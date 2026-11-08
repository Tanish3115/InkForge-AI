import base64
import io
import unittest
from unittest.mock import patch
import numpy as np
from PIL import Image, ImageDraw
from server.sample_reader import prepare, lines, words, read_sample


def note():
    page = Image.new('RGB', (250, 130), (235, 230, 220)); draw = ImageDraw.Draw(page)
    draw.line((30, 40, 30, 78), fill='black', width=3)
    draw.line((48, 40, 48, 78), fill='black', width=3)
    draw.line((30, 59, 48, 59), fill='black', width=3)
    draw.line((58, 53, 58, 78), fill='black', width=2)
    draw.ellipse((56, 40, 60, 44), fill='black')
    draw.line((130, 40, 130, 78), fill='black', width=2)
    return page


class SampleReaderTests(unittest.TestCase):
    def test_narrow_words_and_detached_dots_are_retained(self):
        _, mask = prepare(note()); boxes = lines(mask)
        self.assertEqual(len(boxes), 1)
        crops = words(mask, boxes[0]); self.assertEqual(len(crops), 2)
        self.assertLess(crops[1][2] - crops[1][0], 8)
        self.assertLessEqual(crops[0][1], 40)
        self.assertGreaterEqual(crops[0][3], 78)

    def test_source_words_keep_shared_pixel_scale_and_unchanged_shapes(self):
        with patch('server.sample_reader.recognize', side_effect=[['Hi I'], ['Hi', 'I']]): result = read_sample(note())
        self.assertEqual(result['transcript'], 'Hi I')
        self.assertEqual([word['text'] for word in result['words']], ['Hi', 'I'])
        first, second = result['words']
        self.assertEqual(first['em'], second['em'])
        self.assertEqual(first['height'], second['height'])
        self.assertEqual(first['baseline'], second['baseline'])
        pixels = np.array(Image.open(io.BytesIO(base64.b64decode(first['image'].split(',')[1]))))
        self.assertEqual(pixels.shape[:2], (first['height'], first['width']))
        self.assertTrue((pixels[:, :, 3] > 0).any())
        self.assertTrue((pixels[:, :, 3] == 0).any())
        self.assertEqual(len(result['references']), 5)
        # References passed to the neural model have real white paper, not
        # transparent-black backgrounds which RGB conversion would darken.
        reference = Image.open(io.BytesIO(base64.b64decode(result['references'][0].split(',')[1])))
        self.assertEqual(reference.mode, 'RGB')
        self.assertEqual(reference.getpixel((0, 0)), (255, 255, 255))

    def test_blank_upload_is_an_error_before_recognition(self):
        with patch('server.sample_reader.recognize') as recognize:
            with self.assertRaisesRegex(ValueError, 'No readable ink'): read_sample(Image.new('RGB', (300, 200), 'white'))
            recognize.assert_not_called()

    def test_unreadable_ink_does_not_create_an_empty_library(self):
        with patch('server.sample_reader.recognize', return_value=['']):
            with self.assertRaisesRegex(ValueError, 'could not be read'): read_sample(note())


if __name__ == '__main__': unittest.main()
