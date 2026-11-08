import {test,expect} from '@playwright/test';
import fs from 'node:fs';

test('matching uploaded JPEG words reuse original ink, including after reload without the service',async({page})=>{
  test.skip(process.env.INKFORGE_WORD_REUSE_TEST!=='1'||!fs.existsSync('.cache/word-reuse-note.jpg'),'Needs local recognition and private IAM fixture');
  await page.goto('/#studio');
  await page.getByRole('button',{name:'Upload handwriting sample',exact:true}).click();
  await page.getByLabel('Upload automatic handwriting sample').setInputFiles('.cache/word-reuse-note.jpg');
  await expect(page.getByRole('dialog')).toHaveCount(0,{timeout:180000});
  const transcript='MOVE to any\nLabour to meeting\nLabour the';
  await page.getByText(/Review the text read from your sample/).click();
  await expect(page.getByLabel('Recognized sample text')).toHaveValue(transcript);
  // Correcting a label changes matching immediately; restoring it returns the
  // exact source crop to the library, without generating a replacement.
  await page.getByLabel('Uploaded word label 1',{exact:true}).fill('MOVED');
  await page.getByLabel('Uploaded word label 1',{exact:true}).fill('MOVE');
  await page.getByRole('button',{name:'Use recognized text in editor'}).click();
  await expect(page.getByRole('textbox',{name:'Digital text',exact:true})).toHaveValue(transcript);
  await page.route('http://127.0.0.1:8000/generate',route=>route.abort());
  await page.getByRole('button',{name:'Generate handwriting',exact:true}).click();
  await expect(page.locator('.output-status')).toContainText('8 copied words');
  await expect(page.locator('.error-banner')).toHaveCount(0);
  await expect(page.locator('.rendering-badge')).toHaveCount(0);
  const first=await page.locator('canvas').evaluate((c:HTMLCanvasElement)=>c.toDataURL());
  await page.getByRole('button',{name:'Export',exact:true}).click();
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:/Page PNG/}).click();
  await (await download).saveAs('.cache/uploaded-word-reuse.png');
  await page.reload();
  await page.route('http://127.0.0.1:8000/**',route=>route.abort());
  await page.locator('.sidebar-profiles').getByRole('button',{name:/word-reuse-note.*Neural reference profile/}).click();
  await page.getByRole('textbox',{name:'Digital text',exact:true}).fill(transcript);
  await page.getByRole('button',{name:'Generate handwriting',exact:true}).click();
  await expect(page.locator('.output-status')).toContainText('8 copied words');
  await expect(page.locator('.rendering-badge')).toHaveCount(0);
  expect(await page.locator('canvas').evaluate((c:HTMLCanvasElement)=>c.toDataURL())).toBe(first);
  await page.setViewportSize({width:375,height:812});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('only unseen words are sent to neural synthesis',async({page})=>{
  test.skip(process.env.INKFORGE_WORD_REUSE_TEST!=='1'||process.env.INKFORGE_NEURAL_TEST!=='1'||!fs.existsSync('.cache/word-reuse-note.jpg'),'Needs local recognition and synthesis');
  await page.goto('/#studio');
  await page.getByRole('button',{name:'Upload handwriting sample',exact:true}).click();
  await page.getByLabel('Upload automatic handwriting sample').setInputFiles('.cache/word-reuse-note.jpg');
  await expect(page.getByRole('dialog')).toHaveCount(0,{timeout:180000});
  await page.getByRole('textbox',{name:'Digital text',exact:true}).fill('MOVE future any');
  const request=page.waitForRequest(r=>r.url()==='http://127.0.0.1:8000/generate');
  await page.getByRole('button',{name:'Generate handwriting',exact:true}).click();
  expect((await request).postDataJSON().words).toEqual(['future']);
  await expect(page.locator('.output-status')).toContainText('2 copied words / 1 new words synthesized',{timeout:120000});
});
