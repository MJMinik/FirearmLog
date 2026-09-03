// The 5 August 2026 defect, in a browser: the shooter changed the division away
// from what PractiScore recorded and could not get back to it, because the
// "(as scored)" option was drawn only while it was the selected value. His
// words: "There was no way to change it back to -0-".
//
// The existing spec changed the division away and asserted the warning appeared.
// It never changed it back, which is precisely the shape of test that could not
// see this. These go the other way, and the save assertion is the one that
// matters most: it proves the record carries what the screen showed.
import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';
import { GUN_CRAFT_2026_08_02 } from '../tests/fixtures/practiscore-guncraft-2026-08-02.ts';

// A small real-shaped capture: PractiScore's own shorthand in the Div and PF
// columns ("O", "Min"), which is what makes the starting value fall outside our
// own lists in the first place.
const PASTE = [
  'Gun Craft Practical Shooters 1st Sunday August - 2026-08-02',
  '',
  'Match Results - Combined',
  ['Place', 'Name', 'No.', 'Class', 'Div', 'PF', 'Category', 'Match Pts', 'Match %'].join('\t'),
  ['1', 'Alder, Robin', 'A100001', 'M', 'LO', 'Min', '', '830.6178', '100.0000%'].join('\t'),
  ['2', 'Brandt, Casey', 'A100002', 'A', 'CO', 'Min', '', '712.2328', '85.7474%'].join('\t'),
  ['3', 'Nolan, Devin', 'A100003', 'U', 'O', 'Min', '', '181.5609', '21.8585%'].join('\t'),
].join('\n') + '\n';

// A comma export that DOES carry a Division Place column. The tab paste above
// cannot exercise the placing at all — PractiScore's combined page has no such
// column, so divisionPlace is null for every competitor in it, and a test named
// for the placing could not observe the thing it was named after.
const PASTE_WITH_DIVISION_PLACE = [
  'Match Name,Spring Classic',
  'Match Date,2026-05-17',
  'Overall Place,Division Place,First Name,Last Name,USPSA #,Division,Class,Power Factor,Match Points,Match %',
  '1,1,Robin,Alder,A100001,LO,M,Minor,830.6178,100.0000%',
  '2,1,Casey,Brandt,A100002,O,A,Minor,712.2328,85.7474%',
  '3,2,Devin,Nolan,A100003,O,U,Minor,181.5609,21.8585%',
].join('\n') + '\n';

async function reachPreview(page: Page) {
  await seedDemo(page);
  await gotoTab(page, 'Compete');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Import…' }).click();
  await page.getByRole('dialog', { name: 'Import' }).getByRole('button', { name: 'Import from PractiScore' }).click();
  await main.locator('textarea').first().fill(PASTE);
  await main.getByRole('button', { name: 'Read results' }).click();
  await main.getByRole('button', { name: 'Nolan, Devin' }).click();
  return main;
}

const divisionField = (main: ReturnType<Page['getByRole']>) =>
  main.locator('label.field').filter({ hasText: 'Division' });
const pfField = (main: ReturnType<Page['getByRole']>) =>
  main.locator('label.field').filter({ hasText: 'Power factor' });

test.describe('PractiScore import — the as-scored value stays reachable', () => {
  test('the division can be changed away and changed BACK to what the results said', async ({ page }) => {
    const main = await reachPreview(page);
    const sel = divisionField(main).locator('select');

    // Since the normalisation branch the picker STARTS on the canonical name
    // ("Open"), not the raw code -- the raw "O" stays reachable as "as scored".
    await expect(sel).toHaveValue('Open');
    await expect(divisionField(main).locator('option', { hasText: 'as scored' })).toHaveCount(1);

    await sel.selectOption('Carry Optics');
    await expect(divisionField(main).locator('.report-note')).toContainText('scored you as "O"');

    // The defect: at this point the option was gone from the DOM.
    await expect(divisionField(main).locator('option[value="O"]')).toHaveCount(1);
    await sel.selectOption('O');
    await expect(sel).toHaveValue('O');
    await expect(divisionField(main).locator('.report-note')).toHaveCount(0);
  });

  test('the as-scored option survives a visit to every division in our list', async ({ page }) => {
    const main = await reachPreview(page);
    const sel = divisionField(main).locator('select');
    for (const stop of ['Carry Optics', 'Open', 'Limited', 'Limited Optics', 'Production', 'Single Stack', 'Revolver', 'PCC', 'Other']) {
      await sel.selectOption(stop);
      await expect(divisionField(main).locator('option[value="O"]'), `stranded at ${stop}`).toHaveCount(1);
    }
    await sel.selectOption('O');
    await expect(sel).toHaveValue('O');
  });

  test('power factor can be changed away and back too', async ({ page }) => {
    const main = await reachPreview(page);
    const sel = pfField(main).locator('select');
    // Changed deliberately by the power-factor-codes fix, mirroring the division
    // assertion above: the picker now STARTS on the canonical word ('Minor') for
    // a 'Min' row, not the raw code -- the raw "Min" stays reachable as "as
    // scored" (fieldOptions), and picking it and coming back both still work.
    await expect(sel).toHaveValue('Minor');
    await expect(pfField(main).locator('option', { hasText: 'as scored' })).toHaveCount(1);
    await sel.selectOption('Min');
    await expect(sel).toHaveValue('Min');
    await sel.selectOption('Minor');
    await expect(sel).toHaveValue('Minor');
  });

  test('going away and back RESTORES the division placing rather than leaving it blanked', async ({ page }) => {
    // This is why the defect mattered beyond the annoyance: the placing is kept
    // only while the division still matches the results, so a value you cannot
    // return to means a placing you cannot recover.
    const main = await reachPreview(page);
    const sel = divisionField(main).locator('select');
    await sel.selectOption('PCC');
    await expect(divisionField(main).locator('.report-note')).toContainText('left blank');
    await sel.selectOption('O');
    await expect(divisionField(main).locator('.report-note')).toHaveCount(0);
  });

  test('a round trip back to the as-scored division SAVES the placing, not a blank', async ({ page }) => {
    // The claim this whole change rests on: the placing is kept only while the
    // division still matches the results, so a value you cannot return to is a
    // placing you cannot recover. Asserting the note disappears is not enough —
    // this reads the record that was actually written.
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Import…' }).click();
    await page.getByRole('dialog', { name: 'Import' }).getByRole('button', { name: 'Import from PractiScore' }).click();
    await main.locator('textarea').first().fill(PASTE_WITH_DIVISION_PLACE);
    await main.getByRole('button', { name: 'Read results' }).click();
    await main.getByRole('button', { name: 'Devin Nolan' }).click();

    const sel = divisionField(main).locator('select');
    await expect(sel).toHaveValue('Open');   // canonical pre-selection (normalisation branch)
    await sel.selectOption('PCC');           // away
    await sel.selectOption('O');             // and back — impossible before the fix
    await expect(sel).toHaveValue('O');

    await main.getByLabel('Which gun did you shoot?').selectOption({ index: 1 });
    await main.getByRole('button', { name: 'Save match' }).click();

    const matchCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Match', exact: true }) });
    const placeRow = matchCard.locator('.row').filter({ has: page.getByText('Division finish', { exact: true }) });
    await expect(placeRow).toContainText('2 of 2');
  });

  test('the saved match records what the dropdown was showing, not the first item in the list', async ({ page }) => {
    const main = await reachPreview(page);
    await divisionField(main).locator('select').selectOption('Open');
    await main.getByLabel('Which gun did you shoot?').selectOption({ index: 1 });
    await main.getByRole('button', { name: 'Save match' }).click();

    const matchCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Match', exact: true }) });
    const divisionRow = matchCard.locator('.row').filter({ has: page.getByText('Division', { exact: true }) });
    await expect(divisionRow).toContainText('Open');
    await expect(divisionRow).not.toContainText('Carry Optics');
  });
});

// power-factor-codes fix (POWER_FACTOR_NORMALISATION_SPEC.md): the mirror of the
// division fix above, run against a real Major shooter. GUN_CRAFT_2026_08_02 is
// the real Overall/Combined page (tests/fixtures) -- "Alder, Robin" placed 1st,
// Open division, PF cell 'Maj', the exact real-file shape the spec's §1 inventory
// counted (Maj x9 on this page).
test.describe('PractiScore import — Major power factor starts selected (power-factor-codes fix)', () => {
  test('a "Maj"-scored shooter: the picker starts on Major, the preview row still reads "Maj", and "Maj (as scored)" stays selectable after switching away', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Import…' }).click();
    await page.getByRole('dialog', { name: 'Import' }).getByRole('button', { name: 'Import from PractiScore' }).click();
    await main.locator('textarea').first().fill(GUN_CRAFT_2026_08_02);
    await main.getByRole('button', { name: 'Read results' }).click();
    await main.getByRole('button', { name: 'Alder, Robin' }).click();

    // The "Your result" preview keeps showing exactly what the results said --
    // 'Maj', never the canonical word -- same honesty shape as the division
    // preview a few rows above it.
    const previewPowerFactorRow = main.locator('.row').filter({ has: page.getByText('Power factor', { exact: true }) });
    await expect(previewPowerFactorRow).toContainText('Maj');

    const sel = pfField(main).locator('select');
    // Since the power-factor-codes fix, the picker STARTS on the canonical word
    // for a Major shooter -- the raw "Maj" stays reachable as "as scored".
    await expect(sel).toHaveValue('Major');
    await expect(pfField(main).locator('option', { hasText: 'as scored' })).toHaveCount(1);

    await sel.selectOption('Maj');
    await expect(sel).toHaveValue('Maj');
    // Switch away and confirm "Maj (as scored)" is still there -- the exact
    // defect this whole file exists to catch, now proven for power factor too.
    await sel.selectOption('Major');
    await expect(pfField(main).locator('option[value="Maj"]')).toHaveCount(1);
    await sel.selectOption('Maj');
    await expect(sel).toHaveValue('Maj');
  });
});
