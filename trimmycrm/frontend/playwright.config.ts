import { defineConfig, devices } from "@playwright/test";

const e2ePort = process.env.E2E_PORT || "3000";
const baseURL = process.env.E2E_BASE_URL || `http://localhost:${e2ePort}`;
const usesExternalTarget = Boolean(process.env.E2E_BASE_URL);
const serverScript = process.env.E2E_SERVER_MODE === "production" ? "start" : "dev";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL,
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: usesExternalTarget ? undefined : {
    command: `npm run ${serverScript} -- --port ${e2ePort}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { ...process.env, LOCAL_TRYON_ENABLED: process.env.LOCAL_TRYON_ENABLED || "false" },
  },
});
