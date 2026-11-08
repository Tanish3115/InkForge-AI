"""Real DiffusionPen adapter. Model files remain local and outside the web build."""
import base64
import io
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


def normalize(image):
    import cv2
    image = ImageOps.exif_transpose(image).convert("RGB")
    if image.width * image.height > 12_000_000:
        raise ValueError("Reference images must be below 12 megapixels.")
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

    def generate(self, words, references, seed=42, steps=50):
        import torch
        from diffusers import DDIMScheduler
        if not words or len(words) > 80 or any(not word.strip() or len(word) > 38 for word in words):
            raise ValueError("Use 1–80 nonempty words with at most 38 characters per word in neural mode.")
        started = time.perf_counter(); outputs = []
        scheduler = DDIMScheduler.from_config(self.scheduler_config)
        with torch.inference_mode():
            features = self.style(reference_tensor(references, self.device))
            anchor = document_noise(seed, self.device)
            for word in words:
                tokens = self.tokenizer([word], padding="max_length", max_length=40, return_tensors="pt").to(self.device)
                context = self.unet.text_encoder(**tokens).last_hidden_state
                sample = anchor.clone()
                scheduler.set_timesteps(steps, device=self.device)
                for step in scheduler.timesteps:
                    timestep = step.expand(1)
                    predicted = self.unet(sample, timesteps=timestep, context=context, style_extractor=features)
                    sample = scheduler.step(predicted, step, sample).prev_sample
                image = self.vae.decode(sample / .18215).sample
                array = ((image / 2 + .5).clamp(0, 1)[0].cpu().permute(1, 2, 0).numpy() * 255).astype(np.uint8)
                outputs.append(Image.fromarray(array))
        return outputs, {"seconds": time.perf_counter() - started, "device": str(self.device), "steps": steps, "style_policy": "shared-document-latent"}


INSTANCE = None
def get_model():
    global INSTANCE
    if INSTANCE is None: INSTANCE = DiffusionPen()
    return INSTANCE
