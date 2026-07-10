import { test, expect } from '@playwright/test';
import { seedDemo, isDesktop, nav, gotoSection } from './helpers';

// July 2026: the More screen / sidebar is organized into four labeled groups —
// Your Gear, Training, Records, App & Data. On the phone the groups are headings
// on the More screen; on desktop they are labels down the sidebar. Every App &
// Data destination (Tour & Setup, Sync & Backup, Free Up Space) is now
// its own screen reached by a chevron row / sidebar entry — the iOS-Settings
// pattern — so this verifies each opens and renders without crashing on BOTH
// layouts.

const GROUPS = ['Your Gear', 'Training', 'Records', 'App & Data'];

test.describe('Menu groups', () => {
  test.beforeEach(async ({ page }) => {
    await seedDemo(page);
  });

  test('the four groups are present', async ({ page }) => {
    if (isDesktop(page)) {
      // Desktop: the groups are labels down the sidebar.
      for (const g of GROUPS) {
        await expect(nav(page).getByText(g, { exact: true })).toBeVisible();
      }
    } else {
      // Phone: the groups are headings on the More screen.
      await nav(page).getByRole('button', { name: 'More' }).first().click();
      for (const g of GROUPS) {
        await expect(page.getByRole('heading', { name: g }).first()).toBeVisible();
      }
    }
  });

  // A representative destination in each group opens and renders — plus every
  // App & Data section, since those are the newly-split screens.
  const dests: { group: string; section: string; heading: string }[] = [
    { group: 'Your Gear', section: 'Guns', heading: 'Guns' },
    { group: 'Training', section: 'The numbers', heading: 'How the numbers work' },
    { group: 'Records', section: 'Malfunctions', heading: 'Malfunctions' },
    { group: 'App & Data', section: 'Tour & Setup', heading: 'Tour & Setup' },
    { group: 'App & Data', section: 'Sync & Backup', heading: 'Sync & Backup' },
    { group: 'App & Data', section: 'Free Up Space', heading: 'Free Up Space' },
  ];

  for (const { group, section, heading } of dests) {
    test(`${group}: ${section} opens`, async ({ page }) => {
      await gotoSection(page, section);
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
      await expect(page.getByText('Something went wrong')).toHaveCount(0);
    });
  }

  // F11 (rule 46): the old Import screen is gone and nothing may offer it —
  // no "Import" entry in the sidebar or on the More screen, ever again.
  test('App & Data offers no Import entry (F11)', async ({ page }) => {
    if (!isDesktop(page)) {
      await nav(page).getByRole('button', { name: 'More' }).first().click();
      // Wait for the More screen to render so the zero-count is non-vacuous.
      await expect(page.getByRole('main').getByRole('button', { name: 'Tour & Setup' })).toBeVisible();
      await expect(page.getByRole('main').getByRole('button', { name: 'Import', exact: true })).toHaveCount(0);
    }
    await expect(nav(page).getByRole('button', { name: 'Import', exact: true })).toHaveCount(0);
  });
});
