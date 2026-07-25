import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab, openGunsSection } from './helpers';

// Convert-to-logged is an in-place mode switch, not a navigation. The old flow
// pushed a fresh convert view, which remounted the form, reloaded the saved
// record, and silently threw away any unsaved edits ("the onConvert mid-edit
// loss"). These pin the fixed behavior: edits survive the convert, nothing is
// persisted until Save, and an unsaved conversion is guarded like any edit.

async function makePlan(page: import('@playwright/test').Page, location: string) {
  await gotoTab(page, 'Log');
  await page.getByRole('button', { name: '+ Plan Session' }).click();
  await expect(page.getByRole('heading', { name: 'Plan Session' })).toBeVisible();
  await page.getByLabel('Where').fill(location);
  const gunsCard = page.getByTestId('session-guns-card');
  await gunsCard.locator('button.gun-toggle').first().click();
  await gunsCard.getByRole('spinbutton').first().fill('40');
  await page.locator('.navbar-action').click(); // Save
  await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();
  const row = page.locator('.row-tap', { hasText: location });
  await expect(row.getByText('Planned')).toBeVisible();
  return row;
}

test.describe('Convert to logged session preserves unsaved edits', () => {
  test('mid-edit convert keeps the edits on screen and logs them on Save', async ({ page }) => {
    await seedDemo(page);
    const row = await makePlan(page, 'Convert Keep Range');

    // Reopen the plan and edit BEFORE converting — the exact state the old
    // flow destroyed (its remount reloaded 40 from the saved record).
    await row.click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
    // Editing an existing session still loads Guns & Rounds collapsed —
    // open it before touching the rounds input (verified failure, session 78).
    await openGunsSection(page);
    const gunsCard = page.getByTestId('session-guns-card');
    await gunsCard.getByRole('spinbutton').first().fill('75');

    await page.getByRole('button', { name: 'Convert to logged session' }).click();
    await expect(page.getByRole('heading', { name: 'Log Session (from Plan)' })).toBeVisible();

    // The regression pin: the unsaved 75 survived the convert.
    await expect(gunsCard.getByRole('spinbutton').first()).toHaveValue('75');

    // Save → back on the Log list, the row is a real session now (no badge),
    // and the row's round count proves the EDIT persisted — not just that the
    // convert happened (a save of stale/original data would show 40 here).
    await page.locator('.navbar-action').click();
    const rowAfter = page.locator('.row-tap', { hasText: 'Convert Keep Range' });
    await expect(rowAfter).toBeVisible();
    await expect(rowAfter.getByText('Planned')).toHaveCount(0);
    await expect(rowAfter).toContainText('75 rds');
  });

  test('an unsaved conversion is guarded; Discard leaves the plan a plan', async ({ page }) => {
    await seedDemo(page);
    const row = await makePlan(page, 'Convert Bail Range');

    // Convert (no other edits) — nothing is persisted until Save, so leaving
    // must warn: the conversion itself is an unsaved change.
    await row.click();
    await page.getByRole('button', { name: 'Convert to logged session' }).click();
    await expect(page.getByRole('heading', { name: 'Log Session (from Plan)' })).toBeVisible();

    await gotoTab(page, 'Home');
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();
    await page.getByRole('button', { name: 'Discard' }).click();

    // The plan is untouched — still Planned on the Log list.
    await gotoTab(page, 'Log');
    const rowAfter = page.locator('.row-tap', { hasText: 'Convert Bail Range' });
    await expect(rowAfter.getByText('Planned')).toBeVisible();
  });
});
