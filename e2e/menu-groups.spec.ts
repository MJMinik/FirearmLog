import { test, expect, type Page } from '@playwright/test';
import { seedDemo, isDesktop, nav, gotoSection } from './helpers';

// July 2026: the More screen / sidebar is organized into four labeled groups —
// Your Gear, Training, Records, App & Data — instead of one flat list. This
// verifies the groups render and that a representative destination in each group
// opens and renders without crashing, on both the phone and desktop layouts.

// The More screen (which carries the group headers) is the "More" tab on the
// phone and the "Sync & Backup" entry at the bottom of the desktop sidebar.
async function openMoreScreen(page: Page): Promise<void> {
  const label = isDesktop(page) ? 'Sync & Backup' : 'More';
  await nav(page).getByRole('button', { name: label }).first().click();
}

test.describe('Menu groups', () => {
  test.beforeEach(async ({ page }) => {
    await seedDemo(page);
  });

  test('the four groups render on the More screen', async ({ page }) => {
    await openMoreScreen(page);
    for (const group of ['Your Gear', 'Training', 'Records', 'App & Data']) {
      await expect(page.getByRole('heading', { name: group }).first()).toBeVisible();
    }
  });

  // One representative destination from each group must open and render.
  const onePerGroup: { group: string; section: string; heading: string }[] = [
    { group: 'Your Gear', section: 'Guns', heading: 'Guns' },
    { group: 'Training', section: 'How the numbers work', heading: 'How the numbers work' },
    { group: 'Records', section: 'Malfunctions', heading: 'Malfunctions' },
    { group: 'App & Data', section: 'Tour & Setup', heading: 'Tour & Setup' },
  ];

  for (const { group, section, heading } of onePerGroup) {
    test(`${group}: ${section} opens`, async ({ page }) => {
      await gotoSection(page, section);
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
      await expect(page.getByText('Something went wrong')).toHaveCount(0);
    });
  }
});
