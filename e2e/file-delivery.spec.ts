import { test, expect } from '@playwright/test';
import { seedDemo, gotoSection } from './helpers';

// The bug this file guards against: on the installed iOS PWA, a plain
// <a href="blob:..."> click NAVIGATED the webview to the blob URL (blank white
// screen — no way back). SyncCard's Save + RemindersScreen's Add to Calendar
// now route through src/ui/deliverFile.ts, which picks Share sheet / new
// window / anchor download by platform.
//
// The real Share-sheet flow is iPhone-only and cannot run headlessly here, so
// these desktop specs only prove the DESKTOP path is unchanged: the download
// still fires with the right filename. The iOS branch is proven by the unit
// tests in tests/deliverFile.test.ts and by Michael's iPhone tap-test.

test('Save to File downloads a DATED FirearmLog file on desktop', async ({ page }) => {
  await seedDemo(page);
  await gotoSection(page, 'Sync & Backup');

  await page.getByRole('main').getByRole('button', { name: 'Save to File' }).click();
  await expect(page.getByRole('heading', { name: 'Your Data File Is Ready', exact: true })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save the File Now', exact: true }).click(),
  ]);
  // Dated since pass 3 (Michael, 10 August 2026): iOS never replaces a file of
  // the same name, so one fixed name produced a pile of numbered copies that all
  // claimed to be the same backup. Matched by shape rather than by today's date,
  // so this does not go red at midnight.
  expect(download.suggestedFilename()).toMatch(/^FirearmLog-\d{4}-\d{2}-\d{2}\.flog$/);
  const path = await download.path();
  expect(path).toBeTruthy();
});

test('Add to Calendar still downloads a .ics on desktop', async ({ page }) => {
  await seedDemo(page);
  await gotoSection(page, 'Reminders');

  const main = page.getByRole('main');
  await main.getByRole('button', { name: /Add reminder|Add your own/ }).first().click();
  await expect(main.getByRole('heading', { name: 'New Reminder', exact: true })).toBeVisible();
  await main.getByLabel('Title').fill('Delivery test');
  // Any future date works; the reminder just needs to be exportable.
  const d = new Date(); d.setDate(d.getDate() + 30);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await main.getByLabel('Due date').fill(iso);
  await main.getByRole('button', { name: 'Save reminder', exact: true }).click();
  await expect(main.getByRole('heading', { name: 'Reminders' }).first()).toBeVisible();

  await main.getByText('Delivery test').click();
  await expect(main.getByRole('heading', { name: 'Edit Reminder', exact: true })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    main.getByRole('button', { name: 'Add to Calendar', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.ics$/);
  const path = await download.path();
  expect(path).toBeTruthy();
});
