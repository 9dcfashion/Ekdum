import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests. They need:
 *   - the app running (E2E_BASE_URL, default http://localhost:3000) against a real Supabase project
 *   - "Confirm email" turned OFF in Supabase Auth, so signup goes straight to onboarding
 * Run: pnpm exec playwright install chromium && pnpm test:e2e
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
});
