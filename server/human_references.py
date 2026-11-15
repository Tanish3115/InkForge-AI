"""Local IAM human-ink conditioning; never substitutes font-rendered references."""
import json
from functools import lru_cache
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


@lru_cache(maxsize=1)
def _references():
    manifest = ROOT / 'research/data/synthesis/train.jsonl'
    image_root = (ROOT.parent / 'lines').resolve()
    if not manifest.is_file():
        raise ValueError('Local IAM references are unavailable. Prepare the authorized IAM dataset or upload your own handwriting.')
    # One writer throughout the document, selected deterministically from training data.
    with manifest.open(encoding='utf-8') as stream:
        candidates = []
        for entry in stream:
            row = json.loads(entry)
            if row.get('dataset') == 'iam' and row.get('writer') == '000' and len(row.get('text', '')) >= 5:
                candidates.append(row)
    images, lines, words = [], set(), []
    for row in candidates:
        path = Path(row['image'])
        if not path.is_absolute(): path = ROOT / path
        path = path.resolve()
        if not path.is_relative_to(image_root) or not path.is_file(): continue
        if row['line'] in lines: continue
        x, y, width, height = map(int, row['box'])
        with Image.open(path) as source:
            if width <= 0 or height <= 0 or x < 0 or y < 0 or x+width > source.width or y+height > source.height: continue
            crop = source.convert('RGB').crop((x, y, x+width, y+height))
        ink = crop.convert('L').point(lambda value: 255 if value < 160 else 0)
        if sum(ink.histogram()[128:]) < 25: continue
        images.append(crop)
        lines.add(row['line'])
        words.append(row['text'])
        if len(images) == 5: break
    if len(images) != 5:
        raise ValueError('Five readable local IAM crops from writer 000 are required. Prepare the dataset or upload your own handwriting.')
    return images, words


def human_references():
    return [image.copy() for image in _references()[0]]


def human_reference_status():
    try:
        _, words = _references()
        return {'ready': True, 'writer': '000', 'dataset': 'IAM', 'words': words,
                'provenance': 'Five original human-written crops from local IAM writer 000; AI-generated output. Local non-commercial research use.'}
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as error:
        return {'ready': False, 'reason': str(error)}
