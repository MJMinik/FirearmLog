import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoTab, gotoSection } from './helpers';
import { parseScsaForm, type ScsaForm, type ScsaEntry } from '../src/lib/scsaForm.ts';
import { memberNumberVerdict } from '../src/lib/shooterMatch.ts';
import { Guncraft8stage } from '../tests/fixtures/scsa-guncraft-8stage.ts';

// End-to-end coverage for MEMBER_NUMBER_PROVENANCE_SPEC.md (19 Aug 2026,
// session 128). Michael's own tap-test screenshot showed TWO rows under
// "These look like you" on a Steel import — his own (a name match) and a
// stranger's, Don Webster, carrying "SCSA # matches". Don was there because an
// earlier import of a match Michael never attended had SILENTLY written Don's
// number into Michael's settings, and a stored-number match alone lifted a
// Steel row with no name check of any kind.
//
// These six cases are spec §8 item 6 (a–f): the confirmed-adoption question
// (a–c), the pre-build settings shape a stranger's number can sit in with no
// recorded source (d), and the provenance gate itself, typed vs imported (e–f).
//
// WHY (e) AND (f) CAN FAIL: seedDemo restores the demo log, which never writes
// shooterNames — only Settings → Who you are does (grep: SettingsScreen.tsx is
// the sole writer). So in a test that stores no name, the ONLY thing that can
// lift a group is the number, and "was it lifted" is a real question with a
// real answer. If the demo ever starts seeding names, these two cases stop
// discriminating and must be rewritten, not re-pointed.

function formOf(text: string): ScsaForm {
  const r = parseScsaForm(text);
  if (!r.ok) throw new Error('fixture must parse');
  return r.form;
}

const fullName = (e: ScsaEntry) => `${e.firstName} ${e.lastName}`.trim();

/** Escape a name for use inside a RegExp — the fixture keeps real decorations
 *  (parentheses, hyphens) on surnames on purpose. */
const nameRe = (e: ScsaEntry) => new RegExp(fullName(e).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

/** The Steel download-file door, mirroring e2e/steel-import.spec.ts: a real
 *  file-chooser event with the extensionless filename PractiScore produces. */
async function loadSteelFile(page: Page, text: string, name = '80f0b53b-08b5-4605-af0c-c75c6b9874f8') {
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Import…' }).click();
  const sheet = page.getByRole('dialog', { name: 'Import' });
  await sheet.getByRole('button', { name: 'Import from PractiScore' }).click();
  await expect(main.getByRole('heading', { name: 'Import from PractiScore' })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await main.getByRole('button', { name: 'Load a file' }).click();
  await (await chooser).setFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text, 'utf-8') });
}

/** Store a name under Settings → Who you are, the way a shooter does. */
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

/** Type the SCSA # in Settings — the ONLY in-app path that writes source
 *  'typed' (spec §3), which is the whole point of case (e). */
async function setScsaNumber(page: Page, value: string) {
  await gotoSection(page, 'Settings');
  const main = page.getByRole('main');
  const field = main.getByLabel('SCSA #');
  await field.fill(value);
  await field.blur();
  await expect(field).toHaveValue(value);
}

/**
 * Writes a bare SCSA number straight into the settings record, reproducing the
 * ONE shape no in-app flow can produce once this build ships (spec §3): a
 * non-empty `scsaMemberNumber` with NO `scsaMemberNumberSource` key at all.
 * That is the shape of every settings record written before this build — and
 * the shape Michael's own device held, with Don Webster's number in it.
 *
 * Raw IndexedDB rather than the app's own putSettings, matching the house
 * idiom in edit-match-picker.spec.ts and export-csv.spec.ts: under CI=1 these
 * specs run against the BUILT bundle, where a dynamic import of '/src/lib/db.ts'
 * does not resolve. Settings live in the `meta` store under the key 'settings',
 * as { key, value } (db.ts putSettings). The existing value is merged rather
 * than replaced so the demo restore's own settings survive.
 */
async function seedPreBuildScsaNumber(page: Page, value: string) {
  await page.evaluate(async (v) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('firearmlog');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('meta', 'readwrite');
        const os = tx.objectStore('meta');
        const get = os.get('settings');
        get.onsuccess = () => {
          const current = (get.result as { value?: Record<string, unknown> } | undefined)?.value ?? {};
          // Only the number. No source key — that absence IS the fixture.
          os.put({ key: 'settings', value: { ...current, scsaMemberNumber: v } });
        };
        get.onerror = () => reject(get.error);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, value);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible({ timeout: 20_000 });
}

/** Walk a Steel import from a loaded file through to a saved match, stopping
 *  at the finishing step so each test can drive the adoption block itself. */
async function pickAndFinish(page: Page, me: ScsaEntry) {
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Yes — find my entry' }).click();
  await main.getByPlaceholder('Search shooters by name').fill(me.lastName);
  const myRow = main.getByRole('button', { name: nameRe(me) }).first();
  await myRow.click();
  await expect(myRow).toHaveAttribute('aria-pressed', 'true');
  await main.getByRole('button', { name: 'Continue', exact: true }).click();
  await main.getByLabel('Which gun did you shoot?').selectOption({ index: 1 });
}

const form = formOf(Guncraft8stage);
/** Michael's own row in the anonymised fixture — the anonymiser leaves his
 *  data untouched on purpose, so A185231 is really there. */
const ME = form.entries.find((e) => e.membership.toUpperCase() === 'A185231') as ScsaEntry;

test.describe('member-number provenance (MEMBER_NUMBER_PROVENANCE_SPEC.md, session 128)', () => {
  test.beforeEach(() => {
    expect(ME, 'fixture must contain the A185231 entry').toBeTruthy();
    expect(ME.importable, 'the A185231 entry must be importable').toBe(true);
  });

  test('(a) Yes — it\'s mine remembers the number, and Settings says where it came from', async ({ page }) => {
    // Catches: a write path that never asks, or writes without the source key
    // — either of which leaves Settings silently filled (the original defect)
    // or showing the wrong note.
    await seedDemo(page);
    const main = page.getByRole('main');
    await gotoTab(page, 'Compete');
    await loadSteelFile(page, Guncraft8stage);
    await pickAndFinish(page, ME);

    await expect(main.getByText(`Remember ${ME.membership} as your SCSA #?`)).toBeVisible();
    await expect(main.getByText('Skipping this changes nothing about the match', { exact: false })).toBeVisible();
    const yes = main.getByRole('button', { name: "Yes — it's mine" });
    await yes.click();
    await expect(yes).toHaveAttribute('aria-pressed', 'true');
    await main.getByRole('button', { name: 'Save match' }).click();
    await expect(main.getByRole('heading', { name: form.matchName, level: 1 })).toBeVisible();

    await gotoSection(page, 'Settings');
    await expect(main.getByLabel('SCSA #')).toHaveValue(ME.membership);
    await expect(main.getByText("Remembered from a Steel Challenge import — check it's yours.")).toBeVisible();
  });

  test('(b) ignoring the question stores nothing, and the next import asks again', async ({ page }) => {
    // Catches: a write that fires on save regardless of the answer. "Neither"
    // is the spec's honest default and the outcome most likely to regress
    // unnoticed, because nothing on screen changes when it does.
    await seedDemo(page);
    const main = page.getByRole('main');
    await gotoTab(page, 'Compete');
    await loadSteelFile(page, Guncraft8stage);
    await pickAndFinish(page, ME);
    await expect(main.getByText(`Remember ${ME.membership} as your SCSA #?`)).toBeVisible();
    // Neither button tapped, on purpose.
    await main.getByRole('button', { name: 'Save match' }).click();
    await expect(main.getByRole('heading', { name: form.matchName, level: 1 })).toBeVisible();

    await gotoSection(page, 'Settings');
    await expect(main.getByLabel('SCSA #')).toHaveValue('');

    await gotoTab(page, 'Compete');
    await loadSteelFile(page, Guncraft8stage);
    await pickAndFinish(page, ME);
    await expect(main.getByText(`Remember ${ME.membership} as your SCSA #?`)).toBeVisible();
  });

  test('(c) Not mine stores nothing', async ({ page }) => {
    // Catches: a mutant that writes on ANY selection rather than only on Yes.
    await seedDemo(page);
    const main = page.getByRole('main');
    await gotoTab(page, 'Compete');
    await loadSteelFile(page, Guncraft8stage);
    await pickAndFinish(page, ME);
    const notMine = main.getByRole('button', { name: 'Not mine' });
    await notMine.click();
    await expect(notMine).toHaveAttribute('aria-pressed', 'true');
    await main.getByRole('button', { name: 'Save match' }).click();
    await expect(main.getByRole('heading', { name: form.matchName, level: 1 })).toBeVisible();

    await gotoSection(page, 'Settings');
    await expect(main.getByLabel('SCSA #')).toHaveValue('');
  });

  test('(d) the pre-build shape: a stored number with no source never lifts a stranger', async ({ page }) => {
    // THE DON WEBSTER CASE, reproduced exactly. Catches a reader that treats an
    // absent source as liftable — the shape every settings record older than
    // this build carries. If numberMayLift regressed to accept absence, the
    // stranger's row would appear under "These look like you" right here.
    const stranger = form.entries.find((e) =>
      e.importable && e.membership.trim() !== ''
      && e.membership.toUpperCase() !== ME.membership.toUpperCase()
      && e.lastName !== ME.lastName) as ScsaEntry;
    expect(stranger, 'fixture must contain a second, importable, numbered shooter').toBeTruthy();

    await seedDemo(page);
    await seedPreBuildScsaNumber(page, stranger.membership);
    await addNames(page, [`${ME.lastName}, ${ME.firstName}`]);

    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();

    const suggest = main.locator('.suggest-block');
    await expect(suggest).toBeVisible();
    await expect(suggest.getByRole('button', { name: nameRe(ME) }).first()).toBeVisible();
    await expect(suggest.getByRole('button', { name: nameRe(stranger) })).toHaveCount(0);

    // The confirmation mechanism itself still works on the row that IS
    // suggested (by name). Computed rather than assumed: the two real
    // memberships may agree on digits or not, and asserting the wrong one
    // would be a test that passes for the wrong reason.
    const verdict = memberNumberVerdict(stranger.membership, ME.membership);
    expect(verdict, 'the fixture must give a definite verdict here').not.toBeNull();
    await expect(suggest.getByText(verdict === 'match' ? 'SCSA # matches' : 'Member # differs').first()).toBeVisible();
  });

  test('(e) a TYPED number still lifts its group with no name stored — Decision 4\'s net, alive', async ({ page }) => {
    // Catches the isMine gate losing its typed branch, or numberMayLift
    // rejecting 'typed'. No name is stored, so if the group appears it can
    // ONLY be because the number lifted it.
    await seedDemo(page);
    await setScsaNumber(page, ME.membership); // changed + non-empty -> source 'typed'
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();

    const suggest = main.locator('.suggest-block');
    await expect(suggest).toBeVisible();
    await expect(suggest.getByRole('button', { name: nameRe(ME) }).first()).toBeVisible();
    await expect(suggest.getByText('SCSA # matches').first()).toBeVisible();
  });

  test('(f) an ADOPTED number lifts too — the promise the question makes is kept', async ({ page }) => {
    // The question says "entries with this number go to the top of the list".
    // This is the test that the sentence is TRUE. The first cut of this build
    // let only a typed number lift, which made that promise false and quietly
    // retired Decision 4 for anyone who adopts from an import; CI caught it and
    // Michael reversed it on 19 Aug 2026. Reaches the 'imported' state through
    // the app's OWN adoption flow rather than a raw seed, so it also catches an
    // adoption that wrongly stamps 'typed' (the note in phase 1 is the tell).
    await seedDemo(page);
    const main = page.getByRole('main');
    await gotoTab(page, 'Compete');

    // Phase 1 — adopt the shooter's own number with a real Yes tap.
    await loadSteelFile(page, Guncraft8stage);
    await pickAndFinish(page, ME);
    await main.getByRole('button', { name: "Yes — it's mine" }).click();
    await main.getByRole('button', { name: 'Save match' }).click();
    await expect(main.getByRole('heading', { name: form.matchName, level: 1 })).toBeVisible();

    await gotoSection(page, 'Settings');
    await expect(main.getByLabel('SCSA #')).toHaveValue(ME.membership);
    // The source-aware note proves it landed as 'imported', not 'typed'.
    await expect(main.getByText("Remembered from a Steel Challenge import — check it's yours.")).toBeVisible();

    // Phase 2 — a second import with NO name stored. The confirmed number must
    // lift the group all by itself: no name exists to do it, so a suggestion
    // here can only have come from the number.
    await gotoTab(page, 'Compete');
    await loadSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();
    const suggest = main.locator('.suggest-block');
    await expect(suggest).toBeVisible();
    await expect(suggest.getByRole('button', { name: nameRe(ME) }).first()).toBeVisible();
    await expect(suggest.getByText('SCSA # matches').first()).toBeVisible();

    // And the question is not asked again: the field is no longer empty, so
    // the fill-only-when-empty contract has nothing to offer.
    //
    // Tap the row INSIDE the suggestion block rather than searching for it:
    // `mine` is computed as `steelQuery.trim() === '' ? groups.filter(isMine) : []`
    // (PractiScoreImport.tsx), so typing anything into the search box empties
    // the block by design — the sibling of who-you-are.spec.ts's "searching
    // hides the suggestions rather than showing a row twice". A first draft of
    // this test searched first and would have gone red for that reason alone,
    // proving nothing about the adoption question.
    await suggest.getByRole('button', { name: nameRe(ME) }).first().click();
    await main.getByRole('button', { name: 'Continue', exact: true }).click();
    await main.getByLabel('Which gun did you shoot?').selectOption({ index: 1 });
    await expect(main.getByText('as your SCSA #?', { exact: false })).toHaveCount(0);
  });

  test('(g) the source survives a reload — typed stays typed, imported stays imported', async ({ page }) => {
    // Spec §8.7, which had no test at all until a cold audit said so (19 Aug
    // 2026). Catches a source key that is written but not persisted, or one
    // dropped on the way back out of IndexedDB: the note is the only visible
    // difference between the three states, so it is the assertion.
    await seedDemo(page);
    const main = page.getByRole('main');

    // Typed: no note, and still no note after a reload.
    await setScsaNumber(page, ME.membership);
    await expect(main.getByText('check it\'s yours', { exact: false })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible({ timeout: 20_000 });
    await gotoSection(page, 'Settings');
    await expect(main.getByLabel('SCSA #')).toHaveValue(ME.membership);
    await expect(main.getByText('check it\'s yours', { exact: false })).toHaveCount(0);
  });

  test('(h) blurring the SCSA field without editing it never rewrites where the number came from', async ({ page }) => {
    // The caller-level impostor a cold audit found (19 Aug 2026): the
    // "unchanged blur" branch of scsaNumberPatch was unit-tested but its real
    // call site was not, so a hand-rolled patch in SettingsScreen that stamped
    // 'typed' on every save would pass the whole suite. The shooter blurs the
    // field without touching it — the exact gesture — and the record must still
    // say the number came from an import. The note is the observable: a typed
    // number shows none, an imported one names where it came from. It survives
    // a reload, so this is the stored value talking, not React state.
    await seedDemo(page);
    const main = page.getByRole('main');
    await gotoTab(page, 'Compete');

    // Adopt the shooter's own number: lands as 'imported'.
    await loadSteelFile(page, Guncraft8stage);
    await pickAndFinish(page, ME);
    await main.getByRole('button', { name: "Yes — it's mine" }).click();
    await main.getByRole('button', { name: 'Save match' }).click();
    await expect(main.getByRole('heading', { name: form.matchName, level: 1 })).toBeVisible();

    // The gesture: focus the field, blur it, change nothing.
    await gotoSection(page, 'Settings');
    const field = main.getByLabel('SCSA #');
    await expect(field).toHaveValue(ME.membership);
    await field.click();
    await field.blur();
    // Still described as imported — a blur is not an affirmation.
    await expect(main.getByText("Remembered from a Steel Challenge import — check it's yours.")).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible({ timeout: 20_000 });
    await gotoSection(page, 'Settings');
    await expect(main.getByLabel('SCSA #')).toHaveValue(ME.membership);
    // Still described as imported after a reload. Had the blur stamped it
    // 'typed', this note would be gone — that is the whole assertion.
    await expect(main.getByText("Remembered from a Steel Challenge import — check it's yours.")).toBeVisible();
  });
});
