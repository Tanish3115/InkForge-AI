"""Real DiffusionPen adapter. Model files remain local and outside the web build."""
import base64
import hashlib
import io
import math
import os
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = Path(os.environ.get("INKFORGE_MODEL_DIR", ROOT / ".cache/diffusionpen-model"))
LOCK = threading.Lock()


def white_background(image):
    """Preserve transparent pen ink instead of converting its background to black."""
    if image.width * image.height > 12_000_000:
        raise ValueError("Reference images must be below 12 megapixels.")
    rgba = ImageOps.exif_transpose(image).convert("RGBA")
    return Image.alpha_composite(Image.new("RGBA", rgba.size, "white"), rgba).convert("RGB")


def normalize(image):
    import cv2
    image = white_background(image)
    array = np.array(image)
    gray = cv2.cvtColor(array, cv2.COLOR_RGB2GRAY)
    mask = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY_INV)[1]
    points = cv2.findNonZero(mask)
    if points is None:
        raise ValueError("A reference contains no visible handwriting ink.")
    x, y, width, height = cv2.boundingRect(points)
    if width < 3 or height < 3:
        raise ValueError("A reference sample is too small.")
    image = image.crop((max(0, x - 3), max(0, y - 3), min(image.width, x + width + 3), min(image.height, y + height + 3)))
    scale = min(256 / image.width, 64 / image.height)
    image = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
    target = Image.new("RGB", (256, 64), "white")
    target.paste(image, ((256 - image.width) // 2, (64 - image.height) // 2))
    return target


def reference_tensor(images, device):
    import torch
    if len(images) != 5:
        raise ValueError("DiffusionPen requires exactly five word/reference crops per style.")
    return torch.stack([torch.from_numpy(np.array(normalize(image)).copy()).permute(2, 0, 1).float() / 127.5 - 1 for image in images]).to(device)


def png_data(image):
    data = np.array(image.convert("RGB"))
    alpha = 255 - data.min(axis=2)
    alpha[alpha < 12] = 0
    columns = np.where((alpha > 35).any(axis=0))[0]
    if not len(columns):
        raise ValueError("The neural model generated a blank image. Try another seed or reference.")
    left, right = max(0, int(columns[0]) - 2), min(data.shape[1], int(columns[-1]) + 3)
    rgba = np.zeros((64, right - left, 4), dtype=np.uint8)
    rgba[:, :, 3] = alpha[:, left:right]
    stream = io.BytesIO(); Image.fromarray(rgba).save(stream, format="PNG")
    return "data:image/png;base64," + base64.b64encode(stream.getvalue()).decode(), right - left


def document_noise(seed, device):
    """One latent anchor per document, independent of word count and ordering.

    Text conditioning still changes the letterforms. Reusing the latent avoids
    injecting a completely different diffusion realization for every word.
    """
    import torch
    generator = torch.Generator(device=device).manual_seed(seed)
    return torch.randn((1, 4, 8, 32), generator=generator, device=device)


def validate_generation(words, variant_ids=None, stroke_variation=.12, style_fidelity=.9):
    if not words or len(words) > 80 or any(not isinstance(word,str) or not word.strip() or len(word)>38 for word in words):
        raise ValueError("Use 1–80 nonempty words with at most 38 characters per word in neural mode.")
    for name,value in (("stroke variation",stroke_variation),("style fidelity",style_fidelity)):
        if not isinstance(value,(int,float)) or not math.isfinite(value) or not 0<=value<=1:
            raise ValueError(f"Use {name} between 0 and 1.")
    variants = [0]*len(words) if not variant_ids else list(variant_ids)
    if len(variants)!=len(words) or any(type(value) is not int or value not in (0,1,2) for value in variants):
        raise ValueError("Provide one variant ID (0–2) per word.")
    return variants


def variant_strength(stroke_variation, style_fidelity):
    """A bounded inference residual, not reconstructed pen pressure/trajectories."""
    return .08*math.sqrt(stroke_variation)*(1-.5*style_fidelity)


def contextual_noise(anchor, seed, word, variant=0, stroke_variation=.12, style_fidelity=.9):
    """Keep a document anchor; vary only explicitly requested repeated-word forms.

    The same word/variant remains stable across request batches and reordering.
    No reference features are replaced and no global RNG state is consumed.
    """
    if variant==0 or stroke_variation==0:
        return anchor.clone()
    digest=hashlib.sha256(f"{seed}\0{word}\0{variant}".encode('utf-8')).digest()
    residual_seed=int.from_bytes(digest[:8],'big') & ((1<<63)-1)
    residual=document_noise(residual_seed,anchor.device).to(dtype=anchor.dtype)
    strength=variant_strength(stroke_variation,style_fidelity)
    return (anchor+strength*residual)/math.sqrt(1+strength*strength)


class DiffusionPen:
    def __init__(self, checkpoint=None):
        import torch
        import timm
        from torch import nn
        from diffusers import AutoencoderKL, DDIMScheduler
        from transformers import CanineConfig, CanineModel, CanineTokenizer
        from server.vendor.unet import UNetModel
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        if self.device.type == "cpu": torch.set_num_threads(min(8, os.cpu_count() or 1))
        self.tokenizer = CanineTokenizer()
        encoder = CanineModel(CanineConfig())
        args = SimpleNamespace(interpolation=False, mix_rate=None)
        self.unet = UNetModel(image_size=(64, 256), in_channels=4, model_channels=320, out_channels=4,
                              num_res_blocks=1, attention_resolutions=(1, 1), channel_mult=(1, 1), num_heads=4,
                              num_classes=339, context_dim=320, vocab_size=79, text_encoder=encoder, args=args)
        path = Path(checkpoint) if checkpoint else MODEL_DIR / "diffusionpen_iam_model_path/models/ema_ckpt.pt"
        state = torch.load(path, map_location="cpu", weights_only=True)
        # Upstream saved nested DataParallel prefixes, not a different architecture.
        clean = {k.removeprefix("module.").replace("text_encoder.module.", "text_encoder."): v for k, v in state.items()}
        self.unet.load_state_dict(clean, strict=True)
        del state, clean
        self.unet.to(self.device).eval()
        class Encoder(nn.Module):
            def __init__(self):
                super().__init__(); self.model = timm.create_model("mobilenetv2_100", pretrained=False, num_classes=0, global_pool="max")
            def forward(self, x): return self.model(x)
        self.style = Encoder()
        state = torch.load(MODEL_DIR / "style_models/iam_style_diffusionpen.pth", map_location="cpu", weights_only=True)
        expected = self.style.state_dict()
        filtered = {k: v for k, v in state.items() if k in expected and expected[k].shape == v.shape}
        self.style.load_state_dict(filtered, strict=True)
        self.style.to(self.device).eval().requires_grad_(False)
        self.vae = AutoencoderKL.from_pretrained(str(MODEL_DIR / "sd15"), subfolder="vae", local_files_only=True, low_cpu_mem_usage=False).to(self.device).eval().requires_grad_(False)
        self.scheduler_config = DDIMScheduler.from_pretrained(str(MODEL_DIR / "sd15"), subfolder="scheduler", local_files_only=True).config
        self.unet.text_encoder.requires_grad_(False)

    def generate(self, words, references, seed=42, steps=50, variant_ids=None, stroke_variation=.12, style_fidelity=.9):
        import torch
        from diffusers import DDIMScheduler
        variants=validate_generation(words,variant_ids,stroke_variation,style_fidelity)
        started = time.perf_counter(); outputs = []
        scheduler = DDIMScheduler.from_config(self.scheduler_config)
        with torch.inference_mode():
            features = self.style(reference_tensor(references, self.device))
            anchor = document_noise(seed, self.device)
            for word,variant in zip(words,variants):
                tokens = self.tokenizer([word], padding="max_length", max_length=40, return_tensors="pt").to(self.device)
                context = self.unet.text_encoder(**tokens).last_hidden_state
                sample = contextual_noise(anchor,seed,word,variant,stroke_variation,style_fidelity)
                scheduler.set_timesteps(steps, device=self.device)
                for step in scheduler.timesteps:
                    timestep = step.expand(1)
                    predicted = self.unet(sample, timesteps=timestep, context=context, style_extractor=features)
                    sample = scheduler.step(predicted, step, sample).prev_sample
                image = self.vae.decode(sample / .18215).sample
                array = ((image / 2 + .5).clamp(0, 1)[0].cpu().permute(1, 2, 0).numpy() * 255).astype(np.uint8)
                outputs.append(Image.fromarray(array))
        return outputs, {"seconds": time.perf_counter() - started, "device": str(self.device), "steps": steps,
                         "style_policy": "shared-document-latent", "variant_policy":"bounded-context-residual",
                         "variant_strength":variant_strength(stroke_variation,style_fidelity) if any(variants) else 0,
                         "stroke_variation":stroke_variation,"style_fidelity":style_fidelity}


INSTANCE = None
def get_model():
    global INSTANCE
    if INSTANCE is None: INSTANCE = DiffusionPen()
    return INSTANCE
