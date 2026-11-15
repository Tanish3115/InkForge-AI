import type { GeneratedDocument, HandwritingQuality, Settings, UploadedWord } from '../types';
import { canvas, decodeInk } from './image';
import {inkBounds} from './layout';

export const HANDWRITING_SCALE=.8;
export function writingSettings(settings:Settings):Settings {return {...settings,size:settings.size*HANDWRITING_SCALE};}
export const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);const n=sorted.length;return n?(sorted[(n-1)>>1]+sorted[n>>1])/2:0;};
export const strength=(value:number|undefined,fallback:number)=>Number.isFinite(value)?Math.max(0,Math.min(1,value!)):fallback;

/** Label classes describe vertical proportions, never individual word exceptions. */
export function letterEnvelope(text:string) {
  let up=1,down=0;
  for(const ch of text){
    if(/[A-Z0-9bdfhkl]/.test(ch))up=Math.max(up,1.5);
    if(ch==='t')up=Math.max(up,1.25);
    if(/[ij]/.test(ch))up=Math.max(up,1.22);
    if(/[gjpqy]/.test(ch))down=.35;
  }
  if(!/[A-Za-z0-9]/.test(text)){
    const height=/[!?()[\]{}]/.test(text)?1.45:/[,;]/.test(text)?.32:/["'‘’“”]/.test(text)?.35:/[-—–]/.test(text)?.14:.16;
    return {up:height,down:0,punctuation:true};
  }
  return {up,down,punctuation:false};
}

export interface InkMetrics {left:number;top:number;width:number;height:number;body:number;baseline:number;stroke:number;slant:number;alpha:Uint8ClampedArray;edgeContact?:boolean}
export function analyzeInk(data:Uint8ClampedArray,width:number,height:number,text:string):InkMetrics {
  const alpha=new Uint8ClampedArray(width*height);
  let left=width,right=-1,top=height,bottom=-1;
  for(let i=0;i<alpha.length;i++){
    const gray=(data[i*4]+data[i*4+1]+data[i*4+2])/3;
    const value=Math.round(data[i*4+3]*(1-gray/255));
    alpha[i]=value<24?0:value;
    if(value>=40){const x=i%width,y=Math.floor(i/width);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  }
  if(right<left||bottom<top)throw new Error(`No visible ink was found for “${text}”.`);
  const h=bottom-top+1,w=right-left+1,envelope=letterEnvelope(text),rows=Array(h).fill(0);
  let area=0,edges=0,gradientCross=0,gradientX=0;
  for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)if(alpha[y*width+x]>=40){
    rows[y-top]++;area++;
    if(x===0||alpha[y*width+x-1]<40)edges++;
    if(x===width-1||alpha[y*width+x+1]<40)edges++;
    if(y===0||alpha[(y-1)*width+x]<40)edges++;
    if(y===height-1||alpha[(y+1)*width+x]<40)edges++;
  }
  // Local near-vertical stroke edges, rather than a whole-word centroid slope.
  // The latter mostly measures which letters happen to be tall in this word.
  for(let y=Math.max(1,top);y<Math.min(height-1,bottom+1);y++)for(let x=Math.max(1,left);x<Math.min(width-1,right+1);x++){
    const gx=alpha[y*width+x+1]-alpha[y*width+x-1],gy=alpha[(y+1)*width+x]-alpha[(y-1)*width+x];
    if(Math.abs(gx)>24&&Math.abs(gx)>Math.abs(gy)*1.4){gradientCross-=gx*gy;gradientX+=gx*gx;}
  }
  const radius=Math.max(1,Math.round(h*.04));
  const smooth=rows.map((_,i)=>{let sum=0,n=0;for(let j=Math.max(0,i-radius);j<=Math.min(h-1,i+radius);j++){sum+=rows[j];n++;}return sum/n;});
  const threshold=Math.max(...smooth)*.4;
  let start=0,bandTop=0,bandBottom=h-1,best=0;
  for(let i=0;i<=h;i++)if(i===h||smooth[i]<threshold){if(i-start>best){best=i-start;bandTop=start;bandBottom=i-1;}start=i+1;}
  const prior=h/(envelope.up+envelope.down);
  const bodyEvidence=Math.max(prior*.8,Math.min(prior*1.2,bandBottom-bandTop+1));
  const confidence=envelope.punctuation?0:Math.min(.5,(text.match(/[acemnorsuvwxz]/g)||[]).length*.1);
  const body=prior*(1-confidence)+bodyEvidence*confidence;
  // Dots/commas keep their original relative baseline if a usable one exists.
  const baseline=envelope.punctuation?bottom+1:top+Math.min(h,body*envelope.up);
  return {left,top,width:w,height:h,body,baseline,
    stroke:area/Math.max(1,edges)/Math.max(1,body),
    slant:gradientX?gradientCross/gradientX:0,alpha,edgeContact:left===0||top===0||right===width-1||bottom===height-1};
}

export interface NormalizedInk extends UploadedWord { metrics:InkMetrics; correction:number; sourceScale:number;sourceGroup?:string }
export async function normalizeInk(word:UploadedWord,sourceGroup='capture'):Promise<NormalizedInk>{
  const bitmap=await decodeInk(word.image);
  try{
    const source=canvas(bitmap.width,bitmap.height),context=source.getContext('2d')!;
    context.drawImage(bitmap,0,0);
    const measured=analyzeInk(context.getImageData(0,0,source.width,source.height).data,source.width,source.height,word.text);
    const target=canvas(measured.width+4,measured.height+4),ctx=target.getContext('2d')!,pixels=ctx.createImageData(target.width,target.height);
    for(let y=0;y<measured.height;y++)for(let x=0;x<measured.width;x++)pixels.data[((y+2)*target.width+x+2)*4+3]=measured.alpha[(y+measured.top)*source.width+x+measured.left];
    ctx.putImageData(pixels,0,0);
    // Glyph-editor metrics are in virtual em units; PNGs retain capture pixels.
    // Uploaded/neural word metrics already use pixels and have pixelScale=1.
    const pixelScale=bitmap.height/word.height,sourceEm=word.em*pixelScale;
    const em=measured.body/.52;
    const baseline=letterEnvelope(word.text).punctuation?word.baseline*pixelScale-measured.top+2:measured.baseline-measured.top+2;
    return {...word,image:target.toDataURL('image/png'),width:target.width,height:target.height,em,baseline,
      metrics:measured,correction:sourceEm/em,sourceScale:measured.body/sourceEm,sourceGroup};
  }finally{bitmap.close();}
}

/** Blend the source's real relative sizing with a shared body-height target.
 * Full normalization removes image padding/resolution as a source of scale.
 * Lower consistency retains bounded original size differences, never anisotropy.
 */
export function normalizeWordScale(words:NormalizedInk[],settings:Settings){
  const ratios=words.filter(word=>/[A-Za-z]/.test(word.text)).map(word=>word.sourceScale);
  const center=median(ratios)||.52,consistency=strength(settings.wordConsistency,.9);
  const groups=new Map<string,number>();
  for(const word of words)if(!groups.has(word.sourceGroup||'')){
    groups.set(word.sourceGroup||'',median(words.filter(other=>other.sourceGroup===word.sourceGroup&&/[A-Za-z]/.test(other.text)).map(other=>other.sourceScale))||center);
  }
  for(const word of words){
    const group=groups.get(word.sourceGroup||'')||center;
    if(letterEnvelope(word.text).punctuation){
      const sourceEm=word.em*word.correction,body=sourceEm*group;
      word.metrics.stroke*=word.metrics.body/body;word.metrics.body=body;
      word.em=body/.52;word.correction=sourceEm/word.em;word.sourceScale=group;
    }
    const relative=Math.max(.85,Math.min(1.15,word.sourceScale/group));
    const retained=1+(relative-1)*(1-consistency);
    word.em/=retained;word.correction*=retained;
  }
}

/** Choose only real/synthesized alternate candidates with compatible geometry. */
export function compatibleVariants(pool:NormalizedInk[],document:NormalizedInk[],settings:Settings){
  if(pool.length<2)return pool;
  const stroke=median(document.map(word=>word.metrics.stroke)),slant=median(document.map(word=>word.metrics.slant));
  const width=median(pool.map(word=>word.metrics.width/word.metrics.body));
  const fidelity=strength(settings.styleFidelity,.9);
  const ranked=pool.map(word=>({word,score:Math.abs(Math.log(Math.max(.001,word.metrics.stroke)/Math.max(.001,stroke)))+Math.abs(word.metrics.slant-slant)+Math.abs(Math.log((word.metrics.width/word.metrics.body)/width))})).sort((a,b)=>a.score-b.score);
  const kept=ranked.filter(item=>item.score<=ranked[0].score+(.75-.4*fidelity)).map(item=>item.word);
  return kept.length?kept:[ranked[0].word];
}

export function qualityReport(doc:GeneratedDocument,nominalSize:number,images:NormalizedInk[]=[],variantsUsed=0,notes:string[]=[]):HandwritingQuality{
  const all=doc.pages.flatMap(page=>page.items),warnings=[...notes];
  const clipped=images.filter(image=>image.metrics.edgeContact);
  if(clipped.length)warnings.push(clipped.length+' source crops touch an image edge. Inspect for clipped strokes; missing source ink cannot be recovered by normalization.');
  const examples=(samples:NormalizedInk[])=>[...new Set(samples.map(image=>image.text))].slice(0,6).join(', ');
  const strokeMedian=median(images.map(image=>image.metrics.stroke));
  const strokes=images.filter(image=>strokeMedian>0&&(image.metrics.stroke>strokeMedian*1.9||image.metrics.stroke<strokeMedian*.5));
  if(strokes.length)warnings.push(`${strokes.length} source crops have unusual stroke thickness (${examples(strokes)}). Their original strokes were preserved; review these samples.`);
  const widthRatios=images.filter(image=>/[A-Za-z]/.test(image.text)).map(image=>({image,ratio:image.metrics.width/image.metrics.body/Math.max(1,[...image.text].length)}));
  const widthMedian=median(widthRatios.map(item=>item.ratio));
  const widths=widthRatios.filter(item=>widthMedian>0&&(item.ratio>widthMedian*2.1||item.ratio<widthMedian*.4));
  if(widths.length)warnings.push(`${widths.length} source crops have unusual width proportions (${examples(widths.map(item=>item.image))}); check segmentation and labels. They were not stretched into a different letter shape.`);
  const slantMedian=median(images.map(image=>image.metrics.slant));
  const slants=images.filter(image=>Math.abs(image.metrics.slant-slantMedian)>.45);
  if(slants.length)warnings.push(`${slants.length} source crops have a different slant signature (${examples(slants)}). This image statistic is approximate; review writer consistency.`);
  let layoutIssues=0,baselineIssues=0;
  const s=doc.renderSettings||doc.request.settings;
  for(const page of doc.pages)for(let i=0;i<page.items.length;i++){
    const item=page.items[i],previous=page.items[i-1];
    const bounds=inkBounds(item,s.slant),prior=previous?inkBounds(previous,s.slant):undefined;
    if(![item.x,item.y,item.width,item.scale].every(Number.isFinite)||item.x<s.margin-.1||item.x+item.width>page.width-s.margin+1||item.y-(item.inkAscent||0)<s.margin-.5||item.y+(item.inkDescent||0)>page.height-s.margin+.5)layoutIssues++;
    if(previous&&previous.line===item.line&&item.x<previous.x+previous.width-.2)layoutIssues++;
    if(item.x+bounds.left<s.margin-.5||item.x+bounds.right>page.width-s.margin+.5)layoutIssues++;
    if(previous&&previous.line===item.line&&item.x+bounds.left<previous.x+prior!.right-.2)layoutIssues++;
    if(previous&&previous.line===item.line&&Math.abs(item.y-previous.y)>s.size*.08)baselineIssues++;
  }
  if(layoutIssues)warnings.push(`${layoutIssues} layout bounds or spacing constraints need review.`);
  if(baselineIssues)warnings.push(`${baselineIssues} words have an unusual baseline change within a line.`);
  return {nominalSize,effectiveSize:(doc.renderSettings||doc.request.settings).size,checkedWords:new Set(all.map((item,i)=>item.wordIndex??i)).size,
    checkedLines:doc.pages.reduce((sum,page)=>sum+new Set(page.items.map(item=>item.line??item.y)).size,0),checkedPages:doc.pages.length,
    normalizedImages:images.length,sizeCorrections:images.filter(image=>Math.abs(image.correction-1)>.15).length,
    variantsUsed,warnings:[...new Set(warnings)]};
}
