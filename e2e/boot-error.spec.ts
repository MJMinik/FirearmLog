import { test, expect } from '@playwright/test';

// F1: the boot open guard. If IndexedDB can't open (a stale tab holding a
// connection, a pending delete queued ahead of the open), the app used to show
// a loading spinner forever. It must now show a plain-language recovery screen
// with a working Try Again.
//
// We simulate the stuck open by replacing indexedDB.open with a request that
// never settles — before any app code runs (addInitScript). A window hook
// (__fixDb) lets the recovery test "close the other tab" and prove Try Again
// actually brings the app back without a reload.

test.describe('Boot open guard (F1)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const realIndexedDb = window.indexedDB;
      let broken = true;
      (window as unknown as { __fixDb: () => void }).__fixDb = () => { broken = false; };
      const stuckOpen = (): IDBOpenDBRequest =>
        // Handlers are assignable but never fired — the open never settles.
        ({ onblocked: null, onupgradeneeded: null, onsuccess: null, onerror: null } as unknown as IDBOpenDBRequest);
      Object.defineProperty(window, 'indexedDB', {
        value: {
          open: (name: string, version?: number) =>
            broken ? stuckOpen() : realIndexedDb.open(name, version),
          deleteDatabase: (name: string) => realIndexedDb.deleteDatabase(name),
        },
      });
    });
  });

  test('a stuck open shows the recovery screen, not an eternal spinner', async ({ page }) => {
    await page.goto('/');
    // The guard's timeout is 10s; give the assertion room beyond it.
    await expect(
      page.getByRole('heading', { name: "FirearmLog couldn't open its storage" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Nothing has been deleted')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
  });

  test('Try Again recovers once the open can succeed', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: "FirearmLog couldn't open its storage" }),
    ).toBeVisible({ timeout: 15_000 });

    // "Close the other tab": let opens succeed again, then retry in-app.
    await page.evaluate(() => (window as unknown as { __fixDb: () => void }).__fixDb());
    await page.getByRole('button', { name: 'Try Again' }).click();

    // A fresh profile with a working database boots into the setup wizard.
    await expect(page.getByRole('heading', { name: 'Set up FirearmLog' })).toBeVisible({ timeout: 15_000 });
  });
});
