import { defineConfig, devices } from "@playwright/test";

/* E2E runs against the real API (Django, dev settings with OTP echo) and the production builds
 * served by `vite preview`. Start the stack with tests/e2e/run-stack.sh (CI does the same). */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: ".",
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "report", open: "never" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { executablePath },
  },
  projects: [
    { name: "customer", testMatch: /customer\.spec\.ts/, use: { ...devices["Pixel 7"], baseURL: "http://localhost:4173", launchOptions: { executablePath } } },
    { name: "vendor", testMatch: /(vendor|screenshots)\.spec\.ts/, use: { ...devices["Pixel 7"], baseURL: "http://localhost:4174", launchOptions: { executablePath } } },
    { name: "admin", testMatch: /admin\.spec\.ts/, use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:4175", launchOptions: { executablePath } } },
  ],
});
