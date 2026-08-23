import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoTab, gotoSection } from './helpers';
import { GUN_CRAFT_2026_08_02 } from '../tests/fixtures/practiscore-guncraft-2026-08-02.ts';
import { parseScsaForm, type ScsaForm, type ScsaEntry } from '../src/lib/scsaForm.ts';
import { Guncraft8stage } from '../tests/fixtures/scsa-guncraft-8stage.ts';

// End-to-end coverage for the member-number fields added to Settings -> Who
// you are (MEMBER_NUMBER_SPEC.md, session 127): a USPSA # and an SCSA # the
// shooter types once, kept ONLY as a confirmation beside a name match on
// import — never a key.
//
// The import-suggestion sub-tests reuse the real, anonymised Gun Craft
// capture (tests/fixtures/practiscore-guncraft-2026-08-02.ts) that
// who-you-are.spec.ts already exercises through the same screen, rather than
// inventing paste text or competitor data of their own — every name and
// member number in that fixture is synthetic (see its own header comment).
// Competitor row 1, "Alder, Robin" / A112912, is the one exercised below.

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

async function setUspsaNumber(page: Page, value: string) {
  await gotoSection(page, 'Settings');
  const main = page.getByRole('main');
  const field = main.getByLabel('USPSA #');
  await field.fill(value);
  await field.blur();
  await expect(field).toHaveValue(value);
}

async function setScsaNumber(page: Page, value: string) {
  await gotoSection(page, 'Settings');
  const main = page.getByRole('main');
  const field = main.getByLabel('SCSA #');
  await field.fill(value);
  await field.blur();
  await expect(field).toHaveValue(value);
}

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

/** Pick one entry in the Steel picker by name and save it with the first gun.
 *  `adopt` taps "Yes — it's mine" on the adoption question first: since
 *  MEMBER_NUMBER_PROVENANCE_SPEC.md (19 Aug 2026, session 128) a Steel save
 *  NEVER stores a member number on its own, so a caller that wants the number
 *  remembered has to say so, exactly as a shooter does. */
async function saveSteelEntry(page: Page, entry: ScsaEntry, opts: { adopt?: boolean; expectDupe?: boolean } = {}) {
  const main = page.getByRole('main');
  await main.getByPlaceholder('Search shooters by name').fill(entry.lastName);
  const row = main.getByRole('button', { name: nameRe(entry) }).first();
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await main.getByRole('button', { name: 'Continue', exact: true }).click();
  await main.getByLabel('Which gun did you shoot?').selectOption({ index: 1 });
  if (opts.adopt) {
    const yes = main.getByRole('button', { name: "Yes — it's mine" });
    await expect(yes).toBeVisible();
    await yes.click();
  }
  await main.getByRole('button', { name: 'Save match' }).click();
  if (opts.expectDupe) {
    // A second import of the same file now meets the duplicate warning
    // (DUPLICATE_IMPORT_DETECTION_SPEC.md, 23 Aug 2026) — same date + same
    // name IS the signal, whoever is picked. Save Anyway is the shooter's
    // stated choice and proceeds exactly as before the warning existed.
    await expect(page.getByText('Looks like you already saved this match.')).toBeVisible();
    await page.getByRole('button', { name: 'Save Anyway' }).click();
  }
  // The new match's own detail screen is the proof the write landed.
  await expect(main.getByRole('button', { name: '‹ Back' })).toBeVisible();
}

async function toShooterList(page: Page, paste: string) {
  await gotoTab(page, 'Compete');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Import…' }).click();
  await page.getByRole('dialog', { name: 'Import' }).getByRole('button', { name: 'Import from PractiScore' }).click();
  await main.locator('textarea').first().fill(paste);
  await main.getByRole('button', { name: 'Read results' }).click();
  await expect(main.getByText('Which one is you?')).toBeVisible();
  return main;
}

test.describe('member numbers in Who you are', () => {
  test('a typed USPSA # persists after reload', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Settings');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Who you are' })).toBeVisible();

    const field = main.getByLabel('USPSA #');
    await field.fill('A185231');
    await field.blur();
    await expect(field).toHaveValue('A185231');

    // The save fires from onBlur with nothing on screen to await, so a
    // one-shot reload can race a write that hasn't landed. Retry the whole
    // reload-and-read instead of sleeping a fixed time — it passes the moment
    // the write is really there, and a genuinely lost write still fails.
    await expect(async () => {
      await page.reload();
      await gotoSection(page, 'Settings');
      await expect(main.getByLabel('USPSA #')).toHaveValue('A185231', { timeout: 2000 });
    }).toPass({ timeout: 15000 });
  });

  test('a stored USPSA # matching a suggested row shows "USPSA # matches"', async ({ page }) => {
    // Alder, Robin's real member number in the fixture (row 1).
    await seedDemo(page);
    await addNames(page, ['Robin Alder']);
    await setUspsaNumber(page, 'A112912');
    const main = await toShooterList(page, GUN_CRAFT_2026_08_02);
    const suggestBlock = main.locator('.suggest-block');
    await expect(suggestBlock).toBeVisible();
    await expect(suggestBlock.getByText('USPSA # matches')).toBeVisible();
    await expect(suggestBlock.getByText('Member # differs')).toHaveCount(0);
  });

  test('a deliberately transposed stored USPSA # shows "Member # differs"', async ({ page }) => {
    // Two digits of Alder, Robin's real A112912 swapped (A112192) — the same
    // shape of club-entered typo MEMBER_NUMBER_SPEC.md §6 was written against,
    // not a fabricated number.
    await seedDemo(page);
    await addNames(page, ['Robin Alder']);
    await setUspsaNumber(page, 'A112192');
    const main = await toShooterList(page, GUN_CRAFT_2026_08_02);
    const suggestBlock = main.locator('.suggest-block');
    await expect(suggestBlock).toBeVisible();
    await expect(suggestBlock.getByText('Member # differs')).toBeVisible();
    await expect(suggestBlock.getByText('USPSA # matches')).toHaveCount(0);
  });

  test('no stored USPSA # renders neither confirmation text', async ({ page }) => {
    await seedDemo(page);
    await addNames(page, ['Robin Alder']);
    const main = await toShooterList(page, GUN_CRAFT_2026_08_02);
    const suggestBlock = main.locator('.suggest-block');
    await expect(suggestBlock).toBeVisible();
    await expect(suggestBlock.getByText('USPSA # matches')).toHaveCount(0);
    await expect(suggestBlock.getByText('Member # differs')).toHaveCount(0);
  });

  test('a CONFIRMED Steel import fills an empty SCSA # and a second import never overwrites it', async ({ page }) => {
    // Closes the tests-constrain finding of 18 Aug 2026: the fill-only-when-
    // empty guard (spec §3, promised as a test in §8.3) had no test that
    // exercised its real call site — deleting the guard passed the suite.
    // This drives the whole Steel save path twice: the first import fills the
    // blank field with the picked entry's own number; the second, picking a
    // DIFFERENT shooter, must leave it untouched.
    //
    // UPDATED 19 Aug 2026 (session 128, MEMBER_NUMBER_PROVENANCE_SPEC.md): the
    // first save now has to ANSWER the adoption question — a Steel import no
    // longer stores a number silently, which is the whole point of that build.
    // Before this edit the test asserted the old silent write and would have
    // gone red. The second save deliberately does NOT pass adopt: with a value
    // now stored, the question must not even be asked, and the `adopt: true`
    // path asserts the button is visible, so passing it there would fail —
    // which is itself the fill-only-when-empty contract being checked.
    const form = formOf(Guncraft8stage);
    const me = form.entries.find((e) => e.membership.toUpperCase() === 'A185231') as ScsaEntry;
    const other = form.entries.find((e) =>
      e.importable && e.membership && e.membership.toUpperCase() !== 'A185231' && e.lastName !== me.lastName) as ScsaEntry;
    expect(me).toBeTruthy();
    expect(other).toBeTruthy();

    await seedDemo(page);
    await addNames(page, [`${me.lastName}, ${me.firstName}`]);
    const main = page.getByRole('main');
    await expect(main.getByLabel('SCSA #')).toHaveValue('');

    await gotoTab(page, 'Compete');
    await loadSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();
    // The silence case (spec §5): suggested by name with NO stored number —
    // no sub-line at all, in either wording.
    const suggest = main.locator('.suggest-block');
    await expect(suggest).toBeVisible();
    await expect(suggest.getByText('SCSA # matches')).toHaveCount(0);
    await expect(suggest.getByText('Member # differs')).toHaveCount(0);
    await saveSteelEntry(page, me, { adopt: true });

    await gotoSection(page, 'Settings');
    await expect(main.getByLabel('SCSA #')).toHaveValue(me.membership);

    await gotoTab(page, 'Compete');
    await loadSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();
    await saveSteelEntry(page, other, { expectDupe: true });

    await gotoSection(page, 'Settings');
    await expect(main.getByLabel('SCSA #')).toHaveValue(me.membership);
  });

  test('the Steel picker notes when a suggested row\'s number matches or differs', async ({ page }) => {
    // Closes the second tests-constrain finding: spec §5 promises the same
    // match/differs note on Steel suggestion rows, and no test constrained it.
    const form = formOf(Guncraft8stage);
    const me = form.entries.find((e) => e.membership.toUpperCase() === 'A185231') as ScsaEntry;
    expect(me).toBeTruthy();

    // Match: the stored number alone lifts the group (Decision 4) and the
    // note confirms it.
    await seedDemo(page);
    await setScsaNumber(page, me.membership);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();
    const suggest = main.locator('.suggest-block');
    await expect(suggest).toBeVisible();
    await expect(suggest.getByText('SCSA # matches').first()).toBeVisible();
    await expect(suggest.getByText('Member # differs')).toHaveCount(0);

    // Differs: a transposed stored number, with the row suggested by NAME so
    // there is a suggestion to annotate (a number never suggests by itself).
    const digits = me.membership.replace(/\D+/g, '');
    const transposed = me.membership.replace(digits, digits.slice(0, -2) + digits.slice(-1) + digits.slice(-2, -1));
    await setScsaNumber(page, transposed);
    await addNames(page, [`${me.lastName}, ${me.firstName}`]);
    await gotoTab(page, 'Compete');
    await loadSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();
    await expect(suggest).toBeVisible();
    await expect(suggest.getByText('Member # differs').first()).toBeVisible();
    await expect(suggest.getByText('SCSA # matches')).toHaveCount(0);
  });
});
