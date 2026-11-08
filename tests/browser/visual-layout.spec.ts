import { test, expect, type Page } from '@playwright/test';

// Exercise the largest supported recognition result without depending on OCR,
// downloaded model weights, or a volunteer's private handwriting document.
async function importLargeHandwritingProfile(page: Page) {
  await page.route('http://127.0.0.1:8000/**', route => route.abort());
  await page.goto('/#studio');
  const profile = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 108;
    canvas.height = 40;
    const context = canvas.getContext('2d')!;
    context.strokeStyle = '#243d82';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(4, 28);
    context.bezierCurveTo(15, 5, 18, 38, 34, 17);
    context.bezierCurveTo(46, 40, 51, 7, 63, 26);
    context.bezierCurveTo(77, 9, 86, 34, 103, 17);
    context.stroke();
    const image = canvas.toDataURL('image/png');
    const wordSamples = Array.from({ length: 160 }, (_, index) => ({
      id: `layout-word-${index}`,
      text: `source${index}`,
      image,
      width: 108,
      height: 40,
      baseline: 31,
      em: 24,
      line: Math.floor(index / 4),
    }));
    return {
      id: 'layout-fixture',
      name: 'A long uploaded handwriting profile name for the document layout regression',
      version: 1,
      createdAt: Date.now(),
      em: 24,
      glyphs: {},
      kind: 'reference',
      automaticSample: true,
      sampleCount: 5,
      references: Array.from({ length: 5 }, () => image),
      wordSamples,
      sourceTranscript: Array.from({ length: 40 }, (_, line) =>
        wordSamples.slice(line * 4, line * 4 + 4).map(word => word.text).join(' '),
      ).join('\n'),
      sourceReadWarnings: ['Review the recognized labels before reusing your source handwriting.'],
    };
  });
  await page.getByLabel('Import profile', { exact: true }).setInputFiles({
    name: 'large-handwriting-profile.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(profile)),
  });
  await expect(page.getByRole('region', { name: 'Uploaded handwriting word library' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Personal profile', exact: true }))
    .toHaveValue(/.+/);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  const library = page.getByRole('region', { name: 'Uploaded handwriting word library' });
  const main = page.locator('.studio-main');
  const libraryBox = await library.boundingBox();
  const mainBox = await main.boundingBox();
  expect(libraryBox).not.toBeNull();
  expect(mainBox).not.toBeNull();
  expect(libraryBox!.width).toBeLessThanOrEqual(mainBox!.width + 1);
}

for (const scenario of [
  { name: 'desktop', width: 1440, height: 1000, reducedMotion: 'no-preference' as const },
  { name: 'mobile with reduced motion', width: 390, height: 844, reducedMotion: 'reduce' as const },
]) {
  test(`${scenario.name}: selecting a large handwriting document keeps review and generation usable`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.emulateMedia({ reducedMotion: scenario.reducedMotion });
    await importLargeHandwritingProfile(page);

    const editor = page.getByRole('textbox', { name: 'Digital text', exact: true });
    const generate = page.getByRole('button', { name: 'Generate handwriting', exact: true });
    // A long unmatched-word warning must wrap inside the panel instead of
    // widening the entire studio or concealing the editor's actions.
    await editor.fill(Array.from({ length: 24 }, (_, i) => `unmatched${i}${'x'.repeat(100)}`).join(' '));
    await expectNoHorizontalOverflow(page);
    const compactLibrary = page.getByRole('region', { name: 'Uploaded handwriting word library', exact: true });
    expect((await compactLibrary.boundingBox())!.height).toBeLessThanOrEqual(Math.min(360, scenario.height * 0.5));
    await generate.scrollIntoViewIfNeeded();
    await expect(generate).toBeInViewport();
    await expect(generate).toBeEnabled();

    await page.getByText(/Review the text read from your sample/).click();
    await expect(page.getByLabel('Recognized sample text', { exact: true })).toBeVisible();
    const grid = page.locator('.uploaded-word-grid');
    await expect(grid.getByRole('textbox')).toHaveCount(160);
    const review = page.getByRole('region', { name: 'Recognized sample review', exact: true });
    const reviewDimensions = await review.evaluate(element => ({
      height: element.getBoundingClientRect().height,
      visible: element.clientHeight,
      content: element.scrollHeight,
    }));
    expect(reviewDimensions.height).toBeLessThanOrEqual(Math.min(600, scenario.height * 0.8));
    expect(reviewDimensions.content).toBeGreaterThan(reviewDimensions.visible);
    const lastLabel = page.getByLabel('Uploaded word label 160', { exact: true });
    await lastLabel.click();
    await lastLabel.fill('corrected159');
    await expect(lastLabel).toHaveValue('corrected159');
    await expect(lastLabel).toBeInViewport();
    await lastLabel.fill('source159');
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `.cache/visual-upload-review-${scenario.width}.png`, fullPage: true });

    await page.getByText(/Review the text read from your sample/).click();
    await editor.fill('source0 source159\nsource42 source80');
    await editor.scrollIntoViewIfNeeded();
    await expect(editor).toBeInViewport();
    expect((await editor.boundingBox())!.height).toBeGreaterThanOrEqual(150);
    await generate.click();
    await expect(page.locator('.output-status')).toContainText('4 copied words');
    await expect(page.locator('.error-banner')).toHaveCount(0);
    await expect(page.locator('.rendering-badge')).toHaveCount(0);
    await expect(page.locator('.preview-page')).toHaveCSS('opacity', '1');
    const preview = page.getByRole('img', { name: 'Generated handwriting page 1' });
    // Canvas has an accessible label but no implicit image role in all engines.
    const canvas = preview.or(page.locator('canvas[aria-label="Generated handwriting page 1"]'));
    await canvas.scrollIntoViewIfNeeded();
    await expect(canvas).toBeInViewport();
    expect(await canvas.evaluate((element: HTMLCanvasElement) => element.width)).toBeGreaterThan(0);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `.cache/visual-studio-${scenario.width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button', { name: /Page PNG/ })).toBeVisible();
  });
}

test('mobile upload dialog contains a long filename and explains progress before selecting the profile', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('http://127.0.0.1:8000/**', route => route.abort());
  await page.goto('/#studio');
  const images = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 108;
    canvas.height = 40;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fdfcf6';
    context.fillRect(0, 0, 108, 40);
    context.strokeStyle = '#243d82';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(5, 29);
    context.bezierCurveTo(20, 3, 36, 38, 53, 18);
    context.bezierCurveTo(70, 39, 83, 7, 102, 24);
    context.stroke();
    return { jpeg: canvas.toDataURL('image/jpeg'), png: canvas.toDataURL('image/png') };
  });
  let releaseRecognition!: () => void;
  const recognitionReady = new Promise<void>(resolve => { releaseRecognition = resolve; });
  // Hold a deterministic service response to inspect the real file-selection
  // and pending UI. This verifies layout; it makes no OCR accuracy claim.
  await page.route('http://127.0.0.1:8000/recognize-sample', async route => {
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    await recognitionReady;
    await route.fulfill({ status: 200, headers, json: {
      words: [{ id: 'selected-word', text: 'source', image: images.png, width: 108, height: 40, baseline: 31, em: 24, line: 0 }],
      transcript: 'source', references: Array.from({ length: 5 }, () => images.png), referenceCount: 1, warnings: [],
    } });
  });
  await page.locator('.generation-mode').getByRole('button', { name: /My handwriting/ }).click();
  await page.locator('.personal-selection').getByRole('button', { name: 'Upload handwriting sample', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload your handwriting', exact: true });
  await expect(dialog).toBeVisible();
  await page.getByLabel('Upload automatic handwriting sample', { exact: true }).setInputFiles({
    name: `handwriting_${'document_'.repeat(20)}.jpeg`,
    mimeType: 'image/jpeg',
    buffer: Buffer.from(images.jpeg.split(',')[1], 'base64'),
  });
  try {
    const progress = page.getByRole('progressbar', { name: 'Reading handwriting sample', exact: true });
    await expect(progress).toBeVisible();
    await expect(progress).not.toHaveAttribute('value');
    await expect(page.getByLabel('Upload automatic handwriting sample', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: /Advanced letter tools/ })).toBeDisabled();
    expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    const dialogBox = (await dialog.boundingBox())!;
    expect(dialogBox.width).toBeLessThanOrEqual(390);
    expect(Math.abs(dialogBox.x + dialogBox.width / 2 - 195)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: '.cache/visual-upload-reading-mobile.png', fullPage: true });
  } finally {
    releaseRecognition();
  }
  await expect(dialog).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expect(page.getByRole('region', { name: 'Uploaded handwriting word library', exact: true })).toContainText('word');
  await page.getByRole('textbox', { name: 'Digital text', exact: true }).fill('source');
  await expect(page.getByRole('button', { name: 'Generate handwriting', exact: true })).toBeEnabled();
});
