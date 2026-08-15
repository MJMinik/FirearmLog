import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';
import { parseScsaForm, groupEntriesByPerson, type ScsaForm, type ScsaEntry } from '../src/lib/scsaForm.ts';
import { Guncraft8stage } from '../tests/fixtures/scsa-guncraft-8stage.ts';
import { RedbrushMultigun } from '../tests/fixtures/scsa-redbrush-multigun.ts';
import { GcfgFourStringInvented } from '../tests/fixtures/scsa-gcfg-four-string-invented.ts';
import { UspsaDegenerateOneString } from '../tests/fixtures/scsa-uspsa-degenerate-one-string.ts';

// End-to-end coverage for the Steel Challenge download-file import
// (src/ui/PractiScoreImport.tsx, build spec 10 Aug 2026, sequence step 6):
// choose the extensionless file -> confirm which match it is -> pick your
// entry (or entries) -> per-entry gun -> save -> the match record(s) in the
// log. The parser and the write module are unit-tested (tests/scsaForm.test.ts,
// tests/scsaImport.test.ts); these prove the SCREEN is wired end to end in a
// real browser — a real file-chooser event in, a real IndexedDB write out.
//
// Expectations are computed from the fixtures at runtime with the app's own
// parser, so the specs keep working if a fixture's anonymised names change.

function formOf(text: string): ScsaForm {
  const r = parseScsaForm(text);
  if (!r.ok) throw new Error('fixture must parse');
  return r.form;
}

const fullName = (e: ScsaEntry) => `${e.firstName} ${e.lastName}`.trim();

/** Reach the import screen the way a shooter does, then load a download file
 *  through the real file chooser. The filename is extensionless on purpose —
 *  that is exactly what PractiScore puts in the Downloads folder (hazard 12). */
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

test.describe('Steel Challenge download-file import', () => {
  test('happy path: file -> confirm -> pick yourself -> save -> the match lands with the published total', async ({ page }) => {
    const form = formOf(Guncraft8stage);
    const me = form.entries.find((e) => e.membership.toUpperCase() === 'A185231') as ScsaEntry;
    expect(me).toBeTruthy();

    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    const matchesCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Matches', exact: true }) });
    // Wait for the list to actually render before counting it — counting an
    // empty not-yet-loaded card reads 0 and poisons the +N assertion at the end.
    await expect(matchesCard.locator('.row-tap').first()).toBeVisible();
    const totalBefore = await matchesCard.locator('.row-tap').count();

    await loadSteelFile(page, Guncraft8stage);

    // Step A — the app says which match this file is BEFORE any picking, from
    // the file's own ER line: name and the date SHOT (never the download date).
    await expect(main.getByRole('heading', { name: form.matchName })).toBeVisible();
    await expect(main.getByText('Shot 2026-08-09', { exact: false })).toBeVisible();
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();

    // Step B — the picker shows the whole field; search it and tap your row.
    await main.getByPlaceholder('Search shooters by name').fill(me.lastName);
    const myRow = main.getByRole('button', { name: new RegExp(fullName(me)) }).first();
    await myRow.click();
    await expect(myRow).toHaveAttribute('aria-pressed', 'true');
    await main.getByRole('button', { name: 'Continue', exact: true }).click();

    // Step C — per-entry details, then save.
    const gunSelect = main.getByLabel('Which gun did you shoot?');
    await gunSelect.selectOption({ index: 1 });
    await main.getByRole('button', { name: 'Save match' }).click();

    // Lands on the new match's own detail screen: the strongest proof a real
    // record was written. The total is the app's own recomputation from the
    // imported runs — and it equals the file's (and PractiScore's published)
    // total, which is refusal 3 visible on screen.
    await expect(main.getByRole('heading', { name: form.matchName, level: 1 })).toBeVisible();
    await expect(main.getByText(`${(me.fileTotal as number).toFixed(2)}s`, { exact: true })).toBeVisible();
    const matchCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Match', exact: true }) });
    await expect(matchCard.locator('.row').filter({ has: page.getByText('Division', { exact: true }) })).toContainText('Open');
    await expect(matchCard.locator('.row', { hasText: 'Type' })).toContainText('Steel Challenge');
    // An official stage shows the app's canonical name, mapped by SC- code.
    await expect(main.getByText('Showdown', { exact: false }).first()).toBeVisible();
    // The SAVED record carries the match date from the file's ER line — a test
    // audit proved the screen could save any date without a failure here.
    await expect(matchCard.locator('.row', { hasText: 'Date' })).toContainText('2026');

    // Back on Compete the list really grew by one.
    await main.getByRole('button', { name: '‹ Back' }).click();
    await expect(matchesCard.locator('.row-tap')).toHaveCount(totalBefore + 1);

    // Decision 4, round trip: the import stored his member number, so loading
    // the same file again lifts his entries to the top unprompted.
    await loadSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();
    const suggest = main.locator('.suggest-block');
    await expect(suggest).toBeVisible();
    await expect(suggest.getByRole('button', { name: new RegExp(fullName(me)) }).first()).toBeVisible();
  });

  test('a no-scores entry is shown greyed and cannot be picked', async ({ page }) => {
    const form = formOf(Guncraft8stage);
    const blocked = form.entries.find((e) => !e.importable) as ScsaEntry;
    expect(blocked).toBeTruthy();
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, Guncraft8stage);
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();
    await main.getByPlaceholder('Search shooters by name').fill(blocked.lastName);
    const row = main.getByRole('button', { name: new RegExp(fullName(blocked)) }).first();
    await expect(row).toHaveAttribute('aria-disabled', 'true');
    await expect(row).toContainText(blocked.blockedReason as string);
    // force: aria-disabled makes Playwright itself refuse the click — but a
    // real finger can still land on the row, and THAT tap is what must do
    // nothing. force delivers the event so the guard is what's being tested.
    await row.click({ force: true });
    // The tap must not select it, and Continue stays disabled with nothing picked.
    await expect(row).toHaveAttribute('aria-pressed', 'false');
    await expect(main.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  });

  test('multi-gun: picking both of one shooter\'s entries saves two match records', async ({ page }) => {
    const form = formOf(RedbrushMultigun);
    const pair = groupEntriesByPerson(form.entries)
      .find((g) => g.length === 2 && g.every((e) => e.importable)) as ScsaEntry[];
    expect(pair).toBeTruthy();

    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    const matchesCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Matches', exact: true }) });
    // Wait for the list to actually render before counting it — counting an
    // empty not-yet-loaded card reads 0 and poisons the +N assertion at the end.
    await expect(matchesCard.locator('.row-tap').first()).toBeVisible();
    const totalBefore = await matchesCard.locator('.row-tap').count();

    await loadSteelFile(page, RedbrushMultigun, 'fa2b1ed5-323c-4d6f-a49b-f1c2f803417a');
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();

    // Both entries carry the same name — the division on the row is what tells
    // them apart (decision 2). Tap both.
    await main.getByPlaceholder('Search shooters by name').fill(pair[0].lastName);
    const rows = main.getByRole('button', { name: new RegExp(fullName(pair[0])) });
    await rows.nth(0).click();
    await rows.nth(1).click();
    await main.getByRole('button', { name: 'Continue with 2 entries' }).click();

    // Two entries, two gun pickers, one save.
    const gunSelects = main.getByLabel('Which gun did you shoot?');
    await expect(gunSelects).toHaveCount(2);
    await gunSelects.nth(0).selectOption({ index: 1 });
    await gunSelects.nth(1).selectOption({ index: 1 });
    await main.getByRole('button', { name: 'Save 2 matches' }).click();

    await expect(main.getByRole('heading', { name: form.matchName, level: 1 })).toBeVisible();
    await main.getByRole('button', { name: '‹ Back' }).click();
    await expect(matchesCard.locator('.row-tap')).toHaveCount(totalBefore + 2);

    // TWO DISTINCT records, not one record twice: visit both new rows and
    // collect their divisions — the pair's two divisions must both be there.
    // (A screen mutant that saved the first entry's fields twice passed the
    // count check; this is what catches it.)
    const expectedDivs = new Set(pair.map((e) => e.storedDivision ?? e.divisionName));
    const seen = new Set<string>();
    for (const idx of [0, 1]) {
      await matchesCard.locator('.row-tap', { hasText: form.matchName }).nth(idx).click();
      const divRow = main.locator('.card')
        .filter({ has: page.getByRole('heading', { name: 'Match', exact: true }) })
        .locator('.row').filter({ has: page.getByText('Division', { exact: true }) });
      seen.add((await divRow.locator('.value').innerText()).trim());
      await main.getByRole('button', { name: '‹ Back' }).click();
      await expect(matchesCard.locator('.row-tap').first()).toBeVisible();
    }
    expect(seen).toEqual(expectedDivs);
  });

  test('editing an imported club-stage match preserves the club name and the declared string count', async ({ page }) => {
    // GCF&G: every stage club-invented, one a genuine FOUR-string stage. The
    // fields that make it score correctly (steelStageName, steelStringsDeclared)
    // must survive an open-and-save in Edit Match — dropping them would silently
    // re-score best-3-of-4 as sum-of-4 (spec §9.5).
    const form = formOf(GcfgFourStringInvented);
    const entry = form.entries.find((e) => e.importable && e.stages.some((s) => s.declaredStrings === 4)) as ScsaEntry;
    expect(entry).toBeTruthy();
    const fourStage = entry.stages.find((s) => s.declaredStrings === 4) as ScsaEntry['stages'][number];

    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, GcfgFourStringInvented, '09d84011-ab39-4d73-a51e-9b6207ec4875');
    await main.getByRole('button', { name: 'Yes — find my entry' }).click();
    // 36 entries in this fixture, so the search box is always present — a
    // conditional here would let a silently-skipped branch hide a regression.
    await main.getByPlaceholder('Search shooters by name').fill(entry.lastName);
    await main.getByRole('button', { name: new RegExp(fullName(entry)) }).first().click();
    await main.getByRole('button', { name: 'Continue', exact: true }).click();
    await main.getByLabel('Which gun did you shoot?').selectOption({ index: 1 });
    await main.getByRole('button', { name: 'Save match' }).click();

    // The detail screen shows the club's own stage name and the correct
    // best-3-of-4 stage time.
    await expect(main.getByText(fourStage.clubStageName, { exact: false }).first()).toBeVisible();
    const totalText = `${(entry.fileTotal as number).toFixed(2)}s`;
    // exact: the coaching read quotes derived seconds in prose, and a loose
    // text match collides with it under strict mode.
    await expect(main.getByText(totalText, { exact: true })).toBeVisible();

    // Open Edit Match, change nothing, save — the round trip must not move a
    // single number or lose the club's stage name.
    await main.getByRole('button', { name: 'Edit' }).click();
    await expect(main.getByRole('button', { name: 'Save changes' })).toBeVisible();
    await main.getByRole('button', { name: 'Save changes' }).click();
    await expect(main.getByText(fourStage.clubStageName, { exact: false }).first()).toBeVisible();
    await expect(main.getByText(totalText, { exact: true })).toBeVisible();
  });

  test('the degenerate USPSA-through-the-Steel-form file is refused with the plain-language reason', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await loadSteelFile(page, UspsaDegenerateOneString, '3237f12b-074d-4ad9-83da-20beb421e5fe');
    await expect(main.getByText("This file can't be imported as a Steel Challenge match", { exact: false })).toBeVisible();
    // Refused before the picker: no confirm step, nothing to select.
    await expect(main.getByRole('button', { name: 'Yes — find my entry' })).toHaveCount(0);
  });

  test('a download file PASTED into the text box routes to the Steel flow (the USPSA reader never sees it)', async ({ page }) => {
    const form = formOf(Guncraft8stage);
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Import…' }).click();
    await page.getByRole('dialog', { name: 'Import' }).getByRole('button', { name: 'Import from PractiScore' }).click();
    await main.getByLabel('Results text').fill(Guncraft8stage);
    await main.getByRole('button', { name: 'Read results' }).click();
    await expect(main.getByRole('heading', { name: form.matchName })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Yes — find my entry' })).toBeVisible();
  });
});
