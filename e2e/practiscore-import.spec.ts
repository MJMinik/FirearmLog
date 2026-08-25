import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';
import { GUNCRAFT_2026_08_02_STAGE1_COMBINED } from '../tests/fixtures/stageScoresGuncraft-2026-08-02.ts';

// End-to-end coverage for the PractiScore importer (src/ui/PractiScoreImport.tsx):
// paste/try-sample -> parse -> pick which shooter is you -> preview -> Save match.
// The parser itself is unit-tested in tests/practiscore.test.ts (parsePractiScore,
// countInDivision, SAMPLE_PRACTISCORE_CSV); these specs prove the SCREEN is wired
// up end to end in a real browser — real navigation in, a real IndexedDB write out.
//
// Note: danger-flows.spec.ts (M-13) already has a thin happy-path smoke test for
// this screen (picks whichever shooter is first, checks the resulting heading).
// These specs pick a specific competitor and assert the per-stage/per-field data
// that actually landed, plus the malformed-input failure path, which had no
// coverage anywhere.

test.describe('PractiScore import', () => {
  test('the doing controls open the screen; the how-tos wait behind disclosures (21 Aug 2026 rearrangement)', async ({ page }) => {
    // Michael, 21 Aug 2026 (session 129): "when you come to a page it just looks
    // like an explanation rather than the place you are doing the import." The
    // paste box and its three buttons now lead the screen; the two how-to
    // walkthroughs sit behind <details>. This asserts the ORDER in pixels (the
    // box inside the first viewport, phone included) and that the instructions
    // are still one tap away, not gone.
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Import…' }).click();
    const sheet = page.getByRole('dialog', { name: 'Import' });
    await sheet.getByRole('button', { name: 'Import from PractiScore' }).click();
    await expect(main.getByRole('heading', { name: 'Import from PractiScore' })).toBeVisible();

    // The doing part is on screen the moment the page opens — no scrolling.
    await expect(main.getByRole('textbox', { name: 'Results text' })).toBeInViewport();
    await expect(main.getByRole('button', { name: 'Load a file' })).toBeInViewport();
    await expect(main.getByRole('button', { name: 'Try the sample' })).toBeInViewport();

    // Both walkthroughs exist, closed, below the actions — and still open.
    const howtos = main.locator('details.import-howto');
    await expect(howtos).toHaveCount(2);
    await expect(main.getByText('On practiscore.com, tap Scores')).not.toBeVisible();
    await howtos.first().locator('summary').click();
    await expect(main.getByText('On practiscore.com, tap Scores')).toBeVisible();
    await howtos.nth(1).locator('summary').click();
    await expect(main.getByText('Old style results', { exact: false }).first()).toBeVisible();
  });

  test('happy path: sample export -> pick a specific shooter -> save -> the match record lands with the right data', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');

    const matchesCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Matches', exact: true }) });
    const matchRows = matchesCard.locator('.row-tap');
    await expect(matchRows.first()).toBeVisible();
    const totalBefore = await matchRows.count();

    // Reach the screen the way a shooter does: Compete -> Import… -> From PractiScore.
    await main.getByRole('button', { name: 'Import…' }).click();
    const sheet = page.getByRole('dialog', { name: 'Import' });
    await sheet.getByRole('button', { name: 'Import from PractiScore' }).click();

    await expect(main.getByRole('heading', { name: 'Import from PractiScore' })).toBeVisible();
    await main.getByRole('button', { name: 'Try the sample' }).click();
    await main.getByRole('button', { name: 'Read results' }).click();

    // Step 2: pick which shooter is you. The sample has 5 competitors — pick
    // Chris Calder specifically (not the #1 finisher) so the assertions below
    // prove the RIGHT row's data flowed through, not just any row's.
    await expect(main.getByRole('heading', { name: 'Spring Classic USPSA Level 1', level: 2 })).toBeVisible();
    await main.getByRole('button', { name: 'Chris Calder' }).click();

    // Step 3: preview shows Chris Calder's real numbers from the sample CSV.
    // ("Division" is filtered by exact label text because "Division place" is
    // a separate row whose text would otherwise also match a loose substring.)
    const resultCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Your result' }) });
    const resultDivisionRow = resultCard.locator('.row').filter({ has: page.getByText('Division', { exact: true }) });
    await expect(resultCard.locator('.row', { hasText: 'Shooter' })).toContainText('Chris Calder');
    await expect(resultDivisionRow).toContainText('Carry Optics');
    await expect(resultCard.locator('.row', { hasText: 'Power factor' })).toContainText('Minor');
    await expect(resultCard.locator('.row', { hasText: 'Overall place' })).toContainText('3 of 5');
    await expect(resultCard.locator('.row', { hasText: 'Division place' })).toContainText('2 of 4');
    await expect(resultCard.locator('.row', { hasText: 'Match %' })).toContainText('84.98%');
    await expect(resultCard.locator('.row', { hasText: 'Stage 3' })).toContainText('79.50%');

    const gunSelect = main.getByLabel('Which gun did you shoot?');
    await gunSelect.selectOption({ index: 1 });
    const gunName = (await gunSelect.locator('option:checked').innerText()).trim();

    await main.getByRole('button', { name: 'Save match' }).click();

    // Lands on the new match's own detail screen — the strongest proof the
    // parse -> preview -> commit path landed a real, viewable record, not just
    // that the Save button was clickable.
    await expect(main.getByRole('heading', { name: 'Spring Classic USPSA Level 1', level: 1 })).toBeVisible();
    const matchCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Match', exact: true }) });
    const matchDivisionRow = matchCard.locator('.row').filter({ has: page.getByText('Division', { exact: true }) });
    await expect(matchDivisionRow).toContainText('Carry Optics');
    await expect(matchDivisionRow).toContainText('Minor');
    await expect(matchCard.locator('.row', { hasText: 'Gun' })).toContainText(gunName);
    await expect(matchCard.locator('.row', { hasText: 'Match percent' })).toContainText('84.98%');
    await expect(matchCard.locator('.row', { hasText: 'Division finish' })).toContainText('2 of 4');
    await expect(matchCard.locator('.row', { hasText: 'Overall finish' })).toContainText('3 of 5');

    const stageCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Stage breakdown' }) });
    await expect(stageCard.locator('.row', { hasText: 'Stage 3' })).toContainText('79.5%');

    // Back on Compete, the Matches list really grew by one and shows the new match.
    await main.getByRole('button', { name: '‹ Back' }).click();
    await expect(main.getByRole('heading', { name: 'Compete' })).toBeVisible();
    await expect(matchRows).toHaveCount(totalBefore + 1);
    await expect(matchesCard.getByText('Spring Classic USPSA Level 1')).toBeVisible();
  });


  // A real paste, not the built-in sample. PractiScore's public results pages
  // carry no download, so the only route a shooter has is Html Results >
  // Overall > Combined and copying the page, which arrives TAB separated,
  // wrapped in the site's own navigation, with the match name and date on a
  // title line. Before 5 August 2026 this threw "no competitor rows" and there
  // was no way at all to import a real match. The text below is faithful to
  // the capture from Michael's own USPSA match on 2 August 2026, with the
  // other competitors' names and member numbers substituted.
  const REAL_PASTE = [
    'Scores', 'Matches', 'Events', 'Clubs', 'Shooters', 'Guns', 'Support',
    'New Results',
    'Gun Craft Practical Shooters 1st Sunday August - 2026-08-02',
    '',
    'Match Results - Combined',
    ['Place', 'Name', 'No.', 'Class', 'Div', 'PF', 'Category', 'Match Pts', 'Match %'].join('\t'),
    ['1', 'Lima, Breno', 'A101033', 'G', 'O', 'Maj', '', '830.6178', '100.0000%'].join('\t'),
    ['3', 'Nunez, Jeff', 'A172032', 'M', 'LO', 'Min', '', '705.7027', '84.9612%'].join('\t'),
    ['5', 'Birrey, Clyde', '', '', 'CO', 'Min', '', '685.4327', '82.5208%'].join('\t'),
    ['68', 'Minik, Michael', 'A100068', 'U', 'O', 'Min', '', '181.5609', '21.8585%'].join('\t'), // member number is a placeholder: this repo is public (see tests/fixtures/practiscore-guncraft-2026-08-02.ts)
    'Search links', 'Scores', 'Matches',
  ].join('\n');

  test('a real tab-separated paste from PractiScore imports end to end', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');

    await main.getByRole('button', { name: 'Import…' }).click();
    const sheet = page.getByRole('dialog', { name: 'Import' });
    await sheet.getByRole('button', { name: 'Import from PractiScore' }).click();

    await main.getByRole('textbox', { name: 'Results text' }).fill(REAL_PASTE);
    await main.getByRole('button', { name: 'Read results' }).click();

    // The title line supplied the match name, and the site's navigation lines
    // did NOT become competitors: four shooters in, four shooters listed.
    await expect(
      main.getByRole('heading', { name: 'Gun Craft Practical Shooters 1st Sunday August', level: 2 }),
    ).toBeVisible();
    await expect(main.getByText('4 shooters')).toBeVisible();

    await main.getByRole('button', { name: 'Minik, Michael' }).click();

    const resultCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Your result' }) });
    await expect(resultCard.locator('.row', { hasText: 'Shooter' })).toContainText('Minik, Michael');
    await expect(resultCard.locator('.row', { hasText: 'Match %' })).toContainText('21.86%');
    await expect(resultCard.locator('.row', { hasText: 'Overall place' })).toContainText('68 of 4');

    // The date came from the title line, so it is the day the match was shot
    // and not the day it was imported.
    await expect(main.getByLabel('Date')).toHaveValue('2026-08-02');

    await main.getByLabel('Which gun did you shoot?').selectOption({ index: 1 });
    await main.getByRole('button', { name: 'Save match' }).click();

    await expect(
      main.getByRole('heading', { name: 'Gun Craft Practical Shooters 1st Sunday August', level: 1 }),
    ).toBeVisible();
  });

  test('the division can be corrected before saving, and the division finish goes with it', async ({ page }) => {
    // Michael's own club scores every shooter as Carry Optics whatever they
    // actually shot, so without this an import writes a division into the log
    // that he never competed in. The division PLACING has to go with it: it
    // was worked out among the shooters PractiScore put in that division, so
    // under a different label it describes a field the match never had.
    //
    // Updated for the division normalisation fix (session 108): the picker now
    // pre-selects the CANONICAL name. For "O" the picker starts on "Open" rather
    // than "O". Selecting "Open" (canonical of "O") is NOT a genuine change and
    // does NOT null the placing (divisionActuallyChanged returns false). To test
    // that a genuine division change nulls the placing, we pick "Limited" instead.
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');

    await main.getByRole('button', { name: 'Import…' }).click();
    await page.getByRole('dialog', { name: 'Import' })
      .getByRole('button', { name: 'Import from PractiScore' }).click();
    await main.getByRole('textbox', { name: 'Results text' }).fill(REAL_PASTE);
    await main.getByRole('button', { name: 'Read results' }).click();
    await main.getByRole('button', { name: 'Minik, Michael' }).click();

    // The picker now starts on the CANONICAL name for the raw "O" scored division.
    const divisionField = main.getByRole('combobox', { name: 'Division' });
    await expect(divisionField).toHaveValue('Open');
    // The short-code note is shown (not the placing-will-be-blank warning).
    await expect(main.getByText(/short code/)).toBeVisible();

    // Select a genuinely different division to verify the placing is nulled.
    await divisionField.selectOption('Limited');
    await expect(main.getByText(/The results scored you as "O"/)).toBeVisible();

    await main.getByLabel('Which gun did you shoot?').selectOption({ index: 1 });
    await main.getByRole('button', { name: 'Save match' }).click();

    await expect(
      main.getByRole('heading', { name: 'Gun Craft Practical Shooters 1st Sunday August', level: 1 }),
    ).toBeVisible();
    const matchCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Match', exact: true }) });
    const savedDivision = matchCard.locator('.row').filter({ has: page.getByText('Division', { exact: true }) });
    await expect(savedDivision).toContainText('Limited');
    await expect(matchCard.locator('.row', { hasText: 'Division finish' })).toHaveCount(0);
    // The overall finish is untouched: it never depended on the division.
    await expect(matchCard.locator('.row', { hasText: 'Overall finish' })).toContainText('68 of 4');
  });

  test('the screen names the click path that actually exists', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Import…' }).click();
    await page.getByRole('dialog', { name: 'Import' })
      .getByRole('button', { name: 'Import from PractiScore' }).click();

    // The old copy said "export or copy the results". No export exists, so the
    // word must not come back: an instruction naming an action the reader
    // cannot perform is the defect this whole change is about. Since the 21 Aug
    // 2026 rearrangement the steps live behind the USPSA disclosure — open it
    // first; the claim under test is what the steps SAY, not where they sit.
    await main.locator('details.import-howto').nth(1).locator('summary').click();
    await expect(main.getByText('Html Results')).toBeVisible();
    // 'Load a file', no extension list: the Steel Challenge download file has
    // NO extension, so naming .csv/.txt would promise a filter that hides the
    // very file the button exists to load (hazard 12) — the same class of
    // defect this test guards against, from the other direction.
    await expect(main.getByRole('button', { name: 'Load a file', exact: true })).toBeVisible();
    await expect(main.getByText(/export or copy the results/i)).toHaveCount(0);
  });

  test('malformed input fails safely: a visible error, no shooter picker, no record created', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');

    const matchesCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Matches', exact: true }) });
    const matchRows = matchesCard.locator('.row-tap');
    await expect(matchRows.first()).toBeVisible();
    const totalBefore = await matchRows.count();

    await main.getByRole('button', { name: 'Import…' }).click();
    const sheet = page.getByRole('dialog', { name: 'Import' });
    await sheet.getByRole('button', { name: 'Import from PractiScore' }).click();
    await expect(main.getByRole('heading', { name: 'Import from PractiScore' })).toBeVisible();

    await main.getByLabel('Results text').fill('just some random text with no results table in it at all');
    await main.getByRole('button', { name: 'Read results' }).click();

    // A visible, plain-language error — not a silent failure or a crash.
    await expect(page.getByRole('alert')).toContainText(/PractiScore/);

    // Still on step 1: no shooter picker, no preview, no way to save.
    await expect(main.getByRole('button', { name: 'Read results' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Save match' })).toHaveCount(0);
    await expect(main.getByText('Which one is you?')).toHaveCount(0);

    // Leaving the screen confirms nothing was written.
    await main.getByRole('button', { name: '‹ Cancel' }).click();
    await expect(main.getByRole('heading', { name: 'Compete' })).toBeVisible();
    await expect(matchRows).toHaveCount(totalBefore);
  });

  // Cold audit H-1 (session 133): a stage-level Combined page carries the same
  // Place/Name/No./Div/PF columns the WHOLE-match parser accepts, so pasting
  // one here used to parse "successfully" — one stage's Stage Pts silently
  // read as the whole match's Match Pts, stages: [] — and the catch-branch
  // route (which only checked the 'review' surface) never fired, so a garbage
  // match saved with no warning. detectStagePageSurface(text) is now consulted
  // on the parse-SUCCESS path too, before the parse result is ever offered.
  test('a stage Combined page pasted into the whole-match importer is refused, not saved as a garbage match (H-1)', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');

    const matchesCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Matches', exact: true }) });
    const matchRows = matchesCard.locator('.row-tap');
    await expect(matchRows.first()).toBeVisible();
    const totalBefore = await matchRows.count();

    await main.getByRole('button', { name: 'Import…' }).click();
    const sheet = page.getByRole('dialog', { name: 'Import' });
    await sheet.getByRole('button', { name: 'Import from PractiScore' }).click();
    await expect(main.getByRole('heading', { name: 'Import from PractiScore' })).toBeVisible();

    await main.getByLabel('Results text').fill(GUNCRAFT_2026_08_02_STAGE1_COMBINED);
    await main.getByRole('button', { name: 'Read results' }).click();

    // A visible, plain-language error naming what the page actually is, and
    // forward-pointing at where a single stage's scores actually go.
    await expect(page.getByRole('alert')).toContainText(/one stage's summary page/);
    await expect(page.getByRole('alert')).toContainText(/Add stage scores/);

    // Still on step 1: no shooter picker, no preview, no way to save.
    await expect(main.getByRole('button', { name: 'Read results' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Save match' })).toHaveCount(0);
    await expect(main.getByText('Which one is you?')).toHaveCount(0);

    // Leaving the screen and reloading confirms nothing was written to disk —
    // not just that the in-memory step never advanced.
    await main.getByRole('button', { name: '‹ Cancel' }).click();
    await expect(main.getByRole('heading', { name: 'Compete' })).toBeVisible();
    await page.reload();
    await gotoTab(page, 'Compete');
    await expect(matchRows).toHaveCount(totalBefore);
  });

  test('empty input never even reaches the parser — Read results stays disabled', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');

    await main.getByRole('button', { name: 'Import…' }).click();
    const sheet = page.getByRole('dialog', { name: 'Import' });
    await sheet.getByRole('button', { name: 'Import from PractiScore' }).click();

    await expect(main.getByRole('button', { name: 'Read results' })).toBeDisabled();
    await main.getByLabel('Results text').fill('   ');
    await expect(main.getByRole('button', { name: 'Read results' })).toBeDisabled();
  });

  test('each step change snaps the page to the top — the suggested row is what you see first', async ({ page }) => {
    // Michael's device tap-test (7 Aug 2026): with a 78-shooter field, "Read
    // results" left the page at the old scroll position, mid-field, and the
    // highlighted "This looks like you" row sat off-screen above. Each step
    // change must land at the top. A big generated field makes step 2 taller
    // than any viewport, so a kept scroll position would be caught, not clamped
    // away by the browser (a short page forces scrollY to 0 on its own, which
    // would make this test pass even without the fix).
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');

    await main.getByRole('button', { name: 'Import…' }).click();
    const sheet = page.getByRole('dialog', { name: 'Import' });
    await sheet.getByRole('button', { name: 'Import from PractiScore' }).click();

    const rows = Array.from({ length: 60 }, (_, i) =>
      `${i + 1},${i + 1},Shooter,Number${String(i + 1).padStart(2, '0')},A${10000 + i},Carry Optics,B,Minor,${(700 - i * 5).toFixed(4)},${(100 - i).toFixed(2)},90.00,90.00,90.00,90.00,90.00`);
    const bigCsv = [
      'Match Name,Big Field Classic',
      'Match Date,2026-08-02',
      'Stages,5',
      '',
      'Overall Place,Division Place,First Name,Last Name,USPSA #,Division,Class,Power Factor,Match Points,Match %,Stage 1 %,Stage 2 %,Stage 3 %,Stage 4 %,Stage 5 %',
      ...rows,
      '',
    ].join('\n');
    await main.getByLabel('Results text').fill(bigCsv);

    // Step 1 must be LONG for this test's guard to bite (see the comment above:
    // a short page forces scrollY to 0 and would pass without the fix). Since
    // the 21 Aug 2026 rearrangement the how-tos are collapsed by default and
    // step 1 is deliberately short — so open one to make the page tall again,
    // then stand at the bottom, the way a real reader of the steps is left.
    await main.locator('details.import-howto').first().locator('summary').click();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    await main.getByRole('button', { name: 'Read results' }).click();
    await expect(main.getByText('Which one is you?')).toBeVisible();
    // The 60-row field is taller than the viewport, so only the fix puts us here.
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

    // Step 2 -> step 3: picking a row far down the field snaps back up too.
    await main.getByRole('button', { name: 'Number55' }).click();
    await expect(main.getByRole('heading', { name: 'Your result' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });
});
