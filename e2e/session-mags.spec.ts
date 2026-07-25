import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab, gotoSection, openGunsSection } from './helpers';

// Per-session magazine tracking (spec July 22 2026). The session form grows a
// quiet per-gun "Magazines" disclosure — hidden the same way ammo and drills
// are, never a nag. Rounds split evenly across the picked mags unless the
// shooter types a custom split, which must sum to the gun's rounds to save.
// Magazine lifetime counts are DERIVED (starting count + session attributions),
// so the Magazines screen updates the moment a session saves — nothing is ever
// written to the Magazine record itself.
//
// The demo dataset gives "Shadow Systems DR920" four linked mags DR9-1..DR9-4,
// all in service. Its most recent live session now carries mag attribution
// for all four (session 78's audit: an earlier commit added magazine
// attribution to the demo dataset's live sessions) — so the sticky preselect
// (a brand-new session's Magazines section preselects the gun's last-used
// mags the moment it's opened) fires with all four checked on first open,
// not a blank slate. Tests reconcile to the exact picks they want via
// `pickMags` below rather than assuming an empty starting selection.

const GUN = 'Shadow Systems DR920';
const ALL_MAGS = ['DR9-1', 'DR9-2', 'DR9-3', 'DR9-4'];

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

/**
 * After a gun's Magazines disclosure is open, force exactly `want` to end up
 * selected — clicking whichever buttons are mismatched. Robust regardless of
 * what the sticky preselect already checked when the disclosure opened (it
 * may have pre-checked some or all of `all`).
 *
 * Not `exact: true` — a pressed toggle button's accessible name includes a
 * synthesized checked-state glyph ("✓ DR9-1" / "☐ DR9-1"), so match by
 * contains (same reason the original spec used a substring match here).
 */
async function pickMags(page: import('@playwright/test').Page, all: string[], want: string[]): Promise<void> {
  for (const label of all) {
    const btn = page.getByRole('button', { name: label });
    const pressed = (await btn.getAttribute('aria-pressed')) === 'true';
    if (pressed !== want.includes(label)) await btn.click();
  }
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
    await pickMags(page, ALL_MAGS, ['DR9-1', 'DR9-2']);

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
    await pickMags(page, ALL_MAGS, ['DR9-1', 'DR9-2']);

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
    // back exactly, and the sum re-validates against any new gun total. The
    // section loads COLLAPSED (owner decision, session 75); Show reveals it.
    await gotoTab(page, 'Log');
    await page.getByRole('main').locator('.row-tap').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
    // Editing an existing session loads Guns & Rounds collapsed — open it
    // first so the per-gun Magazines disclosure it contains is even in the DOM.
    await openGunsSection(page);
    await page.locator('.session-mags .checklist-disclosure').click();
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

  // Fix A collapsed the Magazines section by default on load (session 75).
  // If a mag-sum validation problem fires while it's still collapsed, the
  // section must open itself — otherwise the error message under Guns &
  // Rounds refers to inputs the shooter can't see.
  test('a mag-sum validation problem auto-opens its collapsed Magazines section', async ({ page }) => {
    await seedDemo(page);
    await startSessionWithGun(page, '100');
    await page.locator('.session-mags .checklist-disclosure').click();
    await pickMags(page, ALL_MAGS, ['DR9-1', 'DR9-2']);
    await page.getByLabel(`Rounds through DR9-1 with ${GUN}`).fill('80');
    await page.getByLabel(`Rounds through DR9-2 with ${GUN}`).fill('20');
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // Reopen the saved session: the Magazines section loads collapsed. Guns &
    // Rounds itself also loads collapsed (unrelated, pre-existing behavior) —
    // open it so the Magazines sub-disclosure is in the DOM to check at all.
    await page.getByRole('main').locator('.row-tap').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
    await openGunsSection(page);
    const disclosure = page.locator('.session-mags .checklist-disclosure');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');

    // Change the gun's rounds so the saved 80 + 20 split no longer sums, and
    // save WITHOUT ever opening the Magazines section.
    await page.getByLabel(`Rounds for ${GUN}`).fill('120');
    await page.locator('.navbar-action').click();

    // The error message appears AND the section auto-opened, so the mag
    // inputs it refers to are actually visible.
    await expect(page.locator('#session-mags-err')).toContainText(
      `Mag rounds for ${GUN} total 100, but the gun logged 120`);
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByLabel(`Rounds through DR9-1 with ${GUN}`)).toHaveValue('80');
    await expect(page.getByLabel(`Rounds through DR9-2 with ${GUN}`)).toHaveValue('20');
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
    await pickMags(page, ALL_MAGS, ['DR9-1', 'DR9-2']);
    await page.getByRole('button', { name: 'Dry fire' }).click();
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // ...then reopen it: flipping back to live fire shows a clean section —
    // nothing was stored, so nothing is picked. Guns & Rounds itself also
    // loads collapsed on an existing session — open it first so the
    // Magazines sub-disclosure is in the DOM.
    await page.getByRole('main').locator('.row-tap').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
    await openGunsSection(page);
    await page.getByRole('button', { name: 'Live practice' }).click();
    await page.locator('.session-mags .checklist-disclosure').click();
    await expect(page.getByRole('button', { name: 'DR9-1' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: 'DR9-2' })).toHaveAttribute('aria-pressed', 'false');
  });

  // Owner decision, session 75 (July 23 2026): saved sessions load with their
  // Magazines section COLLAPSED — the summary row lists the saved picks, and
  // opening is one tap. Supersedes the earlier "mirrors the ratings Reveal
  // defaultOpen" choice.
  test('reopening a saved session with mag attributions loads the Magazines section collapsed', async ({ page }) => {
    await seedDemo(page);
    await startSessionWithGun(page, '80');
    await page.locator('.session-mags .checklist-disclosure').click();
    await pickMags(page, ALL_MAGS, ['DR9-1', 'DR9-3']);
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // Reopen the just-saved session: the disclosure loads COLLAPSED, its
    // summary row lists the saved picks, and no checkboxes render until Show
    // is tapped. Guns & Rounds itself also loads collapsed — open it first so
    // the Magazines sub-disclosure is in the DOM.
    await page.getByRole('main').locator('.row-tap').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
    await openGunsSection(page);
    const disclosure = page.locator('.session-mags .checklist-disclosure');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(disclosure).toContainText('Magazines — DR9-1, DR9-3');
    // The disclosure's own summary text contains "DR9-1" too, so scope to the
    // per-mag toggle rows specifically, not the accessible-name substring match.
    await expect(page.locator('.session-mags .gun-toggle')).toHaveCount(0);

    // Tapping Show reveals the saved picks still checked.
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('button', { name: 'DR9-1' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'DR9-3' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'DR9-2' })).toHaveAttribute('aria-pressed', 'false');
  });

  // Owner decision, session 75: opening a saved session's Magazines section
  // must never dirty the form (the 7/9 vs 7/21 inconsistency), and a saved
  // session's history is never auto-backfilled from habit.
  test('a saved session without mag attributions: Show pre-checks nothing, and Cancel exits with no discard sheet', async ({ page }) => {
    await seedDemo(page);
    await startSessionWithGun(page, '50');
    // Save WITHOUT ever opening the Magazines section.
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    await page.getByRole('main').locator('.row-tap').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
    // Guns & Rounds itself also loads collapsed — open it first so the
    // Magazines sub-disclosure is in the DOM to check at all.
    await openGunsSection(page);
    const disclosure = page.locator('.session-mags .checklist-disclosure');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(disclosure).not.toContainText('—');

    // Tapping Show does not pre-check anything.
    await disclosure.click();
    await expect(page.getByRole('button', { name: 'DR9-1' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: 'DR9-2' })).toHaveAttribute('aria-pressed', 'false');

    // Hide, then ‹ Cancel: merely opening/closing the section must not dirty
    // the form, so Cancel exits directly with NO discard sheet.
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: '‹ Cancel' }).click();
    await expect(page.getByRole('dialog', { name: 'Discard changes?' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();
  });

  // The preserved feature: sticky preselect still fires for a brand-new
  // session (never for an already-saved one — see the tests above).
  test('preserved: a NEW session still preselects the gun last-used mags on first open', async ({ page }) => {
    await seedDemo(page);
    await startSessionWithGun(page, '40');
    await page.locator('.session-mags .checklist-disclosure').click();
    await pickMags(page, ALL_MAGS, ['DR9-2', 'DR9-4']);
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // A brand-new session with the same gun: opening Magazines preselects the
    // mags from that just-logged session.
    await startSessionWithGun(page, '30');
    await page.locator('.session-mags .checklist-disclosure').click();
    await expect(page.getByRole('button', { name: 'DR9-2' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'DR9-4' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'DR9-1' })).toHaveAttribute('aria-pressed', 'false');
  });
});
