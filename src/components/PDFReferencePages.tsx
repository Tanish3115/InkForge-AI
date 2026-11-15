import {useEffect,useRef,useState} from 'react';
import {Check,LoaderCircle,ScanLine} from 'lucide-react';
import type {Profile} from '../types';
import {extractPDFPage,pdfStyleWarnings,profileFromPDF,type PDFPreview,type PDFPageResult} from '../engine/sample';

export default function PDFReferencePages({preview,filename,onBack,onSave,onClose}:{
  preview:PDFPreview;filename:string;onBack:()=>void;onSave:(profile:Profile)=>Promise<void>;onClose:()=>void;
}){
  const eligible=preview.pages.filter(page=>page.eligible);
  const [selected,setSelected]=useState<number[]>(eligible.slice(0,preview.limits.maxSelected).map(page=>page.page));
  const [rotations,setRotations]=useState<Record<number,number|null>>({});
  const [includePrinted,setIncludePrinted]=useState<Record<number,boolean>>({});
  const [results,setResults]=useState<Record<number,{rotation:number|null;allowPrint:boolean;result:PDFPageResult}>>({});
  const [active,setActive]=useState(eligible[0]?.page||1),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [progress,setProgress]=useState({completed:0,total:0,current:0});
  const controller=useRef<AbortController|null>(null),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
  const ordered=[...selected].sort((a,b)=>a-b);
  const current=ordered.map(number=>results[number]).filter(item=>item&&item.rotation===(rotations[item.result.page]??null)&&item.allowPrint===!!includePrinted[item.result.page]).map(item=>item.result);
  const ready=current.filter(page=>page.status==='ready'),words=ready.reduce((count,page)=>count+(page.words?.length||0),0);
  const tooMany=selected.length>preview.limits.maxSelected;
  const estimatedPixels=ordered.reduce((sum,number)=>{const page=preview.pages[number-1];return sum+Math.min(preview.limits.maxPixels,page.width*page.height*(preview.limits.dpi/72)**2);},0);
  const tooLarge=estimatedPixels>100_000_000;
  const styleWarnings=pdfStyleWarnings(ready),activePage=preview.pages[active-1];
  const extract=async()=>{
    const run=new AbortController();controller.current=run;setBusy(true);setError('');setProgress({completed:0,total:ordered.length,current:ordered[0]});
    try{
      for(let i=0;i<ordered.length;i++){
        const number=ordered[i],rotation=rotations[number]??null,allowPrint=!!includePrinted[number];
        setProgress({completed:i,total:ordered.length,current:number});
        if(!results[number]||results[number].rotation!==rotation||results[number].allowPrint!==allowPrint){
          const result=await extractPDFPage(preview.session,number,rotation,run.signal,allowPrint);
          if(!mounted.current||run.signal.aborted)return;
          setResults(values=>({...values,[number]:{rotation,allowPrint,result}}));
        }
        setProgress({completed:i+1,total:ordered.length,current:number});
      }
    }catch(err){if(mounted.current&&!run.signal.aborted)setError(err instanceof Error?err.message:String(err));}
    finally{if(mounted.current)setBusy(false);}
  };
  return <section className="pdf-reference" aria-label="PDF handwriting page selection" aria-busy={busy||saving}>
    <p className="sample-selected-file">{filename}</p>
    <div className="pdf-reference-header"><div><h3>{preview.pageCount} PDF {preview.pageCount===1?'page':'pages'}</h3><p>Select handwriting pages from the same writer. Embedded PDF text is excluded; scanned printed text needs review.</p></div><button className="button small" disabled={busy||saving} onClick={onBack}>Choose another file</button></div>
    <div className="pdf-page-actions"><button className="button small" disabled={busy||saving||!eligible.length} onClick={()=>setSelected(eligible.map(page=>page.page))}>Select all eligible</button><button className="button small" disabled={busy||saving||!selected.length} onClick={()=>setSelected([])}>Deselect all</button><span>{selected.length} selected · up to {preview.limits.maxSelected}</span></div>
    {!eligible.length&&<p role="alert" className="sample-upload-error">No eligible handwriting pages remain. This PDF is blank or contains embedded printed text only. Choose a scanned handwritten reference.</p>}
    {eligible.length>preview.limits.maxSelected&&<p className="pdf-notice">The first {preview.limits.maxSelected} eligible pages are selected initially. Choose the pages that best represent one writer.</p>}
    {tooMany&&<p role="alert" className="sample-upload-error">Choose at most {preview.limits.maxSelected} pages per reference.</p>}
    {tooLarge&&<p role="alert" className="sample-upload-error">These pages exceed the combined rendering budget. Select fewer pages.</p>}
    <div className="pdf-page-grid" role="group" aria-label="PDF pages">
      {preview.pages.map(page=><article key={page.page} className={`pdf-page-card ${selected.includes(page.page)?'selected':''} ${!page.eligible?'excluded':''}`}>
        <label><input type="checkbox" aria-label={`Select PDF page ${page.page}`} checked={selected.includes(page.page)} disabled={!page.eligible||busy||saving} onChange={event=>setSelected(values=>event.target.checked?[...values,page.page]:values.filter(number=>number!==page.page))}/><span>Page {page.page}</span></label>
        <button className="pdf-page-thumbnail" aria-label={`Preview PDF page ${page.page}`} onClick={()=>setActive(page.page)}><img src={page.thumbnail} alt={`PDF page ${page.page} thumbnail`} loading="lazy" style={{transform:`rotate(${rotations[page.page]||0}deg)`}}/></button>
        <label className="pdf-rotation">Orientation<select aria-label={`Rotation for PDF page ${page.page}`} disabled={!page.eligible||busy||saving} value={rotations[page.page]??'auto'} onChange={event=>setRotations(values=>({...values,[page.page]:event.target.value==='auto'?null:Number(event.target.value)}))}><option value="auto">Auto check</option><option value="0">Keep as shown</option><option value="90">90° clockwise</option><option value="180">180°</option><option value="270">90° anticlockwise</option></select></label>
        {page.reason&&<p>{page.reason}</p>}{page.warnings.map(warning=><p key={warning}>{warning}</p>)}
        {results[page.page]&&<p className="pdf-page-result">{results[page.page].result.status==='ready'?`${results[page.page].result.words?.length} word crops · ${results[page.page].result.dpi} DPI`:`Excluded: ${results[page.page].result.reason}`}</p>}
        {results[page.page]?.result.quality?.possiblePrint&&<label className="pdf-print-review"><input type="checkbox" aria-label={`Include PDF page ${page.page} after print review`} disabled={busy||saving} checked={!!includePrinted[page.page]} onChange={event=>setIncludePrinted(values=>({...values,[page.page]:event.target.checked}))}/><span>This is handwriting; include after review, then re-extract.</span></label>}
      </article>)}
    </div>
    <details className="pdf-large-preview"><summary>Preview page {active}</summary><img src={activePage.thumbnail} alt={`PDF page ${active} preview`} style={{transform:`rotate(${rotations[active]||0}deg)`}}/></details>
    <div className="pdf-extract-actions"><button className="button primary" disabled={busy||saving||!selected.length||tooMany||tooLarge} onClick={()=>void extract()}><ScanLine size={15}/>Extract selected pages</button>{busy&&<button className="button small" onClick={()=>controller.current?.abort()}>Cancel extraction</button>}</div>
    {busy&&<div className="sample-reading-status" role="status"><div><LoaderCircle size={15} className="spin"/><span>Reading page {progress.current} · {progress.completed} of {progress.total} pages processed</span></div><progress aria-label="PDF pages processed" value={progress.completed} max={progress.total}/><p>Recognition runs locally. A page can take a few minutes; progress advances only when processing completes.</p></div>}
    {current.length>0&&<div className="pdf-extraction-review" aria-label="PDF extraction review">
      <h4>{ready.length} usable pages · {words} word crops</h4>
      {words>preview.limits.maxWords&&<p role="alert" className="sample-upload-error">Select fewer pages to stay within {preview.limits.maxWords} word crops.</p>}
      {styleWarnings.map(warning=><p className="sample-upload-error" key={warning}>{warning}</p>)}
      {current.map(page=><details key={page.page}><summary>Page {page.page} · {page.status==='ready'?'Review handwriting':'Excluded'}</summary>
        {page.status==='excluded'&&<p>{page.reason}</p>}{page.warnings.map(warning=><p key={warning}>{warning}</p>)}
        {page.status==='ready'&&<><div className="pdf-crop-review">{page.references?.slice(0,3).map((image,i)=><img key={i} src={image} alt={`Handwriting crop ${i+1} from PDF page ${page.page}`}/>)}</div><label>Recognized page {page.page} text<textarea aria-label={`Recognized PDF page ${page.page} text`} value={page.transcript||''} readOnly rows={3}/></label><p>{page.dpi} DPI · rotation {page.rotation}°. Reference features are approximate; review OCR labels after saving.</p></>}
      </details>)}
      <p>These samples use the existing reference model. They do not train a new font or establish exact character identities, pen movements, or writer identity.</p>
    </div>}
    {error&&<p role="alert" className="sample-upload-error">{error}</p>}
    <button className="button primary full" disabled={busy||saving||!ready.length||current.length!==selected.length||tooMany||tooLarge||words>preview.limits.maxWords} onClick={async()=>{
      setError('');setSaving(true);
      try{const profile=profileFromPDF(filename,preview,current);await onSave(profile);if(mounted.current)onClose();}
      catch(err){if(mounted.current)setError(err instanceof Error?err.message:String(err));}
      finally{if(mounted.current)setSaving(false);}
    }}><Check size={15}/>{saving?'Saving reference…':'Use selected handwriting'}</button>
    <p className="pdf-limit-note">Up to {preview.limits.maxBytes/1024**2} MiB, {preview.limits.maxPages} PDF pages, {preview.limits.maxSelected} selected pages and {preview.limits.maxWords} word crops. Preview expires after {Math.round(preview.expiresSeconds/60)} minutes. No PDF intermediate files are saved.</p>
  </section>;
}
