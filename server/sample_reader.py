"""Local OCR labels for original uploaded word ink; no dataset-word substitution."""
import base64
import io
import re
from functools import lru_cache

import cv2
import numpy as np
from PIL import Image, ImageOps
from server.model import ROOT


@lru_cache(maxsize=1)
def reader():
    import torch
    from transformers import TrOCRProcessor, VisionEncoderDecoderModel
    torch.set_num_threads(4)
    options = dict(cache_dir=str(ROOT / '.cache/huggingface/hub'), local_files_only=True)
    name = 'microsoft/trocr-small-handwritten'
    processor = TrOCRProcessor.from_pretrained(name, use_fast=False, **options)
    model = VisionEncoderDecoderModel.from_pretrained(name, **options).eval()
    return processor, model


def recognize(images, tokens=48, beams=1):
    import torch
    processor, model = reader()
    result = []
    with torch.inference_mode():
        for start in range(0, len(images), 4):
            pixels = processor(images=images[start:start + 4], return_tensors='pt').pixel_values
            output = model.generate(pixels, max_new_tokens=tokens, num_beams=beams)
            result.extend(text.strip() for text in processor.batch_decode(output, skip_special_tokens=True))
    return result


def decode_page(data):
    if not isinstance(data, str) or len(data) > 12_000_000 or not re.match(r'^data:image/(jpeg|png|webp);base64,', data):
        raise ValueError('Use a JPEG, PNG or WebP handwriting image below the page-size limit.')
    image = Image.open(io.BytesIO(base64.b64decode(data.split(',', 1)[1], validate=True)))
    if image.width * image.height > 5_000_000:
        raise ValueError('Resize the handwriting image below 5 megapixels.')
    return ImageOps.exif_transpose(image).convert('RGB')


def prepare(image):
    gray = np.array(image.convert('L'))
    background = cv2.GaussianBlur(gray, (0, 0), 25)
    gray = cv2.divide(gray, np.maximum(background, 1), scale=255)
    mask = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 51, 10)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    for i in range(1, count):
        if stats[i, cv2.CC_STAT_AREA] < 3:
            mask[labels == i] = 0
    if np.count_nonzero(mask) < 15:
        raise ValueError('No readable ink was found. Upload a sharper image with the writing in focus.')
    # Mild photo tilt correction, based on row projection concentration.
    factor = min(1, 800 / max(gray.shape))
    small = cv2.resize(mask, None, fx=factor, fy=factor, interpolation=cv2.INTER_NEAREST)
    center = (small.shape[1] / 2, small.shape[0] / 2)
    def score(angle):
        rotated = cv2.warpAffine(small, cv2.getRotationMatrix2D(center, angle, 1), (small.shape[1], small.shape[0]), flags=cv2.INTER_NEAREST)
        return float(np.square(np.count_nonzero(rotated, axis=1).astype(float)).sum())
    best, angle = max((score(float(a)), float(a)) for a in np.arange(-8, 8.01, .5))
    if abs(angle) >= .5 and best > score(0) * 1.07:
        matrix = cv2.getRotationMatrix2D((gray.shape[1] / 2, gray.shape[0] / 2), angle, 1)
        gray = cv2.warpAffine(gray, matrix, (gray.shape[1], gray.shape[0]), flags=cv2.INTER_CUBIC, borderValue=255)
        mask = cv2.warpAffine(mask, matrix, (mask.shape[1], mask.shape[0]), flags=cv2.INTER_NEAREST)
    # Remove detected page-frame margins, which otherwise join every text row.
    height, width = mask.shape
    rows, columns = np.count_nonzero(mask, axis=1), np.count_nonzero(mask, axis=0)
    top = np.where((np.arange(height) < height * .08) & (rows > width * .4))[0]
    bottom = np.where((np.arange(height) > height * .92) & (rows > width * .4))[0]
    left = np.where((np.arange(width) < width * .05) & (columns > height * .25))[0]
    right = np.where((np.arange(width) > width * .95) & (columns > height * .25))[0]
    if len(top): mask[:int(top[-1]) + 5] = 0
    if len(bottom): mask[max(0, int(bottom[0]) - 4):] = 0
    if len(left): mask[:, :int(left[-1]) + 5] = 0
    if len(right): mask[:, max(0, int(right[0]) - 4):] = 0
    for kernel in [np.ones((1, max(50, width // 3)), np.uint8), np.ones((max(50, height // 3), 1), np.uint8)]:
        mask = cv2.subtract(mask, cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel))
    # Keep grayscale pen edges, while removing background outside actual ink.
    near = cv2.dilate(mask, np.ones((3, 3), np.uint8)) > 0
    clean = np.where(near, gray, 255).astype(np.uint8)
    clean[mask > 0] = np.minimum(clean[mask > 0], 150)
    return clean, mask


def lines(mask):
    _, _, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    heights = [row[cv2.CC_STAT_HEIGHT] for row in stats[1:] if row[cv2.CC_STAT_HEIGHT] >= 7 and row[cv2.CC_STAT_AREA] >= 10]
    typical = float(np.median(heights)) if heights else 20
    active = np.where(np.count_nonzero(mask, axis=1) > 0)[0]
    if not len(active): return []
    groups = np.split(active, np.where(np.diff(active) > max(4, round(typical * .35)))[0] + 1)
    joined = []; i = 0
    while i < len(groups):
        group = groups[i]
        if i + 1 < len(groups) and group[-1] - group[0] + 1 < typical * .35 and groups[i + 1][0] - group[-1] <= typical * .85:
            group = np.r_[group, groups[i + 1]]; i += 1
        joined.append(group); i += 1
    result = []
    for group in joined:
        top, bottom = int(group[0]), int(group[-1] + 1)
        columns = np.where(mask[top:bottom].any(axis=0))[0]
        if not len(columns) or bottom - top < 5: continue
        left, right = int(columns[0]), int(columns[-1] + 1)
        if (top < mask.shape[0] * .08 or bottom > mask.shape[0] * .92) and bottom - top < typical * .35 and right - left > mask.shape[1] * .4: continue
        if np.count_nonzero(mask[top:bottom, left:right]) >= 12: result.append((left, top, right, bottom))
    return result


def words(mask, line):
    left, top, right, bottom = line; height = bottom - top
    active = mask[top:bottom, left:right].any(axis=0)
    edges = np.diff(np.r_[False, active, False].astype(np.int8))
    runs = list(zip(np.where(edges == 1)[0], np.where(edges == -1)[0]))
    if not runs: return []
    gaps = np.array([runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)], dtype=float)
    threshold = max(3, height * .33)
    bounded = gaps[gaps <= height * 2]
    if len(bounded) >= 2 and bounded.max() > bounded.min() * 2:
        lo, hi = float(bounded.min()), float(bounded.max())
        for _ in range(6):
            a, b = bounded[bounded <= (lo + hi) / 2], bounded[bounded > (lo + hi) / 2]
            if len(a) and len(b): lo, hi = float(a.mean()), float(b.mean())
        if hi > lo * 1.8: threshold = float(np.clip((lo + hi) / 2, height * .28, height * .65))
    result = []; start = 0
    for i in range(len(runs)):
        if i == len(runs) - 1 or gaps[i] >= threshold:
            x0, x1 = int(left + runs[start][0]), int(left + runs[i][1])
            if np.count_nonzero(mask[top:bottom, x0:x1]) >= 10: result.append((x0, top, x1, bottom))
            start = i + 1
    return result


def crop(clean, box, pad=5):
    left, top, right, bottom = box
    return Image.fromarray(clean[max(0, top - pad):min(clean.shape[0], bottom + pad), max(0, left - pad):min(clean.shape[1], right + pad)]).convert('RGB')


def asset(clean, mask, box, line, em, label, identifier):
    left, top, right, bottom = box
    # All words on a line keep exactly the same vertical geometry. There is no
    # per-word stretching, thickening, letter substitution, or generative step.
    left, right = max(0, left - 2), min(clean.shape[1], right + 2)
    top, bottom = max(0, line[1] - 3), min(clean.shape[0], line[3] + 3)
    gray = clean[top:bottom, left:right]
    rgba = np.zeros((*gray.shape, 4), np.uint8)
    rgba[:, :, 3] = 255 - gray
    projection = np.count_nonzero(mask[line[1]:line[3], line[0]:line[2]], axis=1)
    dense = np.where(projection >= max(1, projection.max() * .45))[0]
    baseline = int(line[1] + dense[-1] - top)
    stream = io.BytesIO(); Image.fromarray(rgba).save(stream, format='PNG')
    return dict(id=identifier, text=label, image='data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode(),
                width=rgba.shape[1], height=rgba.shape[0], baseline=baseline, em=em)


def read_sample(image):
    clean, mask = prepare(image); line_boxes = lines(mask)
    if not line_boxes: raise ValueError('No readable handwriting lines were found. Try a clearer, closer image.')
    if len(line_boxes) > 40: raise ValueError('Upload at most 40 handwriting lines at a time.')
    transcripts = recognize([crop(clean, line) for line in line_boxes], tokens=160, beams=2)
    entries = []; pending = []; warnings = []
    for i, (line, text) in enumerate(zip(line_boxes, transcripts)):
        labels = text.split(); boxes = words(mask, line)
        if len(labels) == 1 and 1 < len(boxes) <= 3 and all(boxes[j + 1][0] - boxes[j][2] < (line[3] - line[1]) * .6 for j in range(len(boxes) - 1)):
            boxes = [(boxes[0][0], line[1], boxes[-1][2], line[3])]
        aligned = len(labels) == len(boxes)
        for j, box in enumerate(boxes):
            label = labels[j] if aligned else ''
            entries.append(dict(line=i, box=box, text=label))
            if not aligned or len(re.sub(r'\W', '', label)) <= 3: pending.append((len(entries) - 1, crop(clean, box)))
    if len(entries) > 160: raise ValueError('Upload a smaller section containing at most 160 words.')
    if pending:
        readings = recognize([image for _, image in pending])
        for (i, _), label in zip(pending, readings):
            label = label.strip(); previous = entries[i]['text']
            if re.fullmatch(r'[A-Za-z](?:\s+[A-Za-z]){1,2}', label): label = ''.join(label.split())
            if not previous or (re.fullmatch(r'[A-Za-z0-9]+[.,!?;:]?', label) and len(label) <= 5): entries[i]['text'] = label
            if label != previous: warnings.append('Recognition readings differed for some words. Review the word labels before generating.')
    if not entries or not any(re.search(r'[A-Za-z0-9]', e['text']) for e in entries):
        raise ValueError('The image has ink, but its words could not be read. No empty word library was saved.')
    em = float(np.median([line[3] - line[1] for line in line_boxes]))
    samples = [{**asset(clean, mask, e['box'], line_boxes[e['line']], em, e['text'], f"line-{e['line']}-word-{i}"), 'line':e['line']} for i, e in enumerate(entries)]
    reference_crops = [crop(clean, e['box']) for e in entries]
    candidates = [im for im in reference_crops if im.width / im.height >= 1.2] or reference_crops
    count = min(5, len(candidates)); references = []
    for i in range(count):
        stream = io.BytesIO(); candidates[i * len(candidates) // count].save(stream, format='PNG')
        references.append('data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode())
    while len(references) < 5: references.append(references[len(references) % count])
    transcript = '\n'.join(' '.join(e['text'] for e in entries if e['line'] == i) for i in range(len(line_boxes)))
    return dict(words=samples, transcript=transcript, warnings=sorted(set(warnings)), references=references, referenceCount=count)
