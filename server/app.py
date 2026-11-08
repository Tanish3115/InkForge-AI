import base64
import io
import os
from PIL import Image
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from server.model import MODEL_DIR, LOCK, get_model, png_data
from server.styles import available_styles, default_references

app = FastAPI(title="InkForge local DiffusionPen service")
origins = os.environ.get("INKFORGE_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173").split(",")
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

class Request(BaseModel):
    words: list[str] = Field(min_length=1, max_length=80)
    style_id: str = "classic"
    references: list[str] = Field(default_factory=list, max_length=5)
    seed: int = Field(default=42, ge=0, le=2147483000)

class SampleRequest(BaseModel):
    page: str = Field(max_length=12_000_000)

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
    ready = all(p.is_file() for p in files) and bool(available_styles())
    return {"ready": ready, "reason": "Verified DiffusionPen assets available locally." if ready else "Install the model assets and run research/verify_model.py before enabling neural generation.", "styles": available_styles()}

@app.get("/styles")
def styles(): return available_styles()

@app.post("/generate")
async def generate(request: Request):
    if not health()["ready"]: raise HTTPException(503, health()["reason"])
    try:
        if request.references:
            if len(request.references) != 5: raise ValueError("Upload exactly five cropped word references.")
            images = []
            for data in request.references:
                if not data.startswith("data:image/png;base64,") or len(data) > 3_000_000: raise ValueError("Use PNG reference crops below 2 MiB each.")
                image = Image.open(io.BytesIO(base64.b64decode(data.split(",", 1)[1], validate=True)))
                if image.width * image.height > 12_000_000: raise ValueError("Reference dimensions exceed the limit.")
                images.append(image.convert("RGB"))
        else:
            if request.style_id not in {s["id"] for s in available_styles()}: raise ValueError("This default neural style has not been verified.")
            images = default_references(request.style_id)
        with LOCK:
            output, timing = get_model().generate(request.words, images, request.seed)
        words = []
        for word, image in zip(request.words, output):
            data, width = png_data(image); words.append({"text": word, "image": data, "width": width})
        return {"words": words, "timing": timing}
    except (ValueError, OSError) as error: raise HTTPException(400, str(error))
    except Exception as error: raise HTTPException(503, f"Local neural inference failed: {error}. Browser preset rendering remains available.")
