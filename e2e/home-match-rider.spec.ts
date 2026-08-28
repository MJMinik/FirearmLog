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

// ---------------------------------------------------------------------------
// THE RIDERS' LAYOUT (Michael, 27 Aug 2026, session 136).
//
// He reported "+9 matches" wrapping mid-phrase on his iPhone, with a tall gap
// above the stranded word. Two faults, both structural rather than cosmetic:
//   (1) the only break opportunity inside "+9 matches" was its single space --
//       the same shape as the "Stage 2" heading the day before; and
//   (2) a wrapped 13px rider still rode .num's 28px line box, which is what
//       read as double spacing. It was never a margin.
//
// His spec, verbatim: "1 if it will fit, 2 if it does not fit and it skips the
// line" -- riders share a row when there is room, and when there is not, the
// second drops directly UNDER the first. flex-wrap on a row of nowrap spans is
// one rule that satisfies both halves, so both halves are asserted here.
//
// This MEASURES rather than eyeballs (rule 36). Counting an element's client
// rects is the wrong instrument -- JSX renders "+9" and "matches" as separate
// text nodes, so an unwrapped rider already reports two rects at the same
// height. What a wrap changes is the number of DISTINCT vertical positions.
// (That lesson cost session 135 a red test that was right about the app and
// wrong about the check.)
// ---------------------------------------------------------------------------

interface RiderBox { text: string; top: number; left: number; lines: number; }

async function riderBoxes(page: Page): Promise<RiderBox[]> {
  return page.evaluate(() => {
    const tile = Array.from(document.querySelectorAll('.stat')).find((el) =>
      /Sessions/.test(el.querySelector('.cap')?.textContent || ''));
    const row = tile?.querySelector('.stat-riders');
    return Array.from(row?.querySelectorAll(':scope > span') || []).map((el) => {
      const rects = Array.from(el.getClientRects());
      return {
        text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
        top: Math.round(rects[0]?.top ?? -1),
        left: Math.round(rects[0]?.left ?? -1),
        lines: new Set(rects.map((r) => Math.round(r.top))).size,
      };
    });
  });
}

/** The top of the session number itself, to prove the riders got their own row. */
async function numberTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const tile = Array.from(document.querySelectorAll('.stat')).find((el) =>
      /Sessions/.test(el.querySelector('.cap')?.textContent || ''));
    const num = tile?.querySelector('.num');
    const first = num?.firstChild as Text | null;
    if (!first) return -1;
    const r = document.createRange();
    r.selectNodeContents(first);
    return Math.round(r.getBoundingClientRect().top);
  });
}

for (const width of [320, 390, 1440]) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`session riders never split mid-phrase at ${width}px (${scheme})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await seedDemo(page);

      // Guarantee BOTH riders exist. Without both, this test proves nothing
      // about how they sit relative to each other, so it must not pass quietly.
      await gotoTab(page, 'Compete');
      await page.getByRole('button', { name: '+ Log Match' }).click();
      await page.getByLabel('What this match is called').fill(`E2E Layout ${Date.now()}`);
      await page.getByRole('button', { name: 'Save match' }).click();
      await gotoTab(page, 'Home');
      await expect
        .poll(async () => (await riderBoxes(page)).length, { timeout: 10_000 })
        .toBe(2);

      const boxes = await riderBoxes(page);
      expect(boxes[0].text, 'the dry rider must be first').toMatch(/^\+\d+ dry$/);
      expect(boxes[1].text, 'the match rider must be second').toMatch(/^\+\d+ match(es)?$/);

      // (1) NEITHER RIDER MAY BREAK IN HALF. One distinct vertical position per
      // rider. This is the assertion his report was actually about.
      //
      // What actually prevents the split is flex-wrap breaking BETWEEN the two
      // riders; the white-space: nowrap on each span is a second belt and could
      // not be red-proofed (removing it leaves this green at every supported
      // width). Recorded so nobody later reads a green suite as proof of it.
      for (const b of boxes) {
        expect(b.lines, `"${b.text}" must occupy one line, not ${b.lines}`).toBe(1);
      }

      // (2) THE RIDERS SIT ON THEIR OWN ROW, below the session number -- which
      // is what removes the 28px line box that produced the tall gap.
      const numTop = await numberTop(page);
      expect(numTop, 'the session number must be measurable').toBeGreaterThanOrEqual(0);
      expect(boxes[0].top, 'the riders belong on a row of their own, under the number')
        .toBeGreaterThan(numTop);

      // (3) HIS SPEC, FIRST HALF -- "1 if it will fit". At every supported width
      // the two riders SHARE one row, dry first and matches to its right.
      //
      // This was written as an if/else covering both halves of his spec, and
      // measuring the real geometry showed the else branch never executed: at
      // 320, 390 and 1440 the riders always fit on one row, so the wrapped case
      // was dead code -- a test that could not fail, which is this project's
      // signature defect. The wrapped case now has its own test below, where
      // the condition is created deliberately instead of hoped for.
      expect(boxes[1].top, 'at supported widths both riders share one row')
        .toBe(boxes[0].top);
      expect(boxes[1].left, 'sharing a row: the match rider sits to the right')
        .toBeGreaterThan(boxes[0].left);

      // (4) And we did not trade a wrapping defect for a sideways-overflow one.
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}

// "2 IF IT DOES NOT FIT AND IT SKIPS THE LINE" -- the second half of his spec.
//
// This case cannot be reached with today's demo data at any supported width:
// "+282 dry" and "+36 matches" occupy 139px of a 141px content box at 390px,
// so they fit with two pixels to spare. It WILL be reached -- one more digit on
// the dry count overflows the row -- so the rule is proved here by creating the
// condition rather than waiting for a shooter to find it.
//
// 390px is the tight case, NOT 320px, which is the opposite of the intuition
// and was measured rather than assumed. At 320 the stat grid collapses to a
// single 288px column and the riders have room to spare; at 390 it is two
// columns of 173px, leaving a 141px content box. A first attempt at this test
// ran at 320 and could not force a wrap at any count -- it would have shipped
// as a test that cannot fail.
//
// The condition is created honestly: the rider text is lengthened to a count a
// real logbook reaches, and nothing about the layout is touched. What is
// asserted is the CSS contract itself -- when the two riders cannot share a
// row, the second drops BELOW the first and lines up with its LEFT edge, rather
// than hanging at whatever indent the break happened to land on.
test('when the riders cannot share a row, the second lines up under the first', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await seedDemo(page);
  await gotoTab(page, 'Compete');
  await page.getByRole('button', { name: '+ Log Match' }).click();
  await page.getByLabel('What this match is called').fill(`E2E Wrap ${Date.now()}`);
  await page.getByRole('button', { name: 'Save match' }).click();
  await gotoTab(page, 'Home');
  await expect.poll(async () => (await riderBoxes(page)).length, { timeout: 10_000 }).toBe(2);

  const shared = await riderBoxes(page);
  expect(shared[0].top, 'precondition: they start out sharing a row').toBe(shared[1].top);

  // Lengthen the dry count by one digit -- a figure his own log reaches -- which
  // is the smallest change that overflows the row. Measured, not guessed.
  await page.evaluate(() => {
    const tile = Array.from(document.querySelectorAll('.stat')).find((el) =>
      /Sessions/.test(el.querySelector('.cap')?.textContent || ''));
    const first = tile?.querySelector('.stat-riders > span:first-child');
    if (first) first.textContent = '+1,282 dry';
  });

  const wrapped = await riderBoxes(page);
  expect(wrapped.length).toBe(2);
  expect(wrapped[1].top, 'the match rider must drop BELOW, never above')
    .toBeGreaterThan(wrapped[0].top);
  expect(wrapped[1].left, 'and must line up under the dry rider, not hang at an indent')
    .toBe(wrapped[0].left);
  for (const b of wrapped) {
    expect(b.lines, `"${b.text}" must still not split in half`).toBe(1);
  }

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'wrapping must not become sideways overflow').toBeLessThanOrEqual(0);
});
