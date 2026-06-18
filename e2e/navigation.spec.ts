import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab, gotoSection } from './helpers';

// Every top-level tab and every Data & Gear section must open and render its
// screen without crashing — on both the desktop and phone layouts.

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await seedDemo(page);
  });

  const tabs: { tab: string; heading: string }[] = [
    { tab: 'Home', heading: 'FirearmLog' },
    { tab: 'Log', heading: 'Log' },
    { tab: 'Compete', heading: 'Compete' },
    { tab: 'Progress', heading: 'Progress' },
  ];

  for (const { tab, heading } of tabs) {
    test(`tab: ${tab}`, async ({ page }) => {
      await gotoTab(page, tab);
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
      await expect(page.getByText('Something went wrong')).toHaveCount(0);
    });
  }

  const sections: string[] = [
    'Guns',
    'Optics',
    'Ammo',
    'Magazines',
    'Drills',
    'Costs & Purchases',
    'Maintenance',
    'Spare Parts & Inventory',
    'Reference',
    'Reports',
  ];

  for (const section of sections) {
    test(`section: ${section}`, async ({ page }) => {
      await gotoSection(page, section);
      await expect(page.getByRole('heading', { name: section }).first()).toBeVisible();
      await expect(page.getByText('Something went wrong')).toHaveCount(0);
    });
  }

  test('section: Tour & Setup', async ({ page }) => {
    await gotoSection(page, 'Tour & Setup');
    await expect(page.getByRole('heading', { name: 'Tour & Setup' }).first()).toBeVisible();
  });
});
