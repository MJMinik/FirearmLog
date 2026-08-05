// The "this looks like you" block has to READ as an answer, not as another
// section heading. Michael, 5 August 2026, on the first version: "It worked but
// is too subtle, it should be highlighted."
//
// Subtlety is not directly testable, but the things that produce it are: the
// block has to be visibly distinct from the card it sits in, its label has to be
// a different colour from the ordinary headings, and all of that has to clear
// WCAG AA in both schemes at every width. MEASURED from resolved pixels, never
// asserted as a CSS property — a property can be right while the rendered
// contrast is not.
import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoTab, gotoSection } from './helpers';

const PASTE = [
  'Gun Craft Practical Shooters 1st Sunday August - 2026-08-02', '', 'Match Results - Combined',
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

async function toSuggestion(page: Page) {
  await seedDemo(page);
  await gotoSection(page, 'Settings');
  const main = page.getByRole('main');
  await main.getByLabel('Name as it appears in results').fill('David Blosser');
  await main.getByRole('button', { name: 'Add name', exact: true }).click();
  await expect(main.getByText('David Blosser', { exact: true })).toBeVisible();
  await gotoTab(page, 'Compete');
  await main.getByRole('button', { name: 'Import…' }).click();
  await page.getByRole('dialog', { name: 'Import' }).getByRole('button', { name: 'Import from PractiScore' }).click();
  await main.locator('textarea').first().fill(PASTE);
  await main.getByRole('button', { name: 'Read results' }).click();
  await expect(main.locator('.suggest-block')).toBeVisible();
  return main;
}

/** Contrast of resolved colours, walking up for a transparent background.
 *  A real function, not a string: Playwright evaluates a STRING page function as
 *  a bare expression and never passes the argument, so the first version of this
 *  measured nothing and reported six contrast failures that did not exist. */
async function contrastOf(page: Page, sel: string) {
  const out = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const lum = (c: number[]) => {
      const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    // A computed colour is not always rgb(): color-mix() resolves to
    // `color(srgb 0.99 0.95 0.9)`, whose channels run 0–1. Reading those as
    // 0–255 made a pale amber wash measure as near-black, so black text on it
    // came back at 1.01:1 — a contrast FAILURE reported against a design that
    // was fine, and passing in dark mode purely by luck. Scale when the syntax
    // says to.
    const parse = (t: string) => {
      const n = (t.match(/[\d.]+(?:e[-+]?\d+)?/gi) || []).slice(0, 4).map(Number);
      if (/^color\(/i.test(t.trim())) {
        return n.map((v, i) => (i < 3 ? Math.round(v * 255) : v));
      }
      return n;
    };
    const bgOf = (node: Element | null) => {
      let n: Element | null = node;
      while (n) {
        const p = parse(getComputedStyle(n).backgroundColor);
        if (p.length >= 3 && (p[3] === undefined || p[3] > 0)) return p.slice(0, 3);
        n = n.parentElement;
      }
      return [255, 255, 255];
    };
    const fg = parse(getComputedStyle(el).color).slice(0, 3);
    const bg = bgOf(el);
    const l1 = lum(fg), l2 = lum(bg);
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return { contrast: (hi + 0.05) / (lo + 0.05), fg, bg };
  }, sel);
  if (out === null) throw new Error(`nothing matched ${sel}`);
  return out;
}

for (const vp of [{ w: 320, h: 720 }, { w: 390, h: 844 }, { w: 1440, h: 900 }]) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`${vp.w} / ${scheme}`, () => {
      test.use({ viewport: { width: vp.w, height: vp.h }, colorScheme: scheme });

      test('the block is visibly a different surface from the card it sits in', async ({ page }) => {
        const main = await toSuggestion(page);
        const seen = await main.locator('.suggest-block').evaluate((el) => {
          const cs = getComputedStyle(el);
          const card = getComputedStyle(el.closest('.card'));
          return {
            bg: cs.backgroundColor, cardBg: card.backgroundColor,
            borderLeft: parseFloat(cs.borderLeftWidth), borderColour: cs.borderLeftColor,
            radius: parseFloat(cs.borderTopLeftRadius),
          };
        });
        expect(seen.bg).not.toBe(seen.cardBg);          // a wash, not the same paper
        expect(seen.borderLeft).toBeGreaterThanOrEqual(3); // an edge you can see
        expect(seen.radius).toBeGreaterThan(0);          // its own shape
      });

      test('the suggestion label and the ordinary field heading are not the same colour', async ({ page }) => {
        const main = await toSuggestion(page);
        const a = await main.locator('.suggest-label').evaluate((el) => getComputedStyle(el).color);
        const b = await main.locator('.field-label').evaluate((el) => getComputedStyle(el).color);
        expect(a).not.toBe(b);
      });

      test('everything in the block clears WCAG AA on the tint it sits on', async ({ page }) => {
        await toSuggestion(page);
        // The shooter's name — normal body text, 4.5:1 floor.
        const name = await contrastOf(page, '.suggest-block .row-tap .label');
        expect(name.contrast, `name ${name.contrast.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        // The division/class/percent line under it — also body text.
        const sub = await contrastOf(page, '.suggest-block .row-sub');
        expect(sub.contrast, `sub-line ${sub.contrast.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        // The label is 12px, so it takes the normal-text floor too, not the large one.
        const label = await contrastOf(page, '.suggest-label');
        expect(label.contrast, `label ${label.contrast.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        // And the quiet heading it is being contrasted against still has to be readable.
        const quiet = await contrastOf(page, '.field-label');
        expect(quiet.contrast, `field heading ${quiet.contrast.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });

      test('the suggested row is still a full-size target and nothing overflows', async ({ page }) => {
        const main = await toSuggestion(page);
        const box = await main.locator('.suggest-block .row-tap').first().boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        const over = await page.evaluate(() => ({ c: document.documentElement.clientWidth, s: document.documentElement.scrollWidth }));
        expect(over.s).toBeLessThanOrEqual(over.c + 1);
      });

      test('highlighting changed nothing about the behaviour — still a choice, still the whole field', async ({ page }) => {
        const main = await toSuggestion(page);
        await expect(main.getByRole('heading', { name: 'Your result' })).toHaveCount(0);
        expect(await main.locator('.row-tap').count()).toBe(11); // 10 shooters + the copy at the top
        await main.locator('.suggest-block .row-tap').first().click();
        const card = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Your result' }) });
        await expect(card.locator('.row').filter({ has: page.getByText('Shooter', { exact: true }) })).toContainText('Blosser, David');
      });
    });
  }
}
