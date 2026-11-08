import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test('one note upload automatically prepares personal neural handwriting', async ({page}) => {
  test.skip(process.env.INKFORGE_NEURAL_TEST !== '1' || !fs.existsSync('.cache/auto-sample.png'), 'Requires local neural service and private handwriting fixture');
  await page.goto('/#studio');
  await page.getByRole('button', {name:'Upload handwriting sample', exact:true}).click();
  await page.getByLabel('Upload automatic handwriting sample').setInputFiles('.cache/auto-sample.png');
  await expect(page.getByRole('dialog')).toHaveCount(0, {timeout:180000});
  await expect(page.locator('.personal-selection')).toContainText('Sample ready');
  await expect(page.getByAltText(/Selected handwriting reference/)).toHaveCount(5);
  await expect(page.locator('.engine-status')).toContainText('Neural engine available');
  await expect(page.getByLabel('Generation engine')).toHaveValue('neural');
  await expect(page.getByLabel('Generation engine').locator('option[value="browser"]')).toBeDisabled();

  let references: string[] = [];
  page.on('request', r => { if (r.url().endsWith('/generate')) references = r.postDataJSON().references; });
  await page.getByRole('textbox', {name:'Digital text',exact:true}).fill('hello future');
  await page.getByRole('button',{name:'Generate handwriting',exact:true}).click();
  await expect(page.locator('.output-status')).toContainText('DiffusionPen', {timeout:120000});
  expect(references).toHaveLength(5);
  expect(new Set(references).size).toBe(5);
  await page.screenshot({path:'.cache/automatic-handwriting.png',fullPage:true});
  await page.reload();
  await expect(page.locator('.sidebar-profiles')).toContainText('auto-sample');
});
