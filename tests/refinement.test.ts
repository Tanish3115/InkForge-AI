import {describe,expect,it} from 'vitest';
import {analyzeInk,compatibleVariants,letterEnvelope,normalizeWordScale,qualityReport,writingSettings,type NormalizedInk} from '../src/engine/handwriting';
import {contextualAlphabet,contextualText,variantSelector} from '../src/engine/variation';
import {layout,inkBounds} from '../src/engine/layout';
import {importDocument,withRefinementDefaults} from '../src/lib/storage';
import {defaults,type GenerationRequest,type Settings} from '../src/types';

const request:GenerationRequest={text:'',mode:'default',engine:'browser',styleId:'classic',settings:defaults,seed:42,fallback:false};
const refinementKeys=['wordConsistency','strokeVariation','baselineVariation','styleFidelity'] as const;
function backup(settings:unknown){
  const data=JSON.stringify({id:'old',name:'Saved note',version:1,text:'A saved document.',styleId:'classic',engine:'browser',seed:42,settings,updatedAt:0,fallback:false});
  return {size:Buffer.byteLength(data),text:async()=>data} as File;
}

/** Explicitly synthetic stroke geometry, not a human-writing/OCR benchmark. */
function strokePixels({scale=1,padding=10,thickness=2,separation=24,height=30,white=false}={}){
  const width=(padding*2+separation*2+14)*scale,h=(padding*2+height)*scale;
  const data=new Uint8ClampedArray(width*h*4);
  if(white)data.fill(255);
  for(let glyph=0;glyph<3;glyph++)for(let y=0;y<height*scale;y++)for(let x=0;x<14*scale;x++){
    if(x>=thickness*scale&&x<(14-thickness)*scale&&y>=thickness*scale&&y<(height-thickness)*scale)continue;
    const index=((y+padding*scale)*width+x+(padding+glyph*separation)*scale)*4;
    data.set([0,0,0,255],index);
  }
  return {data,width,height:h};
}
function word(id:string,options:Parameters<typeof strokePixels>[0]={},sourceScale=.52,text='murmur'):NormalizedInk{
  const pixels=strokePixels(options),metrics=analyzeInk(pixels.data,pixels.width,pixels.height,text),em=metrics.body/.52;
  return {id,text,image:'data:image/png;base64,AAAA',width:metrics.width+4,height:metrics.height+4,baseline:metrics.baseline-metrics.top+2,em,
    metrics,sourceScale,correction:.52/sourceScale};
}

describe('saved settings compatibility',()=>{
  it('fills new defaults without changing the saved nominal size or mutating a draft',async()=>{
    const legacy={...defaults};for(const key of refinementKeys)delete legacy[key];
    const upgraded=withRefinementDefaults(legacy);
    expect(upgraded.size).toBe(28);expect(legacy.wordConsistency).toBeUndefined();
    for(const key of refinementKeys)expect(upgraded[key]).toBe(defaults[key]);
    const imported=await importDocument(backup(legacy));
    expect(imported.settings).toEqual(upgraded);expect(imported.text).toBe('A saved document.');
    expect(writingSettings(imported.settings).size).toBeCloseTo(22.4);
    expect(writingSettings(imported.settings)).toEqual(writingSettings(imported.settings));
  });
  it('retains explicit zero strengths and rejects invalid refinement values',async()=>{
    const settings={...defaults,wordConsistency:0,strokeVariation:0,baselineVariation:0,styleFidelity:0};
    expect((await importDocument(backup(settings))).settings).toEqual(settings);
    for(const key of refinementKeys)for(const value of [-.01,1.01,'0.5',null])
      await expect(importDocument(backup({...defaults,[key]:value}))).rejects.toThrow('refinement settings');
  });
});

describe('context-aware letter formations',()=>{
  it('balances all three available forms for every uppercase and lowercase letter',()=>{
    const a=variantSelector(42),b=variantSelector(42);
    for(const letter of contextualAlphabet){
      const selected=Array.from({length:12},(_,index)=>a(letter,3,'neighbor|'+index));
      expect(selected).toEqual(Array.from({length:12},(_,index)=>b(letter,3,'neighbor|'+index)));
      expect([0,1,2].map(form=>selected.filter(value=>value===form).length)).toEqual([4,4,4]);
      for(let index=1;index<selected.length;index++)expect(selected[index]).not.toBe(selected[index-1]);
    }
  });
  it('preserves letter identity, case, punctuation and unsupported Unicode while varying outlines',()=>{
    const text=contextualAlphabet+' 0123.,!? “’” 🙂',select=variantSelector(42);
    const values=Array.from({length:3},(_,index)=>contextualText(text,index,42,select,1));
    for(let index=0;index<52;index++)expect(new Set(values.map(value=>value[index])).size).toBe(3);
    for(const rendered of values){
      const restored=[...rendered].map(character=>{
        const code=character.codePointAt(0)!;
        return code>=0xE000&&code<0xE068?contextualAlphabet[Math.floor((code-0xE000)/2)]:character;
      }).join('');
      expect(restored).toBe(text);
    }
    expect(contextualText(text,0,42,variantSelector(42),0)).toBe(text);
  });
  it('handles changing candidate pools without returning an unavailable variant',()=>{
    const choose=variantSelector(42);
    for(const length of [3,3,1,2,4,2,2,1,3]){
      const value=choose('a',length,'position');
      expect(Number.isInteger(value)).toBe(true);expect(value).toBeGreaterThanOrEqual(0);expect(value).toBeLessThan(length);
    }
  });
});

describe('visible-ink normalization',()=>{
  it('measures ink independently of transparent padding, white paper and source resolution',()=>{
    const base=strokePixels(),large=strokePixels({scale:3}),padded=strokePixels({padding:28}),paper=strokePixels({white:true});
    const a=analyzeInk(base.data,base.width,base.height,'murmur'),b=analyzeInk(large.data,large.width,large.height,'murmur');
    const c=analyzeInk(padded.data,padded.width,padded.height,'murmur'),d=analyzeInk(paper.data,paper.width,paper.height,'murmur');
    expect(b.body/a.body).toBeCloseTo(3,2);expect(b.width/a.width).toBeCloseTo(3,2);
    expect(c.body).toBeCloseTo(a.body);expect(c.width).toBe(a.width);expect(c.left-a.left).toBe(18);
    expect(d.body).toBeCloseTo(a.body);expect(d.baseline).toBe(a.baseline);
    expect(()=>analyzeInk(new Uint8ClampedArray(400),10,10,'blank')).toThrow('No visible ink');
  });
  it('uses generic caps, ascenders, dots and descenders rather than word-specific exceptions',()=>{
    expect(letterEnvelope('ACME').up).toBe(1.5);expect(letterEnvelope('bdfhkl').up).toBe(1.5);
    expect(letterEnvelope('murmur').up).toBe(1);expect(letterEnvelope('t').up).toBeGreaterThan(1);
    expect(letterEnvelope('ij').up).toBeGreaterThan(1);expect(letterEnvelope('gypq').down).toBeGreaterThan(0);
    expect(letterEnvelope('.,').punctuation).toBe(true);
    const lower=strokePixels({height:30}),upper=strokePixels({height:45});
    const lowerBody=analyzeInk(lower.data,lower.width,lower.height,'www').body,upperBody=analyzeInk(upper.data,upper.width,upper.height,'WWW').body;
    // Row-density evidence is deliberately approximate; caps should retain a
    // taller total envelope while inferred body sizes stay within 10%.
    expect(lowerBody/upperBody).toBeGreaterThan(.9);expect(lowerBody/upperBody).toBeLessThan(1.1);
  });
  it('tightens shared body scale while retaining only bounded source size differences',()=>{
    const make=()=>[word('small',{},.2),word('center',{},.52),word('large',{},1.3)];
    const strict=make(),relaxed=make(),partial=make();
    normalizeWordScale(strict,{...defaults,wordConsistency:1});normalizeWordScale(relaxed,{...defaults,wordConsistency:0});normalizeWordScale(partial,{...defaults,wordConsistency:.9});
    for(const sample of strict)expect(sample.metrics.body/sample.em).toBeCloseTo(.52);
    const ratios=relaxed.map(sample=>sample.metrics.body/sample.em/.52);
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(.85-1e-10);expect(Math.max(...ratios)).toBeLessThanOrEqual(1.15+1e-10);
    expect(Math.max(...ratios)-Math.min(...ratios)).toBeGreaterThan(.2);
    for(let index=0;index<partial.length;index++){
      expect(Math.abs(partial[index].metrics.body/partial[index].em/.52-1)).toBeLessThanOrEqual(.015+1e-10);
      expect(partial[index].width).toBe(strict[index].width);expect(partial[index].height).toBe(strict[index].height);
    }
  });
  it('higher fidelity selects closer available stroke candidates without inventing new images',()=>{
    const a=word('normal'),b=word('heavier',{thickness:4}),document=[a,word('other-normal'),word('third-normal'),b];
    const loose=compatibleVariants([a,b],document,{...defaults,styleFidelity:0}),strict=compatibleVariants([a,b],document,{...defaults,styleFidelity:1});
    expect(loose).toContain(b);expect(strict).toContain(a);expect(strict).not.toContain(b);
    expect(strict.every(candidate=>candidate===a||candidate===b)).toBe(true);
  });
});

describe('line and document constraints',()=>{
  it('anchors punctuation to captured letter scale instead of its own pen thickness',()=>{
    const letter=word('letter',{},.52,'moon'),thin=word('thin',{height:3},.9,'.'),thick=word('thick',{height:6},1.2,'.');
    for(const item of [thin,thick]){item.correction=200/item.em;item.baseline=50;}
    normalizeWordScale([letter,thin,thick],{...defaults,wordConsistency:1});
    expect(thin.em).toBeCloseTo(thick.em);expect(thin.baseline/thin.em).toBeCloseTo(thick.baseline/thick.em);
    expect(thin.em).toBeCloseTo(200);expect(thin.baseline).toBe(50);
  });
  it('reserves actual ink overhang and shear clearance at extreme global slants',()=>{
    for(const slant of [-12,12]){
      const settings={...defaults,size:50,slant,wordSpacing:.6};
      const pages=layout({...request,text:'angled '.repeat(90),settings},()=>({width:90,inkLeft:-4,inkRight:110,inkAscent:40,inkDescent:15}),40,15);
      for(const page of pages)for(let i=0;i<page.items.length;i++){
        const item=page.items[i],previous=page.items[i-1],box=inkBounds(item,slant);
        expect(item.x+box.left).toBeGreaterThanOrEqual(settings.margin-.01);expect(item.x+box.right).toBeLessThanOrEqual(page.width-settings.margin);
        if(previous?.line===item.line)expect(item.x+box.left).toBeGreaterThan(previous.x+inkBounds(previous,slant).right);
      }
      expect(qualityReport({pages,request:{...request,settings},missing:[],source:'Synthetic slant fixture'},50).warnings).toEqual([]);
    }
  });
  const paragraph='Artificial intelligence is transforming the future of technology.\nI take every word you own.\nThe little letters look different every time.\n\n';
  const measured=(text:string)=>({width:text.length*8,image:'original-ink',imageHeight:33,imageBaseline:25,imageEm:50,inkAscent:25,inkDescent:8});
  it('retains many paragraphs across pages with shared line baselines and no per-word image distortion',()=>{
    const text=paragraph.repeat(20),settings=writingSettings({...defaults,baselineVariation:1}),pages=layout({...request,text,settings},measured,25,8);
    expect(pages.length).toBeGreaterThan(2);expect(pages.flatMap(page=>page.items).map(item=>item.text)).toEqual(text.match(/\S+/g));
    for(const page of pages)for(let index=0;index<page.items.length;index++){
      const item=page.items[index],previous=page.items[index-1];
      expect(item.scale).toBe(1);expect(item.rotation).toBe(0);expect(item.opacity).toBe(settings.opacity);
      expect(item.x).toBeGreaterThanOrEqual(settings.margin);expect(item.x+item.width).toBeLessThan(page.width-settings.margin);
      expect(item.y-25).toBeGreaterThan(settings.margin);expect(item.y+8).toBeLessThan(page.height-settings.margin);
      if(previous?.line===item.line){expect(item.y).toBe(previous.y);expect(item.x).toBeGreaterThan(previous.x+previous.width);}
      const grid=page.baseline+Math.round((item.y-page.baseline)/page.lineHeight)*page.lineHeight;
      expect(Math.abs(item.y-grid)).toBeLessThanOrEqual(settings.size*.08);
    }
    const report=qualityReport({pages,request:{...request,text},renderSettings:settings,missing:[],source:'Synthetic geometry fixture'},28);
    expect(report.checkedWords).toBe(text.match(/\S+/g)!.length);expect(report.checkedPages).toBe(pages.length);expect(report.warnings).toEqual([]);
  });
  it('zero baseline strength stays on the line grid and wrapped font tokens retain stable offsets',()=>{
    const settings:Settings={...defaults,baselineVariation:0},token='alphabet'.repeat(100);
    const pages=layout({...request,text:token,settings},(part,position)=>({width:part.length*12,renderText:token.slice(position.offset,position.offset+part.length)}),25,8);
    const items=pages.flatMap(page=>page.items);expect(items.map(item=>item.renderText).join('')).toBe(token);
    expect(new Set(items.map(item=>item.wordIndex)).size).toBe(1);
    for(const page of pages)for(const item of page.items){
      const delta=(item.y-page.baseline)/page.lineHeight;expect(delta).toBeCloseTo(Math.round(delta));
    }
    expect(()=>layout({...request,text:'unbreakable'},()=>({width:1000,image:'real-ink'}),25,8)).toThrow('wider than the available page');
  });
  it('quality checks report actual source thickness/width outliers and unsafe layout without claiming identity',()=>{
    const samples=[word('a'),word('b'),word('c'),word('thick',{thickness:6}),word('wide',{separation:90})];
    const pages=layout({...request,text:'first second third'},measured,25,8);
    pages[0].items[1].y+=90;pages[0].items[2].inkAscent=1000;
    const report=qualityReport({pages,request,missing:[],source:'Synthetic quality fixture'},28,samples,0);
    expect(report.checkedWords).toBe(3);expect(report.normalizedImages).toBe(5);
    for(const message of ['stroke thickness','width proportions','baseline','bounds'])expect(report.warnings.some(warning=>warning.includes(message))).toBe(true);
  });
});
