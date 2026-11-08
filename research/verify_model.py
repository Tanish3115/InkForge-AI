"""Execute real DiffusionPen inference and save proof images for visual review."""
import argparse
import hashlib
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server.model import DiffusionPen, MODEL_DIR
from server.styles import default_references

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--steps', type=int, default=50)
    parser.add_argument('--output', default=str(MODEL_DIR / 'proof'))
    parser.add_argument('--record-reviewed-styles', nargs='+', choices=['classic', 'neat'], help='Explicitly record styles only after reviewing the actual generated proof images.')
    args = parser.parse_args()
    output = Path(args.output); output.mkdir(parents=True, exist_ok=True)
    model = DiffusionPen()
    report = {'model': 'konnik/DiffusionPen EMA pretrained', 'reference_provenance': 'SIL-OFL font-derived references, not IAM writer samples', 'styles': {}, 'verified_styles': []}
    for style in ['classic', 'neat']:
        images, timing = model.generate(['hello', 'future'], default_references(style), seed=42, steps=args.steps)
        records = []
        for word, image in zip(['hello', 'future'], images):
            path = output / f'{style}-{word}.png'; image.save(path)
            records.append({'text': word, 'file': str(path), 'sha256': hashlib.sha256(image.tobytes()).hexdigest(), 'ink_pixels': int((np.array(image).mean(axis=2) < 180).sum())})
        report['styles'][style] = {'timing': timing, 'outputs': records}
        print(json.dumps({'style': style, **timing}), flush=True)
    # Readiness is deliberately gated on a separate explicit visual/text review.
    (output / 'inference.json').write_text(json.dumps(report, indent=2))
    if args.record_reviewed_styles:
        if args.steps < 50: raise ValueError('Use the verified 50-step sampling procedure for readiness checks.')
        report['verified_styles'] = args.record_reviewed_styles
        report['review'] = 'Operator recorded visual review of the actual deterministic proof images. This is not an accuracy guarantee.'
        (MODEL_DIR / 'verification.json').write_text(json.dumps(report, indent=2))
    print('Real outputs saved. Review their legibility before recording verified styles.', flush=True)

if __name__ == '__main__': main()
