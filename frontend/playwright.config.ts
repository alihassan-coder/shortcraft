import { defineConfig, devices } from "@playwright/test";

// Point at an already running app with PLAYWRIGHT_BASE_URL (skips the web server),
// otherwise Playwright starts one on port 3100.
const CI = !!process.env.CI;
const PORT = 3100;
const external = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = external ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 7_000 },
  reporter: CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Locally use the installed Chrome so no browser download is needed; CI installs Chromium.
    ...(CI ? {} : { channel: "chrome" }),
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "tablet",
      testMatch: /editor-layout\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 900, height: 1100 } },
    },
  ],
  webServer: external
    ? undefined
    : {
        command: CI ? `npm run build && npm run start -- -p ${PORT}` : `npm run dev -- -p ${PORT}`,
        url: baseURL,
        reuseExistingServer: !CI,
        timeout: 240_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
