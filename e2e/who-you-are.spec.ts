// "Who you are": the shooter names a household in Settings, and the PractiScore
// import lifts those rows to the top of the field instead of making them scroll
// seventy-eight strangers to find themselves.
//
// The rule the whole feature turns on, and every test here checks some face of
// it: the app SUGGESTS and never decides. Michael, 5 August 2026 — "it has to be
// a selection because sometimes husband and wife or father and child may both
// attend a match and they have to be able to choose between the two."
import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoTab, gotoSection } from './helpers';

const PASTE = [
  'Gun Craft Practical Shooters 1st Sunday August - 2026-08-02',
  '',
  'Match Results - Combined',
  ['Place', 'Name', 'No.', 'Class', 'Div', 'PF', 'Category', 'Match Pts', 'Match %'].join('\t'),
  ['1', 'Alder, Robin', 'A100001', 'M', 'LO', 'Min', '', '830.6178', '100.0000%'].join('\t'),
  ['2', 'Blosser, Ann', 'A100002', 'A', 'LO', 'Min', 'Lady', '712.2328', '85.7474%'].join('\t'),
  ['3', 'Nolan, Devin', 'A100003', 'M', 'CO', 'Min', '', '705.7027', '84.9612%'].join('\t'),
  ['4', 'Okonkwo, Sam', 'A100004', 'A', 'O', 'Maj', '', '692.7507', '83.4019%'].join('\t'),
  ['5', 'Prieto, Alex', 'A100005', 'B', 'LO', 'Min', '', '685.4327', '82.5208%'].join('\t'),
  ['6', 'Quill, Jordan', 'A100006', 'C', 'CO', 'Min', '', '659.9473', '79.4526%'].join('\t'),
  ['7', 'Rasmussen, Kai', 'A100007', 'U', 'O', 'Min', '', '654.1252', '78.7516%'].join('\t'),
  ['8', 'Sato, Reese', 'A100008', 'D', 'LO', 'Min', '', '651.4238', '78.4264%'].join('\t'),
  ['9', 'Blosser, David', 'A100009', 'B', 'PCC', 'Min', '', '649.3026', '78.1710%'].join('\t'),
  ['10', 'Tavares, Noel', 'A100010', 'U', 'CO', 'Min', '', '643.4311', '77.4642%'].join('\t'),
].join('\n') + '\n';

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

async function toShooterList(page: Page) {
  await gotoTab(page, 'Compete');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Import…' }).click();
  await page.getByRole('dialog', { name: 'Import' }).getByRole('button', { name: 'Import from PractiScore' }).click();
  await main.locator('textarea').first().fill(PASTE);
  await main.getByRole('button', { name: 'Read results' }).click();
  await expect(main.getByText('Which one is you?')).toBeVisible();
  return main;
}

/** Every shooter row on the pick step, in the order they appear on screen. */
const rowOrder = (main: ReturnType<Page['getByRole']>) =>
  main.locator('.row-tap').evaluateAll((els) =>
    els.map((e) => (e.querySelector('.label')?.childNodes[0]?.textContent || '').trim()));

// NOTE: test.use({ viewport, colorScheme }) below OVERRIDES whatever the project
// supplies, so these specs are identical under --project=desktop and
// --project=mobile. Run them once, on either. The three widths and two schemes
// here are the rule-36 coverage; the projects add nothing on top of it.
for (const vp of [{ w: 320, h: 720 }, { w: 390, h: 844 }, { w: 1440, h: 900 }]) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`${vp.w} / ${scheme}`, () => {
      test.use({ viewport: { width: vp.w, height: vp.h }, colorScheme: scheme });

      test('with no names stored the field is exactly as it always was', async ({ page }) => {
        await seedDemo(page);
        const main = await toShooterList(page);
        await expect(main.getByText('This looks like you')).toHaveCount(0);
        await expect(main.getByText('These look like you')).toHaveCount(0);
        expect(await rowOrder(main)).toEqual([
          'Alder, Robin', 'Blosser, Ann', 'Nolan, Devin', 'Okonkwo, Sam', 'Prieto, Alex',
          'Quill, Jordan', 'Rasmussen, Kai', 'Sato, Reese', 'Blosser, David', 'Tavares, Noel',
        ]);
        // And it says where to fix that.
        await expect(main.getByText(/Settings → Who you are/)).toBeVisible();
      });

      test('one name lifts exactly that row, selects nothing, and leaves the field whole', async ({ page }) => {
        await seedDemo(page);
        await addNames(page, ['David Blosser']);   // stored First Last; the page writes Last, First
        const main = await toShooterList(page);
        await expect(main.getByText('This looks like you')).toBeVisible();
        const order = await rowOrder(main);
        expect(order[0]).toBe('Blosser, David');
        // The whole field is still there underneath — the suggestion is a copy at
        // the top, not a filter.
        expect(order.length).toBe(11);
        expect(order.slice(1)).toEqual([
          'Alder, Robin', 'Blosser, Ann', 'Nolan, Devin', 'Okonkwo, Sam', 'Prieto, Alex',
          'Quill, Jordan', 'Rasmussen, Kai', 'Sato, Reese', 'Blosser, David', 'Tavares, Noel',
        ]);
        // Nothing has been chosen on the shooter's behalf.
        await expect(main.getByRole('heading', { name: 'Your result' })).toHaveCount(0);
      });

      test('the household case: two names, two suggestions, each readable apart', async ({ page }) => {
        await seedDemo(page);
        await addNames(page, ['Blosser, David', 'Ann Blosser']);
        const main = await toShooterList(page);
        await expect(main.getByText('These look like you')).toBeVisible();
        const order = await rowOrder(main);
        expect(order.slice(0, 2)).toEqual(['Blosser, Ann', 'Blosser, David']);
        // Still a choice: neither is selected, and each carries its own division
        // and percentage so they can be told apart at a glance.
        await expect(main.getByRole('heading', { name: 'Your result' })).toHaveCount(0);
        const first = main.locator('.row-tap').first();
        await expect(first).toContainText('LO');
        await expect(main.locator('.row-tap').nth(1)).toContainText('PCC');
      });

      test('tapping a suggestion picks that shooter and nobody else', async ({ page }) => {
        await seedDemo(page);
        await addNames(page, ['David Blosser']);
        const main = await toShooterList(page);
        await main.locator('.row-tap').first().click();
        const card = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Your result' }) });
        await expect(card.locator('.row').filter({ has: page.getByText('Shooter', { exact: true }) })).toContainText('Blosser, David');
        await expect(card.locator('.row').filter({ has: page.getByText('Overall place', { exact: true }) })).toContainText('9 of 10');
      });

      test('a stored name matching nobody changes nothing, and says so', async ({ page }) => {
        await seedDemo(page);
        await addNames(page, ['Nobody, Atall']);
        const main = await toShooterList(page);
        await expect(main.getByText('This looks like you')).toHaveCount(0);
        expect((await rowOrder(main))[0]).toBe('Alder, Robin');
        // The case a mistyped stored name lands in — it has to be pointed at.
        await expect(main.getByText(/None of the names in Settings/)).toBeVisible();
      });

      test('two different people are never merged by swapping the words of a name', async ({ page }) => {
        // Storing one order must not suggest the other. The field has
        // "Blosser, Ann" and "Blosser, David"; storing "Ann, Blosser" names
        // nobody in it.
        await seedDemo(page);
        await addNames(page, ['Ann, Blosser']);
        const main = await toShooterList(page);
        await expect(main.getByText('This looks like you')).toHaveCount(0);
        expect((await rowOrder(main))[0]).toBe('Alder, Robin');
      });

      test('searching hides the suggestions rather than showing a row twice', async ({ page }) => {
        await seedDemo(page);
        await addNames(page, ['David Blosser']);
        const main = await toShooterList(page);
        await main.getByPlaceholder('Search shooters by name').fill('Blosser');
        await expect(main.getByText('This looks like you')).toHaveCount(0);
        expect(await rowOrder(main)).toEqual(['Blosser, Ann', 'Blosser, David']);
      });
    });
  }
}

test('a name added in Settings survives leaving the screen, and Remove takes it away', async ({ page }) => {
  await seedDemo(page);
  await addNames(page, ['Minik, Michael']);
  await gotoTab(page, 'Compete');
  await gotoSection(page, 'Settings');
  const main = page.getByRole('main');
  await expect(main.getByText('Minik, Michael', { exact: true })).toBeVisible();
  await main.getByRole('button', { name: 'Remove Minik, Michael' }).click();
  await expect(main.getByText('Minik, Michael', { exact: true })).toHaveCount(0);
  await gotoTab(page, 'Compete');
  await gotoSection(page, 'Settings');
  await expect(main.getByText('Minik, Michael', { exact: true })).toHaveCount(0);
});

test('the same person typed twice in two spellings is stored once', async ({ page }) => {
  await seedDemo(page);
  await addNames(page, ['Minik, Michael']);
  const main = page.getByRole('main');
  await main.getByLabel('Name as it appears in results').fill('Michael Minik');
  await main.getByRole('button', { name: 'Add name', exact: true }).click();
  await expect(main.getByRole('button', { name: /^Remove / })).toHaveCount(1);
});

test('a name that is only punctuation is refused rather than stored as a permanent no-op', async ({ page }) => {
  await seedDemo(page);
  await gotoSection(page, 'Settings');
  const main = page.getByRole('main');
  await main.getByLabel('Name as it appears in results').fill('###');
  await main.getByRole('button', { name: 'Add name', exact: true }).click();
  await expect(main.getByText('That does not look like a name.')).toBeVisible();
  await expect(main.getByRole('button', { name: /^Remove / })).toHaveCount(0);
});

test('a search query does not survive Start over and strand the next paste', async ({ page }) => {
  // Measured on the first version: a leftover query filtered a shorter second
  // field down to nothing AND switched the suggestions off, with the search box
  // itself hidden because it only appears above eight shooters.
  await seedDemo(page);
  await addNames(page, ['David Blosser']);
  const main = await toShooterList(page);
  await main.getByPlaceholder('Search shooters by name').fill('Tavares');
  await main.getByRole('button', { name: 'Start over' }).click();
  const short = [
    'Small Match - 2026-08-02', '', 'Match Results - Combined',
    ['Place', 'Name', 'No.', 'Class', 'Div', 'PF', 'Category', 'Match Pts', 'Match %'].join('\t'),
    ['1', 'Alder, Robin', 'A1', 'M', 'LO', 'Min', '', '100.0000', '100.0000%'].join('\t'),
    ['2', 'Blosser, David', 'A2', 'B', 'PCC', 'Min', '', '90.0000', '90.0000%'].join('\t'),
  ].join('\n') + '\n';
  await main.locator('textarea').first().fill(short);
  await main.getByRole('button', { name: 'Read results' }).click();
  const order = await rowOrder(main);
  expect(order.length).toBeGreaterThan(0);
  expect(order[0]).toBe('Blosser, David');   // the suggestion is back on
});
