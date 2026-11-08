"""Download official model assets only; no IAM images or optimizer dumps are downloaded."""
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from huggingface_hub import hf_hub_download
from server.model import MODEL_DIR

if __name__ == '__main__':
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for file in ['diffusionpen_iam_model_path/models/ema_ckpt.pt', 'style_models/iam_style_diffusionpen.pth']:
        print('Downloading official DiffusionPen asset:', file, flush=True)
        hf_hub_download('konnik/DiffusionPen', file, local_dir=MODEL_DIR)
    for file in ['vae/config.json', 'vae/diffusion_pytorch_model.safetensors', 'scheduler/scheduler_config.json']:
        print('Downloading SD1.5 VAE/scheduler asset:', file, flush=True)
        hf_hub_download('stable-diffusion-v1-5/stable-diffusion-v1-5', file, local_dir=MODEL_DIR / 'sd15')
    print('Assets ready. Run research/verify_model.py and inspect actual outputs before recording reviewed styles.')
