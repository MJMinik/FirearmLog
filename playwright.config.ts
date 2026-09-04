import { defineConfig, devices } from '@playwright/test';

// End-to-end tests for FirearmLog.
//
// These drive the REAL app in a real browser, exactly as a shooter would — they
// complement the unit suite (which covers the pure logic in `src/lib`) by
// proving the UI is actually wired up: navigation, the demo loader, adding a
// gun, logging a session, the retire/return lifecycle, and every screen
// rendering without crashing.
//
// WHICH SERVER WE RUN AGAINST DEPENDS ON WHERE WE ARE, and the difference is
// the whole point of this block.
//
// Locally we use the Vite DEV server: it starts instantly and needs no build,
// which is what you want when you are iterating on one spec. The cost is that
// a dev server does not bundle — it serves the app as hundreds of individual
// module files that the browser must fetch one by one. Every page load is a
// fetch storm.
//
// On CI we BUILD first and serve the built output with `vite preview`. Two
// reasons. (1) The fetch storm is a real source of flake: under memory or
// file-handle pressure Chrome starts refusing fetches with
// ERR_INSUFFICIENT_RESOURCES, one refused module means the app never boots,
// and the test then dies at whatever it was waiting for — so the failure
// message looks unrelated to the cause. Traced to a white page + a wall of
// ERR_INSUFFICIENT_RESOURCES in session 110. The heaviest specs (any that
// reload mid-test, or restore the full demo) hit it first. A built app is a
// handful of bundled files, so the entire class disappears. (2) CI then
// exercises exactly the artifact that ships, rather than a dev-mode variant
// of it.
//
// Each test gets a fresh browser context either way, so IndexedDB starts empty
// every time and tests don't bleed into each other. Most tests seed a full
// dataset by tapping the in-app "See it with sample data" button — the same
// path a tester uses.
//
// Two projects run every spec twice: a desktop layout (sidebar nav) and a
// phone layout (bottom tab bar + More), so we catch viewport-specific wiring.

// Dev server and preview server get different ports so a stray local dev server
// can never be mistaken for the built app (or vice versa).
const PORT = process.env.CI ? 4173 : 5173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Fail the build if someone accidentally commits test.only.
  forbidOnly: !!process.env.CI,
  // A flaky E2E test should retry in CI before it fails the run.
  retries: process.env.CI ? 2 : 0,
  // One worker in CI keeps the single server calm and the logs readable.
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

  // Playwright starts the server for us and waits until it answers.
  // On CI that means building first, so the timeout has to cover the build.
  webServer: {
    // FL_E2E=1 on the CI build only: vite.config.ts's `define` makes
    // __FL_E2E__ true for it (dev mode is already true by default), so the
    // video-guards E2E spec can override the 100 MB ask line on a built app.
    // The deploy workflow's plain `npm run build` never sets this, so real
    // users' bundle never carries the override branch at all.
    command: process.env.CI
      ? `FL_E2E=1 npm run build && npm run preview -- --port ${PORT} --strictPort`
      : `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: process.env.CI ? 300_000 : 120_000,
  },
});
