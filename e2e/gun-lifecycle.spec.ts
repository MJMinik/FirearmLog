import { test, expect } from '@playwright/test';
import { seedDemo, gotoSection } from './helpers';

// The retire / return-to-active lifecycle (audit #10). We create a throwaway
// gun so the test is self-contained and never disturbs the demo guns.

test('a gun can be retired and brought back to active', async ({ page }) => {
  await seedDemo(page);
  await gotoSection(page, 'Guns');

  // Create a fresh gun to operate on.
  const name = `E2E Retire ${Date.now()}`;
  await page.getByRole('button', { name: '+ Add Gun' }).click();
  await page.getByRole('textbox', { name: 'What this Gun is called' }).fill(name);
  await page.getByRole('button', { name: 'Save gun', exact: true }).click();
  await expect(page.getByText(name)).toBeVisible();

  // Retire it.
  await page.getByRole('button', { name: 'Retire or remove this gun…' }).click();
  await expect(page.getByRole('heading', { name: `Retire or remove ${name}` })).toBeVisible();
  await page.getByRole('button', { name: 'Retire this gun' }).click();

  // Back on detail: it now shows the retired status and a way back.
  const backToActive = page.getByRole('button', { name: 'Return to active' });
  await expect(backToActive).toBeVisible();
  // "Retired" appears twice (status line + badge), so scope to the first.
  await expect(page.getByText('Retired', { exact: false }).first()).toBeVisible();

  // Bring it back.
  await backToActive.click();
  await expect(page.getByRole('button', { name: 'Retire or remove this gun…' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Return to active' })).toHaveCount(0);
});
