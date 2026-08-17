import { test, expect } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import { seedDemo, gotoTab, gotoSection } from './helpers';

// Magazines in competitions (spec: vault "Magazines in competitions", 17 Aug
// 2026, session 124). MatchMagPicker.tsx is the shared "Mags" disclosure that
// rides the match form and both PractiScoreImport confirm screens — the same
// collapsed pattern SessionForm's per-gun picker already uses, minus the
// per-gun repetition (a match has one gun). Rounds fired at the match split
// across the picked mags once a total exists; before that it stays visibly
// pending, never a silent zero (decision 2a).
//
// The demo dataset gives "Shadow Systems DR920" four linked mags DR9-1..DR9-4,
// all in service — the same gun/mags session-mags.spec.ts uses, reused here so
// this file needs no dataset assumptions beyond ones already proven to hold.
//
// SEEDING: every test drives the picker through the real UI (new match / edit
// match / the PractiScore importer's own "Try the sample" button) except the
// deleted-magazine ghost test, which writes a match straight into IndexedDB —
// the UI has no way to pick a magazine and then have it vanish out from under
// the record in the same session, so the only way to reach that state is the
// way edit-match-picker.spec.ts reaches its own unreachable-by-the-UI states:
// write the record directly, then reload so the app reads it fresh.

const GUN = 'Shadow Systems DR920';
const ALL_MAGS = ['DR9-1', 'DR9-2', 'DR9-3', 'DR9-4'];

/**
 * Force exactly `want` to end up selected within `section` (a `.session-mags`
 * locator), clicking whichever buttons are mismatched. Copied from
 * session-mags.spec.ts's `pickMags`, scoped to a container instead of the
 * whole page — MatchForm only ever has one `.session-mags` block (one gun per
 * match), but scoping costs nothing and keeps this file self-contained.
 *
 * NOT `exact: true` — the mag toggle buttons render a checkbox glyph via CSS
 * generated content (`.gun-toggle::before`), which joins the accessible-name
 * computation, so the button's accessible name is not the bare label. Exact
 * matching finds zero buttons; substring matching is required.
 */
async function pickMags(page: Page, section: Locator, all: string[], want: string[]): Promise<void> {
  for (const label of all) {
    const btn = section.getByRole('button', { name: label });
    const pressed = (await btn.getAttribute('aria-pressed')) === 'true';
    if (pressed !== want.includes(label)) await btn.click();
  }
}

/** Start a new match from the Compete tab, named and with `gun` picked. */
async function startNewMatch(page: Page, name: string, gun: string = GUN): Promise<void> {
  await gotoTab(page, 'Compete');
  await page.getByRole('button', { name: '+ Log Match' }).click();
  await expect(page.getByRole('heading', { name: 'Log Match' })).toBeVisible();
  await page.getByLabel('What this match is called').fill(name);
  await page.locator('#match-gun-select').selectOption({ label: gun });
}

/** The navbar Save button — present (as exactly "Save", never "Save match" /
 *  "Save changes") on both Log Match and Edit Match, so one helper covers
 *  both without caring which screen it's on. Mirrors edit-match-picker.spec.ts. */
async function clickSave(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
}

/** From a match's detail screen, open it for editing. */
async function reopenForEdit(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit Match' })).toBeVisible();
}

/** The magazine's lifetime round count as the Magazines screen shows it
 *  ("125 rds ›") — starting count plus every session and match attribution,
 *  all derived, never written back to the Magazine record. Mirrors
 *  session-mags.spec.ts's `dr91Lifetime`, generalised to any mag label so the
 *  match-rounds test below can reuse it. */
async function magLifetime(page: Page, label: string): Promise<number> {
  await gotoSection(page, 'Magazines');
  const row = page.getByRole('main').locator('.row-tap', { hasText: label }).first();
  await expect(row).toBeVisible();
  const text = await row.locator('.value').textContent();
  return Number((text ?? '').replace(/[^\d]/g, ''));
}

test.describe('Magazines in competitions: the match form', () => {
  test('pending state: mags picked with no rounds fired renders visibly pending, never a silent zero', async ({ page }) => {
    await seedDemo(page);
    await startNewMatch(page, 'Pending Rounds Match');

    const magSection = page.locator('.session-mags');
    await expect(magSection).toBeVisible();
    await magSection.locator('.checklist-disclosure').click();
    await pickMags(page, magSection, ALL_MAGS, ['DR9-1', 'DR9-2']);

    // No total entered: no override input renders at all (nothing to split),
    // and the picker says so in plain language rather than showing a 0.
    await expect(magSection.locator('.rounds-input')).toHaveCount(0);
    await expect(page.getByText('Pending a round count', { exact: false })).toBeVisible();

    await clickSave(page);
    await expect(page.getByRole('heading', { name: 'Pending Rounds Match' })).toBeVisible();

    // MatchDetail's read-only Mags row carries the same honesty forward.
    await expect(page.getByText('pending a round count')).toBeVisible();
  });

  test('even split with a rounds total, the payoff line, and a clean edit round-trip', async ({ page }) => {
    await seedDemo(page);
    await startNewMatch(page, 'Even Split Match');
    await page.getByLabel(/Rounds fired/).fill('50');

    const magSection = page.locator('.session-mags');
    await magSection.locator('.checklist-disclosure').click();
    await pickMags(page, magSection, ALL_MAGS, ['DR9-1', 'DR9-2']);

    await expect(page.getByLabel('Rounds through DR9-1')).toHaveValue('25');
    await expect(page.getByLabel('Rounds through DR9-2')).toHaveValue('25');
    await expect(page.getByText('Updates round counts for maintenance tracking.')).toBeVisible();
    await expect(page.getByText('Rounds split evenly across the mags you pick', { exact: false })).toBeVisible();

    // Type a different value, then the even value back. A split the shooter
    // typed that ends up EQUAL to the even split is still not an override
    // (spec: stored only when they differ) -- the reopen-and-change-total
    // assertions below catch an impostor that stores it anyway. (Away-and-back
    // rather than same-value fill: React fires no change event when the value
    // doesn't change, so a same-value fill never reaches the code under test.)
    await page.getByLabel('Rounds through DR9-1').fill('30');
    await page.getByLabel('Rounds through DR9-1').fill('25');
    await page.getByLabel('Rounds through DR9-2').fill('25');

    await clickSave(page);
    await expect(page.getByRole('heading', { name: 'Even Split Match' })).toBeVisible();

    // Reopen: the picks and the even split are seeded back exactly, and
    // because nothing was overridden, no mismatch banner has anything to say.
    await reopenForEdit(page);
    await magSection.locator('.checklist-disclosure').click();
    await expect(page.getByRole('button', { name: 'DR9-1' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'DR9-2' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Rounds through DR9-1')).toHaveValue('25');
    await expect(page.getByLabel('Rounds through DR9-2')).toHaveValue('25');
    await expect(magSection.locator('.report-note.warn')).toHaveCount(0);

    // The proof that an untouched even split stored NO overrides (spec: they
    // exist "only when the shooter overrode the split"): change the total and
    // the split simply recalculates -- an impostor that quietly stored 25/25
    // as overrides would flag a mismatch here instead.
    await page.getByLabel(/Rounds fired/).fill('80');
    await expect(page.getByLabel('Rounds through DR9-1')).toHaveValue('40');
    await expect(page.getByLabel('Rounds through DR9-2')).toHaveValue('40');
    await expect(magSection.locator('.report-note.warn')).toHaveCount(0);
  });

  test('zero rounds fired is a KNOWN zero, not pending -- on the form and the detail screen', async ({ page }) => {
    // The exact case spec 2a names ("never a silent zero" cuts both ways: a
    // real 0 must show as 0, not as pending). Kills the falsy-check impostor
    // (`!match.totalRounds`) that == null correctly rejects.
    await seedDemo(page);
    await startNewMatch(page, 'Zero Rounds Match');
    await page.getByLabel(/Rounds fired/).fill('0');

    const magSection = page.locator('.session-mags');
    await magSection.locator('.checklist-disclosure').click();
    await pickMags(page, magSection, ALL_MAGS, ['DR9-1', 'DR9-2']);

    await expect(page.getByLabel('Rounds through DR9-1')).toHaveValue('0');
    await expect(page.getByLabel('Rounds through DR9-2')).toHaveValue('0');
    await expect(page.getByText('Pending a round count', { exact: false })).toHaveCount(0);

    await clickSave(page);
    await expect(page.getByRole('heading', { name: 'Zero Rounds Match' })).toBeVisible();
    await expect(page.getByText('DR9-1, DR9-2')).toBeVisible();
    await expect(page.getByText('pending a round count')).toHaveCount(0);
  });

  test('a custom split blocks Save until it matches, and a later total edit re-flags the mismatch on reopen', async ({ page }) => {
    await seedDemo(page);
    await startNewMatch(page, 'Override Gate Match');
    await page.getByLabel(/Rounds fired/).fill('50');

    const magSection = page.locator('.session-mags');
    await magSection.locator('.checklist-disclosure').click();
    await pickMags(page, magSection, ALL_MAGS, ['DR9-1', 'DR9-2']);

    // Typing 30 into DR9-1 makes the split custom: 30 + 25 (DR9-2's even
    // share) = 55 ≠ 50, and the live note says so before any save attempt.
    await page.getByLabel('Rounds through DR9-1').fill('30');
    await expect(page.getByText('These mag rounds total 55, but the match logged 50', { exact: false })).toBeVisible();

    // Saving anyway is refused with the field-level problem, and the form
    // never navigates away.
    await clickSave(page);
    await expect(page.locator('#match-numbers-err')).toContainText(
      'Your mag rounds total 55, but the match logged 50');
    await expect(page.getByRole('heading', { name: 'Log Match' })).toBeVisible();

    // A negative number is refused even when the SUM works out -- -5 + 55 =
    // 50 would sail through a sum-only check and write a negative round count
    // onto a mag's odometer (tests-constrain audit, impostor 1).
    await page.getByLabel('Rounds through DR9-1').fill('-5');
    await page.getByLabel('Rounds through DR9-2').fill('55');
    await clickSave(page);
    await expect(page.locator('#match-numbers-err')).toContainText('whole number');
    await page.getByLabel('Rounds through DR9-1').fill('30');

    // Fix the second mag so 30 + 20 = 50; the warning yields to the
    // custom-split note and the save goes through.
    await page.getByLabel('Rounds through DR9-2').fill('20');
    await expect(page.getByText('Custom split', { exact: false })).toBeVisible();
    await clickSave(page);
    await expect(page.getByRole('heading', { name: 'Override Gate Match' })).toBeVisible();

    // Reopen: the overrides are seeded back exactly (30/20), not the even split.
    await reopenForEdit(page);
    await magSection.locator('.checklist-disclosure').click();
    await expect(page.getByLabel('Rounds through DR9-1')).toHaveValue('30');
    await expect(page.getByLabel('Rounds through DR9-2')).toHaveValue('20');

    // Raise the match's total to 60 -- against the SAVED 30/20 split, seeded
    // fresh at THIS edit's mount (the exact gap Pass 2's build notes flagged
    // as untested: overrideText seeds from initialMagOverrides only once, at
    // mount, so this proves that seed is still validated against a total that
    // changed after the record was saved, not just a total typed in the same
    // sitting the split was created in).
    await page.getByLabel(/Rounds fired/).fill('60');
    await expect(page.getByText('These mag rounds total 50, but the match logged 60', { exact: false })).toBeVisible();

    await clickSave(page);
    await expect(page.locator('#match-numbers-err')).toContainText(
      'Your mag rounds total 50, but the match logged 60');

    // "Reset to even split" clears the custom numbers, the banner clears, and
    // the save that was blocked now goes through.
    await page.getByRole('button', { name: 'Reset to even split' }).click();
    await expect(magSection.locator('.report-note.warn')).toHaveCount(0);
    await clickSave(page);
    await expect(page.getByRole('heading', { name: 'Override Gate Match' })).toBeVisible();
  });

  test('clearing every mag pick on edit removes them -- not a stale carry-forward', async ({ page }) => {
    await seedDemo(page);
    await startNewMatch(page, 'Clear Picks Match');

    const magSection = page.locator('.session-mags');
    await magSection.locator('.checklist-disclosure').click();
    await pickMags(page, magSection, ALL_MAGS, ['DR9-1', 'DR9-3']);
    await clickSave(page);
    await expect(page.getByRole('heading', { name: 'Clear Picks Match' })).toBeVisible();
    await expect(page.getByText('DR9-1, DR9-3')).toBeVisible();

    await reopenForEdit(page);
    await magSection.locator('.checklist-disclosure').click();
    await pickMags(page, magSection, ALL_MAGS, []); // un-pick everything
    await clickSave(page);
    await expect(page.getByRole('heading', { name: 'Clear Picks Match' })).toBeVisible();

    // No Mags row at all -- the field was explicitly cleared, not left at its
    // stale saved value (the defect this build fixed: a naive spread that
    // only overwrites a key when the new fields object HAS that key would
    // have left DR9-1/DR9-3 sitting on the record forever).
    await expect(page.getByText('DR9-1, DR9-3')).toHaveCount(0);
    await expect(page.getByText('Mags', { exact: true })).toHaveCount(0);

    await reopenForEdit(page);
    await magSection.locator('.checklist-disclosure').click();
    for (const label of ALL_MAGS) {
      await expect(page.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false');
    }
  });

  test('switching guns clears mag picks -- the picker remounts, it does not carry them over', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await seedDemo(page);
    await startNewMatch(page, 'Gun Switch Match');

    const magSection = page.locator('.session-mags');
    await magSection.locator('.checklist-disclosure').click();
    await pickMags(page, magSection, ALL_MAGS, ['DR9-1', 'DR9-2']);

    // Switch to any other pickable gun -- picked dynamically rather than by a
    // second hardcoded demo gun name, since this file has no independent way
    // to confirm what else the demo dataset carries beyond DR920 (see NOTES).
    const gunSelect = page.locator('#match-gun-select');
    const options = await gunSelect.locator('option').allTextContents();
    const other = options.find((o) => o !== GUN);
    expect(other, 'the demo dataset needs at least two pickable guns for this test to mean anything').toBeTruthy();
    await gunSelect.selectOption({ label: other as string });

    // Switch back: this is a fresh MatchMagPicker instance (key={firearmId}),
    // so nothing survived the round trip.
    await gunSelect.selectOption({ label: GUN });
    await magSection.locator('.checklist-disclosure').click();
    for (const label of ALL_MAGS) {
      await expect(page.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false');
    }
    expect(errors, 'switching guns must not throw').toEqual([]);
  });

  test('a condition tag shows a Needs cleaning row on the match, and travels with the pick', async ({ page }) => {
    await seedDemo(page);
    await startNewMatch(page, 'Sand Match');

    const magSection = page.locator('.session-mags');
    await magSection.locator('.checklist-disclosure').click();
    await pickMags(page, magSection, ALL_MAGS, ['DR9-1']);
    // Exactly one mag is picked, so exactly one Condition <select> exists --
    // there is no accessible way to scope it to "DR9-1's" specifically (see
    // NOTES), which is why this test only ever picks one mag.
    await magSection.locator('select').selectOption({ label: 'Sand' });

    await clickSave(page);
    await expect(page.getByRole('heading', { name: 'Sand Match' })).toBeVisible();
    await expect(page.locator('.row', { hasText: 'Needs cleaning' })).toBeVisible();
    await expect(page.getByText('DR9-1 (sand)')).toBeVisible();

    // Reopen: the tag persists.
    await reopenForEdit(page);
    await magSection.locator('.checklist-disclosure').click();
    await expect(magSection.locator('select')).toHaveValue('sand');

    // Un-pick the mag: the tag goes with it (a condition tag describes a mag
    // that ran the match; it can't survive the mag being un-picked).
    await pickMags(page, magSection, ALL_MAGS, []);
    await clickSave(page);
    await expect(page.getByRole('heading', { name: 'Sand Match' })).toBeVisible();
    await expect(page.locator('.row', { hasText: 'Needs cleaning' })).toHaveCount(0);
  });

  test('sticky "same mags as last time" offers on a NEW match, never on an edit of an existing one', async ({ page }) => {
    await seedDemo(page);

    // A first match establishes a history: DR9-1 + DR9-3 for DR920.
    await startNewMatch(page, 'Sticky Source Match');
    const magSection = page.locator('.session-mags');
    await magSection.locator('.checklist-disclosure').click();
    await pickMags(page, magSection, ALL_MAGS, ['DR9-1', 'DR9-3']);
    await clickSave(page);
    await expect(page.getByRole('heading', { name: 'Sticky Source Match' })).toBeVisible();

    // A brand-new match for the same gun offers the same mags -- unapplied
    // until tapped, mirroring SessionForm's magSuggestion rule exactly.
    await startNewMatch(page, 'Sticky Target Match');
    await magSection.locator('.checklist-disclosure').click();
    for (const label of ALL_MAGS) {
      await expect(page.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false');
    }
    await expect(page.locator('.mag-suggest')).toHaveText('Same mags as last time');
    await expect(page.locator('.mag-suggest-list')).toHaveText('DR9-1, DR9-3');
    await page.locator('.mag-suggest').click();
    await expect(page.getByRole('button', { name: 'DR9-1' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'DR9-3' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'DR9-2' })).toHaveAttribute('aria-pressed', 'false');
    await clickSave(page);
    await expect(page.getByRole('heading', { name: 'Sticky Target Match' })).toBeVisible();

    // Editing an EXISTING match never offers the suggestion, even though it
    // would technically qualify (same gun, mags picked elsewhere) -- a saved
    // record shows exactly what it holds, never backfilled from habit.
    await reopenForEdit(page);
    await magSection.locator('.checklist-disclosure').click();
    await expect(page.locator('.mag-suggest')).toHaveCount(0);
  });

  test('a PRIOR match with corrupt magIds never crashes a NEW match for the same gun (sticky lookup hardening)', async ({ page }) => {
    // The sticky "same mags as last time" lookup reads LIVE match records at
    // mount -- one corrupt record (magIds as a bare string, reachable via a
    // hand-edited .flog) must not take down every future match form for that
    // gun (verify-loop finding, 17 Aug 2026).
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await seedDemo(page);
    await page.evaluate(async () => {
      const firearmId = await new Promise<string>((resolve, reject) => {
        const o = indexedDB.open('firearmlog');
        o.onerror = () => reject(o.error);
        o.onsuccess = () => {
          const db = o.result;
          const r = db.transaction('firearms', 'readonly').objectStore('firearms').getAll();
          r.onsuccess = () => { const all = r.result || []; db.close(); resolve(all.length ? String(all[0].id) : ''); };
          r.onerror = () => { db.close(); reject(r.error); };
        };
      });
      const rec = {
        id: 'e2e-corrupt-magids-match', date: '2026-08-01', name: 'Corrupt MagIds Match',
        matchType: 'USPSA Level 1 (club match)', division: 'Carry Optics', powerFactor: 'Minor',
        firearmId, scoringType: 'uspsa', totalRounds: 40, matchPercent: null,
        divisionPlace: null, divisionOf: null, overallPlace: null, overallOf: null,
        stages: [], notes: '', magIds: 'DR9-1',
      };
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('firearmlog');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('matches', 'readwrite');
          tx.objectStore('matches').put(rec);
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      });
    });
    await page.reload();

    await startNewMatch(page, 'After Corruption Match');
    const magSection = page.locator('.session-mags');
    await expect(magSection).toBeVisible();
    await magSection.locator('.checklist-disclosure').click();
    await pickMags(page, magSection, ALL_MAGS, ['DR9-1']);
    await expect(page.getByText('Pending a round count', { exact: false })).toBeVisible();
    expect(errors, 'a corrupt prior match must not crash a new match form').toEqual([]);
  });

  test('a magazine no longer on file renders as a ghost row -- never crashes, and un-picks cleanly', async ({ page }) => {
    const MATCH_ID = 'e2e-ghost-mag-match';
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await seedDemo(page);

    // Write a match straight into IndexedDB carrying a magId no Magazine
    // record holds -- the UI itself can never produce this state (you can
    // only pick a magazine that currently exists), so the only way to reach
    // it is the way edit-match-picker.spec.ts reaches its own unreachable
    // states: seed the record directly, then reload so the app reads it fresh.
    await page.evaluate(async (id) => {
      const firearmId = await new Promise<string>((resolve, reject) => {
        const o = indexedDB.open('firearmlog');
        o.onerror = () => reject(o.error);
        o.onsuccess = () => {
          const db = o.result;
          const r = db.transaction('firearms', 'readonly').objectStore('firearms').getAll();
          r.onsuccess = () => { const all = r.result || []; db.close(); resolve(all.length ? String(all[0].id) : ''); };
          r.onerror = () => { db.close(); reject(r.error); };
        };
      });
      const rec = {
        id, date: '2026-08-02', name: 'Ghost Mag Match', matchType: 'USPSA Level 1 (club match)',
        division: 'Carry Optics', powerFactor: 'Minor', firearmId, scoringType: 'uspsa',
        totalRounds: 40, matchPercent: null, divisionPlace: null, divisionOf: null,
        overallPlace: null, overallOf: null, stages: [], notes: '',
        magIds: ['mg-does-not-exist'],
      };
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('firearmlog');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('matches', 'readwrite');
          tx.objectStore('matches').put(rec);
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      });
    }, MATCH_ID);
    await page.reload();

    await gotoTab(page, 'Compete');
    await page.getByText('Ghost Mag Match').first().click();
    await expect(page.getByRole('heading', { name: 'Ghost Mag Match' })).toBeVisible();
    // totalRounds is set (40), so no "pending" suffix -- just the dash a
    // missing magazine falls back to, never a thrown error.
    await expect(page.locator('.row', { hasText: 'Mags' }).locator('.value')).toHaveText('—');
    expect(errors, 'rendering a ghost mag on MatchDetail must not throw').toEqual([]);

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByLabel('What this match is called')).toBeVisible();
    const magSection = page.locator('.session-mags');
    await magSection.locator('.checklist-disclosure').click();
    await expect(page.getByText('Deleted magazine')).toBeVisible();

    // Un-pickable cleanly: tapping the ghost row removes it, no crash.
    await page.getByRole('button', { name: 'Deleted magazine' }).click();
    await expect(page.getByText('Deleted magazine')).toHaveCount(0);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ghost Mag Match' })).toBeVisible();
    expect(errors, 'removing a ghost mag must not throw').toEqual([]);
  });
});

test.describe('Magazines in competitions: the PractiScore importer', () => {
  // Only the USPSA route is covered here (see NOTES for why the Steel/SCSA
  // route is not): its confirm screen has a zero-fixture path already built
  // into the component ("Try the sample"), so driving it needs no new
  // machinery. USPSA results never carry a round count (Pass 2 build notes),
  // so `totalRounds` is always null on this screen -- must-test #5 (spec §5)
  // for the importer side.
  test('the confirm screen renders the same pending state as the match form', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    await page.getByRole('button', { name: 'Import…' }).click();
    await page.getByRole('button', { name: 'Import from PractiScore' }).click();
    await expect(page.getByRole('heading', { name: 'Import from PractiScore' })).toBeVisible();

    await page.getByRole('button', { name: 'Try the sample' }).click();
    await page.getByRole('button', { name: 'Read results' }).click();

    // Step 2: pick a shooter row -- any row does, the mag picker doesn't care
    // which competitor was chosen.
    await page.locator('.row-tap').first().click();

    // Step 3: the confirm screen. Pick a gun with linked mags and open Mags.
    await page.getByLabel('Which gun did you shoot?').selectOption({ label: GUN });
    const magSection = page.locator('.session-mags');
    await expect(magSection).toBeVisible();
    await magSection.locator('.checklist-disclosure').click();
    await pickMags(page, magSection, ALL_MAGS, ['DR9-1']);

    await expect(magSection.locator('.rounds-input')).toHaveCount(0);
    await expect(page.getByText('Pending a round count', { exact: false })).toBeVisible();
    await expect(page.getByText('Updates round counts for maintenance tracking.')).toBeVisible();
  });
});

test('the Magazines screen lifetime count includes match rounds, not just session rounds', async ({ page }) => {
  // Pins the Pass-1 derivation (magLifetimeRounds growing a second loop over
  // matches) to a real screen, not just the unit tests. Uses DR9-1's existing
  // baseline (starting count + the demo's own seeded session attribution --
  // see session-mags.spec.ts) rather than seeding a fresh mag by hand, so this
  // test only needs to prove the DELTA a match's rounds add, not reconstruct
  // the whole figure from scratch.
  await seedDemo(page);
  const before = await magLifetime(page, 'DR9-1');

  await startNewMatch(page, 'Lifetime Count Match');
  await page.getByLabel(/Rounds fired/).fill('60');
  const magSection = page.locator('.session-mags');
  await magSection.locator('.checklist-disclosure').click();
  await pickMags(page, magSection, ALL_MAGS, ['DR9-1', 'DR9-3']);
  await clickSave(page);
  await expect(page.getByRole('heading', { name: 'Lifetime Count Match' })).toBeVisible();

  // Even split of 60 across two mags is 30 each.
  expect(await magLifetime(page, 'DR9-1')).toBe(before + 30);
});
