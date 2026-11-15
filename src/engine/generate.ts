import type { GenerationRequest, GeneratedDocument, Glyph, UploadedWord } from '../types';
import { canvas } from './image';
import { layout, type Measured } from './layout';
import { styles } from './styles';
import { uploadCoverage, uploadedWordVariants, wordKey } from './uploadedWords';
import { normalizeInk, normalizeWordScale, compatibleVariants, qualityReport, writingSettings, strength, type NormalizedInk } from './handwriting';
import { contextualText, contextHash, variantSelector } from './variation';

export function isolateProfile(request:GenerationRequest):GenerationRequest {
  return request.mode==='default'?{...request,profile:undefined,references:undefined}:request;
}
export async function generate(input:GenerationRequest,signal?:AbortSignal):Promise<GeneratedDocument>{
  const original=isolateProfile(input),nominalSize=input.settings.size;
  const request={...original,settings:writingSettings(input.settings)},s=request.settings;
  if(!request.text.trim())throw new Error('Enter some text to generate handwriting.');
  if(request.text.length>30000)throw new Error('Use up to 30,000 characters per document.');
  const tokens=request.text.match(/\S+/g)||[],style=styles.find(item=>item.id===request.styleId)||styles[0];
  const select=variantSelector(request.seed),used=new Set<string>(),notes:string[]=[];
  const images:NormalizedInk[]=[];
  let reusedWords:string[]=[],synthesizedWords:string[]=[];
  let ascent=s.size*.8,descent=s.size*.2;
  let measure:(text:string,position:{wordIndex:number;offset:number})=>Measured;
  if(request.engine==='neural'){
    if(request.mode==='personalized'&&request.profile&&(request.profile.kind!=='reference'||request.references?.length!==5))
      throw new Error('Personalized neural synthesis needs five natural reference crops. Use Browser rendering for a glyph profile.');
    const coverage=request.mode==='personalized'&&request.profile?uploadCoverage(request.text,request.profile):undefined;
    reusedWords=[...new Set(coverage?.found||[])];
    const originals=uploadedWordVariants(request.profile),raw=new Map<string,UploadedWord[]>();
    for(const text of reusedWords)raw.set(wordKey(text),originals.get(wordKey(text))!);
    const missing=coverage?.missing||[...new Set(tokens)],counts=new Map<string,number>();
    for(const text of tokens)counts.set(text,(counts.get(text)||0)+1);
    const tasks=missing.flatMap(text=>Array.from({length:s.variation>0?Math.min(2,counts.get(text)||1):1},(_,variant)=>({text,variant})));
    for(let start=0;start<tasks.length;start+=80){
      signal?.throwIfAborted();const batch=tasks.slice(start,start+80);
      const response=await fetch('http://127.0.0.1:8000/generate',{method:'POST',headers:{'Content-Type':'application/json'},signal,
        body:JSON.stringify({words:batch.map(task=>task.text),variant_ids:batch.map(task=>task.variant),style_id:request.styleId,
          reference_source:request.mode==='personalized'&&!request.profile?'iam':'font',references:request.references||[],seed:request.seed,stroke_variation:strength(s.strokeVariation,.12),style_fidelity:strength(s.styleFidelity,.9)})});
      const result=await response.json();
      if(!response.ok)throw new Error(typeof result.detail==='string'?result.detail:'The local neural engine could not generate this text.');
      if(!Array.isArray(result.words)||result.words.length!==batch.length)throw new Error('The neural service returned an incomplete word batch.');
      for(let i=0;i<batch.length;i++){
        const item=result.words[i],task=batch[i];
        if(item.text!==task.text||typeof item.image!=='string'||!Number.isFinite(item.width)||item.width<=0)throw new Error('Invalid generated word image for '+task.text+'.');
        const key=wordKey(task.text),pool=raw.get(key)||[];
        if(!pool.some(word=>word.image===item.image))pool.push({id:'neural-'+task.text+'-'+task.variant,text:task.text,image:item.image,width:item.width,height:64,baseline:51.2,em:64});
        raw.set(key,pool);
      }
    }
    synthesizedWords=missing;
    const pools=new Map<string,NormalizedInk[]>();
    for(const [key,words] of raw){
      const pool:NormalizedInk[]=[];
      for(const word of words){
        signal?.throwIfAborted();
        try{const ink=await normalizeInk(word,coverage?.index.has(key)?'uploaded:'+(word.page??'image'):'neural');pool.push(ink);images.push(ink);}catch(error){if(words.length===1)throw error;}
      }
      if(!pool.length)throw new Error('No visible ink remains for '+key+'.');
      pools.set(key,pool);
    }
    normalizeWordScale(images,s);
    let replaced=0;
    for(const [key,pool] of pools){const kept=compatibleVariants(pool,images,s);replaced+=pool.length-kept.length;pools.set(key,kept);}
    if(replaced)notes.push(replaced+' outlier candidates were replaced by available variants with closer stroke/width measurements.');
    const plans=tokens.map((text,index)=>{
      const pool=pools.get(wordKey(text))!;
      const variant=s.variation>0?select(wordKey(text),pool.length,(tokens[index-1]||'^')+'|'+(tokens[index+1]||'$')+'|'+index):0;
      const word=pool[variant];used.add(word.id);return word;
    });
    const fixed=[...counts].filter(([text,count])=>count>1&&pools.get(wordKey(text))!.length===1).length;
    if(fixed)notes.push(fixed+' repeated words have only one distinct available image. New human letterforms cannot be recovered from a single captured outline.');
    if(synthesizedWords.length)notes.push('The pretrained word model shares a document style and latent anchor. Geometry checks do not verify spelling, pen trajectories or exact writer identity.');
    for(const word of plans){ascent=Math.max(ascent,word.baseline*s.size/word.em);descent=Math.max(descent,(word.height-word.baseline)*s.size/word.em);}
    measure=(text,position)=>{
      const word=plans[position.wordIndex],factor=s.size/word.em;
      return {image:word.image,width:word.width*factor,imageHeight:word.height,imageBaseline:word.baseline,imageEm:word.em,inkLeft:0,inkRight:word.width*factor,
        inkAscent:word.baseline*factor,inkDescent:(word.height-word.baseline)*factor,sourceWordId:word.id,
        origin:coverage?.index.has(wordKey(text))?'uploaded':'neural'};
    };
  }else{
    await document.fonts.load('400 '+s.size+'px "'+style.family+'"');
    if(!document.fonts.check('400 '+s.size+'px "'+style.family+'"'))throw new Error('The handwriting font could not be loaded.');
    const context=canvas(1,1).getContext('2d')!;
    context.font='400 '+s.size+'px "'+style.family+'"';context.letterSpacing=s.letterSpacing+'px';context.fontKerning='normal';
    const allowed=new Set(style.characters.map(code=>String.fromCodePoint(code))),missing=new Set<string>();
    const glyphs=new Map<string,Glyph[]>();
    if(request.mode==='personalized'){
      const profile=request.profile;
      if(!profile||!Object.values(profile.glyphs).some(pool=>pool.length))throw new Error('Choose a saved glyph profile, or return to Default Handwriting.');
      const prepared=new Map<string,{glyph:Glyph;ink:NormalizedInk}[]>();
      for(const [key,pool] of Object.entries(profile.glyphs)){
        if(!tokens.some(text=>text.includes(key)))continue;
        const values:{glyph:Glyph;ink:NormalizedInk}[]=[];
        for(const glyph of pool){
          signal?.throwIfAborted();
          const ink=await normalizeInk({id:glyph.id,text:key,image:glyph.ink,width:glyph.width,height:glyph.height,baseline:glyph.baseline,em:profile.em});
          if(values.some(value=>value.ink.image===ink.image))continue;
          values.push({glyph,ink});images.push(ink);
        }
        prepared.set(key,values);
      }
      normalizeWordScale(images,s);
      for(const [key,values] of prepared){
        const kept=compatibleVariants(values.map(value=>value.ink),images,s);
        glyphs.set(key,values.filter(value=>kept.includes(value.ink)).map(({glyph,ink})=>{
          const factor=profile.em/ink.em;
          return {...glyph,ink:ink.image,width:ink.width*factor,height:ink.height*factor,baseline:ink.baseline*factor,
            advance:ink.width*factor+Math.min(profile.em*.06,Math.max(0,(glyph.advance-glyph.width)*factor))};
        }));
      }
      notes.push('Captured glyph shapes and visible stroke weight are preserved. Natural cursive connections need actual ligature samples; this renderer does not invent new pen paths.');
      const single=[...glyphs.values()].filter(pool=>pool.length===1).length;
      if(single)notes.push(single+' used characters have one distinct captured outline. Add handwritten variants for more shape diversity.');
    }else if(style.id!=='classic')notes.push('This preset has fixed outlines. Its shapes are preserved; new character formations or pressure trajectories are not synthesized.');
    const keys=[...glyphs.keys()].filter(key=>glyphs.get(key)!.length).sort((a,b)=>b.length-a.length);
    const plans=tokens.map((text,wordIndex)=>{
      if(request.mode==='default'){
        for(const ch of text)if(!allowed.has(ch))missing.add(ch);
        const renderText=style.id==='classic'?contextualText(text,wordIndex,request.seed,select,s.variation):text;
        const fontWeight=style.id==='classic'?400+Math.round(contextHash((tokens[wordIndex-1]||'^')+'|'+text+'|'+wordIndex,request.seed)%25*strength(s.strokeVariation,.12)):400;
        context.font=fontWeight+' '+s.size+'px "'+style.family+'"';
        const metrics=context.measureText(renderText);
        ascent=Math.max(ascent,metrics.actualBoundingBoxAscent);descent=Math.max(descent,metrics.actualBoundingBoxDescent);
        for(const ch of renderText){const code=ch.codePointAt(0)!;if(code>=0xE000&&code<0xE068)used.add(ch);}
        return {renderText,fontWeight,width:metrics.width};
      }
      const pieces:{glyph:Glyph;x:number}[]=[];let width=0;
      for(let offset=0;offset<text.length;){
        const key=keys.find(key=>text.startsWith(key,offset));
        if(!key){missing.add(text[offset]);width+=context.measureText(text[offset]).width;offset++;continue;}
        const pool=glyphs.get(key)!,index=s.variation>0?select(key,pool.length,text.slice(Math.max(0,offset-1),offset+key.length+1)+'|'+wordIndex+'|'+offset):0;
        const glyph=pool[index],factor=s.size/request.profile!.em;used.add(key+':'+glyph.id);
        pieces.push({glyph,x:width});width+=glyph.advance*factor+s.letterSpacing;offset+=key.length;
        ascent=Math.max(ascent,glyph.baseline*factor);descent=Math.max(descent,(glyph.height-glyph.baseline)*factor);
      }
      return {glyphs:pieces,width};
    });
    measure=(text,position)=>{
      const plan=plans[position.wordIndex];
      if('renderText' in plan){
        const renderText=plan.renderText!.slice(position.offset,position.offset+text.length);
        context.font=plan.fontWeight+' '+s.size+'px "'+style.family+'"';const metrics=context.measureText(renderText);
        return {width:metrics.width,renderText,fontWeight:plan.fontWeight,inkAscent:metrics.actualBoundingBoxAscent,inkDescent:metrics.actualBoundingBoxDescent,inkLeft:-metrics.actualBoundingBoxLeft,inkRight:metrics.actualBoundingBoxRight};
      }
      const factor=s.size/request.profile!.em;
      return {width:plan.width,glyphs:plan.glyphs,inkLeft:0,inkRight:plan.width,inkAscent:Math.max(0,...plan.glyphs!.map(piece=>piece.glyph.baseline*factor)),
        inkDescent:Math.max(0,...plan.glyphs!.map(piece=>(piece.glyph.height-piece.glyph.baseline)*factor))};
    };
    const pages=layout(request,measure,ascent,descent);
    if(request.fallback&&[...missing].some(ch=>!allowed.has(ch)))throw new Error('The selected fallback preset does not support some missing characters.');
    signal?.throwIfAborted();
    const doc:GeneratedDocument={pages,request:original,renderSettings:s,missing:[...missing],reusedWords,synthesizedWords,
      source:request.mode==='personalized'?'Your extracted glyphs · browser rendering':style.name+' · browser preset rendering'};
    if(request.fallback&&missing.size)notes.push('Explicit preset fallback is active for missing glyphs; these letters do not come from your reference.');
    doc.quality=qualityReport(doc,nominalSize,images,used.size,notes);return doc;
  }
  const pages=layout(request,measure,ascent,descent);
  signal?.throwIfAborted();
  const coverage=request.mode==='personalized'&&request.profile?uploadCoverage(request.text,request.profile):undefined;
  const doc:GeneratedDocument={pages,request:original,renderSettings:s,missing:[],reusedWords,synthesizedWords,
    source:request.mode==='personalized'&&!request.profile?'DiffusionPen - AI-generated from real local IAM writer 000 crops':reusedWords.length?'Original uploaded ink · '+coverage!.found.length+' copied words'+(synthesizedWords.length?' / '+synthesizedWords.length+' new words synthesized by DiffusionPen':''):'DiffusionPen · local neural synthesis'};
  doc.quality=qualityReport(doc,nominalSize,images,used.size,notes);return doc;
}
