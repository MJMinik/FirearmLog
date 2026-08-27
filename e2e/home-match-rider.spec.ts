import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// MATCHES RIDE BESIDE THE SESSION COUNT (Michael, 27 Aug 2026).
//
// Home's Sessions tile counts practices and classes. It never counted matches,
// and nothing on screen said so -- a month of three matches and one practice
// read as "1 session". The board's answer was to carry matches alongside rather
// than merge them, the way dry fire already is, because every convention looked
// at makes competition VISIBLE next to training and labelled distinctly, while
// this sport keeps the match a test rather than a practice.
//
// The load-bearing assertion is the one that proves the session number does NOT
// move when a match is added. "A rider appeared" alone would still pass if the
// count had quietly absorbed it too.

/** The Sessions tile's whole readout, e.g. "12 +3 dry +2 matches". */
async function sessionsTile(page: Page): Promise<string> {
  const tile = page.locator('.stat').filter({ has: page.locator('.cap', { hasText: 'Sessions' }) });
  return (await tile.locator('.num').innerText()).replace(/\s+/g, ' ').trim();
}

const leadingNumber = (s: string): number => Number(s.match(/^\d+/)?.[0] ?? -1);
const matchRider = (s: string): number => Number(s.match(/\+(\d+) match/)?.[1] ?? 0);

test('logging a match adds to the match rider and leaves the session count alone', async ({ page }) => {
  await seedDemo(page);
  await gotoTab(page, 'Home');

  const before = await sessionsTile(page);
  const sessionsBefore = leadingNumber(before);
  const matchesBefore = matchRider(before);
  expect(sessionsBefore, 'the tile must start with a session count').toBeGreaterThanOrEqual(0);

  // Log one match, nothing else.
  await gotoTab(page, 'Compete');
  await page.getByRole('button', { name: '+ Log Match' }).click();
  await page.getByLabel('What this match is called').fill(`E2E Rider Match ${Date.now()}`);
  await page.getByRole('button', { name: 'Save match' }).click();

  await gotoTab(page, 'Home');
  await expect
    .poll(async () => matchRider(await sessionsTile(page)), { timeout: 10_000 })
    .toBe(matchesBefore + 1);

  const after = await sessionsTile(page);
  expect(leadingNumber(after), 'a match must NOT be absorbed into the session count')
    .toBe(sessionsBefore);
  expect(after).toMatch(/\+\d+ match(es)?$/);

  // THE BOUNDED WINDOW TOO, and this is here because the first version of this
  // test did not have it. The tile defaults to All time, which takes one branch
  // of rangedActivity; the rolling windows take a completely separate one. A
  // red-proof that merged matches into the session count inside the WINDOWED
  // branch left this test green, which is a test passing for the wrong reason.
  await page.getByLabel('Rounds & sessions').selectOption('6');
  const windowed = await sessionsTile(page);
  expect(matchRider(windowed), 'the window must carry the rider as well')
    .toBeGreaterThanOrEqual(1);
  expect(leadingNumber(windowed) + matchRider(windowed),
    'and must not have absorbed the matches into its session count')
    .toBeLessThanOrEqual(leadingNumber(after) + matchRider(after));

  await page.getByLabel('Rounds & sessions').selectOption('12');
  const twelve = await sessionsTile(page);
  expect(matchRider(twelve)).toBeGreaterThanOrEqual(matchRider(windowed));
  expect(matchRider(twelve), 'no window can report more matches than all time')
    .toBeLessThanOrEqual(matchRider(after));
});

test('one match reads "match", more than one reads "matches"', async ({ page }) => {
  await seedDemo(page);
  await gotoTab(page, 'Home');
  const text = await sessionsTile(page);
  const n = matchRider(text);
  if (n === 0) {
    expect(text, 'with no matches there is no rider at all, not a zero').not.toMatch(/match/);
  } else if (n === 1) {
    expect(text).toMatch(/\+1 match$/);
  } else {
    expect(text).toMatch(/\+\d+ matches$/);
  }
});
