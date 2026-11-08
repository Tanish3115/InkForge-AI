import { test, expect } from "@playwright/test";
import fs from "node:fs";
test("verified local DiffusionPen default style produces real neural handwriting", async ({
  page,
}) => {
  test.skip(
    process.env.INKFORGE_NEURAL_TEST !== "1",
    "Opt-in real local neural service test.",
  );
  await page.goto("/#studio");
  await page
    .getByRole("button", { name: "Check local neural service" })
    .click();
  await expect(page.locator(".engine-status")).toContainText(
    "Neural engine available",
  );
  await page
    .getByRole("textbox", { name: "Digital text", exact: true })
    .fill("hello future");
  await page
    .getByRole("button", { name: "Generate handwriting", exact: true })
    .click();
  await expect(page.locator(".output-status")).toContainText("DiffusionPen", {
    timeout: 120000,
  });
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator(".rendering-badge")).toHaveCount(0);
  const original = await page
    .locator("canvas")
    .evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.screenshot({
    path: ".cache/generation-neural.png",
    fullPage: true,
  });
  if (fs.existsSync("research/runs/reference-test.json")) {
    let referenceCount = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/generate"))
        referenceCount = request.postDataJSON().references.length;
    });
    await page
      .getByLabel("Import profile", { exact: true })
      .setInputFiles("research/runs/reference-test.json");
    await page
      .getByRole("button", { name: "Generate handwriting", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Generate handwriting", exact: true }),
    ).toBeEnabled({ timeout: 120000 });
    await expect(page.locator(".rendering-badge")).toHaveCount(0);
    expect(referenceCount).toBe(5);
    expect(
      await page
        .locator("canvas")
        .evaluate((c: HTMLCanvasElement) => c.toDataURL()),
    ).not.toBe(original);
    await page.screenshot({
      path: ".cache/generation-neural-personal.png",
      fullPage: true,
    });
  }
});
