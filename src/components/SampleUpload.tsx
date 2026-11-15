import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, FileImage, LoaderCircle, ScanLine, ShieldCheck, UploadCloud } from 'lucide-react';
import type { Profile } from '../types';
import { profileFromSample,previewPDF,releasePDF,type PDFPreview } from '../engine/sample';
import PDFReferencePages from './PDFReferencePages';
import Dialog from './Dialog';
import './SampleUpload.css';

export default function SampleUpload({ onSave, onClose, onAdvanced }: {
  onSave: (profile: Profile) => Promise<void>; onClose: () => void; onAdvanced: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [filename, setFilename] = useState('');
  const [pdf,setPDF]=useState<PDFPreview>();
  const pdfSession=useRef(''),controller=useRef<AbortController|null>(null);
  const input = useRef<HTMLInputElement>(null);
  const reading = useRef(false);
  const mounted = useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();if(pdfSession.current)releasePDF(pdfSession.current);};},[]);

  const readSample = async (file: File) => {
    if (reading.current) return;
    setDragging(false);
    setError('');
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type) && file.type!=='application/pdf' && !/\.(png|jpe?g|webp|pdf)$/i.test(file.name)) {
      setError('Choose a PDF, PNG, JPEG, or WebP handwriting reference.');
      return;
    }
    reading.current = true;
    setFilename(file.name);
    setBusy(true);
    try {
      if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
        controller.current=new AbortController();
        const preview=await previewPDF(file,controller.current.signal);
        if(!mounted.current){releasePDF(preview.session);return;}
        pdfSession.current=preview.session;setPDF(preview);return;
      }
      const profile = await profileFromSample(file);
      if (!mounted.current) return;
      await onSave(profile);
      if (mounted.current) onClose();
    }
    catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : String(err)); }
    finally {
      reading.current = false;
      if (mounted.current) setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return <Dialog title="Upload your handwriting" onClose={onClose} wide={!!pdf}>
    <div className="sample-upload">
      {pdf?<PDFReferencePages preview={pdf} filename={filename} onSave={onSave} onClose={onClose} onBack={()=>{releasePDF(pdf.session);pdfSession.current='';setPDF(undefined);setError('');setFilename('');}}/>:<>
      <p className="sample-upload-intro">Your words. Your original ink. Upload a clear photo, scan, or PDF of your English handwriting to build a reusable word library.</p>
      <label className={`sample-dropzone${dragging ? ' dragging' : ''}${busy ? ' reading' : ''}`} aria-busy={busy}
        onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }}
        onDragEnter={event => { event.preventDefault(); if (!busy) setDragging(true); }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={event => {
          event.preventDefault();
          setDragging(false);
          if (busy) return;
          const files = event.dataTransfer.files;
          if (files.length > 1) { setError('Choose one handwriting reference at a time.'); return; }
          if (files[0]) void readSample(files[0]);
        }}>
        <input ref={input} className="sample-file-input" aria-label="Upload automatic handwriting sample" type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.pdf" disabled={busy}
          onChange={event => { const file = event.target.files?.[0]; if (file) void readSample(file); }} />
        <span className="sample-upload-orbit" aria-hidden="true">
          <i /><i />{busy ? <LoaderCircle size={28} className="spin" /> : <UploadCloud size={28} />}
        </span>
        <strong>{busy ? /\.pdf$/i.test(filename)?'Preparing PDF preview':'Reading your handwriting' : dragging ? 'Drop your handwriting here' : 'Drop your handwriting image or PDF'}</strong>
        <span className="sample-dropzone-copy">{busy ? /\.pdf$/i.test(filename)?'Validating the document and rendering page thumbnails':'Finding words and preserving their original shapes' : 'or browse files from your device'}</span>
        <span className="sample-format-badges" aria-hidden="true"><span>JPEG</span><span>PNG</span><span>WebP</span><span>PDF</span></span>
      </label>
      {filename && <div className="sample-selected-file"><FileImage size={15} aria-hidden="true" /><span>{filename}</span></div>}
      {busy && <div className="sample-reading-status" role="status" aria-live="polite">
        <div><ScanLine size={15} aria-hidden="true" /><span>{/\.pdf$/i.test(filename)?'Validating PDF pages and preparing thumbnails…':'Reading and indexing your handwriting…'}</span></div>
        <progress aria-label="Reading handwriting sample" />
        <p>Images are read automatically. PDFs open a page preview so you can choose which handwriting to use.</p>
      </div>}
      {error && <p className="sample-upload-error" role="alert">{error}</p>}
      <div className="sample-upload-guide">
        <span className="sample-guide-label">For the clearest result</span>
        <p>Use dark writing on light paper, photographed straight on. Matching typed words reuse your actual ink; new words use approximate neural synthesis.</p>
      </div>
      <div className="sample-privacy-note"><ShieldCheck size={17} aria-hidden="true" /><p>Only upload handwriting you have permission to use. Processing stays on your device and the free local service. The service reads new uploads; saved matching words can render without it.</p></div>
      <div className="sample-upload-footer"><span>Review recognized labels after upload.</span><button disabled={busy} onClick={onAdvanced}>Advanced letter tools <ArrowUpRight size={13} aria-hidden="true" /></button></div>
      </>}
    </div>
  </Dialog>;
}
