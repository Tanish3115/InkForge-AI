import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import torch
from PIL import Image, ImageDraw
from dataset import SynthesisDataset
from metrics import error_rates
from server.model import normalize, reference_tensor, document_noise

class SynthesisTests(unittest.TestCase):
    def test_document_noise_is_shared_and_seeded(self):
        anchor = document_noise(42, 'cpu')
        self.assertTrue(torch.equal(anchor, document_noise(42, 'cpu')))
        self.assertFalse(torch.equal(anchor, document_noise(43, 'cpu')))
        word_sample = anchor.clone()
        word_sample.zero_()
        self.assertTrue(torch.equal(anchor, document_noise(42, 'cpu')))
    def test_metrics_include_insertions(self):
        self.assertEqual(error_rates(['one'], ['one two'])['wer'], 1)
        self.assertEqual(error_rates(['hello'], ['hello'])['cer'], 0)
    def test_reference_normalization_preserves_aspect_and_rejects_empty(self):
        image = Image.new('RGB', (300, 100), 'white'); ImageDraw.Draw(image).line((30, 40, 240, 60), fill='black', width=8)
        self.assertEqual(normalize(image).size, (256, 64))
        with self.assertRaises(ValueError): normalize(Image.new('RGB', (100, 100), 'white'))
        with self.assertRaises(ValueError): reference_tensor([image] * 4, torch.device('cpu'))
        self.assertEqual(tuple(reference_tensor([image] * 5, torch.device('cpu')).shape), (5, 3, 64, 256))
    def test_real_iam_batches_and_reference_exclusion(self):
        manifest = Path('research/data/synthesis/train.jsonl')
        if not manifest.exists(): self.skipTest('Authorized IAM manifests are not present.')
        data = SynthesisDataset(manifest, limit=2)
        item = data[0]
        self.assertEqual(tuple(item['image'].shape), (3, 64, 256)); self.assertEqual(tuple(item['style'].shape), (5, 3, 64, 256))
        refs = data.references(0); row = data.rows[0]
        self.assertTrue(all(r['writer'] == row['writer'] and r['line'] != row['line'] and r['text'].casefold() != row['text'].casefold() for r in refs))
        self.assertEqual(len({r['id'] for r in refs}), 5)

if __name__ == '__main__': unittest.main()
