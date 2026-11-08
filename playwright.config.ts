import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 240_000,
  use: {
    channel:
      process.env.INKFORGE_BROWSER_CHANNEL ||
      (process.platform === "win32" ? "msedge" : undefined),
    headless: true,
    baseURL: process.env.INKFORGE_URL || "http://127.0.0.1:5173",
    screenshot: "only-on-failure",
  },
});
