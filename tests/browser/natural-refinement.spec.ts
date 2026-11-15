import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {unzipSync} from 'fflate';

const directory='.cache/natural-refinement';
const sentences=[
  'Artificial intelligence is transforming the future of technology.',
  'I take every word you own.',
  'The little letters look different every time.',
];

test('all 52 Classic letters render three actual authored outlines in Canvas',async({page})=>{
  await page.goto('/#studio');await fs.mkdir(directory,{recursive:true});
  const result=await page.evaluate(async()=>{
    await document.fonts.load('400 38px "InkForge Context"');
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const chart=document.createElement('canvas');chart.width=1746;chart.height=800;
    const ctx=chart.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,chart.width,chart.height);
    ctx.fillStyle='black';const counts:number[]=[];
    for(let i=0;i<alphabet.length;i++){
      const forms=[alphabet[i],String.fromCodePoint(0xE000+i*2),String.fromCodePoint(0xE001+i*2)];
      const captures=forms.map((letter,index)=>{
        const cell=document.createElement('canvas');cell.width=60;cell.height=65;
        const context=cell.getContext('2d')!;context.font='400 38px "InkForge Context"';context.fillText(letter,10,45);
        ctx.drawImage(cell,(i%13)*132+index*40,Math.floor(i/13)*180+55);
        return cell.toDataURL();
      });
      counts.push(new Set(captures).size);
      ctx.font='12px sans-serif';ctx.fillText(alphabet[i],(i%13)*132,Math.floor(i/13)*180+25);
    }
    return {loaded:document.fonts.check('400 38px "InkForge Context"'),counts,chart:chart.toDataURL()};
  });
  expect(result.loaded).toBe(true);expect(result.counts).toHaveLength(52);
  expect(result.counts.every(count=>count===3)).toBe(true);
  await fs.writeFile(directory+'/alphabet.png',Buffer.from(result.chart.split(',')[1],'base64'));
});

test('requested sentences, varied long text and repeated letters retain a deterministic smaller layout through every export',async({page})=>{
  await page.goto('/#studio');await fs.mkdir(directory,{recursive:true});
  const text=(sentences.join('\n')+'\n\n'+
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz. Bookkeeper committee balloon Mississippi: aabbccddeeffgghhiijjkkllmmnnooppqqrrssttuuvvwwxxyyzz; 0123456789! (Carefully.)\n\n').repeat(9);
  const result=await page.evaluate(async(text)=>{
    const load=(path:string)=>import(path);
    const {generate}=await load('/src/engine/generate.ts');
    const {renderPage,exportPNG,exportPDF,exportAllPNG}=await load('/src/engine/render.ts');
    const {defaults}=await load('/src/types.ts');
    const request={text,mode:'default',engine:'browser',styleId:'classic',settings:{...defaults,variation:1,wordConsistency:1},seed:42,fallback:false};
    const doc=await generate(request),again=await generate(doc.request);
    const first=await renderPage(doc,0),same=await renderPage(again,0);
    const items=doc.pages.flatMap((page:any)=>page.items);
    const blobData=async(blob:Blob)=>{
      const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
      for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
      return btoa(binary);
    };
    return {
      nominal:doc.request.settings.size,inputSize:request.settings.size,effective:doc.renderSettings?.size,
      rerenderEffective:again.renderSettings?.size,identical:first.toDataURL()===same.toDataURL(),
      texts:items.map((item:any)=>item.text),missing:doc.missing,pages:doc.pages.length,quality:doc.quality,
      aliases:new Set(items.flatMap((item:any)=>[...(item.renderText||'')].filter((ch:any)=>ch.codePointAt(0)>=0xE000&&ch.codePointAt(0)<0xE068))).size,
      png:await blobData(await exportPNG(doc,0)),pdf:await blobData(await exportPDF(doc)),zip:await blobData(await exportAllPNG(doc)),
    };
  },text);
  expect(result.nominal).toBe(28);expect(result.inputSize).toBe(28);expect(result.effective).toBeCloseTo(22.4);
  expect(result.rerenderEffective).toBeCloseTo(result.effective);expect(result.identical).toBe(true);
  expect(result.texts).toEqual(text.match(/\S+/g));expect(result.missing).toEqual([]);expect(result.pages).toBeGreaterThan(1);
  expect(result.aliases).toBe(104);expect(result.quality.checkedWords).toBe(result.texts.length);
  expect(result.quality.checkedPages).toBe(result.pages);
  expect(result.quality.warnings.some((warning:string)=>/layout bounds|baseline change|spacing constraints/i.test(warning))).toBe(false);
  const png=Buffer.from(result.png,'base64'),pdf=Buffer.from(result.pdf,'base64'),zip=Buffer.from(result.zip,'base64');
  expect([png.readUInt32BE(16),png.readUInt32BE(20)]).toEqual([2480,3508]);
  const pdfText=pdf.toString('latin1');expect(pdfText).toContain('/Count '+result.pages);
  const box=pdfText.match(/MediaBox \[0 0 ([\d.]+) ([\d.]+)/);
  expect(Number(box?.[1])).toBeCloseTo(595.28,1);expect(Number(box?.[2])).toBeCloseTo(841.89,1);
  expect(Object.keys(unzipSync(zip))).toHaveLength(result.pages);
  await fs.writeFile(directory+'/long-page.png',png);await fs.writeFile(directory+'/long-document.pdf',pdf);await fs.writeFile(directory+'/pages.zip',zip);
  await fs.writeFile(directory+'/measurements.json',JSON.stringify({quality:result.quality,pages:result.pages,nominal:result.nominal,effective:result.effective,authoredAlternates:result.aliases,deterministic:result.identical},null,2));
});

test('all four browser presets remain available with distinct deterministic writing',async({page})=>{
  await page.goto('/#studio');
  const result=await page.evaluate(async(text)=>{
    const load=(path:string)=>import(path),{generate}=await load('/src/engine/generate.ts'),{renderPage}=await load('/src/engine/render.ts'),{defaults}=await load('/src/types.ts');
    const outputs=[];
    for(const styleId of ['classic','neat','casual','flowing']){
      const request={text,mode:'default',engine:'browser',styleId,settings:{...defaults},seed:42,fallback:false};
      const doc=await generate(request),again=await generate(request);
      const image=(await renderPage(doc,0)).toDataURL();
      outputs.push({styleId,image,same:image===(await renderPage(again,0)).toDataURL(),source:doc.source,missing:doc.missing,effective:doc.renderSettings?.size});
    }
    return outputs;
  },sentences.join('\n'));
  expect(new Set(result.map(output=>output.image)).size).toBe(4);
  for(const output of result){expect(output.same).toBe(true);expect(output.missing).toEqual([]);expect(output.effective).toBeCloseTo(22.4);}
  await expect(page.locator('.style-picker > button')).toHaveCount(4);
});

test('source captures at different resolutions share one body scale without invented font strokes',async({page})=>{
  await page.goto('/#studio');let synthesis=0;
  await page.route('http://127.0.0.1:8000/generate',route=>{synthesis++;return route.abort();});
  const result=await page.evaluate(async()=>{
    const load=(path:string)=>import(path),{generate}=await load('/src/engine/generate.ts'),{renderPage}=await load('/src/engine/render.ts'),{defaults}=await load('/src/types.ts');
    // Deliberately synthetic geometric source samples: these test pixel scale,
    // not OCR accuracy, human authorship or learned handwriting identity.
    const samples=[['moon',1],['moon',3],['noon',3]].map(([label,scale],index)=>{
      const text=String(label),factor=Number(scale),c=document.createElement('canvas');c.width=170*factor;c.height=100*factor;
      const context=c.getContext('2d')!;context.scale(factor,factor);context.strokeStyle='black';context.lineWidth=2;
      for(let i=0;i<4;i++){context.beginPath();context.ellipse(24+i*27,45,11,15,0,0,Math.PI*2);context.stroke();}
      if(index===1){context.beginPath();context.moveTo(24,60);context.lineTo(31,56);context.stroke();}
      return {id:'geometry-'+index,text,image:c.toDataURL(),width:c.width,height:c.height,baseline:65*factor,em:64,line:0};
    });
    const profile={id:'geometry',name:'Synthetic scale fixture',version:1,createdAt:0,em:64,glyphs:{},kind:'reference',wordSamples:samples,references:Array(5).fill(samples[0].image)};
    const request={text:'moon noon moon moon moon',profile,references:profile.references,mode:'personalized',engine:'neural',styleId:'flowing',settings:{...defaults,variation:1,wordConsistency:1},seed:42,fallback:false};
    const original=CanvasRenderingContext2D.prototype.fillText;let textDraws=0;
    CanvasRenderingContext2D.prototype.fillText=function(this:CanvasRenderingContext2D,...args:Parameters<CanvasRenderingContext2D['fillText']>){textDraws++;return original.apply(this,args);};
    try{
      const doc=await generate(request);await renderPage(doc,0);
      const items=doc.pages.flatMap((page:any)=>page.items),visibleHeights=[];
      for(const item of items){
        const bitmap=await createImageBitmap(await(await fetch(item.image)).blob());
        const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const context=c.getContext('2d')!;context.drawImage(bitmap,0,0);bitmap.close();
        const rgba=context.getImageData(0,0,c.width,c.height).data;let top=c.height,bottom=-1;
        for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(rgba[(y*c.width+x)*4+3]>=40){top=Math.min(top,y);bottom=Math.max(bottom,y);}
        visibleHeights.push((bottom-top+1)*doc.renderSettings.size/item.imageEm);
      }
      return {items:items.map((item:any)=>({text:item.text,id:item.sourceWordId,origin:item.origin,scale:item.scale,rotation:item.rotation,y:item.y})),visibleHeights,quality:doc.quality,source:doc.source,synthesized:doc.synthesizedWords,textDraws};
    }finally{CanvasRenderingContext2D.prototype.fillText=original;}
  });
  expect(synthesis).toBe(0);expect(result.synthesized).toEqual([]);expect(result.textDraws).toBe(0);
  expect(result.items.every((item:any)=>item.origin==='uploaded'&&item.scale===1&&item.rotation===0)).toBe(true);
  expect(new Set(result.items.map((item:any)=>item.y)).size).toBe(1);
  expect(new Set(result.items.filter((item:any)=>item.text==='moon').map((item:any)=>item.id)).size).toBe(2);
  expect(Math.max(...result.visibleHeights)/Math.min(...result.visibleHeights)).toBeLessThan(1.12);
  expect(result.quality.normalizedImages).toBeGreaterThanOrEqual(3);expect(result.quality.sizeCorrections).toBeGreaterThan(0);
});

test('virtual glyph metrics preserve punctuation scale and an outside-crop baseline at 1x and 3x capture resolution',async({page})=>{
  await page.goto('/#studio');
  const result=await page.evaluate(async()=>{
    const load=(path:string)=>import(path),{normalizeInk}=await load('/src/engine/handwriting.ts');
    const values=[];
    for(const captureScale of [1,3]){
      const c=document.createElement('canvas');c.width=40*captureScale;c.height=30*captureScale;
      const context=c.getContext('2d')!;context.fillStyle='black';
      context.fillRect(12*captureScale,8*captureScale,6*captureScale,6*captureScale);
      // Glyph editor metrics stay in virtual units while the PNG keeps its
      // capture pixels. A legitimate baseline can lie beyond the tight crop.
      const normalized=await normalizeInk({id:'virtual-dot-'+captureScale,text:'.',image:c.toDataURL(),
        width:40,height:30,baseline:45,em:60});
      const physicalScale=22.4/normalized.em;
      values.push({sourceScale:normalized.sourceScale,correction:normalized.correction,
        baseline:normalized.baseline,cropHeight:normalized.height,
        visibleHeight:normalized.metrics.height*physicalScale,
        baselineToInkTop:(normalized.baseline-2)*physicalScale,
        baselineToInkBottom:(normalized.baseline-2-normalized.metrics.height)*physicalScale});
    }
    return values;
  });
  expect(result).toHaveLength(2);
  expect(result[0].sourceScale).toBeCloseTo(.625,6);
  expect(result[1].sourceScale).toBeCloseTo(result[0].sourceScale,6);
  expect(result[1].correction).toBeCloseTo(result[0].correction,6);
  expect(result[1].visibleHeight).toBeCloseTo(result[0].visibleHeight,6);
  expect(result[1].baselineToInkTop).toBeCloseTo(result[0].baselineToInkTop,6);
  expect(result[1].baselineToInkBottom).toBeCloseTo(result[0].baselineToInkBottom,6);
  for(const value of result)expect(value.baseline).toBeGreaterThan(value.cropHeight);
});

test('personal unseen words retain their neural path and selected image references',async({page})=>{
  await page.goto('/#studio');let body:{words:string[];references:string[]}|undefined;
  const fixture=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=100;c.height=64;const context=c.getContext('2d')!;
    context.strokeStyle='black';context.lineWidth=3;context.beginPath();context.moveTo(4,45);context.bezierCurveTo(21,6,45,60,94,31);context.stroke();
    return c.toDataURL();
  });
  const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS'};
  await page.route('http://127.0.0.1:8000/generate',async route=>{
    if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
    body=route.request().postDataJSON();await route.fulfill({headers,json:{words:body!.words.map(text=>({text,image:fixture,width:100}))}});
  });
  const result=await page.evaluate(async(image)=>{
    const load=(path:string)=>import(path),{generate}=await load('/src/engine/generate.ts'),{renderPage}=await load('/src/engine/render.ts'),{defaults}=await load('/src/types.ts');
    const profile={id:'personal',name:'Synthetic neural routing fixture',version:1,createdAt:0,em:64,glyphs:{},kind:'reference',references:Array(5).fill(image),wordSamples:[{id:'source-moon',text:'moon',image,width:100,height:64,baseline:50,em:64}]};
    const original=CanvasRenderingContext2D.prototype.fillText;let textDraws=0;
    CanvasRenderingContext2D.prototype.fillText=function(this:CanvasRenderingContext2D,...args:Parameters<CanvasRenderingContext2D['fillText']>){textDraws++;return original.apply(this,args);};
    try{
      const doc=await generate({text:'moon future moon',profile,references:profile.references,mode:'personalized',engine:'neural',styleId:'classic',settings:defaults,seed:42,fallback:false});await renderPage(doc,0);
      return {textDraws,synthesized:doc.synthesizedWords,origins:doc.pages.flatMap((page:any)=>page.items.map((item:any)=>item.origin)),missing:doc.missing,source:doc.source};
    }finally{CanvasRenderingContext2D.prototype.fillText=original;}
  },fixture);
  expect(body?.words).toEqual(['future']);expect(body?.references).toEqual(Array(5).fill(fixture));
  expect(result.synthesized).toEqual(['future']);expect(result.origins).toEqual(['uploaded','neural','uploaded']);
  expect(result.textDraws).toBe(0);expect(result.missing).toEqual([]);
});

test('optional identical human-ink sources compare with the prior renderer',async({page,browser})=>{
  const profilePath='.cache/handwriting-quality/human-profile.json';
  test.skip(process.env.INKFORGE_REFINEMENT_REAL_TEST!=='1'||!existsSync(profilePath),'Opt-in authorized local IAM comparison; needs the prior renderer at INKFORGE_BASELINE_URL.');
  const profile=JSON.parse(await fs.readFile(profilePath,'utf8')),text=await fs.readFile('.cache/handwriting-quality/human-text.txt','utf8');
  const previous=await browser.newPage();await previous.goto(process.env.INKFORGE_BASELINE_URL||'http://127.0.0.1:4174');await page.goto('/#studio');
  const render=async(target:typeof page)=>target.evaluate(async({profile,text})=>{
    const load=(path:string)=>import(path),{generate}=await load('/src/engine/generate.ts'),{renderPage}=await load('/src/engine/render.ts'),{defaults}=await load('/src/types.ts');
    const started=performance.now();const doc=await generate({text,profile,references:profile.references,mode:'personalized',engine:'neural',styleId:'classic',settings:defaults,seed:42,fallback:false});
    return {image:(await renderPage(doc,0,2)).toDataURL(),texts:doc.pages.flatMap((page:any)=>page.items.map((item:any)=>item.text)),quality:doc.quality,synthesized:doc.synthesizedWords,seconds:(performance.now()-started)/1000};
  },{profile,text});
  const before=await render(previous),after=await render(page);
  const requestedText=sentences.join('\n\n');
  const renderPreset=async(target:typeof page)=>target.evaluate(async(text)=>{
    const load=(path:string)=>import(path),{generate}=await load('/src/engine/generate.ts'),{renderPage}=await load('/src/engine/render.ts'),{defaults}=await load('/src/types.ts');
    const doc=await generate({text,mode:'default',engine:'browser',styleId:'classic',settings:{...defaults,size:28},seed:42,fallback:false});
    return {image:(await renderPage(doc,0,2)).toDataURL(),text:doc.request.text,nominal:doc.request.settings.size,
      effective:doc.renderSettings?.size??doc.request.settings.size,texts:doc.pages.flatMap((page:any)=>page.items.map((item:any)=>item.text)),quality:doc.quality};
  },requestedText);
  const requestedBefore=await renderPreset(previous),requestedAfter=await renderPreset(page);await previous.close();
  expect(after.texts).toEqual(before.texts);expect(after.synthesized).toEqual([]);expect(after.quality.checkedWords).toBe(after.texts.length);
  expect(requestedBefore.text).toBe(requestedText);expect(requestedAfter.text).toBe(requestedText);
  expect(requestedAfter.texts).toEqual(requestedBefore.texts);expect(requestedBefore.nominal).toBe(28);expect(requestedAfter.nominal).toBe(28);
  expect(requestedAfter.effective).toBeCloseTo(22.4);
  await fs.mkdir(directory,{recursive:true});await fs.writeFile(directory+'/human-before.png',Buffer.from(before.image.split(',')[1],'base64'));
  await fs.writeFile(directory+'/human-after.png',Buffer.from(after.image.split(',')[1],'base64'));
  await fs.writeFile(directory+'/requested-before.png',Buffer.from(requestedBefore.image.split(',')[1],'base64'));
  await fs.writeFile(directory+'/requested-after.png',Buffer.from(requestedAfter.image.split(',')[1],'base64'));
  await fs.writeFile(directory+'/human-comparison.json',JSON.stringify({sameSourceProfile:true,writer:profile.source?.writer,beforeSeconds:before.seconds,afterSeconds:after.seconds,quality:after.quality,
    requestedSentences:{text:requestedText,seed:42,nominalSize:28,beforeEffective:requestedBefore.effective,afterEffective:requestedAfter.effective,quality:requestedAfter.quality}},null,2));
});
