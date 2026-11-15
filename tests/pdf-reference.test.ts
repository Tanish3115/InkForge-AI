import {describe,it,expect} from 'vitest';
import {profileFromPDF,pdfStyleWarnings,type PDFPreview,type PDFPageResult} from '../src/engine/sample';
import {sourceTranscript} from '../src/engine/uploadedWords';
import {validateProfile} from '../src/lib/storage';
const image='data:image/png;base64,AAAA';
const preview:PDFPreview={session:'test',pageCount:4,expiresSeconds:900,limits:{maxBytes:26214400,maxPages:40,maxSelected:10,maxPixels:12000000,dpi:300,maxWords:1000},pages:[]};
const page=(number:number,stroke=.08):PDFPageResult=>({page:number,status:'ready',dpi:300,rotation:0,
  words:[{id:'pdf-p'+number+'-word',text:'sample'+number,image,width:50,height:40,baseline:32,em:40,line:(number-1)*40,page:number}],
  transcript:'sample'+number,references:[image+number,...Array(4).fill(image)],referenceCount:2,warnings:[],
  quality:{bodyHeight:30,strokeRatio:stroke,slant:.05,sharpness:100,possiblePrint:false,analysis:'Geometric estimate'}});
describe('PDFs share the existing reference profile format',()=>{
  it('keeps selected pages ordered and pools actual reference crops across them',()=>{
    const profile=profileFromPDF('scan.pdf',preview,[page(4),page(1)]);
    expect(profile.kind).toBe('reference');expect(profile.em).toBe(64);expect(profile.references).toHaveLength(5);
    expect(profile.pdf?.pages).toEqual([1,4]);expect(profile.wordSamples?.map(word=>word.page)).toEqual([1,4]);
    expect(profile.sourceTranscript).toBe('sample1\n\nsample4');expect(sourceTranscript(profile.wordSamples!)).toBe(profile.sourceTranscript);
    expect(profile.references).toContain(image+'1');expect(profile.references).toContain(image+'4');
  });
  it('does not create profiles from excluded pages and explains excluded selected pages',()=>{
    const excluded:PDFPageResult={page:2,status:'excluded',reason:'Printed text only',warnings:[]};
    expect(()=>profileFromPDF('scan.pdf',preview,[excluded])).toThrow('No readable word library');
    const profile=profileFromPDF('scan.pdf',preview,[page(1),excluded]);
    expect(profile.sourceReadWarnings).toContain('Page 2 excluded: Printed text only');expect(profile.pdf?.pages).toEqual([1]);
  });
  it('warns on style disagreement and enforces combined word limits',()=>{
    expect(pdfStyleWarnings([page(1),page(2,.3)])).toHaveLength(1);
    expect(()=>profileFromPDF('large.pdf',{...preview,limits:{...preview.limits,maxWords:1}},[page(1),page(2)])).toThrow('fewer PDF pages');
  });
  it('preserves larger PDF libraries in backups and rejects malformed page metadata',()=>{
    const profile=profileFromPDF('scan.pdf',preview,[page(1),page(4)]);
    profile.references=Array(5).fill(image);
    profile.wordSamples=Array.from({length:200},(_,i)=>({...profile.wordSamples![0],id:'word-'+i}));
    expect(validateProfile(profile).wordSamples).toHaveLength(200);
    expect(()=>validateProfile({...profile,pdf:{...profile.pdf,pages:'not-an-array'}})).toThrow('Invalid PDF');
    expect(()=>validateProfile({...profile,pdf:undefined})).toThrow();
  });
});
