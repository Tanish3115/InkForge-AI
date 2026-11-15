"""Inference controls regressions; these tests do not claim model training."""
import asyncio
import inspect
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock,patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import numpy as np
import torch
from PIL import Image,ImageDraw
from pydantic import ValidationError
from fastapi import HTTPException
from server.model import (DiffusionPen,document_noise,contextual_noise,variant_strength,
                          validate_generation,normalize,white_background)
from server.app import Request,generate


class RefinementModelTests(unittest.TestCase):
    def test_legacy_arguments_and_primary_variants_preserve_document_anchor(self):
        # Research callers' fourth positional parameter remains the step count.
        parameters=list(inspect.signature(DiffusionPen.generate).parameters)
        self.assertEqual(parameters[:5],['self','words','references','seed','steps'])
        self.assertEqual(validate_generation(['alpha','beta']),[0,0])
        anchor=document_noise(42,'cpu')
        original=anchor.clone()
        for stroke in (0,.12,1):
            for fidelity in (0,.9,1):
                result=contextual_noise(anchor,42,'alpha',0,stroke,fidelity)
                self.assertTrue(torch.equal(result,anchor));result.zero_()
                self.assertTrue(torch.equal(anchor,original))

    def test_variants_are_word_context_seeded_bounded_and_order_independent(self):
        anchor=document_noise(42,'cpu')
        settings=dict(stroke_variation=.12,style_fidelity=.9)
        first=contextual_noise(anchor,42,'committee',1,**settings)
        self.assertTrue(torch.equal(first,contextual_noise(anchor,42,'committee',1,**settings)))
        self.assertFalse(torch.equal(first,anchor))
        self.assertFalse(torch.equal(first,contextual_noise(anchor,42,'committee',2,**settings)))
        self.assertFalse(torch.equal(first,contextual_noise(anchor,42,'balloon',1,**settings)))
        self.assertLess(float((first-anchor).square().mean().sqrt()),.03)
        largest=contextual_noise(anchor,42,'committee',1,1,0)
        self.assertLess(float((largest-anchor).square().mean().sqrt()),.1)
        self.assertEqual(variant_strength(1,0),.08)
        self.assertTrue(torch.equal(contextual_noise(anchor,42,'committee',1,0,0),anchor))
        self.assertGreater(variant_strength(.5,.1),variant_strength(.5,.9))
        self.assertGreater(variant_strength(.7,.9),variant_strength(.1,.9))

    def test_invalid_controls_and_incomplete_variants_fail_before_model_loading(self):
        for value in (-.1,1.1,float('nan'),float('inf')):
            with self.assertRaises(ValidationError):Request(words=['hello'],stroke_variation=value)
            with self.assertRaises(ValidationError):Request(words=['hello'],style_fidelity=value)
        with self.assertRaises(ValidationError):Request(words=['hello'],variant_ids=[3])
        with patch('server.app.get_model',side_effect=AssertionError('must not load')):
            for request in (Request(words=['one','two'],variant_ids=[1]),Request(words=['x'*39])):
                with self.assertRaises(HTTPException) as error:asyncio.run(generate(request))
                self.assertEqual(error.exception.status_code,400)
        for variants in ([0,1],[-1],[True],['1']):
            with self.assertRaises(ValueError):validate_generation(['one'],variants)

    def test_transparent_reference_ink_is_composited_on_white(self):
        transparent=Image.new('RGBA',(150,60),(0,0,0,0))
        ImageDraw.Draw(transparent).line((15,25,130,35),fill=(0,0,0,255),width=4)
        white=white_background(transparent)
        self.assertEqual(white.getpixel((0,0)),(255,255,255))
        self.assertEqual(white.getpixel((75,30)),(0,0,0))
        self.assertTrue(np.array_equal(np.array(normalize(transparent)),np.array(normalize(white))))

    def test_api_passes_controls_and_original_references_to_same_model(self):
        image=Image.new('RGB',(256,64),'white')
        ImageDraw.Draw(image).line((10,30,100,35),fill='black',width=4)
        model=Mock();model.generate.return_value=([image,image],{'seconds':0,'style_policy':'shared-document-latent'})
        references=[image]*5
        request=Request(words=['hello','hello'],variant_ids=[0,1],stroke_variation=.2,style_fidelity=.95)
        with patch('server.app.health',return_value={'ready':True}),patch('server.app.available_styles',return_value=[{'id':'classic'}]),patch('server.app.default_references',return_value=references),patch('server.app.get_model',return_value=model):
            result=asyncio.run(generate(request))
        model.generate.assert_called_once_with(['hello','hello'],references,42,variant_ids=[0,1],stroke_variation=.2,style_fidelity=.95)
        self.assertEqual([word['text'] for word in result['words']],['hello','hello'])


if __name__=='__main__':unittest.main()
