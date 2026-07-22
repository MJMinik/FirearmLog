import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab, gotoSection } from './helpers';

// Per-session magazine tracking (spec July 22 2026). The session form grows a
// quiet per-gun "Magazines" disclosure — hidden the same way ammo and drills
// are, never a nag. Rounds split evenly across the picked mags unless the
// shooter types a custom split, which must sum to the gun's rounds to save.
// Magazine lifetime counts are DERIVED (starting count + session attributions),
// so the Magazines screen updates the moment a session saves — nothing is ever
// written to the Magazine record itself.
//
// The demo dataset gives "Shadow Systems DR920" four linked mags DR9-1..DR9-4,
// all in service. Demo sessions carry no mag data (the feature is newer than
// they are), which also proves historical records stay untouched.

const GUN = 'Shadow Systems DR920';

/** The DR9-1 lifetime shown on the Magazines screen, as a number. */
async function dr91Lifetime(page: import('@playwright/test').Page): Promise<number> {
  await gotoSection(page, 'Magazines');
  const row = page.getByRole('main').locator('.row-tap', { hasText: 'DR9-1' }).first();
  await expect(row).toBeVisible();
  const text = await row.locator('.value').textContent();
  return Number((text ?? '').replace(/[^\d]/g, ''));
}

async function startSessionWithGun(page: import('@playwright/test').Page, rounds: string) {
  await gotoTab(page, 'Log');
  await page.getByRole('button', { name: '+ Log Session' }).click();
  await page.getByRole('button', { name: GUN }).click();
  await page.getByLabel(`Rounds for ${GUN}`).fill(rounds);
}

test.describe('Per-session magazine tracking', () => {
  test('even split: pick two mags, save, and the Magazines screen shows the derived lifetime', async ({ page }) => {
    await seedDemo(page);
    const before = await dr91Lifetime(page);

    await startSessionWithGun(page, '100');

    // The quiet disclosure sits under the gun's row; open it and pick two mags.
    const magSection = page.locator('.session-mags');
    await expect(magSection).toBeVisible();
    await magSection.locator('.checklist-disclosure').click();
    // The toggle's accessible name includes its checkbox glyph ("☐ DR9-1"),
    // so match by contains, not exact.
    await page.getByRole('button', { name: 'DR9-1' }).click();
    await page.getByRole('button', { name: 'DR9-2' }).click();

    // With no numbers touched, the split is even — 50/50 — and says so.
    await expect(page.getByLabel(`Rounds through DR9-1 with ${GUN}`)).toHaveValue('50');
    await expect(page.getByLabel(`Rounds through DR9-2 with ${GUN}`)).toHaveValue('50');
    await expect(page.getByText('Rounds split evenly across the mags you pick')).toBeVisible();

    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // Derived lifetime: DR9-1's count grew by exactly its 50-round share.
    expect(await dr91Lifetime(page)).toBe(before + 50);

    // Sticky preselect: the NEXT session with this gun opens its mag section
    // with the same two mags already picked — one tap confirms the loadout.
    await startSessionWithGun(page, '60');
    await page.locator('.session-mags .checklist-disclosure').click();
    await expect(page.getByRole('button', { name: 'DR9-1' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'DR9-2' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'DR9-3' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('custom split must match the gun total: bad sum blocks the save, fixed sum saves', async ({ page }) => {
    await seedDemo(page);
    const before = await dr91Lifetime(page);

    await startSessionWithGun(page, '100');
    await page.locator('.session-mags .checklist-disclosure').click();
    await page.getByRole('button', { name: 'DR9-1' }).click();
    await page.getByRole('button', { name: 'DR9-2' }).click();

    // Typing 80 into DR9-1 makes the split custom: 80 + 50 = 130 ≠ 100, and
    // the live note says so before any save attempt.
    await page.getByLabel(`Rounds through DR9-1 with ${GUN}`).fill('80');
    await expect(page.getByText(`These mag rounds total 130, but ${GUN} logged 100`)).toBeVisible();

    // Saving anyway is refused with the field-level problem.
    await page.locator('.navbar-action').click();
    await expect(page.locator('#session-mags-err')).toContainText(
      `Mag rounds for ${GUN} total 130, but the gun logged 100`);

    // Fix the second mag so 80 + 20 = 100; the warning yields to the custom-
    // split note and the save goes through.
    await page.getByLabel(`Rounds through DR9-2 with ${GUN}`).fill('20');
    await expect(page.getByText('Custom split', { exact: false })).toBeVisible();
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // DR9-1 got its hand-typed 80, not an even share.
    expect(await dr91Lifetime(page)).toBe(before + 80);

    // Editable forever: reopen the saved session — the custom split is seeded
    // back exactly, and the sum re-validates against any new gun total.
    await gotoTab(page, 'Log');
    await page.getByRole('main').locator('.row-tap').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
    await expect(page.getByLabel(`Rounds through DR9-1 with ${GUN}`)).toHaveValue('80');
    await expect(page.getByLabel(`Rounds through DR9-2 with ${GUN}`)).toHaveValue('20');

    // Raising the gun's rounds to 120 breaks the 80 + 20 sum — blocked again
    // until the split matches, then the edit saves.
    await page.getByLabel(`Rounds for ${GUN}`).fill('120');
    await page.locator('.navbar-action').click();
    await expect(page.locator('#session-mags-err')).toContainText(
      `Mag rounds for ${GUN} total 100, but the gun logged 120`);
    await page.getByLabel(`Rounds through DR9-1 with ${GUN}`).fill('100');
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();
    expect(await dr91Lifetime(page)).toBe(before + 100);
  });

  test('never a nag: dry fire hides the disclosure, and an untouched section blocks nothing', async ({ page }) => {
    await seedDemo(page);
    await startSessionWithGun(page, '25');

    // Live fire with linked mags: the disclosure is there, but closed and quiet.
    await expect(page.locator('.session-mags')).toBeVisible();

    // Dry fire: mags make no sense, so the section disappears entirely.
    await page.getByRole('button', { name: 'Dry fire' }).click();
    await expect(page.locator('.session-mags')).toHaveCount(0);

    // Picks made in live mode are NOT saved on a dry-fire session: pick two
    // mags, switch to dry fire, save...
    await page.getByRole('button', { name: 'Live practice' }).click();
    await page.locator('.session-mags .checklist-disclosure').click();
    await page.getByRole('button', { name: 'DR9-1' }).click();
    await page.getByRole('button', { name: 'DR9-2' }).click();
    await page.getByRole('button', { name: 'Dry fire' }).click();
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // ...then reopen it: flipping back to live fire shows a clean section —
    // nothing was stored, so nothing is picked.
    await page.getByRole('main').locator('.row-tap').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
    await page.getByRole('button', { name: 'Live practice' }).click();
    await page.locator('.session-mags .checklist-disclosure').click();
    await expect(page.getByRole('button', { name: 'DR9-1' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: 'DR9-2' })).toHaveAttribute('aria-pressed', 'false');
  });
});
