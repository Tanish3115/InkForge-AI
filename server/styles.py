"""Default references are licensed font-derived images, never redistributed IAM writers."""
import json
import base64
from PIL import Image, ImageDraw, ImageFont
from server.model import ROOT, MODEL_DIR

FONTS = {"classic": ("Caveat.ttf", "Caveat-conditioned"), "neat": ("PatrickHand.ttf", "Patrick Hand-conditioned")}
def default_references(style_id):
    if style_id not in FONTS: raise ValueError("Unknown neural reference style.")
    file, _ = FONTS[style_id]
    font = ImageFont.truetype(str(ROOT / "public/fonts" / file), 45)
    images = []
    for word in ["gentle", "morning", "paper", "thoughts", "wander"]:
        image = Image.new("RGB", (256, 64), "white"); draw = ImageDraw.Draw(image); box = draw.textbbox((0, 0), word, font=font)
        draw.text(((256 - box[2] + box[0]) / 2, (64 - box[3] + box[1]) / 2 - box[1]), word, fill="black", font=font); images.append(image)
    return images

def available_styles():
    path = MODEL_DIR / "verification.json"
    if not path.exists(): return []
    data = json.loads(path.read_text())
    result = []
    for key in data.get('verified_styles', []):
        if key not in FONTS: continue
        preview = MODEL_DIR / 'proof' / f'{key}-hello.png'
        result.append({'id': key, 'name': FONTS[key][1], 'provenance': 'Five synthetic word references rendered from SIL-OFL handwriting fonts; neural output is approximate.',
                       'preview': 'data:image/png;base64,' + base64.b64encode(preview.read_bytes()).decode() if preview.exists() else None})
    return result
