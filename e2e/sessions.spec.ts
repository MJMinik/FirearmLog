import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

test.describe('Sessions', () => {
  test('the Log tab shows sessions and toggles to the calendar', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();
    // Demo data means there are sessions to show.
    await expect(page.getByRole('main').locator('.row-tap').first()).toBeVisible();

    // Flip to the calendar view and back.
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('logging a live-fire session records it', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');

    await page.getByRole('button', { name: '+ Log Session' }).click();

    // T-1: count the sessions store in-page BEFORE the save (the same
    // read-the-real-database pattern export-csv.spec.ts uses), so the
    // assertion below anchors on the DB write itself — a green run proves
    // the session was PERSISTED, not merely drawn into the list.
    const sessionCount = () => page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('firearmlog');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return new Promise<number>((resolve) => {
        const r = db.transaction('sessions', 'readonly').objectStore('sessions').count();
        r.onsuccess = () => { db.close(); resolve(r.result); };
        r.onerror = () => { db.close(); resolve(-1); };
      });
    });
    const before = await sessionCount();
    expect(before).toBeGreaterThan(0); // demo data really seeded

    // Pick the first gun in the "Guns & Rounds" card and enter a distinctive
    // round count no demo session uses, so the row we find below is OURS.
    const gunsCard = page.getByTestId('session-guns-card');
    await gunsCard.locator('button.gun-toggle').first().click();
    await gunsCard.getByRole('spinbutton').first().fill('47');

    // Save via the navbar action (date is prefilled to today).
    await page.locator('.navbar-action').click();

    // We return to the Log list; the new 47-round session is there
    // (rounds render as "rds" for live fire, "reps" for dry fire).
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();
    await expect(page.getByText(/47\s*(rds|reps)/).first()).toBeVisible();

    // The write actually landed: one more row in the sessions store, and the
    // stored record carries our distinctive count.
    expect(await sessionCount()).toBe(before + 1);
    const stored = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('firearmlog');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return new Promise<boolean>((resolve) => {
        const r = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
        r.onsuccess = () => {
          db.close();
          const rows = r.result as { guns?: { rounds?: number }[] }[];
          resolve(rows.some((row) => (row.guns ?? []).some((g) => g.rounds === 47)));
        };
        r.onerror = () => { db.close(); resolve(false); };
      });
    });
    expect(stored, 'a session with 47 rounds is in the sessions store').toBe(true);

    // And it survives a full reload — persistence, not React state.
    await page.reload();
    await gotoTab(page, 'Log');
    await expect(page.getByText(/47\s*(rds|reps)/).first()).toBeVisible();
  });

  // Session-55 fresh-eyes find: with an EMPTY ammo library the Ammo Used card
  // used to vanish entirely — a new user never learned it existed. Now it
  // stays and teaches the door; with ammo present, the normal card shows.
  test('empty ammo library: Log Session keeps the Ammo Used card as a hint', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('main').getByRole('button', { name: '1. Add a gun' }).click();
    await page.getByRole('textbox', { name: 'What this Gun is called' }).fill('First Pistol');
    await page.getByRole('textbox', { name: 'Caliber' }).fill('9mm');
    await page.getByRole('button', { name: 'Save gun', exact: true }).click();
    await page.getByRole('button', { name: 'Skip for now' }).click();

    await page.getByRole('main').getByRole('button', { name: '+ Log Session', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ammo Used' })).toBeVisible();
    await expect(page.getByText('Add your ammo under More → Ammo to track rounds used here.')).toBeVisible();
  });

  test('with ammo in the library, the hint is gone and the real card shows', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();
    await expect(page.getByRole('heading', { name: 'Ammo Used' })).toBeVisible();
    await expect(page.getByText('Add your ammo under More → Ammo', { exact: false })).toHaveCount(0);
  });
});
