import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import { unzipSync } from "fflate";

async function fingerprint(page: Page) {
  const c = page.locator('canvas[aria-label^="Generated handwriting"]');
  await expect(c).toBeVisible();
  await expect(page.locator(".rendering-badge")).toHaveCount(0);
  return c.evaluate((element: HTMLCanvasElement) => element.toDataURL());
}
async function fileDownload(page: Page, name: RegExp, path: string) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name }).click();
  const file = await waiting;
  await file.saveAs(path);
  return fs.readFile(path);
}

test("no-upload browser generation, distinct styles, deterministic output, and real exports", async ({
  page,
}) => {
  await page.goto("/#studio");
  await fs.mkdir(".cache/generation-exports", { recursive: true });
  await expect(
    page.getByRole("button", { name: /Default handwriting.*No upload needed/ }),
  ).toHaveAttribute("aria-pressed", "true");
  const text =
    "Artificial intelligence is transforming the future of technology.";
  await page
    .getByRole("textbox", { name: "Digital text", exact: true })
    .fill(text);
  await page
    .getByRole("button", { name: "Generate handwriting", exact: true })
    .click();
  const classic = await fingerprint(page);
  expect(classic.length).toBeGreaterThan(15000);
  await page
    .getByRole("button", { name: "Generate handwriting", exact: true })
    .click();
  expect(await fingerprint(page)).toBe(classic);
  await page
    .locator(".style-picker")
    .getByRole("button", { name: /Neat/ })
    .click();
  await page
    .getByRole("button", { name: "Generate handwriting", exact: true })
    .click();
  expect(await fingerprint(page)).not.toBe(classic);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".recent-docs")).toContainText(
    "A little more human",
  );
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const png = await fileDownload(
    page,
    /Page PNG/,
    ".cache/generation-exports/default.png",
  );
  expect(png.readUInt32BE(16)).toBe(2480);
  expect(png.readUInt32BE(20)).toBe(3508);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const pdf = await fileDownload(
    page,
    /Handwritten PDF/,
    ".cache/generation-exports/default.pdf",
  );
  const pdfText = pdf.toString("latin1");
  expect(pdfText).toContain("/Subtype /Image");
  const box = pdfText.match(/MediaBox \[0 0 ([\d.]+) ([\d.]+)/);
  expect(Number(box?.[1])).toBeCloseTo(595.28, 1);
  expect(Number(box?.[2])).toBeCloseTo(841.89, 1);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const zip = await fileDownload(
    page,
    /All pages as PNG/,
    ".cache/generation-exports/pages.zip",
  );
  expect(Object.keys(unzipSync(zip))).toEqual(["page-001.png"]);
  await page
    .getByRole("textbox", { name: "Digital text", exact: true })
    .fill(("A full page of thoughts. ".repeat(25) + "\n\n").repeat(8));
  await page
    .getByRole("button", { name: "Generate handwriting", exact: true })
    .click();
  await fingerprint(page);
  await expect(
    page.getByRole("button", { name: "Next page", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "aria-label",
    "Generated handwriting page 2",
  );
  await page.screenshot({
    path: ".cache/generation-studio.png",
    fullPage: true,
  });
});

test("actual worksheet extraction affects personalized output and profiles survive reload", async ({
  page,
}) => {
  await page.goto("/#studio");
  const image = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1000;
    c.height = 1414;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 1000, 1414);
    ctx.fillStyle = "black";
    for (const [x, y] of [
      [36, 36],
      [964, 36],
      [964, 1378],
      [36, 1378],
    ])
      ctx.fillRect(x - 10, y - 10, 20, 20);
    ctx.strokeStyle = "black";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    for (const ch of ["a", "b", "c"]) {
      const i = ch.charCodeAt(0) - 33,
        x = 60 + (i % 8) * 110,
        y = 160 + Math.floor(i / 8) * 114;
      ctx.beginPath();
      ctx.arc(
        x + 51,
        y + 67,
        15,
        ch === "c" ? 0.5 : 0,
        ch === "c" ? 5.8 : Math.PI * 2,
      );
      ctx.stroke();
      if (ch !== "c") {
        ctx.beginPath();
        ctx.moveTo(x + (ch === "a" ? 66 : 36), y + (ch === "a" ? 51 : 35));
        ctx.lineTo(x + (ch === "a" ? 66 : 36), y + 83);
        ctx.stroke();
      }
    }
    return c.toDataURL("image/png");
  });
  await page
    .getByRole("button", { name: "Upload handwriting sample", exact: true })
    .click();
  await page.getByRole("button", { name: "Advanced letter tools" }).click();
  await page
    .getByRole("textbox", { name: "Profile name" })
    .fill("Synthetic test ink");
  const sheet = await fileDownload(
    page,
    /Download A4 worksheet/,
    ".cache/generation-exports/worksheet.pdf",
  );
  const box = sheet
    .toString("latin1")
    .match(/MediaBox \[0 0 ([\d.]+) ([\d.]+)/);
  expect(Number(box?.[1])).toBeCloseTo(595.28, 1);
  await page
    .getByLabel("Upload handwriting sample")
    .setInputFiles({
      name: "authorized-synthetic-sheet.png",
      mimeType: "image/png",
      buffer: Buffer.from(image.split(",")[1], "base64"),
    });
  await page.getByRole("button", { name: "Extract worksheet glyphs" }).click();
  await expect(page.locator(".glyph-review>article")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Save handwriting profile", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Digital text", exact: true })
    .fill("cab abc");
  await page
    .getByRole("button", { name: "Generate handwriting", exact: true })
    .click();
  const personal = await fingerprint(page);
  await expect(page.locator(".output-status")).toContainText(
    "Your extracted glyphs",
  );
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await fileDownload(
    page,
    /Page PNG/,
    ".cache/generation-exports/personal.png",
  );
  await page.reload();
  await page
    .locator(".sidebar-profiles")
    .getByRole("button", { name: /Synthetic test ink.*3 sampled/ })
    .click();
  await page
    .getByRole("textbox", { name: "Digital text", exact: true })
    .fill("cab abc");
  await page
    .getByRole("button", { name: "Generate handwriting", exact: true })
    .click();
  expect(await fingerprint(page)).toBe(personal);
  await page
    .getByRole("textbox", { name: "Digital text", exact: true })
    .fill("cab z");
  await page
    .getByRole("button", { name: "Generate handwriting", exact: true })
    .click();
  await expect(page.locator(".missing-warning")).toContainText("z");
  await expect(page.locator(".missing-warning").getByRole("button", { name: "Upload sample for automatic generation" })).toBeVisible();
  await page.getByRole("button", { name: "Export profile backup" }).click();
  await page.screenshot({
    path: ".cache/generation-personal.png",
    fullPage: true,
  });
});

test("backend unavailable keeps the public browser generator functional", async ({
  page,
}) => {
  await page.route("http://127.0.0.1:8000/**", (route) => route.abort());
  await page.goto("/#studio");
  await page
    .getByRole("button", { name: "Check local neural service" })
    .click();
  await expect(page.locator(".toast")).toContainText(
    "Neural engine unavailable",
  );
  await expect(page.locator(".engine-status")).toContainText(
    "Browser rendering active",
  );
  await page
    .getByRole("button", { name: "Generate handwriting", exact: true })
    .click();
  await fingerprint(page);
});
