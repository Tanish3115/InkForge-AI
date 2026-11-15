import { canvas, loadImage } from './image';
import type { Profile,UploadedWord } from '../types';

export interface RecognitionResult {
  words:UploadedWord[];transcript:string;references:string[];referenceCount:number;warnings:string[];
}
export interface PDFPreview {
  session:string;pageCount:number;expiresSeconds:number;
  limits:{maxBytes:number;maxPages:number;maxSelected:number;maxPixels:number;dpi:number;maxWords:number};
  pages:{page:number;thumbnail:string;width:number;height:number;eligible:boolean;reason:string;warnings:string[];nativeTextObjects:number;lowResolution:boolean}[];
}
export interface PDFPageResult extends Partial<RecognitionResult> {
  page:number;status:'ready'|'excluded';reason?:string;warnings:string[];dpi?:number;rotation?:number;
  quality?:{bodyHeight:number;strokeRatio:number;slant:number;sharpness:number;possiblePrint:boolean;analysis:string};
}

function profileFromRecognition(filename:string,result:RecognitionResult):Profile {
  if(!result.words?.length||!result.transcript?.trim()||result.references?.length!==5)
    throw new Error('No readable word library was returned. No empty profile was saved.');
  return {id:crypto.randomUUID(),name:filename.replace(/\.[^.]+$/,'').slice(0,70)||'My handwriting',
    version:1,createdAt:Date.now(),em:64,glyphs:{},kind:'reference',automaticSample:true,
    references:result.references,sampleCount:result.referenceCount,wordSamples:result.words,
    sourceTranscript:result.transcript,sourceReadWarnings:result.warnings||[]};
}

async function pdfRequest(path:string,body:unknown,signal?:AbortSignal):Promise<any>{
  let response:Response;
  try{response=await fetch('http://127.0.0.1:8000'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(300000)]):AbortSignal.timeout(300000)});}
  catch{signal?.throwIfAborted();throw new Error('Could not reach the local handwriting service at 127.0.0.1:8000. Start it and choose the PDF again.');}
  const result=await response.json();
  if(!response.ok)throw new Error(response.status===404?'Restart the local handwriting service to enable PDF references.':typeof result.detail==='string'?result.detail:'Could not process the PDF reference.');
  return result;
}

export async function previewPDF(file:File,signal?:AbortSignal):Promise<PDFPreview>{
  if(file.size>50*1024*1024)throw new Error('Use a PDF reference smaller than 50 MiB; the local service may apply a lower limit.');
  const header=new TextDecoder().decode(await file.slice(0,5).arrayBuffer());
  if(header!=='%PDF-')throw new Error('This file does not contain a PDF. Choose a valid .pdf document.');
  const document=await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve('data:application/pdf;base64,'+String(reader.result).split(',')[1]);
    reader.onerror=()=>reject(new Error('The PDF file could not be read.'));reader.readAsDataURL(file);
  });
  signal?.throwIfAborted();return pdfRequest('/pdf-reference',{document},signal);
}

export const extractPDFPage=(session:string,page:number,rotation:number|null,signal?:AbortSignal,allowPrintLike=false):Promise<PDFPageResult>=>pdfRequest('/pdf-reference/'+encodeURIComponent(session)+'/page',{page,rotation,allow_print_like:allowPrintLike},signal);
export function releasePDF(session:string){void fetch('http://127.0.0.1:8000/pdf-reference/'+encodeURIComponent(session),{method:'DELETE',keepalive:true}).catch(()=>{});}

export function pdfStyleWarnings(results:PDFPageResult[]){
  const ready=results.filter(page=>page.status==='ready'&&page.quality);
  if(ready.length<2)return [];
  const strokes=ready.map(page=>page.quality!.strokeRatio).sort((a,b)=>a-b),median=strokes[Math.floor(strokes.length/2)];
  const slants=ready.map(page=>page.quality!.slant).sort((a,b)=>a-b),slant=slants[Math.floor(slants.length/2)];
  return ready.some(page=>page.quality!.strokeRatio>median*2||page.quality!.strokeRatio<median*.5||Math.abs(page.quality!.slant-slant)>.25)
    ?['Possible style variation between selected pages. Stroke/slant measurements are approximate, not a writer classifier. Deselect pages from other writers before saving.']:[];
}

export function profileFromPDF(filename:string,preview:PDFPreview,results:PDFPageResult[]):Profile{
  const ordered=[...results].sort((a,b)=>a.page-b.page),ready=ordered.filter(page=>page.status==='ready');
  const words=ready.flatMap(page=>page.words||[]),transcript=ready.map(page=>page.transcript||'').join('\n\n');
  if(words.length>preview.limits.maxWords||transcript.length>30000)throw new Error('Use fewer PDF pages: the combined reference exceeds 1,000 word crops or 30,000 recognized characters.');
  const pool=ready.flatMap(page=>(page.references||[]).slice(0,page.referenceCount||5));
  const references=pool.length?Array.from({length:5},(_,i)=>pool[Math.round(i*(pool.length-1)/4)]):[];
  const warnings=ordered.flatMap(page=>[...(page.status==='excluded'?[`Page ${page.page} excluded: ${page.reason}`]:[]),...page.warnings.map(w=>`Page ${page.page}: ${w}`)]).concat(pdfStyleWarnings(ready));
  const profile=profileFromRecognition(filename,{words,transcript,references,referenceCount:Math.min(5,new Set(pool).size),warnings:[...new Set(warnings)].slice(0,100)});
  if(JSON.stringify(profile).length>19*1024*1024)throw new Error('This reference is too large for a portable profile backup. Select fewer PDF pages.');
  profile.pdf={totalPages:preview.pageCount,pages:ready.map(page=>page.page),analysis:ready.map(page=>({page:page.page,dpi:page.dpi!,rotation:page.rotation!,bodyHeight:page.quality!.bodyHeight,strokeRatio:page.quality!.strokeRatio,slant:page.quality!.slant}))};
  return profile;
}

export async function profileFromSample(file: File): Promise<Profile> {
  const source = await loadImage(file);
  const factor = Math.min(1, 1800 / Math.max(source.width, source.height));
  const page = canvas(source.width * factor, source.height * factor);
  page.getContext('2d')!.drawImage(source, 0, 0, page.width, page.height);
  let response: Response;
  try {
    response = await fetch('http://127.0.0.1:8000/recognize-sample', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({page:page.toDataURL('image/jpeg',.94)}),
      signal: AbortSignal.timeout(180000),
    });
  } catch {
    throw new Error('Could not read the sample. Start the free local handwriting service at 127.0.0.1:8000 and upload again.');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'The sample could not be read. Try a clearer image.');
  return profileFromRecognition(file.name,result);
}
