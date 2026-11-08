import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, FileImage, LoaderCircle, ScanLine, ShieldCheck, UploadCloud } from 'lucide-react';
import type { Profile } from '../types';
import { profileFromSample } from '../engine/sample';
import Dialog from './Dialog';
import './SampleUpload.css';

export default function SampleUpload({ onSave, onClose, onAdvanced }: {
  onSave: (profile: Profile) => Promise<void>; onClose: () => void; onAdvanced: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [filename, setFilename] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const reading = useRef(false);
  const mounted = useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);

  const readSample = async (file: File) => {
    if (reading.current) return;
    setDragging(false);
    setError('');
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
      setError('Choose a PNG, JPEG, or WebP image of your handwriting.');
      return;
    }
    reading.current = true;
    setFilename(file.name);
    setBusy(true);
    try {
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

  return <Dialog title="Upload your handwriting" onClose={onClose}>
    <div className="sample-upload">
      <p className="sample-upload-intro">Your words. Your original ink. Upload a clear photo or scan of your English handwriting to build a reusable word library.</p>
      <label className={`sample-dropzone${dragging ? ' dragging' : ''}${busy ? ' reading' : ''}`} aria-busy={busy}
        onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }}
        onDragEnter={event => { event.preventDefault(); if (!busy) setDragging(true); }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={event => {
          event.preventDefault();
          setDragging(false);
          if (busy) return;
          const files = event.dataTransfer.files;
          if (files.length > 1) { setError('Choose one handwriting image at a time.'); return; }
          if (files[0]) void readSample(files[0]);
        }}>
        <input ref={input} className="sample-file-input" aria-label="Upload automatic handwriting sample" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
          onChange={event => { const file = event.target.files?.[0]; if (file) void readSample(file); }} />
        <span className="sample-upload-orbit" aria-hidden="true">
          <i /><i />{busy ? <LoaderCircle size={28} className="spin" /> : <UploadCloud size={28} />}
        </span>
        <strong>{busy ? 'Reading your handwriting' : dragging ? 'Drop your handwriting here' : 'Drop your handwriting image'}</strong>
        <span className="sample-dropzone-copy">{busy ? 'Finding words and preserving their original shapes' : 'or browse files from your device'}</span>
        <span className="sample-format-badges" aria-hidden="true"><span>JPEG</span><span>PNG</span><span>WebP</span></span>
      </label>
      {filename && <div className="sample-selected-file"><FileImage size={15} aria-hidden="true" /><span>{filename}</span></div>}
      {busy && <div className="sample-reading-status" role="status" aria-live="polite">
        <div><ScanLine size={15} aria-hidden="true" /><span>Reading and indexing your handwriting…</span></div>
        <progress aria-label="Reading handwriting sample" />
        <p>A full page can take a little while. The dialog will close when your library is ready.</p>
      </div>}
      {error && <p className="sample-upload-error" role="alert">{error}</p>}
      <div className="sample-upload-guide">
        <span className="sample-guide-label">For the clearest result</span>
        <p>Use dark writing on light paper, photographed straight on. Matching typed words reuse your actual ink; new words use approximate neural synthesis.</p>
      </div>
      <div className="sample-privacy-note"><ShieldCheck size={17} aria-hidden="true" /><p>Only upload handwriting you have permission to use. Processing stays on your device and the free local service. The service reads new uploads; saved matching words can render without it.</p></div>
      <div className="sample-upload-footer"><span>Review recognized labels after upload.</span><button disabled={busy} onClick={onAdvanced}>Advanced letter tools <ArrowUpRight size={13} aria-hidden="true" /></button></div>
    </div>
  </Dialog>;
}
