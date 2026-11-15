"""Bounded PDF rasterization and the existing image-reference analysis pipeline.

PDF parsing/rendering runs in a disposable process. Sessions retain bytes only,
expire, and never execute JavaScript, launch attachments, or initialize forms.
"""
import base64
import io
import json
import math
import os
import secrets
import subprocess
import sys
import threading
import time
from collections import OrderedDict


def setting(name, default, low, high):
    return max(low, min(high, int(os.environ.get('INKFORGE_PDF_' + name, default))))


LIMITS = dict(maxBytes=setting('MAX_MIB', 25, 1, 50)*1024**2,
              maxPages=setting('MAX_PAGES', 40, 1, 100),
              maxSelected=setting('MAX_SELECTED', 10, 1, 20),
              maxPixels=setting('MAX_PIXELS', 12_000_000, 1_000_000, 20_000_000),
              dpi=setting('DPI', 300, 150, 450), maxWords=1000,
              timeout=setting('RENDER_SECONDS', 45, 5, 90))
SESSION_SECONDS = 15*60
SESSIONS = OrderedDict()
SESSION_LOCK = threading.Lock()
RENDER_SLOTS = threading.BoundedSemaphore(2)
JANITOR_STARTED = False


def _expire_sessions():
    while True:
        time.sleep(30)
        with SESSION_LOCK:
            for key in list(SESSIONS):
                if SESSIONS[key]['expires']<time.monotonic():del SESSIONS[key]


def _memory_limit():
    """Hard 1 GiB per disposable native renderer, independent of torch/service."""
    if os.name != 'nt':
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (1024**3, 1024**3))
        resource.setrlimit(resource.RLIMIT_CPU, (90, 90))
        return
    import ctypes as c
    from ctypes import wintypes as w
    class Basic(c.Structure):
        _fields_ = [('processTime', c.c_int64), ('jobTime', c.c_int64), ('flags', w.DWORD),
                    ('minWS', c.c_size_t), ('maxWS', c.c_size_t), ('active', w.DWORD),
                    ('affinity', c.c_size_t), ('priority', w.DWORD), ('schedule', w.DWORD)]
    class Counters(c.Structure):
        _fields_ = [(name, c.c_uint64) for name in ('readOps','writeOps','otherOps','readBytes','writeBytes','otherBytes')]
    class Extended(c.Structure):
        _fields_ = [('basic', Basic), ('io', Counters), ('processMemory', c.c_size_t),
                    ('jobMemory', c.c_size_t), ('peakProcess', c.c_size_t), ('peakJob', c.c_size_t)]
    kernel = c.WinDLL('kernel32', use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [c.c_void_p, w.LPCWSTR]; kernel.CreateJobObjectW.restype = w.HANDLE
    kernel.SetInformationJobObject.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
    kernel.GetCurrentProcess.restype = w.HANDLE
    job = kernel.CreateJobObjectW(None, None)
    info = Extended(); info.basic.flags = 0x100; info.processMemory = 1024**3
    if not job or not kernel.SetInformationJobObject(job, 9, c.byref(info), c.sizeof(info)) or not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess()):
        raise RuntimeError('Could not apply the PDF renderer memory limit.')
    # Keep the handle until this short-lived process exits.
    globals()['_renderer_job'] = job


def _open(payload):
    import pypdfium2 as pdfium
    try:
        return pdfium.PdfDocument(payload)
    except pdfium.PdfiumError:
        raise ValueError('Could not open the PDF. It may be damaged or encrypted; use a valid password-free PDF.')


def _page_info(page):
    import pypdfium2.raw as raw
    width, height = page.get_size()
    if not all(math.isfinite(v) and 1 <= v <= 14400 for v in (width,height)):
        raise ValueError('A PDF page has unsupported dimensions.')
    text, low_dpi, objects = [], [], list(page.get_objects(max_depth=5))
    if len(objects)>10000:
        raise ValueError('This PDF page contains too many drawing objects.')
    for obj in objects:
        if obj.type == raw.FPDF_PAGEOBJ_TEXT:
            text.append(obj)
        elif obj.type == raw.FPDF_PAGEOBJ_IMAGE:
            left,bottom,right,top = obj.get_bounds()
            area = abs((right-left)*(top-bottom))
            if area > width*height*.1 and right != left and top != bottom:
                px,py = obj.get_px_size()
                dpi = min(px*72/abs(right-left), py*72/abs(top-bottom))
                if dpi<150: low_dpi.append(round(dpi))
    return width,height,text,low_dpi


def _bitmap(page, scale):
    bitmap = page.render(scale=scale, fill_color=(255,255,255,255), may_draw_forms=False, draw_annots=True)
    try:
        return bitmap.to_pil().convert('RGB').copy()
    finally:
        bitmap.close()


def _png(image):
    stream=io.BytesIO();image.save(stream,format='PNG',compress_level=3)
    return 'data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode()


def _native(request):
    import numpy as np
    payload=base64.b64decode(request['data'],validate=True);limits=request['limits']
    with _open(payload) as document:
        count=len(document)
    if not 1<=count<=limits['maxPages']:
        raise ValueError(f"Use a PDF with 1–{limits['maxPages']} pages. This document has {count}; split it first.")
    if request['action']=='preview':
        pages=[]
        for number in range(count):
            with _open(payload) as document:
                page=document[number]
                try:
                    width,height,text,low=_page_info(page)
                    original=_bitmap(page,720/max(width,height))
                    thumb=_png(original);original.close()
                    for obj in text:page.remove_obj(obj);obj.close()
                    clean=_bitmap(page,360/max(width,height))
                    pixels=np.array(clean.convert('L'));clean.close()
                    blank=int(np.count_nonzero(pixels<200))<12
                    warnings=[]
                    if text:warnings.append('Embedded PDF text is excluded from handwriting extraction.')
                    if low:warnings.append(f'Low-resolution scan (~{min(low)} DPI). Rendering cannot restore missing stroke detail.')
                    reason='No ink remains after excluding embedded PDF text.' if blank and text else 'No visible ink was detected.' if blank else ''
                    pages.append(dict(page=number+1,thumbnail=thumb,width=width,height=height,
                                      eligible=not blank,reason=reason,warnings=warnings,nativeTextObjects=len(text),lowResolution=bool(low)))
                finally:page.close()
        return dict(pageCount=count,pages=pages)
    number=request['page']
    if not 1<=number<=count:raise ValueError('The selected PDF page does not exist.')
    with _open(payload) as document:
        page=document[number-1]
        try:
            width,height,text,low=_page_info(page)
            for obj in text:page.remove_obj(obj);obj.close()
            scale=min(request.get('dpi',limits['dpi'])/72,math.sqrt(limits['maxPixels']/(width*height)))
            image=_bitmap(page,scale)
            try:return dict(image=_png(image),width=image.width,height=image.height,dpi=round(scale*72,1),nativeTextObjects=len(text),lowResolution=bool(low))
            finally:image.close()
        finally:page.close()


def native(action,payload,**options):
    request=dict(action=action,data=base64.b64encode(payload).decode(),limits=LIMITS,**options)
    if not RENDER_SLOTS.acquire(timeout=5):raise ValueError('PDF rendering is busy. Retry after the current pages finish.')
    try:
        result=subprocess.run([sys.executable,'-m','server.pdf_reference'],input=json.dumps(request).encode(),
                              capture_output=True,timeout=LIMITS['timeout'],cwd=os.path.dirname(os.path.dirname(__file__)),
                              env={**os.environ,'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1'},
                              creationflags=0x08000000 if os.name=='nt' else 0)
    except subprocess.TimeoutExpired:
        raise ValueError('PDF rendering exceeded its processing limit. Try a simpler PDF or fewer pages.')
    finally:RENDER_SLOTS.release()
    if result.returncode or len(result.stdout)>50*1024**2:
        raise ValueError('The PDF exceeded renderer resources or could not be safely rendered.')
    try:response=json.loads(result.stdout)
    except (ValueError,UnicodeError):raise ValueError('The PDF renderer could not read this document.')
    if 'error' in response:raise ValueError(response['error'])
    return response


def create_session(data):
    global JANITOR_STARTED
    if not data.startswith('data:application/pdf;base64,') or len(data)>LIMITS['maxBytes']*4//3+100:
        raise ValueError(f"Use a PDF smaller than {LIMITS['maxBytes']//1024**2} MiB.")
    try:payload=base64.b64decode(data.split(',',1)[1],validate=True)
    except ValueError:raise ValueError('The PDF upload is not valid base64 data.')
    if not payload.startswith(b'%PDF-') or len(payload)>LIMITS['maxBytes']:
        raise ValueError('This file does not contain a valid PDF within the file-size limit.')
    preview=native('preview',payload)
    token=secrets.token_urlsafe(24)
    with SESSION_LOCK:
        now=time.monotonic()
        for key in list(SESSIONS):
            if SESSIONS[key]['expires']<now:del SESSIONS[key]
        while SESSIONS and (len(SESSIONS)>=3 or sum(len(s['payload']) for s in SESSIONS.values())+len(payload)>75*1024**2):
            SESSIONS.popitem(last=False)
        SESSIONS[token]=dict(payload=payload,expires=now+SESSION_SECONDS,pages=preview['pages'],processed={},requests=0)
        if not JANITOR_STARTED:
            threading.Thread(target=_expire_sessions,daemon=True,name='pdf-session-cleanup').start();JANITOR_STARTED=True
    return dict(session=token,**preview,limits=LIMITS,expiresSeconds=SESSION_SECONDS)


def close_session(token):
    with SESSION_LOCK:SESSIONS.pop(token,None)


def session(token):
    with SESSION_LOCK:
        item=SESSIONS.get(token)
        if item is None or item['expires']<time.monotonic():
            SESSIONS.pop(token,None)
            raise ValueError('This PDF preview expired. Choose the PDF again to continue.')
        return item


def ink_quality(image):
    """Conservative scan diagnostics, not a handwriting/identity classifier."""
    import cv2
    import numpy as np
    gray=np.array(image.convert('L'));mask=(gray<180).astype(np.uint8)
    count,_,stats,_=cv2.connectedComponentsWithStats(mask,8)
    components=[s for s in stats[1:] if s[cv2.CC_STAT_AREA]>=12 and s[cv2.CC_STAT_HEIGHT]>=5]
    if not components:return dict(blank=True)
    heights=[int(s[cv2.CC_STAT_HEIGHT]) for s in components]
    gx=cv2.Sobel(gray,cv2.CV_32F,1,0,ksize=3);gy=cv2.Sobel(gray,cv2.CV_32F,0,1,ksize=3)
    edge=np.sqrt(gx*gx+gy*gy);values=edge[(gray<235)&(gray>30)]
    sharpness=float(np.median(values)) if len(values) else 255.
    distance=cv2.distanceTransform(mask,cv2.DIST_L2,3)
    body=float(np.median(heights));stroke=float(np.median(distance[mask>0]))*2/max(body,1)
    near=np.abs(gx)>np.abs(gy)*1.4;den=float((gx[near]**2).sum())
    slant=float((-gx[near]*gy[near]).sum())/den if den else 0.
    # Raster printing can only be flagged conservatively: many near-identical,
    # nontrivial glyph components. Never treat this as certified authorship.
    shapes=[]
    for x,y,w,h,area in components[:600]:
        if .3<=w/max(h,1)<=1.8 and h>=body*.65 and h<=body*1.5:
            shapes.append(cv2.resize(mask[y:y+h,x:x+w],(20,24),interpolation=cv2.INTER_AREA).astype(np.float32).reshape(-1))
    representatives=[];repeated=0
    for shape in shapes:
        norm=float(np.linalg.norm(shape));matched=False
        if not norm:continue
        vector=shape/norm
        for existing in representatives:
            if float(vector@existing)>.985:matched=True;break
        if matched:repeated+=1
        else:representatives.append(vector)
    print_like=len(shapes)>=35 and len(representatives)>=5 and repeated/len(shapes)>.72
    return dict(blank=False,bodyHeight=round(body,2),strokeRatio=round(stroke,4),slant=round(slant,4),
                sharpness=round(sharpness,2),possiblePrint=print_like,
                analysis='Geometric estimates; character identity, pen lifts and writer identity are not inferred.')


def orient(image,rotation):
    if rotation is not None:return image.rotate(-rotation,expand=True,fillcolor='white'),rotation,[]
    from server.sample_reader import prepare,lines,crop,recognize_scored
    candidates=[]
    small=image.copy();small.thumbnail((1600,1600))
    try:
        for angle in (0,90,180,270):
            view=small.rotate(-angle,expand=True,fillcolor='white')
            try:
                clean,mask=prepare(view);boxes=lines(mask)
                boxes=[box for box in boxes if box[2]-box[0]>(box[3]-box[1])*2][:2]
                if boxes:candidates.append((angle,[crop(clean,box) for box in boxes]))
            except ValueError:pass
            finally:view.close()
        if len(candidates)<2:return image.copy(),0,['Orientation could not be verified. Rotate the preview if needed.']
        readings=recognize_scored([crop for _,crops in candidates for crop in crops])
        offset=0;scores=[]
        for angle,crops in candidates:
            result=readings[offset:offset+len(crops)];offset+=len(crops)
            score=sum(value['confidence'] for value in result)/len(result)
            scores.append((score,angle))
            for crop in crops:crop.close()
        scores.sort(reverse=True);best,angle=scores[0]
        current=next((score for score,a in scores if a==0),0)
        if angle!=0 and best>=.6 and best-current>=.15 and best-scores[1][0]>=.1:
            return image.rotate(-angle,expand=True,fillcolor='white'),angle,[f'Page orientation corrected by {angle}° clockwise using OCR confidence.']
        return image.copy(),0,([] if angle==0 else ['Orientation is uncertain; review the page and choose a rotation if needed.'])
    finally:small.close()


def extract_page(token,number,rotation=None,allow_print_like=False):
    from PIL import Image
    from server.sample_reader import read_sample
    item=session(token)
    if not 1<=number<=len(item['pages']):raise ValueError('The selected PDF page does not exist.')
    meta=item['pages'][number-1]
    if not meta['eligible']:return dict(page=number,status='excluded',reason=meta['reason'],warnings=meta['warnings'])
    with SESSION_LOCK:
        planned=min(LIMITS['maxPixels'],math.ceil(meta['width']*meta['height']*(LIMITS['dpi']/72)**2))
        processed={**item['processed'],number:planned}
        if len(processed)>LIMITS['maxSelected'] or sum(processed.values())>100_000_000:
            raise ValueError('This PDF preview reached its cumulative page/pixel budget. Reopen the PDF and choose a smaller set of pages.')
        if item['requests']>=LIMITS['maxSelected']*4:
            raise ValueError('This PDF preview reached its retry limit. Reopen the PDF to continue.')
        item['processed']=processed;item['requests']+=1
    rendered=native('render',item['payload'],page=number)
    warnings=list(meta['warnings'])
    with Image.open(io.BytesIO(base64.b64decode(rendered['image'].split(',')[1]))) as raw:
        image=raw.convert('RGB')
    try:
        quality=ink_quality(image)
        if quality.get('blank'):return dict(page=number,status='excluded',reason='No usable handwriting remains.',warnings=warnings)
        if quality['possiblePrint'] and not allow_print_like:
            return dict(page=number,status='excluded',reason='Highly repetitive glyph shapes suggest printed text. Choose handwritten pages or provide a handwriting-only crop.',warnings=warnings,quality=quality)
        if quality['possiblePrint']:warnings.append('Possible printed glyph patterns were included after your review; handwriting detection is approximate.')
        if quality['bodyHeight']<18 and rendered['dpi']<400 and not meta['lowResolution']:
            higher=native('render',item['payload'],page=number,dpi=450)
            if higher['dpi']>rendered['dpi']+10:
                image.close();image=Image.open(io.BytesIO(base64.b64decode(higher['image'].split(',')[1]))).convert('RGB')
                rendered=higher;quality=ink_quality(image);warnings.append('Small writing was rendered at a higher bounded resolution.')
        if quality['sharpness']<25:warnings.append('This page may be blurry or faint. Review its extracted word shapes and labels.')
        upright,angle,notes=orient(image,rotation);warnings.extend(notes)
        try:result=read_sample(upright)
        except ValueError as error:return dict(page=number,status='excluded',reason=str(error),warnings=warnings)
        finally:upright.close()
    finally:image.close()
    warnings.extend(result['warnings'])
    warnings.append('Rasterized printed text cannot always be distinguished from handwriting. Review the word crops; exact writer identity is not verified.')
    # The existing renderer accepts bounded PNG masks. Downsample only unusually
    # large individual crops; all normal 300-DPI word images remain lossless.
    for word in result['words']:
        with Image.open(io.BytesIO(base64.b64decode(word['image'].split(',')[1]))) as source:
            factor=min(1,1800/source.width,1800/source.height,math.sqrt(900000/(source.width*source.height)))
            if factor<1:
                resized=source.resize((max(1,round(source.width*factor)),max(1,round(source.height*factor))),Image.Resampling.LANCZOS)
                word.update(image=_png(resized),width=resized.width,height=resized.height,baseline=word['baseline']*factor,em=word['em']*factor);resized.close()
        word.update(id=f"pdf-p{number}-{word['id']}",page=number,line=(number-1)*40+word.get('line',0))
    return dict(**{key:value for key,value in result.items() if key!='warnings'},page=number,status='ready',
                warnings=list(dict.fromkeys(warnings)),quality=quality,dpi=rendered['dpi'],rotation=angle,
                nativeTextObjects=rendered['nativeTextObjects'],pixels=rendered['width']*rendered['height'])


if __name__=='__main__':
    try:
        _memory_limit()
        output=_native(json.loads(sys.stdin.buffer.read(75*1024**2)))
    except ModuleNotFoundError:output={'error':'Install server/requirements.txt in the local Python environment and restart the service to enable PDF references.'}
    except MemoryError:output={'error':'This PDF exhausted the renderer memory limit. Try a smaller or simpler PDF.'}
    except Exception as error:output={'error':str(error) or 'The PDF could not be safely rendered.'}
    sys.stdout.buffer.write(json.dumps(output).encode())
