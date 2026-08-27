import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Session 135 (26 Aug 2026). Michael reported the debrief's stage heading
// breaking in half at phone width whenever a Weakest/Strongest badge was
// present: "Stage" on one line and "2 Weakest" on the next, on stages 2, 3 and
// 6 of his 2 August match.
//
// The cause was structural rather than cosmetic. The label was the text
// "Stage 2" followed immediately by the badge, and the ONLY line-break
// opportunity inside it was the single space between the word and the number.
// So once the badge widened the line past the phone, that space was the one
// place a break could go -- it did not choose badly, it had no alternative.
//
// This MEASURES rather than eyeballs (rule 36), and the instrument matters.
// "Stage N" now sits in its own white-space: nowrap span. Counting that span's
// client rects does NOT work: JSX renders the word and the number as two text
// nodes, so an unwrapped heading reports TWO rects sitting at the same height.
// What a wrap actually changes is the number of DISTINCT vertical positions, so
// that is what we count. (Caught here by debugging a red test that was right
// about the app and wrong about the check -- the standing lesson that a check
// can cover the right page and still measure the wrong thing.)
// The second assertion is the guard on the fix itself:
// his decision deliberately let the BADGE wrap rather than gluing it on too,
// because an unbreakable block has nowhere to go at 320px -- so we also prove
// we did not trade a wrapping defect for a sideways-overflow one.
//
// Red-proofed against the pre-fix markup: without the nowrap span every one of
// these four cases reports 2 rects.

async function logTwoStageMatch(page: Page, name: string): Promise<void> {
  await seedDemo(page);
  await gotoTab(page, 'Compete');
  await page.getByRole('button', { name: '+ Log Match' }).click();
  await page.getByLabel('What this match is called').fill(name);
  const addStage = page.getByRole('button', { name: '+ Add Stage' });
  await addStage.click();
  await addStage.click();
  const blocks = page.locator('.drill-edit');
  await blocks.nth(0).getByLabel('Points').fill('80');
  await blocks.nth(0).getByLabel('Time (s)').fill('8');
  await blocks.nth(1).getByLabel('Points').fill('60');
  await blocks.nth(1).getByLabel('Time (s)').fill('12');
  await page.getByRole('button', { name: 'Save match' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

for (const width of [320, 390]) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`debrief stage heading stays on one line at ${width}px (${scheme})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: scheme });
      await logTwoStageMatch(page, 'Wrap Test');

      // The badges are what made the line too wide in the first place; if they
      // are absent this test proves nothing, so assert they are there.
      await expect(page.getByText('Weakest', { exact: true })).toBeVisible();
      await expect(page.getByText('Strongest', { exact: true })).toBeVisible();

      const lineCounts = await page.evaluate(() => {
        const main = document.querySelector('main, [role="main"]');
        const out: number[] = [];
        main?.querySelectorAll('.label > span').forEach((el) => {
          if (/^Stage \d+$/.test((el.textContent || '').trim())) {
            const tops = new Set(
              Array.from(el.getClientRects()).map((r) => Math.round(r.top)));
            out.push(tops.size);
          }
        });
        return out;
      });

      // One distinct vertical position per heading = it did not wrap.
      expect(lineCounts.length).toBeGreaterThan(0);
      for (const n of lineCounts) expect(n).toBe(1);

      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}
