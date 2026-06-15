import { defineConfig, devices } from '@playwright/test';

// End-to-end tests for FirearmLog.
//
// These drive the REAL app in a real browser, exactly as a shooter would — they
// complement the 182 unit tests (which cover the pure logic in `src/lib`) by
// proving the UI is actually wired up: navigation, the demo loader, adding a
// gun, logging a session, the retire/return lifecycle, and every screen
// rendering without crashing.
//
// We run against the Vite dev server (no build step needed). Each test gets a
// fresh browser context, so IndexedDB starts empty every time and tests don't
// bleed into each other. Most tests seed a full dataset by tapping the in-app
// "See it with sample data" button — the same path a tester uses.
//
// Two projects run every spec twice: a desktop layout (sidebar nav) and a
// phone layout (bottom tab bar + More), so we catch viewport-specific wiring.

const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Fail the build if someone accidentally commits test.only.
  forbidOnly: !!process.env.CI,
  // A flaky E2E test should retry in CI before it fails the run.
  retries: process.env.CI ? 2 : 0,
  // One worker in CI keeps the single dev server calm and logs readable.
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    // Capture a trace + screenshot only when a test fails — cheap to keep,
    // invaluable for debugging.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'mobile',
      // Phone-sized viewport so the bottom tab bar + "More" layout is exercised.
      use: { ...devices['Pixel 5'] },
    },
  ],

  // Playwright starts the dev server for us and waits until it answers.
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
