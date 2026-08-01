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
// attribution to the demo dataset's live sessions) — so a brand-new session
// opens with all four OFFERED by the "Same mags as last time" button.
//
// Owner decision, session 100: that offer is never applied on its own.
// Opening the disclosure checks nothing and stores nothing; only the tap on
// the offer records a loadout. (It used to pre-check them silently, which
// wrote an attribution the shooter had never made and contradicted this
// feature's own spec: "untouched section = nothing stored".) Tests still
// reconcile to the exact picks they want via `pickMags` below rather than
// assuming any particular starting selection.

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
 * what is already checked when the disclosure opens (nothing, since session
 * 100 — but a taken offer or a saved session's own picks may be).
 *
 * Not `exact: true` — the mag toggles render a checkbox glyph via CSS
 * generated content (`.gun-toggle::before`, app.css: '\u2713'/'\u2610'), and
 * generated content joins the accessible-name computation, so the button's
 * accessible name is "\u2713 DR9-1", not "DR9-1". Exact matching therefore
 * finds zero buttons; substring matching is required, not a convenience.
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

    // The NEXT session with this gun opens its mag section with NOTHING
    // checked, and the same two mags offered by name — one tap takes them.
    await startSessionWithGun(page, '60');
    await page.locator('.session-mags .checklist-disclosure').click();
    for (const label of ALL_MAGS) {
      await expect(page.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false');
    }
    await expect(page.locator('.mag-suggest')).toHaveText('Same mags as last time');
    await expect(page.locator('.mag-suggest-list')).toHaveText('DR9-1, DR9-2');
    await page.locator('.mag-suggest').click();
    await expect(page.getByRole('button', { name: 'DR9-1' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'DR9-2' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'DR9-3' })).toHaveAttribute('aria-pressed', 'false');
    // The offer withdraws once taken — it only ever fills an empty selection.
    await expect(page.locator('.mag-suggest')).toHaveCount(0);
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

  // The July-22 spec's own contract — "untouched section = nothing stored" —
  // machine-guarded for the first time (owner decision, session 100). Opening
  // a disclosure is inspection; it must never put an unmade claim about which
  // mags were fired into the shooter's log.
  test('a NEW session: opening Magazines and saving without tapping stores nothing', async ({ page }) => {
    await seedDemo(page);
    const before = await dr91Lifetime(page);

    await startSessionWithGun(page, '100');
    // Open it, look at the offer, take nothing.
    await page.locator('.session-mags .checklist-disclosure').click();
    await expect(page.locator('.mag-suggest')).toBeVisible();
    for (const label of ALL_MAGS) {
      await expect(page.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false');
    }
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // Nothing was attributed: the derived lifetime has not moved a round.
    expect(await dr91Lifetime(page)).toBe(before);

    // And the saved session holds no picks — with no offer to backfill one,
    // because a saved session's history is never filled in from habit.
    await gotoTab(page, 'Log');
    await page.getByRole('main').locator('.row-tap').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
    await openGunsSection(page);
    await page.locator('.session-mags .checklist-disclosure').click();
    await expect(page.locator('.mag-suggest')).toHaveCount(0);
    for (const label of ALL_MAGS) {
      await expect(page.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false');
    }
    await page.getByRole('button', { name: '‹ Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // Skipping the section once must not destroy the offer: the NEXT new
    // session still gets it, sourced from the last log that did attribute.
    await startSessionWithGun(page, '50');
    await page.locator('.session-mags .checklist-disclosure').click();
    await expect(page.locator('.mag-suggest')).toBeVisible();
  });

  // A plan being converted to a log counts as NEW — it is being written for
  // the first time, so the offer belongs there. (A plain saved session does
  // not: see the Show-pre-checks-nothing test above.) Found unguarded by the
  // session-100 cold audit; the behaviour was right and untested.
  test('converting a plan to a log offers the last-used mags; a plan alone stores none', async ({ page }) => {
    await seedDemo(page);
    const before = await dr91Lifetime(page);

    // Plan a session with the gun, never opening Magazines.
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Plan Session' }).click();
    await expect(page.getByRole('heading', { name: 'Plan Session' })).toBeVisible();
    await page.getByLabel('Where').fill('Convert Mags Range');
    await page.getByRole('button', { name: GUN }).click();
    await page.getByLabel(`Rounds for ${GUN}`).fill('80');
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // Reopen it and convert in place.
    await page.locator('.row-tap', { hasText: 'Convert Mags Range' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
    await openGunsSection(page);
    await page.getByRole('button', { name: 'Convert to logged session' }).click();
    await expect(page.getByRole('heading', { name: 'Log Session (from Plan)' })).toBeVisible();

    // The offer is there, and it is still an offer — nothing is checked yet.
    await page.locator('.session-mags .checklist-disclosure').click();
    for (const label of ALL_MAGS) {
      await expect(page.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false');
    }
    await page.locator('.mag-suggest').click();
    await expect(page.getByRole('button', { name: 'DR9-1' })).toHaveAttribute('aria-pressed', 'true');

    // Saving the now-logged session is what moves the derived lifetime: the
    // plan itself spent no rounds, so the whole 80 arrives at once, 20 each.
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();
    expect(await dr91Lifetime(page)).toBe(before + 20);
  });
});
