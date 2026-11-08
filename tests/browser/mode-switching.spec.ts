import {test,expect,type Page} from '@playwright/test';
import fs from 'node:fs/promises';
test.setTimeout(60000);

const healthy={ready:true,reason:'Test local service ready',styles:[{id:'classic',name:'Classic condition',provenance:'Test condition'},{id:'neat',name:'Neat condition',provenance:'Test condition'}]};
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};

async function fixture(page:Page) {
  return page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=100;c.height=64;
    const ctx=c.getContext('2d')!;ctx.lineWidth=3;ctx.strokeStyle='black';ctx.beginPath();ctx.moveTo(3,45);ctx.bezierCurveTo(18,5,31,60,45,25);ctx.bezierCurveTo(63,60,76,7,96,42);ctx.stroke();
    const image=c.toDataURL();
    return {id:'mode-fixture',name:'Mode switching sample',version:1,createdAt:Date.now(),em:64,glyphs:{},kind:'reference',references:Array(5).fill(image),wordSamples:[{id:'hello-source',text:'hello',image,width:100,height:64,baseline:50,em:64}],sourceTranscript:'hello'};
  });
}

async function importSample(page:Page) {
  const data=await fixture(page);
  await page.getByLabel('Import profile',{exact:true}).setInputFiles({name:'mode-profile.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await expect(page.getByLabel('Personal profile',{exact:true})).not.toHaveValue('');
  return data;
}

async function render(page:Page) {
  await page.getByRole('button',{name:'Generate handwriting',exact:true}).click();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.rendering-badge')).toHaveCount(0);
  return page.locator('canvas').evaluate((c:HTMLCanvasElement)=>c.toDataURL());
}

async function expectFourFonts(page:Page) {
  await expect(page.locator('.style-picker > button')).toHaveCount(4);
  for(const name of ['Classic','Neat','Casual','Flowing'])await expect(page.locator('.style-picker').getByRole('button',{name:new RegExp(name)})).toBeVisible();
}

test('returning from an uploaded sample restores the chosen preset and all four fonts',async({page})=>{
  await page.route('http://127.0.0.1:8000/health',route=>route.fulfill({json:healthy,headers:cors}));
  let synthesis=0;
  await page.route('http://127.0.0.1:8000/generate',route=>{synthesis++;return route.abort();});
  await page.goto('/#studio');
  await page.getByRole('textbox',{name:'Digital text',exact:true}).fill('hello');
  await page.locator('.style-picker').getByRole('button',{name:/Casual/}).click();
  const casual=await render(page);
  await page.locator('.style-picker').getByRole('button',{name:/Flowing/}).click();
  const flowing=await render(page);
  expect(flowing).not.toBe(casual);
  await page.locator('.style-picker').getByRole('button',{name:/Casual/}).click();
  await importSample(page);
  expect(await render(page)).not.toBe(casual);
  await expect(page.locator('.output-status')).toContainText('Original uploaded ink');
  await page.getByRole('button',{name:/Default handwriting.*No upload needed/}).click();
  await expectFourFonts(page);
  await expect(page.getByLabel('Generation engine')).toHaveValue('browser');
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.locator('.style-picker').getByRole('button',{name:/Casual/})).toHaveAttribute('aria-pressed','true');
  expect(await render(page)).toBe(casual);
  await page.locator('.style-picker').getByRole('button',{name:/Flowing/}).click();
  expect(await render(page)).toBe(flowing);
  await expect(page.locator('.output-status')).toContainText('Flowing');
  expect(synthesis).toBe(0);
  await page.getByRole('button',{name:'Export',exact:true}).click();
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download editable project backup'}).click();
  await (await download).saveAs('.cache/mode-default-project.json');
  const saved=JSON.parse(await fs.readFile('.cache/mode-default-project.json','utf8'));
  expect(saved.engine).toBe('browser');expect(saved.styleId).toBe('flowing');expect(saved.profileId).toBeUndefined();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:/My handwriting.*Upload a sample/}).click();
  await expect(page.getByLabel('Personal profile',{exact:true})).toHaveValue('');
});

test('both the deselect button and empty dropdown choice remove a sample without deleting it',async({page})=>{
  await page.route('http://127.0.0.1:8000/health',route=>route.fulfill({json:healthy,headers:cors}));
  await page.goto('/#studio');await importSample(page);
  const selection=page.getByLabel('Personal profile',{exact:true});const id=await selection.inputValue();
  await page.getByRole('button',{name:'Deselect handwriting sample'}).click();
  await expect(selection).toHaveValue('');
  await expect(page.getByRole('region',{name:'Uploaded handwriting word library'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Generate handwriting',exact:true})).toBeDisabled();
  await expect(page.locator('.sidebar-profiles')).toContainText('Mode switching sample');
  await selection.selectOption(id);
  await expect(page.getByRole('region',{name:'Uploaded handwriting word library'})).toBeVisible();
  await selection.selectOption('');
  await expect(selection).toHaveValue('');
  await expect(page.getByRole('button',{name:'Generate handwriting',exact:true})).toBeDisabled();
});

test('a delayed sample connection cannot reactivate neural mode after returning to a font',async({page})=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('http://127.0.0.1:8000/health',async route=>{await gate;await route.fulfill({json:healthy,headers:cors});});
  await page.route('http://127.0.0.1:8000/generate',route=>route.abort());
  await page.goto('/#studio');
  await page.locator('.style-picker').getByRole('button',{name:/Flowing/}).click();
  const request=page.waitForRequest('http://127.0.0.1:8000/health');
  await importSample(page);await request;
  await page.getByRole('button',{name:/Default handwriting.*No upload needed/}).click();
  const response=page.waitForResponse('http://127.0.0.1:8000/health');release();await response;
  await expectFourFonts(page);
  await expect(page.getByLabel('Generation engine')).toHaveValue('browser');
  await expect(page.locator('.style-picker').getByRole('button',{name:/Flowing/})).toHaveAttribute('aria-pressed','true');
  await render(page);
  await expect(page.locator('.output-status')).toContainText('Flowing');
});

test('explicit default neural synthesis uses no uploaded references and preset clicks return to fonts',async({page})=>{
  await page.route('http://127.0.0.1:8000/health',route=>route.fulfill({json:healthy,headers:cors}));
  await page.goto('/#studio');const source=await importSample(page);
  await page.getByRole('button',{name:/Default handwriting.*No upload needed/}).click();
  let body:{references:string[];words:string[]}|undefined;
  await page.route('http://127.0.0.1:8000/generate',async route=>{
    if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers:cors});return;}
    body=route.request().postDataJSON();
    await route.fulfill({headers:cors,json:{words:body!.words.map(text=>({text,image:source.references[0],width:100}))}});
  });
  await page.getByRole('button',{name:'Check local neural service'}).click();
  await expect(page.getByLabel('Generation engine')).toHaveValue('neural');
  await expectFourFonts(page);
  await page.getByRole('textbox',{name:'Digital text',exact:true}).fill('hello');
  await render(page);
  expect(body?.references).toEqual([]);
  await page.locator('.style-picker').getByRole('button',{name:/Casual/}).click();
  await expect(page.getByLabel('Generation engine')).toHaveValue('browser');
  await render(page);await expect(page.locator('.output-status')).toContainText('Casual');
});

test('closing a pending upload cannot select its sample after returning to default handwriting',async({page})=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.goto('/#studio');const source=await fixture(page);
  await page.route('http://127.0.0.1:8000/recognize-sample',async route=>{
    if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers:cors});return;}
    await gate;await route.fulfill({headers:cors,json:{words:source.wordSamples,references:source.references,referenceCount:1,transcript:'hello',warnings:[]}});
  });
  await page.getByRole('button',{name:'Upload handwriting sample',exact:true}).click();
  const request=page.waitForRequest(r=>r.url().endsWith('/recognize-sample')&&r.method()==='POST');
  await page.getByLabel('Upload automatic handwriting sample').setInputFiles({name:'cancelled-note.png',mimeType:'image/png',buffer:Buffer.from(source.references[0].split(',')[1],'base64')});
  await request;
  await page.getByRole('button',{name:'Close dialog'}).click();
  await page.getByRole('button',{name:/Default handwriting.*No upload needed/}).click();
  const response=page.waitForResponse(r=>r.url().endsWith('/recognize-sample')&&r.request().method()==='POST');release();await (await response).finished();
  await page.getByRole('textbox',{name:'Digital text',exact:true}).fill('hello');
  await render(page);
  await expect(page.getByLabel('Generation engine')).toHaveValue('browser');
  await expectFourFonts(page);
  await expect(page.locator('.sidebar-profiles')).not.toContainText('cancelled-note');
});

test('an old personal generation cannot replace a newly selected default font preview',async({page})=>{
  let release!:()=>void;let completed!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});const finished=new Promise<void>(resolve=>{completed=resolve;});
  await page.route('http://127.0.0.1:8000/health',route=>route.fulfill({json:healthy,headers:cors}));
  await page.goto('/#studio');const source=await importSample(page);
  await page.route('http://127.0.0.1:8000/generate',async route=>{
    if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers:cors});return;}
    await gate;
    try{await route.fulfill({headers:cors,json:{words:[{text:'future',image:source.references[0],width:100}]}});}catch{/* The old request was deliberately aborted. */}finally{completed();}
  });
  await page.getByRole('textbox',{name:'Digital text',exact:true}).fill('future');
  const request=page.waitForRequest(r=>r.url().endsWith('/generate')&&r.method()==='POST');
  await page.getByRole('button',{name:'Generate handwriting',exact:true}).click();await request;
  await page.getByRole('button',{name:/Default handwriting.*No upload needed/}).click();
  await page.locator('.style-picker').getByRole('button',{name:/Flowing/}).click();
  const current=await render(page);release();await finished;
  await expect(page.locator('.output-status')).toContainText('Flowing');
  await expect(page.locator('.error-banner')).toHaveCount(0);
  expect(await page.locator('canvas').evaluate((c:HTMLCanvasElement)=>c.toDataURL())).toBe(current);
});
