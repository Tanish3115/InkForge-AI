import {test,expect,type Page} from '@playwright/test';
import {jsPDF} from 'jspdf';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';

const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS'};
const healthy={ready:true,reason:'Fixture service ready',styles:[{id:'classic',name:'Fixture',provenance:'Synthetic test fixture'}]};
function documentBytes(){const pdf=new jsPDF();pdf.text('UI validation fixture',20,20);return Buffer.from(pdf.output('arraybuffer'));}
async function images(page:Page){return page.evaluate(()=>{
  const result=[];
  for(let i=0;i<2;i++){
    const c=document.createElement('canvas');c.width=100;c.height=64;
    const ctx=c.getContext('2d')!;ctx.strokeStyle=i?'#153c63':'black';ctx.lineWidth=3+i;
    ctx.beginPath();ctx.moveTo(4,45);ctx.bezierCurveTo(23,10+i*3,34,60,50,27);ctx.bezierCurveTo(70,57,77,12,95,40);ctx.stroke();
    result.push(c.toDataURL());
  }return result;
});}
const quality=(stroke=.08)=>({bodyHeight:30,strokeRatio:stroke,slant:.05,sharpness:100,possiblePrint:false,analysis:'Synthetic fixture statistics'});
async function fixtureRoutes(page:Page){
  const ink=await images(page);let calls:number[]=[],synthesis:any[]=[];
  const preview={session:'pdf-test',pageCount:3,expiresSeconds:900,limits:{maxBytes:26214400,maxPages:40,maxSelected:10,maxPixels:12000000,dpi:300,maxWords:1000},
    pages:[1,2,3].map(number=>({page:number,thumbnail:ink[0],width:595,height:842,eligible:number!==3,reason:number===3?'Embedded printed text only':'',warnings:[],nativeTextObjects:number===3?5:0,lowResolution:false}))};
  const result=(number:number)=>({page:number,status:'ready',dpi:300,rotation:0,quality:quality(number===1?.08:.25),
    words:[{id:'pdf-p'+number+'-word',text:number===1?'hello':'again',image:ink[number-1],width:100,height:64,baseline:50,em:64,line:(number-1)*40,page:number}],
    transcript:number===1?'hello':'again',references:Array(5).fill(ink[number-1]),referenceCount:1,warnings:[]});
  await page.route('http://127.0.0.1:8000/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
    if(path==='/health'){await route.fulfill({headers,json:healthy});return;}
    if(path==='/pdf-reference'){
      expect(route.request().postDataJSON().document).toMatch(/^data:application\/pdf;base64,JVBER/);
      await route.fulfill({headers,json:preview});return;
    }
    if(path.endsWith('/page')){const number=route.request().postDataJSON().page;calls.push(number);await route.fulfill({headers,json:result(number)});return;}
    if(path==='/generate'){const body=route.request().postDataJSON();synthesis.push(body);await route.fulfill({headers,json:{words:body.words.map((text:string)=>({text,image:ink[0],width:100}))}});return;}
    if(route.request().method()==='DELETE'){await route.fulfill({headers,json:{released:true}});return;}
    await route.abort();
  });
  return {preview,result,ink,calls,synthesis};
}

test('PDF page selection, style warning, saved sources and the existing neural generator share one workflow',async({page})=>{
  await page.goto('/#studio');const fixture=await fixtureRoutes(page);
  await page.getByRole('button',{name:'Upload handwriting sample',exact:true}).click();
  await page.getByLabel('Upload automatic handwriting sample').setInputFiles({name:'personal-reference.pdf',mimeType:'application/pdf',buffer:documentBytes()});
  await expect(page.getByRole('region',{name:'PDF handwriting page selection'})).toBeVisible();
  await expect(page.getByLabel('Select PDF page 3')).toBeDisabled();
  await page.getByRole('button',{name:'Deselect all',exact:true}).click();
  await expect(page.getByRole('button',{name:'Extract selected pages'})).toBeDisabled();
  await page.getByRole('button',{name:'Select all eligible'}).click();
  await page.getByRole('button',{name:'Preview PDF page 2'}).click();await page.getByText('Preview page 2',{exact:true}).click();
  await expect(page.getByAltText('PDF page 2 preview',{exact:true})).toBeVisible();
  await page.getByLabel('Rotation for PDF page 2').selectOption('0');
  await page.getByRole('button',{name:'Extract selected pages'}).click();
  await expect(page.getByLabel('PDF extraction review')).toContainText('2 usable pages');
  await expect(page.getByLabel('PDF extraction review')).toContainText('Possible style variation');
  expect(fixture.calls).toEqual([1,2]);
  await page.getByLabel('Select PDF page 2').uncheck();
  await expect(page.getByLabel('PDF extraction review')).not.toContainText('Possible style variation');
  const release=page.waitForRequest(request=>request.method()==='DELETE'&&request.url().endsWith('/pdf-test'));
  await page.getByRole('button',{name:'Use selected handwriting'}).click();await release;
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByText(/Review the text read from your sample/).click();
  await expect(page.getByLabel('Recognized sample text')).toHaveValue('hello');
  await expect(page.getByRole('region',{name:'Uploaded handwriting word library'})).toContainText('PDF pages 1');
  await page.getByRole('button',{name:'Use recognized text in editor'}).click();
  await page.getByRole('button',{name:'Generate handwriting',exact:true}).click();
  await expect(page.locator('.output-status')).toContainText('1 copied words');
  expect(fixture.synthesis).toHaveLength(0);
  await page.getByRole('textbox',{name:'Digital text',exact:true}).fill('future');
  await page.getByRole('button',{name:'Generate handwriting',exact:true}).click();
  await expect(page.locator('.output-status')).toContainText('DiffusionPen');
  expect(fixture.synthesis).toHaveLength(1);expect(fixture.synthesis[0].references).toEqual(Array(5).fill(fixture.ink[0]));
  await page.reload();await page.locator('.sidebar-profiles').getByRole('button',{name:/personal-reference.*Neural reference profile/}).click();
  await page.getByText(/Review the text read from your sample/).click();await expect(page.getByLabel('Recognized sample text')).toHaveValue('hello');
});

test('suspected printed pages can be reviewed and re-extracted without stale results',async({page})=>{
  await page.goto('/#studio');const fixture=await fixtureRoutes(page);
  let release!:()=>void,requests=0;const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('http://127.0.0.1:8000/pdf-reference/pdf-test/page',async route=>{
    if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
    const body=route.request().postDataJSON();requests++;
    if(!body.allow_print_like){await gate;await route.fulfill({headers,json:{page:1,status:'excluded',reason:'Possible printed scan',warnings:[],quality:{...quality(),possiblePrint:true}}});}
    else await route.fulfill({headers,json:{...fixture.result(1),quality:{...quality(),possiblePrint:true}}});
  });
  await page.getByRole('button',{name:'Upload handwriting sample',exact:true}).click();
  await page.getByLabel('Upload automatic handwriting sample').setInputFiles({name:'review.pdf',mimeType:'application/pdf',buffer:documentBytes()});
  await page.getByLabel('Select PDF page 2').uncheck();
  await page.getByRole('button',{name:'Extract selected pages'}).click();
  await expect(page.getByRole('progressbar',{name:'PDF pages processed'})).toHaveAttribute('value','0');release();
  await expect(page.getByLabel('Include PDF page 1 after print review')).toBeVisible();
  await expect(page.getByRole('button',{name:'Use selected handwriting'})).toBeDisabled();
  await page.getByLabel('Include PDF page 1 after print review').check();await page.getByRole('button',{name:'Extract selected pages'}).click();
  await expect(page.getByRole('button',{name:'Use selected handwriting'})).toBeEnabled();expect(requests).toBe(2);
  await page.getByRole('button',{name:'Use selected handwriting'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
});

for(const format of ['jpeg','png','webp'])test(`${format} image uploads keep the existing automatic path`,async({page})=>{
  await page.goto('/#studio');const ink=(await images(page))[0];
  const image=await page.evaluate(async({ink,format})=>{const source=await createImageBitmap(await(await fetch(ink)).blob());const c=document.createElement('canvas');c.width=100;c.height=64;const ctx=c.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,100,64);ctx.drawImage(source,0,0);source.close();return c.toDataURL('image/'+format);},{ink,format});
  let calls=0;
  await page.route('http://127.0.0.1:8000/**',async route=>{
    if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
    if(route.request().url().endsWith('/health')){await route.fulfill({headers,json:healthy});return;}
    expect(route.request().url()).toContain('/recognize-sample');calls++;
    await route.fulfill({headers,json:{words:[{id:'word',text:'hello',image:ink,width:100,height:64,baseline:50,em:64,line:0}],transcript:'hello',references:Array(5).fill(ink),referenceCount:1,warnings:[]}});
  });
  await page.getByRole('button',{name:'Upload handwriting sample',exact:true}).click();
  await page.getByLabel('Upload automatic handwriting sample').setInputFiles({name:'note.'+format,mimeType:'image/'+format,buffer:Buffer.from(image.split(',')[1],'base64')});
  await expect(page.getByRole('dialog')).toHaveCount(0);expect(calls).toBe(1);
  await expect(page.getByRole('region',{name:'Uploaded handwriting word library'})).toBeVisible();
});

test('mobile preview stays bounded and corrupt/encrypted PDF errors do not save a profile',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/#studio');
  await page.locator('.generation-mode').getByRole('button',{name:/My handwriting/}).click();
  await page.locator('.personal-selection').getByRole('button',{name:'Upload handwriting sample',exact:true}).click();
  const input=page.getByLabel('Upload automatic handwriting sample');
  await input.setInputFiles({name:'corrupt.pdf',mimeType:'application/pdf',buffer:Buffer.from('not a PDF')});
  await expect(page.getByRole('alert')).toContainText('does not contain a PDF');
  await page.route('http://127.0.0.1:8000/pdf-reference',async route=>{
    if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
    await route.fulfill({headers,status:400,json:{detail:'Could not open the encrypted PDF. Use a password-free PDF.'}});
  });
  await input.setInputFiles({name:'encrypted.pdf',mimeType:'application/pdf',buffer:documentBytes()});
  await expect(page.getByRole('alert')).toContainText('password-free');
  await fixtureRoutes(page);await input.setInputFiles({name:'preview.pdf',mimeType:'application/pdf',buffer:documentBytes()});
  await expect(page.getByRole('region',{name:'PDF handwriting page selection'})).toBeVisible();
  expect(await page.getByRole('dialog').evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
  await fs.mkdir('.cache/pdf-reference-tests',{recursive:true});await page.screenshot({path:'.cache/pdf-reference-tests/mobile-picker.png',fullPage:true});
  const release=page.waitForRequest(request=>request.method()==='DELETE');await page.getByRole('button',{name:'Close dialog'}).click();await release;
  await expect(page.locator('.sidebar-profiles')).not.toContainText('preview');
});

for(const multi of [false,true])test(`real ${multi?'multi-page mixed':'single-page scanned'} PDF creates a usable reference and renders original ink`,async({page})=>{
  test.skip(process.env.INKFORGE_PDF_REAL_TEST!=='1'||!existsSync('.cache/word-reuse-note.jpg'),'Opt-in authorized local handwriting PDF / OCR test.');
  const data=await fs.readFile('.cache/word-reuse-note.jpg'),pdf=new jsPDF();
  pdf.text('Printed form heading',20,15);pdf.addImage(data.toString('base64'),'JPEG',20,35,170,108.18);
  if(multi){pdf.addPage();pdf.text('Printed-only page',20,20);pdf.addPage();pdf.addImage(data.toString('base64'),'JPEG',20,35,170,108.18);}
  await page.route('http://127.0.0.1:8000/**',async route=>{const response=await route.fetch({url:route.request().url().replace(':8000',':8002'),timeout:240000});await route.fulfill({response});});
  await page.goto('/#studio');await page.getByRole('button',{name:'Upload handwriting sample',exact:true}).click();
  await page.getByLabel('Upload automatic handwriting sample').setInputFiles({name:multi?'mixed-pages.pdf':'scan.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdf.output('arraybuffer'))});
  await expect(page.getByRole('region',{name:'PDF handwriting page selection'})).toBeVisible({timeout:60000});
  if(multi)await expect(page.getByLabel('Select PDF page 2')).toBeDisabled();
  for(const number of multi?[1,3]:[1])await page.getByLabel(`Rotation for PDF page ${number}`).selectOption('0');
  await page.getByRole('button',{name:'Extract selected pages'}).click();
  await expect(page.getByRole('button',{name:'Use selected handwriting'})).toBeEnabled({timeout:180000});
  await page.getByRole('button',{name:'Use selected handwriting'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByText(/Review the text read from your sample/).click();
  const transcript=await page.getByLabel('Recognized sample text').inputValue();expect(transcript).toContain('MOVE');
  await page.getByRole('button',{name:'Use recognized text in editor'}).click();
  await page.getByRole('button',{name:'Generate handwriting',exact:true}).click();
  await expect(page.locator('.output-status')).toContainText(`${multi?16:8} copied words`);await expect(page.locator('.rendering-badge')).toHaveCount(0);
  await page.getByRole('button',{name:'Export',exact:true}).click();const pending=page.waitForEvent('download');await page.getByRole('button',{name:/Page PNG/}).click();
  await fs.mkdir('.cache/pdf-reference-tests',{recursive:true});await(await pending).saveAs(`.cache/pdf-reference-tests/real-${multi?'multi':'single'}-ink.png`);
  if(!multi&&process.env.INKFORGE_NEURAL_TEST==='1'){
    let references:string[]=[];page.on('request',request=>{if(request.url().endsWith('/generate')&&request.method()==='POST')references=request.postDataJSON().references;});
    await page.getByRole('textbox',{name:'Digital text',exact:true}).fill('hello');await page.getByRole('button',{name:'Generate handwriting',exact:true}).click();
    await expect(page.locator('.output-status')).toContainText('DiffusionPen',{timeout:180000});expect(references).toHaveLength(5);
    await page.screenshot({path:'.cache/pdf-reference-tests/real-pdf-neural.png',fullPage:true});
  }
});

for(const format of ['jpeg','png','webp'])test(`real ${format} recognition still creates an original-ink library`,async({page})=>{
  test.skip(process.env.INKFORGE_PDF_REAL_TEST!=='1'||!existsSync('.cache/word-reuse-note.jpg'),'Opt-in authorized local handwriting / OCR test.');
  await page.route('http://127.0.0.1:8000/**',async route=>{const response=await route.fetch({url:route.request().url().replace(':8000',':8002'),timeout:240000});await route.fulfill({response});});
  await page.goto('/#studio');const original=await fs.readFile('.cache/word-reuse-note.jpg');
  const image=await page.evaluate(async({data,format})=>{
    const bitmap=await createImageBitmap(await(await fetch('data:image/jpeg;base64,'+data)).blob());
    const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d')!;
    ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(bitmap,0,0);bitmap.close();return c.toDataURL('image/'+format,.95);
  },{data:original.toString('base64'),format});
  await page.getByRole('button',{name:'Upload handwriting sample',exact:true}).click();
  await page.getByLabel('Upload automatic handwriting sample').setInputFiles({name:'real-note.'+format,mimeType:'image/'+format,buffer:Buffer.from(image.split(',')[1],'base64')});
  await expect(page.getByRole('dialog')).toHaveCount(0,{timeout:180000});await page.getByText(/Review the text read from your sample/).click();
  await expect(page.getByLabel('Recognized sample text')).toHaveValue('MOVE to any\nLabour to meeting\nLabour the');
  await page.getByRole('button',{name:'Use recognized text in editor'}).click();await page.getByRole('button',{name:'Generate handwriting',exact:true}).click();
  await expect(page.locator('.output-status')).toContainText('8 copied words');await expect(page.locator('.error-banner')).toHaveCount(0);
});
