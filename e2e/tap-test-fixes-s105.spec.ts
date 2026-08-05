// Three defects Michael found using the app for real on 5 August 2026, each
// with a check that would have caught it.
import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

test.describe('the import instructions name what is actually on the PractiScore page', () => {
  for (const vp of [{ w: 320, h: 720 }, { w: 390, h: 844 }, { w: 1440, h: 900 }]) {
    test(`at ${vp.w}px the Overall row is explained as a row, not a button`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await seedDemo(page);
      await gotoTab(page, 'Compete');
      const main = page.getByRole('main');
      await main.getByRole('button', { name: 'Import…' }).click();
      await page.getByRole('dialog', { name: 'Import' }).getByRole('button', { name: 'Import from PractiScore' }).click();

      const steps = main.locator('ol');
      // He could not find "Overall" because it is a row label and every row has
      // a "Combined". The copy has to say both of those things.
      await expect(steps).toContainText("Overall is the row's name, not a button");
      await expect(steps).toContainText('every row has a Combined');
      // "Select the whole page" described a press, a hold and a drag as one gesture.
      await expect(steps).toContainText('press and hold');
      await expect(steps).toContainText('drag the round handle');
      await expect(steps).toContainText('Command-A');
      // The short-selection trap produces a confident wrong answer, so it is named.
      await expect(main.getByText(/out of a smaller number than actually shot/)).toBeVisible();
      // Nothing here talks about the app; rule 44's show-don't-tell.
      await expect(main.locator('ol')).not.toContainText(/accurate|careful|rigorous|honest|expert/i);
    });
  }
});

test('the list screens keep a way back on a wide window, because they are drill-downs', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedDemo(page);
  await gotoTab(page, 'Settings');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Manage lists' }).click();
  await expect(main.getByRole('heading', { name: 'Manage lists' })).toBeVisible();
  // Manage lists is not in the sidebar, so Back is the only route out.
  await expect(page.getByRole('button', { name: '‹ Back' })).toBeVisible();

  await main.getByRole('button', { name: 'Locations' }).click();
  await expect(main.getByRole('heading', { name: 'Locations' })).toBeVisible();
  const back = page.getByRole('button', { name: '‹ Back' });
  await expect(back).toBeVisible();
  await back.click();
  // The point of the fix: edit a second list without leaving and coming back in.
  await expect(main.getByRole('heading', { name: 'Manage lists' })).toBeVisible();
});

// Michael: "these titles should be centered over the greyed boxes." Measured
// rather than eyeballed — the label's centre against the input's centre, at
// three widths, because the cells wrap on a phone and a padding-based fix would
// have drifted there.
for (const vp of [{ w: 320, h: 720 }, { w: 390, h: 844 }, { w: 1440, h: 900 }]) {
  test(`at ${vp.w}px each hit-count label is centred over its own input`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    await page.getByRole('button', { name: '+ Log Match' }).click();
    await page.getByLabel('What this match is called').fill('Label centring');
    await page.getByRole('button', { name: '+ Add Stage' }).click();
    const block = page.locator('.drill-edit').first();
    await block.getByRole('button', { name: '+ Add hit breakdown (A/C/D/miss)' }).click();

    const offsets = await block.evaluate((root) => {
      const out: { label: string; delta: number }[] = [];
      root.querySelectorAll('.stepper-field').forEach((el) => {
        const input = el.querySelector('input');
        const label = el.querySelector('label');
        if (!input || !label) return;
        // Measure the rendered TEXT, not the label box: the label element spans
        // the whole cell, so its own rect would say nothing about where the
        // words sit. A range around its text node gives the ink.
        const node = label.firstChild;
        if (!node) return;
        const r = document.createRange();
        r.selectNode(node);
        const t = r.getBoundingClientRect();
        const i = input.getBoundingClientRect();
        out.push({ label: (label.textContent || '').trim(), delta: (t.left + t.width / 2) - (i.left + i.width / 2) });
      });
      return out;
    });

    expect(offsets.length).toBeGreaterThanOrEqual(5);
    for (const o of offsets) {
      expect(Math.abs(o.delta), `"${o.label}" is ${o.delta.toFixed(1)}px off its input's centre`).toBeLessThanOrEqual(1.5);
    }
  });
}
