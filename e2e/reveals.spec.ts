import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab, gotoSection } from './helpers';

// Progressive-disclosure Pass 2: four "demotions" collapse non-newcomer-essential
// capture/analysis behind the shared Reveal. Each test proves the demoted content is
// hidden by default (unmounted while collapsed) and appears when the reveal is tapped —
// nothing was removed, only tucked one tap away. Runs on desktop and mobile projects.

test.describe('Progressive-disclosure reveals', () => {
  test('Log a Session: the 1–10 self-ratings are behind "Rate how it felt"', async ({ page }) => {
    await seedDemo(page);
    await page.getByRole('button', { name: '+ Log Session' }).click();
    await expect(page.getByLabel('focus', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: /Rate how it felt/ }).click();
    await expect(page.getByLabel('focus', { exact: true })).toBeVisible();
  });

  test('Log a Match: placement fields are behind "Results & placement"', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    await page.getByRole('button', { name: '+ Log Match' }).click();
    await expect(page.getByLabel('Division place')).toHaveCount(0);
    await page.getByRole('button', { name: /Results & placement/ }).click();
    await expect(page.getByLabel('Division place')).toBeVisible();
  });

  test('Add a Gun: detail fields are behind "More details"', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Guns');
    await page.getByRole('button', { name: '+ Add Gun' }).click();
    await expect(page.getByLabel('Serial number')).toHaveCount(0);
    await page.getByRole('button', { name: /More details/ }).click();
    await expect(page.getByLabel('Serial number')).toBeVisible();
  });

  test('Progress: the Trends filters are behind "Filters"', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Progress');
    await expect(page.getByLabel('Gun type')).toHaveCount(0);
    await page.getByRole('main').getByRole('button', { name: 'Filters' }).first().click();
    await expect(page.getByLabel('Gun type')).toBeVisible();
  });

  test('Home: the Rounds-by-Month filters are behind "Filters"', async ({ page }) => {
    await seedDemo(page); // lands on Home
    await expect(page.getByLabel('Gun type')).toHaveCount(0);
    await page.getByRole('main').getByRole('button', { name: 'Filters' }).first().click();
    await expect(page.getByLabel('Gun type')).toBeVisible();
  });
});
