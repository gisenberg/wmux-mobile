import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "terminal-host.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 30_000,
  expect: {
    timeout: 8_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  use: {
    browserName: "chromium",
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    viewport: { width: 760, height: 480 },
  },
  outputDir: "../test-results/terminal-host",
  snapshotPathTemplate: "{testDir}/snapshots/{platform}/{arg}{ext}",
});
