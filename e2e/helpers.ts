import { type Page, type Locator, expect } from '@playwright/test';

// Shared helpers so specs read like a user's intent, not a pile of selectors.
// The app has two nav layouts: a desktop sidebar (>=900px) where every section
// is a direct link, and a phone layout where sections live under the "More" tab.
// These helpers paper over that difference so a single spec runs on both.

export function isDesktop(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= 900;
}

/** The main navigation (bottom tab bar on phone, sidebar on desktop). */
export function nav(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Main' });
}

/** Go to one of the top-level tabs: Home, Log, Compete, Progress. */
export async function gotoTab(page: Page, name: string): Promise<void> {
  await nav(page).getByRole('button', { name }).first().click();
}

/**
 * Go to a "Data & Gear" section (Guns, Optics, Ammo, ...) or Tour & Setup.
 * On desktop these are sidebar links; on phone they live under the More tab.
 */
export async function gotoSection(page: Page, name: string): Promise<void> {
  if (isDesktop(page)) {
    await nav(page).getByRole('button', { name }).first().click();
  } else {
    await nav(page).getByRole('button', { name: 'More' }).first().click();
    await page.getByRole('main').getByRole('button', { name }).first().click();
  }
}

/**
 * Seed a fresh install with the bundled demo dataset via the in-app one-tap
 * loader — exactly what a tester does. Leaves the app on Home with data.
 */
export async function seedDemo(page: Page): Promise<void> {
  await page.goto('/');
  // An empty log auto-opens the Setup Wizard.
  const demoBtn = page.getByRole('button', { name: 'See it with sample data' });
  await expect(demoBtn).toBeVisible();
  await demoBtn.click();
  // Once the restore finishes we land on Home, which shows live stats.
  await expect(page.getByRole('heading', { name: 'FirearmLog' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Live-fire rounds')).toBeVisible();
}
