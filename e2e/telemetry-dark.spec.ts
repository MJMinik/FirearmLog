import { test, expect } from '@playwright/test';
import { nav, isDesktop } from './helpers.ts';

// Rung-1 dark-state guard (July 2026). The consent scaffolding ships DARK —
// no analytics provider is wired, nothing can be sent — so every user-facing
// telemetry surface must be INVISIBLE: a control for a pipe that doesn't
// exist would itself be a false statement (charter §1 honesty; rule 41's
// "no sentence may say 'sends' while nothing can").
//
// These specs guard against premature exposure. They are expected to be
// UPDATED (not deleted) at activation: when a provider registers and
// telemetryState().wired flips true, the row and the first-run disclosure
// appear, and the load-bearing verification becomes toggle-persistence +
// network-silence specs (spec §6.7 of the build plan).
test.describe('Telemetry dark state — no surface shows before the pipe exists', () => {
  test('the "Your Data" row is absent from navigation (More screen and desktop sidebar)', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: "Skip for now — I'm just looking around" })
      .click();

    if (isDesktop(page)) {
      // Desktop: the App & Data group renders down the sidebar. Wait for a
      // neighbour row so the zero-count below is non-vacuous (the sidebar has
      // actually rendered its section entries).
      await expect(nav(page).getByRole('button', { name: 'Sync & Backup' })).toBeVisible();
      await expect(nav(page).getByRole('button', { name: 'Your Data' })).toHaveCount(0);
    } else {
      // Phone: the App & Data group lives on the More screen.
      await nav(page).getByRole('button', { name: 'More' }).first().click();
      const main = page.getByRole('main');
      await expect(main.getByRole('button', { name: 'Sync & Backup' })).toBeVisible();
      await expect(main.getByRole('button', { name: 'Your Data' })).toHaveCount(0);
    }
  });

  test('first-run Setup Wizard carries no consent ask and no sharing language', async ({ page }) => {
    await page.goto('/');
    // Non-vacuous: the wizard itself is up before we assert what it lacks.
    await expect(
      page.getByRole('button', { name: "Skip for now — I'm just looking around" }),
    ).toBeVisible();

    // Neither the EU one-tap ask nor the ROW disclosure line may render dark.
    await expect(page.getByRole('button', { name: 'Share anonymous stats' })).toHaveCount(0);
    await expect(page.getByText(/anonymous usage stats/i)).toHaveCount(0);
  });
});
