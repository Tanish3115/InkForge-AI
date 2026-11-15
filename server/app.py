import base64
import io
import os
from typing import Literal
from PIL import Image
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from server.model import MODEL_DIR, LOCK, get_model, png_data, validate_generation, white_background
from server.styles import available_styles, default_references
from server.human_references import human_references, human_reference_status

app = FastAPI(title="InkForge local DiffusionPen service")
origins = os.environ.get("INKFORGE_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173").split(",")
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type"])

class Request(BaseModel):
    words: list[str] = Field(min_length=1, max_length=80)
    style_id: str = "classic"
    reference_source: Literal["font", "iam"] = "font"
    references: list[str] = Field(default_factory=list, max_length=5)
    seed: int = Field(default=42, ge=0, le=2147483000)
    variant_ids: list[Literal[0,1,2]] = Field(default_factory=list,max_length=80)
    stroke_variation: float = Field(default=.12,ge=0,le=1)
    style_fidelity: float = Field(default=.9,ge=0,le=1)

class SampleRequest(BaseModel):
    page: str = Field(max_length=12_000_000)

class PDFRequest(BaseModel):
    document: str = Field(max_length=70_000_000)

class PDFPageRequest(BaseModel):
    page: int = Field(ge=1,le=100)
    rotation: Literal[0,90,180,270] | None = None
    allow_print_like: bool = False

@app.post('/pdf-reference')
def preview_pdf(request:PDFRequest):
    try:
        from server.pdf_reference import create_session
        return create_session(request.document)
    except (ValueError,OSError) as error:raise HTTPException(400,str(error))
    except ImportError:raise HTTPException(503,'Install server/requirements.txt in the local Python environment and restart the service to enable PDFs.')

@app.post('/pdf-reference/{token}/page')
def read_pdf_page(token:str,request:PDFPageRequest):
    try:
        from server.pdf_reference import extract_page
        with LOCK:return extract_page(token,request.page,request.rotation,request.allow_print_like)
    except (ValueError,OSError) as error:raise HTTPException(400,str(error))
    except Exception as error:raise HTTPException(503,f'Local PDF analysis failed: {error}. No profile was saved.')

@app.delete('/pdf-reference/{token}')
def release_pdf(token:str):
    from server.pdf_reference import close_session
    close_session(token)
    return {'released':True}

@app.post('/recognize-sample')
async def recognize_sample(request: SampleRequest):
    from server.sample_reader import decode_page, read_sample
    try:
        page = decode_page(request.page)
        with LOCK: result = read_sample(page)
        return result
    except (ValueError, OSError) as error: raise HTTPException(400, str(error))
    except Exception as error: raise HTTPException(503, f'Local sample recognition failed: {error}. The cached TrOCR handwriting checkpoint is required. No unreadable profile was saved.')

@app.get("/health")
def health():
    files = [MODEL_DIR / "diffusionpen_iam_model_path/models/ema_ckpt.pt", MODEL_DIR / "style_models/iam_style_diffusionpen.pth", MODEL_DIR / "sd15/vae/diffusion_pytorch_model.safetensors"]
    ready = all(p.is_file() for p in files) and (bool(available_styles()) or human_reference_status()["ready"])
    return {"ready": ready, "reason": "Verified DiffusionPen assets available locally." if ready else "Install the model assets and run research/verify_model.py before enabling neural generation.", "styles": available_styles(), "human_reference": human_reference_status()}

@app.get("/styles")
def styles(): return available_styles()

@app.post("/generate")
async def generate(request: Request):
    try:validate_generation(request.words,request.variant_ids,request.stroke_variation,request.style_fidelity)
    except ValueError as error:raise HTTPException(400,str(error))
    if not health()["ready"]: raise HTTPException(503, health()["reason"])
    try:
        if request.references:
            if len(request.references) != 5: raise ValueError("Upload exactly five cropped word references.")
            images = []
            for data in request.references:
                if not data.startswith("data:image/png;base64,") or len(data) > 3_000_000: raise ValueError("Use PNG reference crops below 2 MiB each.")
                image = Image.open(io.BytesIO(base64.b64decode(data.split(",", 1)[1], validate=True)))
                if image.width * image.height > 12_000_000: raise ValueError("Reference dimensions exceed the limit.")
                images.append(white_background(image))
        elif request.reference_source == "iam":
            images = human_references()
        else:
            if request.style_id not in {s["id"] for s in available_styles()}: raise ValueError("This default neural style has not been verified.")
            images = default_references(request.style_id)
        with LOCK:
            output, timing = get_model().generate(request.words, images, request.seed,
                variant_ids=request.variant_ids or None,stroke_variation=request.stroke_variation,style_fidelity=request.style_fidelity)
        words = []
        for word, image in zip(request.words, output):
            data, width = png_data(image); words.append({"text": word, "image": data, "width": width})
        return {"words": words, "timing": timing, "reference": human_reference_status() if request.reference_source == "iam" and not request.references else None}
    except (ValueError, OSError) as error: raise HTTPException(400, str(error))
    except Exception as error: raise HTTPException(503, f"Local neural inference failed: {error}. Browser preset rendering remains available.")
