// End-to-end and accessibility checks (PLAN §4, M1 T-M1-04, A-A11Y-01). Runs against the built `dist/` through
// scripts/serve-dist.mjs, so every page gets the same hashed CSP and headers Cloudflare sends. Build first:
//   bun run build && bun run e2e
// CI installs Playwright's own Chromium. Locally, PW_CHANNEL=msedge (or chrome) drives an installed browser instead
// of downloading one.
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT || 4350);
const channel = process.env.PW_CHANNEL || undefined;

export default defineConfig({
  testDir: "e2e",
  // Not *.test.* / *.spec.*: those belong to `bun test`.
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    // data-motion="reduced": no transitions, so contrast and focus styles are read in their final state.
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel } },
    { name: "mobile", use: { ...devices["Pixel 7"], channel } },
  ],
  webServer: {
    command: `bun scripts/serve-dist.mjs --port ${port}`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
  },
});
