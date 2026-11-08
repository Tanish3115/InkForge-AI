import { test, expect } from "@playwright/test";
test("desktop landing shows real preset previews", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator(".hero-paper img")).toBeVisible();
  for (const id of [
    "#styles",
    ".personal-section",
    "#how",
    "#technology",
    ".final-cta",
  ])
    await page.locator(id).scrollIntoViewIfNeeded();
  await expect(page.locator(".final-cta")).toHaveCSS("opacity", "1");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(page.locator(".hero-art")).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: ".cache/generation-landing.png",
    fullPage: true,
  });
});
test("mobile navigation, writing controls, and generation remain accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".hero-art")).toHaveCSS("opacity", "1");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .locator(".mobile-links")
    .getByRole("link", { name: "How it works" })
    .click();
  await page
    .getByRole("button", { name: "Start writing", exact: true })
    .click();
  await page.getByRole("button", { name: "Paper & writing" }).click();
  await expect(page.getByRole("combobox", { name: "Page size" })).toBeVisible();
  await page.getByRole("button", { name: "Close inspector" }).click();
  await page
    .getByRole("button", { name: "Generate handwriting", exact: true })
    .click();
  await expect(page.locator("canvas")).toBeVisible();
  await page.screenshot({
    path: ".cache/generation-mobile.png",
    fullPage: true,
  });
});
