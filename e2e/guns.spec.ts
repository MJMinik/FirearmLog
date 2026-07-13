import { test, expect } from '@playwright/test';
import { seedDemo, gotoSection } from './helpers';

test.describe('Guns', () => {
  test('the demo populates the Guns list and each gun opens', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Guns');
    await expect(page.getByRole('heading', { name: 'Guns' }).first()).toBeVisible();

    // There should be several demo guns; open the first one.
    const gunRows = page.getByRole('main').locator('.card .row-tap');
    await expect(gunRows.first()).toBeVisible();
    expect(await gunRows.count()).toBeGreaterThan(0);
    await gunRows.first().click();

    // A gun detail screen loaded: an active gun shows "Retire or remove…",
    // a retired/former one shows "Return to active". Accept either.
    const detailAction = page.getByRole('button', { name: 'Retire or remove this gun…' })
      .or(page.getByRole('button', { name: 'Return to active' }));
    await expect(detailAction.first()).toBeVisible();
  });

  test('adding a gun saves it and opens its detail', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Guns');

    await page.getByRole('button', { name: '+ Add Gun' }).click();
    await expect(page.getByRole('heading', { name: 'New Gun' })).toBeVisible();

    const name = `E2E Test Pistol ${Date.now()}`;
    await page.getByRole('textbox', { name: 'What this Gun is called' }).fill(name);
    await page.getByRole('textbox', { name: 'Caliber' }).fill('9mm');
    await page.getByRole('button', { name: 'Save gun', exact: true }).click();

    // Lands on the new gun's detail, showing its name.
    await expect(page.getByText(name)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retire or remove this gun…' })).toBeVisible();
  });

  // F7 + F8 + F9: the care-guide prompt appears BELOW the save button (so it can't
  // shove the button mid-tap), names the maker once when it matches the guide,
  // and confirms the link inline instead of silently vanishing.
  test('care-guide prompt: no name doubling, link confirms, Save gun still saves', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Guns');
    await page.getByRole('button', { name: '+ Add Gun' }).click();

    const name = `E2E Glock ${Date.now()}`;
    await page.getByRole('textbox', { name: 'What this Gun is called' }).fill(name);
    await page.getByRole('textbox', { name: 'Made by' }).fill('Glock');

    // F8: the maker equals the guide name → said once, never "Glock: Glock".
    await expect(page.getByText('We found a maintenance guide for Glock.', { exact: false })).toBeVisible();
    await expect(page.getByText('Glock: Glock')).toHaveCount(0);

    // F9: linking confirms inline.
    await page.getByRole('button', { name: 'Link Glock' }).click();
    await expect(page.getByText('Care guide linked ✓')).toBeVisible();

    // F7 regression: with prompt/confirmation present, Save gun still lands.
    await page.getByRole('textbox', { name: 'Caliber' }).fill('9mm');
    await page.getByRole('button', { name: 'Save gun', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retire or remove this gun…' })).toBeVisible();
  });
});
