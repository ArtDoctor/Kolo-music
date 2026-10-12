import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const testDataDir = resolve(import.meta.dirname, ".playwright-data");
const fixturesDir = resolve(import.meta.dirname, "tests", "fixtures");

export default defineConfig({
  testDir: "./tests",
  testMatch: ["**/*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  outputDir: "test-results/artifacts",
  globalTeardown: "./tests/fixtures/global-teardown.ts",
  use: {
    baseURL: "http://127.0.0.1:1425",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command:
      "node tests/fixtures/prepare-test-data.mjs && npm run dev -- --host 127.0.0.1 --port 1425",
    url: "http://127.0.0.1:1425/api/library",
    timeout: 60_000,
    reuseExistingServer: false,
    // The helper overrides keep downloads and rating runs off the network and
    // out of the personal library.
    env: {
      ...process.env,
      KOLO_DATA_DIR: testDataDir,
      KOLO_PYTHON: resolve(fixturesDir, "fake-python.mjs"),
      KOLO_YT_DLP: resolve(fixturesDir, "fake-yt-dlp.mjs"),
      PORT: "1425",
    },
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
