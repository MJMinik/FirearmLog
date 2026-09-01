import { test, expect, type Page, type Locator } from '@playwright/test';
import { seedDemo, gotoTab, gotoSection, contrastOf } from './helpers';
import { parseScsaForm, groupEntriesByPerson, type ScsaForm, type ScsaEntry } from '../src/lib/scsaForm.ts';
import { Guncraft8stage } from '../tests/fixtures/scsa-guncraft-8stage.ts';
import { RedbrushMultigun } from '../tests/fixtures/scsa-redbrush-multigun.ts';

// End-to-end coverage for IMPORT_PICKER_AND_CORRECT_NUMBER_SPEC.md (19 Aug
// 2026): the pick bar and picked-row state (Part A, spec §3), the "Not mine"
// correction box (Part B, spec §2), and the adoption buttons that finally
// look like the question they are before either is tapped (Part C, spec §1).
//
// Idioms mirror e2e/member-number-provenance.spec.ts exactly: the same
// fixture, the same loadSteelFile door, the same seedDemo/gotoTab/gotoSection
// helpers. No test here stores a shooter name (no addNames call) and no test
// searches the field and then reaches into .suggest-block — `mine` is
// computed as `steelQuery.trim() === '' ? groups.filter(isMine) : []`
// (PractiScoreImport.tsx), so typing anything empties the block by design.
// That bug cost a CI cycle on the sibling spec; every pick here is reached
// by searching the FULL field, never the suggestion block.
//
// Every getByLabel('Your SCSA #') here passes { exact: true }, and it is
// load-bearing: getByLabel matches by case-insensitive SUBSTRING, and the
// adoption question labelling the two answer buttons' group — "Remember
// <number> as your SCSA #?" — contains "your SCSA #", so the bare locator
// matches the QUESTION while the correction box is still correctly hidden.
// That collision produced PR #65's nine identical "expected 0, received 1"
// failures (21 Aug 2026): the app was right and the locator was wrong.

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

/** Walk a Steel import from a loaded, confirmed file through to the
 *  finishing step for a GIVEN entry — generalises member-number-provenance
 *  .spec.ts's pickAndFinish, which only ever picked ME, so this file can
 *  also pick a stranger for the correction tests. */
async function pickEntryAndFinish(page: Page, entry: ScsaEntry) {
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Yes — find my entry' }).click();
  await main.getByPlaceholder('Search shooters by name').fill(entry.lastName);
  const row = main.getByRole('button', { name: nameRe(entry) }).first();
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await main.getByRole('button', { name: 'Continue', exact: true }).click();
  await main.getByLabel('Which gun did you shoot?').selectOption({ index: 1 });
}

/** Resolved background/border of a button — pixels, not class names, per the
 *  spec's own §1.5/§6.4(x): "at rest the two answer buttons have IDENTICAL
 *  computed background-colour and border, and neither equals the selected
 *  fill." */
async function styleOf(locator: Locator) {
  return locator.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, border: cs.borderColor };
  });
}

const form = formOf(Guncraft8stage);
/** Michael's own row in the anonymised fixture — the anonymiser leaves his
 *  data untouched on purpose, so A185231 is really there (the transposition
 *  case §2's copy is written against). */
const ME = form.entries.find((e) => e.membership.toUpperCase() === 'A185231') as ScsaEntry;
/** A second, unrelated, importable, numbered shooter — the "stranger" whose
 *  row the shooter picks by mistake, then corrects. */
const STRANGER = form.entries.find((e) =>
  e.importable && e.membership.trim() !== ''
  && e.membership.toUpperCase() !== ME.membership.toUpperCase()
  && e.lastName !== ME.lastName) as ScsaEntry;


/** A third importable, numbered shooter, so the bar's plural branch can be
 *  proved at a count no fixture reaches inside one group. steelPicked is a
 *  FLAT list across groups, so three different people is three picks. */
const THIRD = form.entries.find((e) =>
  e.importable && e.membership.trim() !== ''
  && e.lastName !== ME.lastName && e.lastName !== STRANGER.lastName) as ScsaEntry;

test.describe('picker and correct number (IMPORT_PICKER_AND_CORRECT_NUMBER_SPEC.md, 19 Aug 2026)', () => {
  test.beforeEach(() => {
    expect(ME, 'fixture must contain the A185231 entry').toBeTruthy();
    expect(ME.importable, 'the A185231 entry must be importable').toBe(true);
    expect(STRANGER, 'fixture must contain a second, importable, numbered shooter').toBeTruthy();
  });

  // ---------- Part C (spec §1): the two answer buttons ----------

  test('at rest the two answer buttons are visually identical, and neither looks like the primary action', async ({ page }) => {
    // The assertion that would have gone red on today's live screen (spec
    // §6.4(x)): before this build "Yes — it's mine" wore .button (solid
    // accent) and "Not mine" wore .button.secondary, so this equality was
    // false the instant the question rendered.
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, Guncraft8stage);
    await pickEntryAndFinish(page, ME);

    const yes = main.getByRole('button', { name: "Yes — it's mine" });
    const no = main.getByRole('button', { name: 'Not mine' });
    const save = main.getByRole('button', { name: 'Save match' });
    const [yesStyle, noStyle, saveStyle] = await Promise.all([styleOf(yes), styleOf(no), styleOf(save)]);

    expect(yesStyle.bg, 'the two answers must share one background at rest').toBe(noStyle.bg);
    expect(yesStyle.border, 'the two answers must share one border at rest').toBe(noStyle.border);
    // Neither answer may look like the screen's real primary action.
    expect(yesStyle.bg).not.toBe(saveStyle.bg);
    expect(noStyle.bg).not.toBe(saveStyle.bg);
  });

  test('tapping moves the selected treatment from one button to the other, measured in pixels', async ({ page }) => {
    // Catches: aria-pressed flipping in state and markup with no CSS
    // responding to it at all (spec §0.10) — the exact defect Michael found:
    // "tapping Not mine does nothing." A test that only checks aria-pressed
    // (as the shipped provenance test does) passes on that broken screen;
    // this one cannot.
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, Guncraft8stage);
    await pickEntryAndFinish(page, ME);

    const yes = main.getByRole('button', { name: "Yes — it's mine" });
    const no = main.getByRole('button', { name: 'Not mine' });
    const save = main.getByRole('button', { name: 'Save match' });
    const saveStyle = await styleOf(save);

    await no.click();
    const noPressed = await styleOf(no);
    const yesStillRest = await styleOf(yes);
    expect(noPressed.bg).toBe(saveStyle.bg); // now wears the accent fill
    expect(yesStillRest.bg).not.toBe(saveStyle.bg);
    expect(noPressed.bg).not.toBe(yesStillRest.bg);

    await yes.click();
    const yesPressed = await styleOf(yes);
    const noBackToRest = await styleOf(no);
    expect(yesPressed.bg).toBe(saveStyle.bg);
    expect(noBackToRest.bg).not.toBe(saveStyle.bg);
  });

  // ---------- Part B (spec §2): the correction box ----------

  test('"Not mine" reveals the correction box, and it is never pre-filled', async ({ page }) => {
    // Catches: the box rendered unconditionally (defeating progressive
    // disclosure, spec §2.2) or pre-filled with the file's own number — the
    // very number the shooter just rejected.
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, Guncraft8stage);
    await pickEntryAndFinish(page, ME);
    await expect(main.getByLabel('Your SCSA #', { exact: true })).toHaveCount(0);

    await main.getByRole('button', { name: 'Not mine' }).click();
    const field = main.getByLabel('Your SCSA #', { exact: true });
    await expect(field).toBeVisible();
    // Tap-test finding (21 Aug 2026, item 6): on the phone the box revealed
    // BELOW the fold — visible to the DOM, invisible to the shooter. The
    // reveal now scrolls it into view; this asserts it actually arrives.
    await expect(field).toBeInViewport();
    await expect(main.getByText('What is your SCSA #?')).toBeVisible();
    await expect(field).toHaveValue('');
  });

  test('typing a correction and saving stores it as TYPED — Settings shows no note (the real transposition case)', async ({ page }) => {
    // Catches: a mutant that stamps 'imported' on a correction — that shows
    // the grey provenance note; 'typed' shows none, because the shooter
    // typed it himself. Also catches a write that fires unanswered.
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, Guncraft8stage);
    await pickEntryAndFinish(page, STRANGER); // picked the WRONG row on purpose
    await main.getByRole('button', { name: 'Not mine' }).click();
    await main.getByLabel('Your SCSA #', { exact: true }).fill(ME.membership);
    await main.getByRole('button', { name: 'Save match' }).click();
    await expect(main.getByRole('heading', { name: form.matchName, level: 1 })).toBeVisible();

    await gotoSection(page, 'Settings');
    await expect(main.getByLabel('SCSA #')).toHaveValue(ME.membership);
    await expect(main.getByText("Remembered from a Steel Challenge import — check it's yours.")).toHaveCount(0);

    // Round trip: a second file lifts the corrected number's group, and the
    // STRANGER whose row was actually picked is not affected by it (no name
    // is stored, so nothing else could lift anything).
    await gotoTab(page, 'Compete');
    await loadSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();
    const suggest = main.locator('.suggest-block');
    await expect(suggest).toBeVisible();
    await expect(suggest.getByRole('button', { name: nameRe(ME) }).first()).toBeVisible();
    await expect(suggest.getByRole('button', { name: nameRe(STRANGER) })).toHaveCount(0);

    // Deeper wash follow-up (21 Aug 2026, item 2): the picked row's sub-line
    // ("SCSA # matches" / "Member # differs") must clear AA on the 32% wash —
    // the CSS steps it up from --text-dim (3.8:1 light / 3.0:1 dark there) to
    // full --text; this measures the pixels rather than trusting the rule.
    await suggest.getByRole('button', { name: nameRe(ME) }).first().click();
    const subContrast = (await contrastOf(page, '.row-tap[aria-pressed="true"] .row-sub')).contrast;
    expect(subContrast, 'picked-row sub-line on the deeper wash').toBeGreaterThanOrEqual(4.5);
  });

  test('"Not mine" with the box left blank still stores nothing — extends the shipped case, not a rewrite', async ({ page }) => {
    // Catches: scsaCorrectedNumber accepting a blank draft. The shipped
    // provenance test (c) covers "nothing typed" already; this adds "the box
    // was there and still nothing was typed into it".
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, Guncraft8stage);
    await pickEntryAndFinish(page, ME);
    const notMine = main.getByRole('button', { name: 'Not mine' });
    await notMine.click();
    await expect(notMine).toHaveAttribute('aria-pressed', 'true');
    await expect(main.getByLabel('Your SCSA #', { exact: true })).toHaveValue('');
    await main.getByRole('button', { name: 'Save match' }).click();
    await expect(main.getByRole('heading', { name: form.matchName, level: 1 })).toBeVisible();

    await gotoSection(page, 'Settings');
    await expect(main.getByLabel('SCSA #')).toHaveValue('');
  });

  test('typing a correction, then switching to Yes, stores the FILE\'s number as imported — the draft is discarded', async ({ page }) => {
    // Catches: the correction write firing regardless of the FINAL selection
    // rather than the one on screen at save time. If this regressed, Settings
    // would hold the typed junk instead of the file's real number.
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, Guncraft8stage);
    await pickEntryAndFinish(page, ME);
    await main.getByRole('button', { name: 'Not mine' }).click();
    await main.getByLabel('Your SCSA #', { exact: true }).fill('SC-NOT-THE-REAL-ONE');
    await main.getByRole('button', { name: "Yes — it's mine" }).click();
    // The box hides the moment Yes wins (spec §2.3) — gone entirely.
    await expect(main.getByLabel('Your SCSA #', { exact: true })).toHaveCount(0);
    await main.getByRole('button', { name: 'Save match' }).click();
    await expect(main.getByRole('heading', { name: form.matchName, level: 1 })).toBeVisible();

    await gotoSection(page, 'Settings');
    await expect(main.getByLabel('SCSA #')).toHaveValue(ME.membership);
    await expect(main.getByText("Remembered from a Steel Challenge import — check it's yours.")).toBeVisible();
  });

  test('the typed draft dies with the step, even before it would have saved', async ({ page }) => {
    // Catches: steelCorrectionDraft missing from the "‹ Back to the shooter
    // list" reset site specifically (of the three named in spec §2.8) — the
    // draft would still be sitting in the box on return, contradicting the
    // "neither button pressed" state the same tap also has to restore.
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, Guncraft8stage);
    await pickEntryAndFinish(page, ME);
    await main.getByRole('button', { name: 'Not mine' }).click();
    await main.getByLabel('Your SCSA #', { exact: true }).fill('SC-99999');
    await main.getByRole('button', { name: '‹ Back to the shooter list' }).click();
    await main.getByRole('button', { name: 'Continue', exact: true }).click();

    await expect(main.getByRole('button', { name: 'Not mine' })).toHaveAttribute('aria-pressed', 'false');
    await expect(main.getByLabel('Your SCSA #', { exact: true })).toHaveCount(0);
    // The question is back on screen and unanswered after the reset, so the
    // first Save tap is the nudge (23 Aug 2026) and the second is the save.
    await main.getByRole('button', { name: 'Save match' }).click();
    await main.getByRole('button', { name: 'Save match' }).click();
    await expect(main.getByRole('heading', { name: form.matchName, level: 1 })).toBeVisible();

    await gotoSection(page, 'Settings');
    await expect(main.getByLabel('SCSA #')).toHaveValue('');
  });

  // ---------- Part A (spec §3): the pick bar and the picked row ----------

  test("the bar's three status strings, and Continue's own label following the count", async ({ page }) => {
    // Catches: the bar frozen at "Nothing picked yet" regardless of picks, or
    // Continue enabled with nothing picked.
    const rbForm = formOf(RedbrushMultigun);
    const pair = groupEntriesByPerson(rbForm.entries)
      .find((g) => g.length === 2 && g.every((e) => e.importable)) as ScsaEntry[];
    expect(pair, 'fixture must contain a two-entry, both-importable pair').toBeTruthy();

    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, RedbrushMultigun, 'fa2b1ed5-323c-4d6f-a49b-f1c2f803417a');
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();

    const status = main.locator('.pick-bar-status');
    const continueBtn = main.getByRole('button', { name: 'Continue', exact: true });
    await expect(status).toHaveText('Nothing picked yet. Tap your entry to continue.');
    await expect(continueBtn).toBeDisabled();

    await main.getByPlaceholder('Search shooters by name').fill(pair[0].lastName);
    const rows = main.getByRole('button', { name: nameRe(pair[0]) });
    await rows.nth(0).click();
    await expect(status).toHaveText('1 entry picked.');
    await expect(continueBtn).toBeEnabled();
    await expect(continueBtn).toHaveText('Continue');

    await rows.nth(1).click();
    await expect(status).toHaveText('2 entries picked.');
    // The button's accessible name IS the thing under test here, so relocate
    // by the full label rather than through the exact-'Continue' locator,
    // which by construction cannot match the renamed button.
    await expect(main.getByRole('button', { name: 'Continue with 2 entries' })).toBeVisible();
  });

  test('the bar counts PICKED entries even when the search box hides them — a filtered count would lie', async ({ page }) => {
    // Catches: a status line computed from the visible/filtered rows instead
    // of steelPicked itself (spec §3.1). A wrong implementation reading
    // `visible.length` here would report "Nothing picked yet" while two
    // entries really are picked — the false statement this prevents.
    const rbForm = formOf(RedbrushMultigun);
    const pair = groupEntriesByPerson(rbForm.entries)
      .find((g) => g.length === 2 && g.every((e) => e.importable)) as ScsaEntry[];
    expect(pair, 'fixture must contain a two-entry, both-importable pair').toBeTruthy();

    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, RedbrushMultigun, 'fa2b1ed5-323c-4d6f-a49b-f1c2f803417a');
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();
    const search = main.getByPlaceholder('Search shooters by name');
    await search.fill(pair[0].lastName);
    const rows = main.getByRole('button', { name: nameRe(pair[0]) });
    await rows.nth(0).click();
    await rows.nth(1).click();

    // Filter the field down to something that hides BOTH picked rows.
    await search.fill('zzz-nobody-matches-zzz');
    await expect(main.locator('.row-tap')).toHaveCount(0);
    await expect(main.locator('.pick-bar-status')).toHaveText('2 entries picked.');
  });

  test('Continue is reachable without scrolling the field — the bar is pinned, not appended', async ({ page }) => {
    // The machine-checkable half of tap-test item 1: "you should see it
    // without scrolling at all." Catches: the bar rendered inline at the end
    // of the field instead of position:fixed.
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();

    const box = await main.getByRole('button', { name: 'Continue', exact: true }).boundingBox();
    const viewport = page.viewportSize();
    expect(box, 'Continue must be present without a pick').toBeTruthy();
    expect(viewport).toBeTruthy();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
  });

  test('exactly one button is accessibly named Continue on the picker step', async ({ page }) => {
    // The strict-mode canary made explicit: a second Continue would fail
    // every existing spec that clicks it by name.
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();
    await expect(main.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(1);
  });

  // ---------- Gaps closed after the 19 Aug cold audits ----------

  test('a picked row SHOWS it: the check renders and the row wash changes, in pixels', async ({ page }) => {
    // The HIGH the tests-constrain audit found (19 Aug 2026): .row-check and
    // .row-tap[aria-pressed="true"] had NO coverage anywhere in the repo —
    // exactly the defect class this whole build exists to fix (an attribute
    // set, no pixels behind it), reintroduced one control over. Impostors this
    // kills: the check gated on `suggested` instead of `picked`, the check
    // rendered unconditionally, or the wash rule deleted outright.
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();
    await main.getByPlaceholder('Search shooters by name').fill(ME.lastName);

    const row = main.getByRole('button', { name: nameRe(ME) }).first();
    await expect(row.locator('.row-check')).toHaveCount(0);
    const bgBefore = await row.evaluate((el) => getComputedStyle(el).backgroundColor);

    await row.click();
    await expect(row.locator('.row-check')).toHaveCount(1);
    await expect(row.locator('.row-check')).toHaveText('✓');
    const bgAfter = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bgAfter, 'a picked row must not look identical to an unpicked one').not.toBe(bgBefore);

    // And it goes away again — an impostor that renders the check on every
    // row after any pick would survive the assertions above alone.
    await row.click();
    await expect(row.locator('.row-check')).toHaveCount(0);
    expect(await row.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(bgBefore);
  });

  test('the picked row and the selected answer both clear WCAG AA on their own fill', async ({ page }) => {
    // Spec §1.5 and §3.2 both say "measured, not assumed" and neither was
    // measured until this test (19 Aug cold audit). The 18% wash and the
    // accent fill are proposals in the spec; this is the proof.
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();
    await main.getByPlaceholder('Search shooters by name').fill(ME.lastName);
    await main.getByRole('button', { name: nameRe(ME) }).first().click();

    const rowText = (await contrastOf(page, '.row-tap[aria-pressed="true"] .label')).contrast;
    expect(rowText, 'picked-row text on its wash').toBeGreaterThanOrEqual(4.5);
    const check = (await contrastOf(page, '.row-check')).contrast;
    expect(check, 'the check glyph on the wash').toBeGreaterThanOrEqual(3);

    await main.getByRole('button', { name: 'Continue', exact: true }).click();
    await main.getByLabel('Which gun did you shoot?').selectOption({ index: 1 });
    await main.getByRole('button', { name: 'Not mine' }).click();
    const btn = (await contrastOf(page, '.button.choice[aria-pressed="true"]')).contrast;
    expect(btn, 'selected answer label on its fill').toBeGreaterThanOrEqual(4.5);
  });

  test('a stray tap on Yes and back to Not mine does not cost the shooter what he typed', async ({ page }) => {
    // Spec §2.3: "a stray tap must never cost work". The audit found this
    // promise untested — an impostor that clears the draft in the Yes
    // onClick (a natural-looking tidy-up) passed every test in the suite.
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, Guncraft8stage);
    await pickEntryAndFinish(page, ME);
    await main.getByRole('button', { name: 'Not mine' }).click();
    await main.getByLabel('Your SCSA #', { exact: true }).fill('SC-77777');
    await main.getByRole('button', { name: "Yes — it's mine" }).click();
    await expect(main.getByLabel('Your SCSA #', { exact: true })).toHaveCount(0);
    await main.getByRole('button', { name: 'Not mine' }).click();
    await expect(main.getByLabel('Your SCSA #', { exact: true })).toHaveValue('SC-77777');
  });

  test('Start over clears the typed draft too — the second of the three reset sites', async ({ page }) => {
    // The audit found only the "‹ Back to the shooter list" reset exercised.
    // This covers startOver, which no test clicked at all.
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, Guncraft8stage);
    await pickEntryAndFinish(page, ME);
    await main.getByRole('button', { name: 'Not mine' }).click();
    await main.getByLabel('Your SCSA #', { exact: true }).fill('SC-55555');
    await main.getByRole('button', { name: '‹ Back to the shooter list' }).click();
    await main.getByRole('button', { name: 'Start over' }).click();

    // Start over lands on the import screen's own step 1 (load/paste), not on
    // the Compete tab, so the reload goes straight to the file chooser —
    // walking loadSteelFile's Import… dialog here has no button to click.
    await expect(main.getByRole('heading', { name: 'Import from PractiScore' })).toBeVisible();
    const chooser2 = page.waitForEvent('filechooser');
    await main.getByRole('button', { name: 'Load a file' }).click();
    await (await chooser2).setFiles({ name: '80f0b53b-08b5-4605-af0c-c75c6b9874f8', mimeType: 'text/plain', buffer: Buffer.from(Guncraft8stage, 'utf-8') });
    await pickEntryAndFinish(page, ME);
    await main.getByRole('button', { name: 'Not mine' }).click();
    await expect(main.getByLabel('Your SCSA #', { exact: true })).toHaveValue('');
  });

  test('the bar counts THREE, so the plural string is not a hard-coded two', async ({ page }) => {
    // The audit found no fixture reaching a count above 2, so a literal
    // "2 entries picked." would have passed. steelPicked is a flat list
    // across groups, so three different people is three picks.
    expect(THIRD, 'fixture must contain a third importable numbered shooter').toBeTruthy();
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();
    const search = main.getByPlaceholder('Search shooters by name');
    const status = main.locator('.pick-bar-status');

    for (const e of [ME, STRANGER, THIRD]) {
      await search.fill(e.lastName);
      await main.getByRole('button', { name: nameRe(e) }).first().click();
    }
    await search.fill('');
    await expect(status).toHaveText('3 entries picked.');
    await expect(main.getByRole('button', { name: 'Continue with 3 entries' })).toBeEnabled();
  });

  test('the bar never sits on the last row of the field, even scrolled to the bottom', async ({ page }) => {
    // The audit named the original geometry test the weakest in the set: it
    // measured Continue's own box on an unscrolled render and never checked
    // the promise in spec §3.1 — that the LAST row stays tappable. This
    // scrolls to the end and measures the gap.
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();

    const rows = main.locator('.row-tap');
    const last = rows.last();
    await last.scrollIntoViewIfNeeded();
    const lastBox = await last.boundingBox();
    const barBox = await main.locator('.pick-bar').boundingBox();
    expect(lastBox, 'the last row must resolve').toBeTruthy();
    expect(barBox, 'the bar must be on screen').toBeTruthy();
    expect(lastBox!.y + lastBox!.height,
      'the last row must end above the pinned bar, not under it').toBeLessThanOrEqual(barBox!.y + 1);
  });

  test('the correction box does not steal the keyboard, and its explanation is wired to the field', async ({ page }) => {
    // Spec §2.2 (no autoFocus — a popped-up keyboard would cover the Save
    // button) and the accessibility gap the code audit found: the two
    // explanatory paragraphs were not described-by the input, so a screen
    // reader tabbing to the field heard only the label.
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, Guncraft8stage);
    await pickEntryAndFinish(page, ME);
    await main.getByRole('button', { name: 'Not mine' }).click();

    const field = main.getByLabel('Your SCSA #', { exact: true });
    await expect(field).not.toBeFocused();
    const describedBy = await field.getAttribute('aria-describedby');
    expect(describedBy, 'the explanation must be announced with the field').toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toBeVisible();
  });
});
