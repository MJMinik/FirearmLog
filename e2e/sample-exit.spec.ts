import { test, expect, type Page } from '@playwright/test';
import { gotoTab } from './helpers.ts';

// Session 59: the sample log's exit. The tap-test found the payoff-beat hole:
// a user who loads "See a log 18 months in", explores, and is CONVERTED had no
// visible path back to start their own log (the app kept no memory the log was
// the sample; the only exit was buried under Settings → Clear all data).
// Now the flag rides inside the demo dataset's own settings and pins a banner
// with the one action that matters. These tests are the machine-guard on that
// whole journey: load → banner everywhere → exit → a fresh first-run.

// Loading + restoring the ~1.2MB demo (with media) takes a moment; the
// generous timeout is for slow CI runners, not the app.
const DEMO_TIMEOUT = { timeout: 20000 };

async function loadSample(page: Page): Promise<void> {
  await page.goto('/');
  // First run auto-opens the Setup Wizard; the sample door is on its welcome.
  await page.getByRole('button', { name: 'See a log 18 months in' }).click();
  // The sample lands on a data-rich Home (Demo Shooter's log).
  await expect(page.getByRole('main').getByText('Training since', { exact: false }))
    .toBeVisible(DEMO_TIMEOUT);
}

function banner(page: Page) {
  return page.getByRole('status').filter({ hasText: 'sample log' });
}

test.describe('Sample log — the pinned exit banner', () => {
  test('loading the sample pins the banner, and it travels to every screen', async ({ page }) => {
    await loadSample(page);
    await expect(banner(page)).toBeVisible();
    await expect(banner(page).getByRole('button', { name: 'Start my own log' })).toBeVisible();

    // The exit lives wherever the excitement happens — not just on Home.
    await gotoTab(page, 'Progress');
    await expect(banner(page)).toBeVisible();
    await gotoTab(page, 'Compete');
    await expect(banner(page)).toBeVisible();
  });

  test('"Keep exploring" backs out without touching the sample', async ({ page }) => {
    await loadSample(page);
    await banner(page).getByRole('button', { name: 'Start my own log' }).click();
    await page.getByRole('button', { name: 'Keep exploring' }).click();
    // Still the sample: banner pinned, log intact.
    await expect(banner(page)).toBeVisible();
    await expect(page.getByRole('main').getByText('Training since', { exact: false })).toBeVisible();
  });

  test('the exit clears the sample and lands on a fresh first-run — banner gone', async ({ page }) => {
    await loadSample(page);
    await banner(page).getByRole('button', { name: 'Start my own log' }).click();

    // The confirm is honest about the edge case (anything added while
    // exploring goes with the sample) and offers a real way back.
    await expect(page.getByText('This clears the sample log — and anything you\'ve added to it',
      { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Clear sample & start' }).click();

    // Full reload → empty log → the wizard's three-step welcome. No banner:
    // the flag lived in the sample's settings and died with them.
    await expect(page.getByText("Let's get you set up — three steps:")).toBeVisible(DEMO_TIMEOUT);
    await expect(banner(page)).toHaveCount(0);
  });

  test('a real log never shows the banner', async ({ page }) => {
    // The flag belongs to the demo dataset alone — a user's own fresh log
    // (skip the wizard, no sample) must never see "You're exploring…".
    await page.goto('/');
    await page.getByRole('button', { name: "Skip for now — I'm just looking around" }).click();
    await expect(page.getByRole('main')
      .getByRole('button', { name: '+ Add your first gun' })).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
  });
});
