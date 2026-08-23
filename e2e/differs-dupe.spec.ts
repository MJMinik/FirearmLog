import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoTab, gotoSection } from './helpers';
import { parseScsaForm, type ScsaForm, type ScsaEntry } from '../src/lib/scsaForm.ts';
import { Guncraft8stage } from '../tests/fixtures/scsa-guncraft-8stage.ts';

// MEMBER_DIFFERS_ACTION_SPEC.md + DUPLICATE_IMPORT_DETECTION_SPEC.md +
// FINISHING_STEP_PINNED_BAR_MEMO.md (22 Aug 2026, session 129/130). Four
// tests, budget-aware — the suite runs in 4 shards with a 15-minute budget
// each — so imports are shared inside each test and nothing is repeated
// across tests that a single page state could already cover.
//
// Reuses steel-import.spec.ts's and member-numbers.spec.ts's own patterns
// rather than inventing new ones: the paste-box door into the Steel flow
// (steel-import.spec.ts's own "pasted into the text box" test proves it
// routes identically to the file-chooser door, and it is the cheaper one
// when a test needs to re-import the SAME text a second time in one run),
// the Settings-screen seeding helpers (member-numbers.spec.ts's addNames /
// setScsaNumber), and the raw-IndexedDB read of the matches store
// (match-mags.spec.ts's own pattern, reused verbatim below for
// readMatches -- the strongest proof of what was actually written,
// independent of whatever the screen goes on to show).
//
// Expectations are computed from the fixture at runtime with the app's own
// parser, so these specs keep working if the fixture's anonymised names or
// numbers ever change.

function formOf(text: string): ScsaForm {
  const r = parseScsaForm(text);
  if (!r.ok) throw new Error('fixture must parse');
  return r.form;
}

const fullName = (e: ScsaEntry) => `${e.firstName} ${e.lastName}`.trim();
/** Escape a name for use inside a RegExp -- the fixture keeps real
 *  decorations (parentheses, hyphens) on surnames on purpose. */
const nameRe = (e: ScsaEntry) => new RegExp(fullName(e).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

/** A transposed membership number, computed from the fixture's own value --
 *  mirrors member-numbers.spec.ts's own "notes when a suggested row's
 *  number ... differs" test, so a real differing number is always what
 *  drives the differs question, never a hardcoded string. */
function transposed(membership: string): string {
  const digits = membership.replace(/\D+/g, '');
  return membership.replace(digits, digits.slice(0, -2) + digits.slice(-1) + digits.slice(-2, -1));
}

async function addNames(page: Page, names: string[]) {
  await gotoSection(page, 'Settings');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Who you are' })).toBeVisible();
  for (const n of names) {
    await main.getByLabel('Name as it appears in results').fill(n);
    await main.getByRole('button', { name: 'Add name', exact: true }).click();
    await expect(main.getByText(n, { exact: true })).toBeVisible();
  }
}

async function setScsaNumber(page: Page, value: string) {
  await gotoSection(page, 'Settings');
  const main = page.getByRole('main');
  const field = main.getByLabel('SCSA #');
  await field.fill(value);
  await field.blur();
  await expect(field).toHaveValue(value);
}

/** Load a Steel download file through the paste box rather than the file
 *  chooser -- the cheaper door, proven in steel-import.spec.ts to route to
 *  the same Steel flow (tryStartSteel checks the text before the USPSA
 *  parser ever sees it, regardless of which door it arrived through). */
async function pasteSteelFile(page: Page, text: string) {
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Import…' }).click();
  await page.getByRole('dialog', { name: 'Import' }).getByRole('button', { name: 'Import from PractiScore' }).click();
  await main.getByLabel('Results text').fill(text);
  await main.getByRole('button', { name: 'Read results' }).click();
}

/** The picker step: search for `entry` by last name and tap their row. */
async function pickEntry(page: Page, entry: ScsaEntry) {
  const main = page.getByRole('main');
  await main.getByPlaceholder('Search shooters by name').fill(entry.lastName);
  const row = main.getByRole('button', { name: nameRe(entry) }).first();
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
}

/** Read the matches store straight from IndexedDB, mirroring match-
 *  mags.spec.ts's own raw-read pattern. NOTE (see NOTES.md): Settings is
 *  read through the Settings screen instead (member-numbers.spec.ts's own
 *  proven pattern) rather than a raw IndexedDB read, because the settings
 *  object store's name is not established by any staged input file for
 *  this build. */
/** Records in `after` whose id is absent from `before`. Counts alone proved
 *  untrustworthy here: the demo seed's restore can land its last record a
 *  beat AFTER Home renders, so two count snapshots taken mid-test can
 *  straddle a still-settling database and disagree by one for reasons that
 *  have nothing to do with the feature (seen live, 23 Aug 2026 — a demo
 *  record surfaced between two reads and indicted Cancel). An id diff only
 *  ever sees what was actually ADDED between the two reads. */
function addedSince(before: { id: string }[], after: { id: string; name?: string }[]) {
  const ids = new Set(before.map((m) => m.id));
  return after.filter((m) => !ids.has(m.id));
}

async function readMatches(page: Page): Promise<{ id: string }[]> {
  return page.evaluate(async () => {
    return await new Promise((resolve, reject) => {
      const o = indexedDB.open('firearmlog');
      o.onerror = () => reject(o.error);
      o.onsuccess = () => {
        const db = o.result;
        const r = db.transaction('matches', 'readonly').objectStore('matches').getAll();
        r.onerror = () => reject(r.error);
        r.onsuccess = () => { db.close(); resolve(r.result as { id: string }[]); };
      };
    });
  });
}

test.describe('the differs question, mutual exclusion, and duplicate warnings', () => {
  test('differs question: three branches on one screen (spec §7 acceptance path)', async ({ page }) => {
    const form = formOf(Guncraft8stage);
    const me = form.entries.find((e) => e.membership.toUpperCase() === 'A185231') as ScsaEntry;
    expect(me).toBeTruthy();
    const wrongStored = transposed(me.membership);

    await seedDemo(page);
    // A stored NAME too, so the picker row is SUGGESTED and the sub-line the
    // spec's acceptance test relies on ("Member # differs") actually renders
    // -- that sub-line is computed only for suggested rows (spec §1: the row
    // is "the pointer", untouched by this build; suggestion is name-driven,
    // and the number alone never lifts a stranger, MEMBER_NUMBER_PROVENANCE
    // _SPEC.md §3).
    await addNames(page, [`${me.lastName}, ${me.firstName}`]);
    await setScsaNumber(page, wrongStored);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');

    await pasteSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();
    const suggest = main.locator('.suggest-block');
    await expect(suggest).toBeVisible();
    await expect(suggest.getByText('Member # differs')).toBeVisible();
    const row = suggest.getByRole('button', { name: nameRe(me) }).first();
    await row.click();
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    await main.getByRole('button', { name: 'Continue', exact: true }).click();
    await main.getByLabel('Which gun did you shoot?').selectOption({ index: 1 });

    // The question shows BOTH numbers, each under its own label — the exact
    // signed sentence, not two floating presence checks (a swapped pair of
    // values would pass a presence check; it cannot pass this).
    await expect(main.getByText('This file lists a different SCSA # for you.')).toBeVisible();
    await expect(main.getByText(
      `Your saved number is ${wrongStored}. This file lists ${me.membership}. Either could be the right one — only you know.`
    )).toBeVisible();
    // Progressive disclosure: the match-director note is NOT on screen before
    // an answer is chosen (an unconditional render would pass a
    // present-after-Keep check alone).
    await expect(main.getByText('mention it to the match director', { exact: false })).toHaveCount(0);

    // Branch 1: Keep my number -- the match-director note appears; Save;
    // Settings still hold the seeded (wrong) number, because "Keep" writes
    // nothing (spec §4).
    await main.getByRole('button', { name: /^Keep my #/ }).click();
    await expect(main.getByText('mention it to the match director', { exact: false })).toBeVisible();
    await main.locator('.pick-bar').getByRole('button', { name: 'Save match' }).click();
    // exact: true, or this matches the finishing screen's own "‹ Back to the
    // shooter list" and the test runs ahead of the save (getByRole name is
    // SUBSTRING matching — the s129 lesson, re-learned here on first run).
    await expect(main.getByRole('button', { name: '‹ Back', exact: true })).toBeVisible();
    await gotoSection(page, 'Settings');
    await expect(main.getByLabel('SCSA #')).toHaveValue(wrongStored);

    // Branch 2 — IGNORE (spec §7's third branch, exercised for real): the
    // question is on screen, unanswered, and Save is tapped anyway. "Save
    // works in every state" is the shipped contract — a Save button that
    // waited for an answer would fail exactly here. The duplicate warning
    // fires first (this is a re-import), Save Anyway proceeds, and the
    // ignored question stores NOTHING.
    await gotoTab(page, 'Compete');
    await pasteSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();
    await pickEntry(page, me);
    await main.getByRole('button', { name: 'Continue', exact: true }).click();
    await main.getByLabel('Which gun did you shoot?').selectOption({ index: 1 });
    await expect(main.getByText('This file lists a different SCSA # for you.')).toBeVisible();
    await expect(main.getByRole('button', { name: /^Use the file's #/ })).toHaveAttribute('aria-pressed', 'false');
    // The buttons now carry the numbers themselves (tap-test item 4, 23 Aug):
    // exact accessible names, real values substituted.
    await expect(main.getByRole('button', { name: `Use the file's # — ${me.membership}` })).toBeVisible();
    await expect(main.getByRole('button', { name: `Keep my # — ${wrongStored}` })).toBeVisible();
    // The Save-tap nudge (tap-test item 3): the FIRST tap with the question
    // unanswered scrolls it into view and saves nothing — no sheet, still on
    // the finishing screen, question in the viewport. The SECOND tap saves
    // ("ignoring is safe" costs one deliberate extra tap, never a block) —
    // and, this being a re-import, meets the duplicate sheet.
    await main.locator('.pick-bar').getByRole('button', { name: 'Save match' }).click();
    await expect(main.getByText('This file lists a different SCSA # for you.')).toBeInViewport();
    await expect(page.getByText('Looks like you already saved this match.')).toHaveCount(0);
    await main.locator('.pick-bar').getByRole('button', { name: 'Save match' }).click();
    await expect(page.getByText('Looks like you already saved this match.')).toBeVisible();
    await page.getByRole('button', { name: 'Save Anyway' }).click();
    await expect(main.getByRole('button', { name: '‹ Back', exact: true })).toBeVisible();
    await gotoSection(page, 'Settings');
    await expect(main.getByLabel('SCSA #')).toHaveValue(wrongStored); // ignored = nothing stored

    // Branch 3 setup: a THIRD import — the question returns AGAIN (the
    // ignored save above stored nothing, so there is still a differing
    // number to ask about).
    await gotoTab(page, 'Compete');
    await pasteSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();
    await pickEntry(page, me);
    await main.getByRole('button', { name: 'Continue', exact: true }).click();
    await main.getByLabel('Which gun did you shoot?').selectOption({ index: 1 });
    await expect(main.getByText('This file lists a different SCSA # for you.')).toBeVisible();
    const fileBtn = main.getByRole('button', { name: /^Use the file's #/ });
    await expect(fileBtn).toHaveAttribute('aria-pressed', 'false');

    // Branch 3: Use the file's number -- Settings now hold the file's
    // number, source 'imported' (the shipped adoption precedent, directly).
    // COMPOSITION, caught by this test's own first run: this second save IS
    // a re-import of a match branch 1 already saved, so the duplicate
    // warning (the other half of this build) fires first — exactly as both
    // specs, read together, say it must. Save Anyway proceeds, and the
    // differs write still lands on the save that follows.
    await fileBtn.click();
    // Choosing "Use the file's number" reveals no note — the match-director
    // note belongs to "Keep my number" alone.
    await expect(main.getByText('mention it to the match director', { exact: false })).toHaveCount(0);
    await main.locator('.pick-bar').getByRole('button', { name: 'Save match' }).click();
    await expect(page.getByText('Looks like you already saved this match.')).toBeVisible();
    await page.getByRole('button', { name: 'Save Anyway' }).click();
    await expect(main.getByRole('button', { name: '‹ Back', exact: true })).toBeVisible();
    await gotoSection(page, 'Settings');
    await expect(main.getByLabel('SCSA #')).toHaveValue(me.membership);
    // The PROVENANCE, not just the value: the write records source
    // 'imported', which is what makes Settings show this exact note. A write
    // that stored source 'typed' would leave the value identical and this
    // line is the only thing that would catch it.
    await expect(main.getByText('Remembered from a Steel Challenge import', { exact: false })).toBeVisible();
  });

  test('mutual exclusion: adoption XOR differs, and the three-site reset holds after Back', async ({ page }) => {
    const form = formOf(Guncraft8stage);
    const me = form.entries.find((e) => e.membership.toUpperCase() === 'A185231') as ScsaEntry;
    expect(me).toBeTruthy();

    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');

    // Stored number EMPTY (a fresh demo): the adoption question renders,
    // the differs heading is absent -- asserted on the text on screen,
    // pixels rather than state.
    await pasteSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();
    await pickEntry(page, me);
    await main.getByRole('button', { name: 'Continue', exact: true }).click();
    await main.getByLabel('Which gun did you shoot?').selectOption({ index: 1 });
    await expect(main.getByText(`Remember ${me.membership} as your SCSA #?`, { exact: false })).toBeVisible();
    await expect(main.getByText('This file lists a different SCSA # for you.')).toHaveCount(0);

    // Answer it, then leave via ‹ Back to the shooter list without saving --
    // the tap writes nothing until Save succeeds (spec §4), so it leaves no
    // trace, and this exercises the reset site the spec names for this
    // question ("the same three sites" as the differs answer resets).
    await main.getByRole('button', { name: "Yes — it's mine" }).click();
    await main.getByRole('button', { name: '‹ Back to the shooter list' }).click();

    // Now seed a DIFFERING stored number: the differs question renders
    // instead, the adoption heading is absent.
    const wrongStored = transposed(me.membership);
    await setScsaNumber(page, wrongStored);
    await gotoTab(page, 'Compete');
    await pasteSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();
    await pickEntry(page, me);
    await main.getByRole('button', { name: 'Continue', exact: true }).click();
    await main.getByLabel('Which gun did you shoot?').selectOption({ index: 1 });
    await expect(main.getByText('This file lists a different SCSA # for you.')).toBeVisible();
    await expect(main.getByText(`Remember ${me.membership} as your SCSA #?`, { exact: false })).toHaveCount(0);

    // Select an answer, tap ‹ Back to the shooter list, Continue again --
    // NEITHER differs button is aria-pressed (the reset held; steelPicked
    // and the gun pick themselves are untouched by Back, so no re-pick is
    // needed to reach the question again).
    await main.getByRole('button', { name: /^Keep my #/ }).click();
    await main.getByRole('button', { name: '‹ Back to the shooter list' }).click();
    await main.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(main.getByRole('button', { name: /^Use the file's #/ })).toHaveAttribute('aria-pressed', 'false');
    await expect(main.getByRole('button', { name: /^Keep my #/ })).toHaveAttribute('aria-pressed', 'false');
  });

  test('duplicate warning: the USPSA sample import path, Cancel vs Save Anyway', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');

    const importAndSaveSample = async (gunIndex = 1) => {
      await main.getByRole('button', { name: 'Import…' }).click();
      await page.getByRole('dialog', { name: 'Import' }).getByRole('button', { name: 'Import from PractiScore' }).click();
      await main.getByRole('button', { name: 'Try the sample' }).click();
      await main.getByRole('button', { name: 'Read results' }).click();
      await main.locator('.row-tap').first().click();
      await main.getByLabel('Which gun did you shoot?').selectOption({ index: gunIndex });
      await main.getByRole('button', { name: 'Save match' }).click();
    };

    await importAndSaveSample();
    await expect(main.getByRole('button', { name: '‹ Back', exact: true })).toBeVisible();
    const afterFirst = await readMatches(page);
    expect(afterFirst.length).toBeGreaterThan(0);
    await main.getByRole('button', { name: '‹ Back', exact: true }).click();

    // Re-import the same sample and save again, on a DIFFERENT gun (spec §1:
    // the changed gun is exactly the case the date+name key must still
    // catch) -- the sheet warns, with the signed title.
    await importAndSaveSample(2);
    await expect(page.getByRole('dialog', { name: 'Looks like you already saved this match.' })).toBeVisible();

    // Cancel: the log is unchanged.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(addedSince(afterFirst, await readMatches(page))).toHaveLength(0);

    // Save again, Cancel's sheet reappears, then Save Anyway -- a second
    // record lands (today's behaviour, preserved deliberately, dup spec §5).
    await main.getByRole('button', { name: 'Save match' }).click();
    await page.getByRole('button', { name: 'Save Anyway' }).click();
    await expect(main.getByRole('button', { name: '‹ Back', exact: true })).toBeVisible();
    expect(addedSince(afterFirst, await readMatches(page))).toHaveLength(1);
  });

  test('steel duplicate warning and the pinned bar status line (multi-gun sibling case: see steel-import.spec.ts)', async ({ page }) => {
    // The multi-gun sibling no-sheet case (batch exclusion, dup spec §1 fact
    // 2) is already proven by steel-import.spec.ts's own two-entry
    // multi-gun test staying green -- it saves two same-date, same-name
    // records in ONE save and must trip no warning. Deliberately not
    // duplicated here (budget).
    const form = formOf(Guncraft8stage);
    const me = form.entries.find((e) => e.membership.toUpperCase() === 'A185231') as ScsaEntry;
    expect(me).toBeTruthy();

    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');

    await pasteSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();
    await pickEntry(page, me);
    await main.getByRole('button', { name: 'Continue', exact: true }).click();

    // FINISHING_STEP_PINNED_BAR_MEMO.md, Option 2: the bar is present from
    // the moment the finishing step renders, before a gun is even picked.
    await expect(main.locator('.pick-bar')).toBeVisible();
    await expect(main.locator('.pick-bar-status')).toHaveText('Pick your gun above.');

    await main.getByLabel('Which gun did you shoot?').selectOption({ index: 1 });
    // A gun is picked; the adoption question (stored number empty on a
    // fresh demo) is still unanswered.
    await expect(main.locator('.pick-bar-status')).toHaveText('1 question above needs a look');
    await main.getByRole('button', { name: "Yes — it's mine" }).click();
    await expect(main.locator('.pick-bar-status')).toHaveText('1 match ready to save');

    await main.locator('.pick-bar').getByRole('button', { name: 'Save match' }).click();
    await expect(main.getByRole('button', { name: '‹ Back', exact: true })).toBeVisible();
    const afterFirst = await readMatches(page);
    await main.getByRole('button', { name: '‹ Back', exact: true }).click();

    // Re-import the SAME file, same pick -- the stored number now matches
    // the file's, so neither question asks anything and the bar reads
    // ready as soon as the gun is picked; the duplicate warning still fires
    // on Save.
    await pasteSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();
    await pickEntry(page, me);
    await main.getByRole('button', { name: 'Continue', exact: true }).click();
    // A DIFFERENT gun this time, deliberately: spec §1's rule is that a
    // re-import after picking a different gun is still a duplicate — "the
    // gun is what the shooter changed, not the match". A dupe key quietly
    // narrowed to also require the same firearm would pass a same-gun test
    // and fail only here.
    await main.getByLabel('Which gun did you shoot?').selectOption({ index: 2 });
    await expect(main.locator('.pick-bar-status')).toHaveText('1 match ready to save');
    await main.locator('.pick-bar').getByRole('button', { name: 'Save match' }).click();
    await expect(page.getByRole('dialog', { name: 'Looks like you already saved this match.' })).toBeVisible();

    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(addedSince(afterFirst, await readMatches(page))).toHaveLength(0);
  });

  test('a BLANK match title still collides with a blank-title re-import (the check sees what gets written)', async ({ page }) => {
    // Kills the cold audit's finding 1: the check must compare the
    // trim-or-fallback name the record actually stores ('Steel Challenge
    // Match'), never the raw text-box value — raw '' matches nothing, and
    // the double-count the whole spec exists to prevent would sail through
    // on exactly the blank-title case.
    const form = formOf(Guncraft8stage);
    const me = form.entries.find((e) => e.membership.toUpperCase() === 'A185231') as ScsaEntry;
    expect(me).toBeTruthy();

    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');

    const importBlankTitle = async () => {
      await pasteSteelFile(page, Guncraft8stage);
      await main.getByRole('button', { name: 'Yes — find my entry' }).click();
      await pickEntry(page, me);
      await main.getByRole('button', { name: 'Continue', exact: true }).click();
      await main.getByLabel('What this match is called').fill('');
      await main.getByLabel('Which gun did you shoot?').selectOption({ index: 1 });
      // The adoption question is on screen and deliberately unanswered, so
      // the first Save tap is the nudge (scroll, no save) — the second tap
      // is the one that saves (or meets the duplicate sheet on a re-import).
      await main.locator('.pick-bar').getByRole('button', { name: 'Save match' }).click();
      await expect(main.getByText(/Remember .* as your SCSA #\?/)).toBeInViewport();
      await main.locator('.pick-bar').getByRole('button', { name: 'Save match' }).click();
    };

    await importBlankTitle();
    // First save: no warning (nothing to collide with); the adoption
    // question was left unanswered, which is fine — Save works regardless.
    await expect(main.getByRole('button', { name: '‹ Back', exact: true })).toBeVisible();
    await main.getByRole('button', { name: '‹ Back', exact: true }).click();

    await importBlankTitle();
    const sheet = page.getByRole('dialog', { name: 'Looks like you already saved this match.' });
    await expect(sheet).toBeVisible();
    // The message names the name that was actually written — the fallback,
    // not an empty string.
    await expect(sheet.getByText('Steel Challenge Match', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
});
