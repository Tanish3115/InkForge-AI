"""IAM lines + XML word boxes → writer-disjoint text/style-conditioned examples."""
import argparse
import json
import random
import xml.etree.ElementTree as ET
from collections import defaultdict, Counter
from pathlib import Path
from PIL import Image
from data import iam_rows, write_manifest, read_manifest

def prepare(root, output, seed=42):
    root, output = Path(root).resolve(), Path(output)
    lines = iam_rows(root); trees = {}; words = []; skipped = []
    for row in lines:
        # IAM's err flag concerns word segmentation; these boxes are unsuitable here.
        if row['word_segmentation'] != 'ok': continue
        form = row['id'].rsplit('-', 1)[0]
        try:
            if form not in trees: trees[form] = ET.parse(root / 'xml' / (form + '.xml')).getroot()
            line = trees[form].find(f".//line[@id='{row['id']}']")
            if line is None: raise ValueError('Missing XML line')
            with Image.open(row['image']) as image:
                image.verify()
            for word in line.findall('word'):
                components = word.findall('cmp'); text = word.get('text', '')
                if not components or not text.strip() or len(text) > 38: continue
                x0 = min(int(c.get('x')) for c in components); y0 = min(int(c.get('y')) for c in components)
                x1 = max(int(c.get('x')) + int(c.get('width')) for c in components); y1 = max(int(c.get('y')) + int(c.get('height')) for c in components)
                x, y = max(0, x0 - row['box'][0] - 2), max(0, y0 - row['box'][1] - 2)
                width = min(row['box'][2], x1 - row['box'][0] + 2) - x; height = min(row['box'][3], y1 - row['box'][1] + 2) - y
                if width < 3 or height < 3: continue
                words.append({'id': word.get('id'), 'line': row['id'], 'image': row['image'], 'box': [x, y, width, height], 'writer': row['writer'], 'text': text, 'dataset': 'iam', 'language': 'en'})
        except (OSError, ValueError, ET.ParseError) as error: skipped.append({'line': row['id'], 'reason': str(error)})
    writers = sorted({r['writer'] for r in words}); random.Random(seed).shuffle(writers); n = max(1, round(len(writers) * .1))
    groups = {'validation': set(writers[:n]), 'test': set(writers[n:n * 2]), 'train': set(writers[n * 2:])}
    output.mkdir(parents=True, exist_ok=True)
    report = {'seed': seed, 'total_words': len(words), 'writers': len(writers), 'skipped': skipped, 'splits': {}, 'limitation': 'Writer-disjoint within this experiment. Pretrained DiffusionPen and TrOCR already used IAM; this is not independent unseen-data evaluation.'}
    for name, ids in groups.items():
        subset = [r for r in words if r['writer'] in ids]; write_manifest(output / (name + '.jsonl'), subset)
        report['splits'][name] = {'words': len(subset), 'writers': sorted(ids)}
    (output / 'protocol.json').write_text(json.dumps(report, indent=2))
    return report

def crop(row):
    image = Image.open(row['image']).convert('RGB'); x, y, w, h = row['box']; return image.crop((x, y, x + w, y + h))

class SynthesisDataset:
    def __init__(self, manifest, seed=42, limit=None):
        self.rows = read_manifest(manifest); self.seed = seed
        self.writers = defaultdict(list)
        for row in self.rows: self.writers[row['writer']].append(row)
        line_counts = Counter((r['writer'], r['line']) for r in self.rows)
        text_counts = Counter((r['writer'], r['text'].casefold()) for r in self.rows)
        combined = Counter((r['writer'], r['line'], r['text'].casefold()) for r in self.rows)
        valid = [r for r in self.rows if len(self.writers[r['writer']]) - line_counts[r['writer'], r['line']] - text_counts[r['writer'], r['text'].casefold()] + combined[r['writer'], r['line'], r['text'].casefold()] >= 5]
        self.rows = random.Random(seed).sample(valid, min(limit, len(valid))) if limit else valid
        if not self.rows: raise ValueError('No targets with five independent same-writer word references were found.')
    def candidates(self, row): return [r for r in self.writers[row['writer']] if r['line'] != row['line'] and r['text'].casefold() != row['text'].casefold()]
    def references(self, index): return random.Random(self.seed + index).sample(self.candidates(self.rows[index]), 5)
    def __len__(self): return len(self.rows)
    def __getitem__(self, index):
        import torch
        import numpy as np
        from server.model import normalize
        row = self.rows[index]
        def tensor(item): return torch.from_numpy(np.array(normalize(crop(item))).copy()).permute(2, 0, 1).float() / 127.5 - 1
        return {'image': tensor(row), 'style': torch.stack([tensor(ref) for ref in self.references(index)]), 'text': row['text']}

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--root', required=True); p.add_argument('--output', default='research/data/synthesis'); a = p.parse_args()
    r = prepare(a.root, a.output); print(json.dumps({k: v for k, v in r.items() if k not in ['skipped', 'splits']}, indent=2)); print({k: v['words'] for k, v in r['splits'].items()})
