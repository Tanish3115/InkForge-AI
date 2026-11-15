"""Verify human-crop selection and routing without asserting model accuracy."""
import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server.app import Request, generate
from server.human_references import human_references, human_reference_status


class HumanReferenceTests(unittest.TestCase):
    def test_local_five_real_crops_are_available_and_return_independent_copies(self):
        status = human_reference_status()
        self.assertTrue(status['ready'], status)
        self.assertEqual(status['writer'], '000')
        first, second = human_references(), human_references()
        self.assertEqual(len(first), 5)
        self.assertEqual(len(set(image.tobytes() for image in first)), 5)
        for a, b in zip(first, second):
            self.assertIsNot(a, b)
            self.assertEqual(a.tobytes(), b.tobytes())

    def test_iam_route_never_calls_font_reference_builder(self):
        model = Mock()
        model.generate.return_value = ([human_references()[0].resize((256, 64))], {'seconds': 0})
        with patch('server.app.health', return_value={'ready': True}), patch('server.app.get_model', return_value=model), patch('server.app.default_references', side_effect=AssertionError('Font fallback forbidden')):
            result = asyncio.run(generate(Request(words=['future'], reference_source='iam')))
        self.assertEqual(result['reference']['writer'], '000')
        self.assertEqual(len(model.generate.call_args.args[1]), 5)


if __name__ == '__main__': unittest.main()
