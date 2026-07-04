import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Layer 2 -- IDPA time-plus scoring: stage = raw time + points down (1s each) +
// penalties; lowest total wins. We log an IDPA match, confirm the division picker
// switches to IDPA's own divisions (selecting an IDPA-only division would fail if it
// didn't), enter a stage's raw time + points down + penalties, and confirm the derived
// stage time and the saved debrief's match total. Worked example: 20 + 2 down + 1
// non-threat (5) + 1 PE (3) = 30s.

test.describe('IDPA scoring (Layer 2)', () => {
  test('logs an IDPA match with IDPA divisions and derives the time-plus total', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');

    await page.getByRole('button', { name: '+ Log Match' }).click();
    await page.getByLabel('What this Match is called').fill('IDPA Test');
    await page.getByLabel('Match type').selectOption('IDPA Match');

    // Target the Division <select> by the IDPA-only option it now contains, which also
    // proves the picker switched off USPSA's list. (getByLabel is unreliable here: plain
    // 'Division' also matches the "Division place" field, and a wrapped <select>'s
    // accessible name includes its option text, so an exact 'Division' label match misses.)
    await page
      .locator('select', { has: page.locator('option', { hasText: 'Stock Service Pistol (SSP)' }) })
      .selectOption('Stock Service Pistol (SSP)');

    await page.getByRole('button', { name: '+ Add Stage' }).click();
    const block = page.locator('.drill-edit').first();
    await block.getByLabel('Raw time (s)').fill('20');
    await block.getByRole('button', { name: '+ points down / penalties' }).click();
    await block.getByLabel('Down-1 hits', { exact: true }).fill('2');
    await block.getByLabel('Non-threat hits', { exact: true }).fill('1');
    await block.getByLabel('Procedurals (PE)', { exact: true }).fill('1');

    // 20 (raw) + 2 (points down) + 5 (non-threat) + 3 (PE) = 30
    await expect(block.getByText(/30s/).first()).toBeVisible();

    await page.getByRole('button', { name: 'Save Match' }).click();
    await expect(page.getByRole('heading', { name: 'IDPA Test' })).toBeVisible();
    await expect(page.getByText('30s').first()).toBeVisible();

    // Deep-link: the debrief's "How the numbers work" link opens the wiki AT the IDPA section.
    await page.getByRole('button', { name: /How the numbers work/ }).first().click();
    await expect(page.getByRole('heading', { name: 'How the numbers work' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'IDPA (time-plus)' })).toBeVisible();
  });
});
