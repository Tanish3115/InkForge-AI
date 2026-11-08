"""Compare real synthesis checkpoints/default references/personal IAM references with TrOCR."""
import argparse
import json
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
import torch
from PIL import Image
from transformers import TrOCRProcessor, VisionEncoderDecoderModel
from server.model import DiffusionPen, reference_tensor
from server.styles import default_references
from dataset import SynthesisDataset, crop
from metrics import error_rates

def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--manifest', required=True); p.add_argument('--fine-tuned'); p.add_argument('--max-samples', type=int, default=4); p.add_argument('--steps', type=int, default=50); p.add_argument('--output', default='research/runs/evaluation'); a = p.parse_args()
    data = SynthesisDataset(a.manifest, limit=a.max_samples); output = Path(a.output); output.mkdir(parents=True, exist_ok=True)
    processor = TrOCRProcessor.from_pretrained('microsoft/trocr-small-handwritten', use_fast=False); evaluator = VisionEncoderDecoderModel.from_pretrained('microsoft/trocr-small-handwritten').eval()
    report = {'protocol': 'IAM writer-disjoint fine-tuning split, possible overlap with pretrained synthesis and recognition data; not an independent generalization benchmark.', 'samples': [r['id'] for r in data.rows], 'recognition_evaluator': 'microsoft/trocr-small-handwritten', 'human_readability': 'Not numerically rated. Inspect saved actual images.', 'conditions': {}}
    for label, checkpoint in [('pretrained', None), ('fine_tuned', a.fine_tuned)]:
        if label == 'fine_tuned' and not checkpoint: continue
        model = DiffusionPen(checkpoint)
        for mode in ['default', 'personalized']:
            refs_text, hypotheses, records, similarities, elapsed = [], [], [], [], 0
            for i, row in enumerate(data.rows):
                references = default_references('classic') if mode == 'default' else [crop(ref) for ref in data.references(i)]
                images, timing = model.generate([row['text']], references, 42 + i, a.steps); image = images[0]; elapsed += timing['seconds']; file = output / f'{label}-{mode}-{i}.png'; image.save(file)
                with torch.inference_mode():
                    text = processor.batch_decode(evaluator.generate(processor(images=image, return_tensors='pt').pixel_values, max_new_tokens=64), skip_special_tokens=True)[0].strip()
                    target = model.style(reference_tensor(references, model.device)).mean(dim=0)
                    generated = model.style(reference_tensor([image] * 5, model.device)).mean(dim=0)
                    cosine = torch.nn.functional.cosine_similarity(target[None], generated[None]).item()
                refs_text.append(row['text']); hypotheses.append(text); similarities.append(cosine); records.append({'reference': row['text'], 'recognized': text, 'style_embedding_cosine': cosine, 'file': str(file)})
            report['conditions'][label + '/' + mode] = {**error_rates(refs_text, hypotheses), 'mean_seconds_per_word': elapsed / len(data), 'mean_style_cosine': float(np.mean(similarities)), 'style_metric_note': 'Uncalibrated similarity in the pretrained style encoder; not a human readability score.', 'records': records}
        del model
        import gc; gc.collect()
    (output / 'metrics.json').write_text(json.dumps(report, indent=2)); print(json.dumps(report, indent=2))
    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    names = list(report['conditions']); fig, axes = plt.subplots(1, 3, figsize=(13, 4))
    for axis, key, title in zip(axes, ['cer', 'wer', 'mean_style_cosine'], ['Character error ratio', 'Word error ratio', 'Style embedding cosine']):
        axis.bar(range(len(names)), [report['conditions'][n][key] for n in names]); axis.set_title(title); axis.set_xticks(range(len(names)), names, rotation=25, ha='right')
    fig.suptitle('Measured synthesis smoke experiment · IAM pretraining overlap possible'); fig.tight_layout(); fig.savefig(output / 'comparison.png', dpi=180); plt.close(fig)

if __name__ == '__main__': main()
