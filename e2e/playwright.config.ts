import { defineConfig, devices } from "@playwright/test";

// Runs against the stack that is already up (scripts/dev-local.sh up). It never boots the app.
export default defineConfig({
  testDir: "specs",
  globalSetup: "./stack-up.ts",
  outputDir: "../test-results",
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.APP_URL ?? "http://127.0.0.1:5174",
    video: "on",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], colorScheme: "dark" } }],
});
