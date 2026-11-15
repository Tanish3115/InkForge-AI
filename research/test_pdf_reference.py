"""Real native PDF parsing/rasterization; synthetic OCR is labeled as such."""
import base64
import io
import json
import subprocess
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import numpy as np
from PIL import Image,ImageDraw,ImageFont,ImageFilter
from server import pdf_reference as pdf


def drawing():
    image=Image.new('RGB',(800,360),'white');draw=ImageDraw.Draw(image)
    for y in (70,160,250):
        for offset in (0,250):
            draw.line([(40+offset,y+25),(65+offset,y-10),(90+offset,y+20),(120+offset,y),(155+offset,y+30),(190+offset,y)],fill='black',width=4)
    return image


def pdf_bytes(image=None,pages=1,printed=False,encrypted=False):
    # jsPDF is already a production dependency. These are validation fixtures,
    # not handwriting-generation results or an added PDF-writing dependency.
    script="""import {jsPDF} from 'jspdf';import fs from 'node:fs';
const x=JSON.parse(fs.readFileSync(0,'utf8'));
const doc=new jsPDF({encryption:x.encrypted?{userPassword:'secret',ownerPassword:'owner'}:undefined});
for(let i=0;i<x.pages;i++){if(i)doc.addPage();if(x.printed)doc.text('DIGITAL PRINTED HEADING',20,20);if(x.image)doc.addImage(x.image,'PNG',20,45,170,76.5);}
process.stdout.write(Buffer.from(doc.output('arraybuffer')));"""
    data=dict(pages=pages,printed=printed,encrypted=encrypted)
    if image:
        output=io.BytesIO();image.save(output,format='PNG');data['image']='data:image/png;base64,'+base64.b64encode(output.getvalue()).decode()
    return subprocess.run(['node','--input-type=module','-e',script],input=json.dumps(data).encode(),capture_output=True,check=True).stdout


def upload(payload):return pdf.create_session('data:application/pdf;base64,'+base64.b64encode(payload).decode())


class PDFTests(unittest.TestCase):
    def tearDown(self):
        with pdf.SESSION_LOCK:pdf.SESSIONS.clear()

    def test_native_print_is_removed_without_changing_real_raster_ink(self):
        source=pdf_bytes(drawing());mixed=pdf_bytes(drawing(),printed=True)
        preview=upload(mixed)
        self.assertTrue(preview['pages'][0]['eligible']);self.assertGreater(preview['pages'][0]['nativeTextObjects'],0)
        first=pdf.native('render',source,page=1);second=pdf.native('render',mixed,page=1)
        a=np.array(Image.open(io.BytesIO(base64.b64decode(first['image'].split(',')[1]))))
        b=np.array(Image.open(io.BytesIO(base64.b64decode(second['image'].split(',')[1]))))
        self.assertTrue(np.array_equal(a,b));self.assertEqual(second['dpi'],300)

    def test_text_only_and_blank_pages_are_ineligible(self):
        text=upload(pdf_bytes(printed=True));blank=upload(pdf_bytes())
        self.assertFalse(text['pages'][0]['eligible']);self.assertIn('PDF text',text['pages'][0]['reason'])
        self.assertFalse(blank['pages'][0]['eligible'])
        self.assertEqual(pdf.extract_page(blank['session'],1,0)['status'],'excluded')

    def test_corrupt_encrypted_and_excessive_page_counts_are_rejected(self):
        for payload in (b'not a pdf',b'%PDF-1.7\ncorrupt',pdf_bytes(encrypted=True)):
            with self.assertRaises(ValueError):upload(payload)
        with self.assertRaisesRegex(ValueError,'split it first'):upload(pdf_bytes(pages=41))

    def test_selected_page_uses_shared_image_reader_and_preserves_page_identity(self):
        preview=upload(pdf_bytes(drawing(),pages=3))
        image=drawing().convert('RGBA');output=io.BytesIO();image.save(output,format='PNG');url='data:image/png;base64,'+base64.b64encode(output.getvalue()).decode()
        result=dict(words=[dict(id='line-0-word-0',text='fixture',image=url,width=800,height=360,baseline=280,em=160,line=0)],
                    transcript='fixture',references=[url]*5,referenceCount=1,warnings=[])
        with patch('server.sample_reader.read_sample',return_value=result) as reader:
            page=pdf.extract_page(preview['session'],3,0)
        reader.assert_called_once();self.assertEqual(page['status'],'ready')
        self.assertEqual(page['words'][0]['page'],3);self.assertEqual(page['words'][0]['line'],80)
        self.assertEqual(page['words'][0]['id'],'pdf-p3-line-0-word-0');self.assertEqual(len(page['references']),5)

    def test_expiry_release_and_native_timeout_are_bounded(self):
        item=upload(pdf_bytes(drawing()))
        pdf.SESSIONS[item['session']]['expires']=time.monotonic()-1
        with self.assertRaisesRegex(ValueError,'expired'):pdf.session(item['session'])
        with patch('server.pdf_reference.subprocess.run',side_effect=subprocess.TimeoutExpired('renderer',1)):
            with self.assertRaisesRegex(ValueError,'processing limit'):pdf.native('preview',b'%PDF-test')
        pdf.close_session('already-released')

    def test_suspected_print_requires_review_before_shared_reader_is_used(self):
        preview=upload(pdf_bytes(drawing()))
        image=drawing();output=io.BytesIO();image.save(output,format='PNG');url='data:image/png;base64,'+base64.b64encode(output.getvalue()).decode()
        quality=dict(blank=False,possiblePrint=True,bodyHeight=30,strokeRatio=.1,slant=0,sharpness=100)
        result=dict(words=[dict(id='word',text='fixture',image=url,width=800,height=360,baseline=280,em=160,line=0)],transcript='fixture',references=[url]*5,referenceCount=1,warnings=[])
        with patch('server.pdf_reference.ink_quality',return_value=quality),patch('server.sample_reader.read_sample',return_value=result) as reader:
            self.assertEqual(pdf.extract_page(preview['session'],1,0)['status'],'excluded');reader.assert_not_called()
            accepted=pdf.extract_page(preview['session'],1,0,True)
        self.assertEqual(accepted['status'],'ready');reader.assert_called_once()
        self.assertTrue(any('after your review' in warning for warning in accepted['warnings']))

    def test_quality_flags_repetitive_print_and_measures_actual_ink(self):
        image=Image.new('RGB',(1400,600),'white');draw=ImageDraw.Draw(image)
        font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf' if sys.platform=='win32' else 'DejaVuSans.ttf',34)
        for y in range(30,550,65):draw.text((30,y),'Printed material repeats familiar letter shapes in a regular pattern.',font=font,fill='black')
        printed=pdf.ink_quality(image);human_fixture=pdf.ink_quality(drawing())
        self.assertTrue(printed['possiblePrint']);self.assertFalse(human_fixture['possiblePrint'])
        self.assertGreater(human_fixture['bodyHeight'],0);self.assertGreater(human_fixture['strokeRatio'],0)

    def test_orientation_applies_only_a_clear_scored_winner(self):
        # Explicitly mocked OCR confidences test the safety rule, not recognition accuracy.
        def scored(images):
            values=[.1,.85,.15,.2]
            return [dict(text='fixture',confidence=values[i]) for i,_ in enumerate(images)]
        with patch('server.sample_reader.lines',return_value=[(10,10,110,30)]),patch('server.sample_reader.recognize_scored',side_effect=scored):
            image,angle,warnings=pdf.orient(drawing(),None)
        self.assertEqual(angle,90);self.assertTrue(warnings);image.close()
        with patch('server.sample_reader.recognize_scored',return_value=[dict(text='fixture',confidence=.4)]*8):
            image,angle,_=pdf.orient(drawing(),None)
        self.assertEqual(angle,0);image.close()


if __name__=='__main__':unittest.main()
