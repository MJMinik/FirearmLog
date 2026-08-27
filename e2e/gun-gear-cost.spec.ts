import { test, expect } from '@playwright/test';
import { seedDemo, gotoSection, gotoTab } from './helpers';

// "Gun & gear cost per gun" (Aug 2026): a second mode on the Costs & Purchases
// per-gun card that answers "what has owning and feeding this gun cost me" —
// the gun itself, its optic, parts, and linked gear/service — instead of the
// default "Ammo & fees per gun" (ammo + range fees + match fees + parts).

test.describe('Gun & gear cost per gun', () => {
  test('default is unchecked; checking it swaps the heading and the numbers', async ({ page }) => {
    await seedDemo(page);

    // A gun with a recorded price and nothing else logged against it: no
    // sessions, no matches, no parts. In the default (ammo & fees) mode its
    // total is $0 and the row is skipped entirely; in gun & gear mode its
    // price alone gives it a total, so the row appears.
    await gotoSection(page, 'Guns');
    await page.getByRole('button', { name: '+ Add Gun' }).click();
    const gunName = `E2E Cost Gun ${Date.now()}`;
    await page.getByRole('textbox', { name: 'What this Gun is called' }).fill(gunName);
    await page.getByRole('button', { name: 'More details' }).click();
    await page.getByLabel('What you paid').fill('500');
    await page.getByRole('button', { name: 'Save gun', exact: true }).click();
    await expect(page.getByText(gunName)).toBeVisible();

    await gotoSection(page, 'Costs & Purchases');
    await expect(page.getByRole('heading', { name: 'Ammo & fees per gun' })).toBeVisible();
    const toggle = page.getByLabel('Include the gun, optic, parts and gear');
    await expect(toggle).not.toBeChecked();
    await expect(page.getByText(gunName)).toHaveCount(0);

    await toggle.check();
    await expect(page.getByRole('heading', { name: 'Gun & gear cost per gun' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ammo & fees per gun' })).toHaveCount(0);
    const row = page.locator('.row', { hasText: gunName });
    await expect(row).toBeVisible();
    await expect(row).toContainText('$500.00');

    await toggle.uncheck();
    await expect(page.getByRole('heading', { name: 'Ammo & fees per gun' })).toBeVisible();
    await expect(page.getByText(gunName)).toHaveCount(0);
  });

  test('the checkbox is unchecked again on a fresh open of the screen', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Costs & Purchases');
    const toggle = page.getByLabel('Include the gun, optic, parts and gear');
    await toggle.check();
    await expect(page.getByRole('heading', { name: 'Gun & gear cost per gun' })).toBeVisible();

    // Leave the screen and come back — the mode is never persisted.
    await gotoTab(page, 'Home');
    await gotoSection(page, 'Costs & Purchases');
    await expect(page.getByRole('heading', { name: 'Ammo & fees per gun' })).toBeVisible();
    await expect(page.getByLabel('Include the gun, optic, parts and gear')).not.toBeChecked();
  });

  test('"For which gun" appears only for Gear / Equipment and Service / Repair', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Costs & Purchases');
    await page.getByRole('button', { name: '+ Add Purchase' }).click();

    // Category defaults to Gear / Equipment, so the picker starts visible.
    await expect(page.getByLabel('For which gun')).toBeVisible();
    await expect(page.getByLabel('For which gun').locator('option').first()).toHaveText('Not gun-specific');

    await page.getByLabel('Category').selectOption('Ammo Purchase');
    await expect(page.getByLabel('For which gun')).toHaveCount(0);

    await page.getByLabel('Category').selectOption('Service / Repair');
    await expect(page.getByLabel('For which gun')).toBeVisible();

    await page.getByLabel('Category').selectOption('Range Fee');
    await expect(page.getByLabel('For which gun')).toHaveCount(0);

    await page.getByLabel('Category').selectOption('Gear / Equipment');
    await expect(page.getByLabel('For which gun')).toBeVisible();
  });

  // SESSION-135 COLD-AUDIT FINDING 3. A permanently deleted gun used to leave its
  // linked purchases naming an id that no longer resolved. Nothing crashed and
  // nothing was lost -- which is exactly why it needed a test: the linked cost
  // simply stopped appearing anywhere (no gun row left to carry it), re-opening
  // the purchase showed a blank picker while state still held the dead id, and
  // saving it untouched wrote the dead id straight back. The clear happens ONLY
  // on permanent delete, never on retire or "no longer own", because those keep
  // the gun record and the link stays true.
  test('deleting a gun permanently clears the link on purchases that named it', async ({ page }) => {
    await seedDemo(page);

    // A gun with no sessions and no matches, so "Delete permanently" is offered.
    await gotoSection(page, 'Guns');
    await page.getByRole('button', { name: '+ Add Gun' }).click();
    const gunName = `E2E Doomed Gun ${Date.now()}`;
    await page.getByRole('textbox', { name: 'What this Gun is called' }).fill(gunName);
    await page.getByRole('button', { name: 'Save gun', exact: true }).click();
    await expect(page.getByText(gunName)).toBeVisible();

    // A gear purchase pointing at it.
    await gotoSection(page, 'Costs & Purchases');
    await page.getByRole('button', { name: '+ Add Purchase' }).click();
    await page.getByLabel('Item').fill('E2E doomed holster');
    await page.getByLabel('Cost ($)').fill('75');
    await page.getByLabel('For which gun').selectOption({ label: gunName });
    await page.getByRole('button', { name: 'Save purchase' }).click();
    await expect(page.getByText('E2E doomed holster')).toBeVisible();

    // Proof the link is real before we destroy the gun: gun & gear mode carries it.
    const toggle = page.getByLabel('Include the gun, optic, parts and gear');
    await toggle.check();
    await expect(page.locator('.row', { hasText: gunName })).toContainText('$75.00');

    // Delete the gun for good.
    await gotoSection(page, 'Guns');
    await page.getByText(gunName).click();
    await page.getByRole('button', { name: 'Retire or remove this gun…' }).click();
    await page.getByRole('button', { name: 'Delete permanently' }).click();
    await page.getByRole('button', { name: 'Delete Permanently' }).click();
    await expect(page.getByText(gunName)).toHaveCount(0);

    // The purchase survives with its money intact and its gun link gone.
    await gotoSection(page, 'Costs & Purchases');
    await page.getByText('E2E doomed holster').click();
    await expect(page.getByLabel('Cost ($)')).toHaveValue('75');
    await expect(page.getByLabel('For which gun')).toHaveValue('');
  });

  test('picking a gun then moving the category away clears the link, not just hides it', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Costs & Purchases');
    await page.getByRole('button', { name: '+ Add Purchase' }).click();

    await page.getByLabel('Item').fill('E2E linked holster');
    await page.getByLabel('Cost ($)').fill('40');
    const gunPicker = page.getByLabel('For which gun');
    await gunPicker.selectOption({ index: 1 }); // any real gun from the demo log

    // Move the category off the two linkable ones before saving — the picker
    // disappears, and the link it held must not survive to disk.
    await page.getByLabel('Category').selectOption('Travel');
    await expect(page.getByLabel('For which gun')).toHaveCount(0);
    await page.getByRole('button', { name: 'Save purchase' }).click();

    // Re-open the saved purchase and switch back to a linkable category: if
    // the old link had survived, it would show up selected here.
    await page.getByText('E2E linked holster').click();
    await page.getByLabel('Category').selectOption('Gear / Equipment');
    await expect(page.getByLabel('For which gun')).toHaveValue('');
  });
});
