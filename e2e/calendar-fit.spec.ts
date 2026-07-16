import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Tester-2 F7 (July 16 2026): the Log calendar used to overflow the phone screen
// — the 7-column month grid rendered at ~7/4 of the viewport width, so only
// columns S–W fit and T/F/S were clipped by `.screen{overflow-x:hidden}`. Cause:
// bare `1fr` tracks keep a min-content floor that the cells' aspect-ratio +
// min-height transferred into a min WIDTH. Fixed with `minmax(0, 1fr)` and by no
// longer rendering content-less pad cells (which took an intrinsic ~96px size).

test.describe('Log calendar fits the viewport', () => {
  test('the month grid does not overflow and all seven weekday columns fit', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();

    const grid = page.locator('.cal-grid').last();
    await expect(grid).toBeVisible();

    const m = await grid.evaluate((g) => {
      const cells = [...g.querySelectorAll<HTMLElement>('.cal-cell')];
      const rightMost = Math.max(...cells.map((c) => c.getBoundingClientRect().right));
      // The weekday header row (S M T W T F S) is the OTHER .cal-grid, above.
      const header = document.querySelector('.cal-grid.cal-weekdays');
      const headerLefts = header
        ? [...header.children].map((c) => c.getBoundingClientRect().left)
        : [];
      // The month label ("July 2026") → the 1st's weekday column index (0 = Sun).
      const monthLabel = (document.querySelector('.cal-head h2')?.textContent ?? '').trim();
      const first = new Date(monthLabel.replace(/(\w+)\s+(\d+)/, '$1 1, $2'));
      const firstDow = Number.isNaN(first.getTime()) ? -1 : first.getDay();
      // Group day cells into rows by top edge; record a height per row.
      const byTop = new Map<number, number>();
      for (const c of cells) {
        const r = c.getBoundingClientRect();
        byTop.set(Math.round(r.top), Math.max(byTop.get(Math.round(r.top)) ?? 0, Math.round(r.height)));
      }
      return {
        scrollWidth: g.scrollWidth,
        clientWidth: g.clientWidth,
        rightMost,
        innerWidth: window.innerWidth,
        docScroll: document.documentElement.scrollWidth,
        docClient: document.documentElement.clientWidth,
        day1Left: cells[0]?.getBoundingClientRect().left ?? null,
        firstDow,
        headerLeftForFirstDow: firstDow >= 0 ? (headerLefts[firstDow] ?? null) : null,
        rowHeights: [...byTop.values()],
      };
    });

    // The grid does not scroll sideways within itself...
    expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
    // ...the page has no horizontal overflow...
    expect(m.docScroll).toBeLessThanOrEqual(m.docClient);
    // ...and the rightmost (Saturday) column sits inside the viewport.
    expect(m.rightMost).toBeLessThanOrEqual(m.innerWidth);

    // (a) Day 1 renders UNDER the correct weekday header column — guards the
    // `grid-column-start` offset against being dropped or going off-by-one
    // (which the fit-only checks above would NOT catch). Works for any month.
    expect(m.firstDow).toBeGreaterThanOrEqual(0);
    expect(m.day1Left).not.toBeNull();
    expect(m.headerLeftForFirstDow).not.toBeNull();
    expect(Math.abs((m.day1Left as number) - (m.headerLeftForFirstDow as number))).toBeLessThanOrEqual(2);

    // (b) Every week row is the same height — no row renders taller than the
    // others (the empty-pad-cell height inflation this fix removed).
    expect(m.rowHeights.length).toBeGreaterThan(0);
    expect(Math.max(...m.rowHeights) - Math.min(...m.rowHeights)).toBeLessThanOrEqual(1);
  });
});
