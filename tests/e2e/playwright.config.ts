import { defineConfig, devices } from "@playwright/test";

/* E2E runs against the real API (Django, dev settings with OTP echo) and the production builds
 * served by `vite preview`. Start the stack with tests/e2e/run-stack.sh (CI does the same). */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: ".",
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  // Phase 12 hardening (docs/ARCHITECTURE.md D33): several spec files across the "web" and "admin"
  // projects (chat/orders/social/screenshots/search/vendors/admin) exercise the same seeded vendor
  // (@SHARMA001 / +919990000001, "Tomato") from run-stack.sh's fixed seed data — there is only one
  // of it, not one per file. Playwright's default worker count runs different spec files concurrently
  // in separate workers, so two of these files could race on that vendor's live state (cart, order
  // count, tracked inventory quantity, follower/review counts) and produce flaky, order-dependent
  // failures that have nothing to do with a real product bug. Forcing a single worker serializes every
  // spec file so nothing shares that vendor concurrently. This is a broader fix than only the four
  // files first identified (search.spec.ts, vendors.spec.ts and admin.spec.ts also touch the same
  // vendor) and costs some CI wall-clock time, but avoids having to prove file-by-file which uses of
  // the shared vendor are truly read-only and therefore safe to parallelize.
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "report", open: "never" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { executablePath },
  },
  projects: [
    { name: "web", testMatch: /(customer|vendor|vendor-products|vendors|search|chat|orders|social|screenshots|ai-scan)\.spec\.ts/, use: { ...devices["Pixel 7"], baseURL: "http://localhost:4173", launchOptions: { executablePath } } },
    { name: "admin", testMatch: /admin\.spec\.ts/, use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:4175", launchOptions: { executablePath } } },
  ],
});
