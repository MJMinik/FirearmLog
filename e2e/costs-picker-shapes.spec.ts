import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedDemo, gotoSection } from './helpers';

/* D4 (picker sweep, session 139): CostsScreen.tsx's Category select offers
 * only the eight CATEGORIES, no placeholder, CATEGORIES[0] is "Firearm". An
 * imported purchase with an unlisted category falls through to "Firearm" on
 * screen while the gun-link and ammo sections stay keyed on the TRUE
 * category -- the form disagreeing with itself. Pure display defect (like
 * D1/D3): `setCategory(p.category || 'Other')` only substitutes for a truly
 * EMPTY category, and saveProblem() never checks category presence, so the
 * JS state (and an untouched Save) already carries the real value -- the
 * select is what lied.
 *
 * D6's Costs half lives here too: the "Which ammo can" select on an Ammo
 * Purchase whose linked can has since been deleted used to fall through to
 * "-- Not linked --", a different, false statement.
 *
 * Seeded straight into IndexedDB -- no UI path offers a category outside
 * CATEGORIES, or an ammo link to a can that doesn't exist. */

async function seedRaw(page: Page, store: string, rec: Record<string, unknown>) {
  await page.evaluate(async ({ store, rec }) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('firearmlog');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(rec);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }, { store, rec });
}

async function storedPurchase(page: Page, id: string): Promise<{ category: string; ammoId: string | null; updatedAt: number }> {
  return page.evaluate(async (id) => new Promise<{ category: string; ammoId: string | null; updatedAt: number }>((resolve, reject) => {
    const open = indexedDB.open('firearmlog');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const req = db.transaction('purchases', 'readonly').objectStore('purchases').get(id);
      req.onsuccess = () => {
        const v = req.result; db.close();
        resolve({
          category: v ? String(v.category) : '<<missing>>',
          ammoId: v ? (v.ammoId ?? null) : '<<missing>>',
          updatedAt: v ? Number(v.updatedAt ?? 0) : -1,
        });
      };
      req.onerror = () => { db.close(); reject(req.error); };
    };
  }), id);
}

async function openThePurchase(page: Page, itemText: string) {
  await gotoSection(page, 'Costs & Purchases');
  await page.getByText(itemText, { exact: false }).first().click();
  await expect(page.getByRole('heading', { name: 'Edit Purchase' })).toBeVisible();
}

test.describe('Costs edit: the category picker shows what the record holds', () => {
  const PURCHASE_ID = 'e2e-picker-purchase';
  const ITEM = 'E2E Picker Reloading Press';

  test.beforeEach(async ({ page }) => {
    await seedDemo(page);
    await seedRaw(page, 'purchases', {
      id: PURCHASE_ID, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
      date: '2026-08-01', category: 'Reloading', item: ITEM, vendor: '', cost: 350,
      notes: '', ammoId: null, rounds: null, addedToInventory: false, firearmId: null,
    });
    await page.reload();
  });

  test('an unlisted category ("Reloading") displays as itself, not Firearm', async ({ page }) => {
    await openThePurchase(page, ITEM);
    const select = page.getByLabel('Category');
    // The assertion the pre-fix build fails: it rendered 'Firearm' here.
    await expect(select).toHaveValue('Reloading');
    await expect(select).not.toHaveValue('Firearm');
  });

  test('ROUND TRIP: an untouched save keeps the unlisted category', async ({ page }) => {
    // Regression guard: this passes on main too, unfixed -- an UNLISTED
    // category is a pure display defect (the select's DOM rendering fell
    // through to CATEGORIES[0]; the `category` state itself was never
    // corrupted), so an untouched Save round-tripped correctly even
    // pre-fix. The test above (display) is what catches the lie. (A BLANK
    // category is different -- see the blank-category describe block below,
    // where the load itself substituted 'Other' and this same assertion
    // would have failed pre-fix.)
    expect((await storedPurchase(page, PURCHASE_ID)).category).toBe('Reloading');
    await openThePurchase(page, ITEM);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Costs & Purchases' })).toBeVisible();
    expect((await storedPurchase(page, PURCHASE_ID)).category).toBe('Reloading');
  });

  test('a listed category is untouched and offers no extra option', async ({ page }) => {
    await seedRaw(page, 'purchases', {
      id: 'e2e-picker-purchase-known', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_001,
      date: '2026-08-02', category: 'Gear / Equipment', item: 'E2E Picker Known Category', vendor: '',
      cost: 20, notes: '', ammoId: null, rounds: null, addedToInventory: false, firearmId: null,
    });
    await page.reload();
    await openThePurchase(page, 'E2E Picker Known Category');
    const select = page.getByLabel('Category');
    await expect(select).toHaveValue('Gear / Equipment');
    const values = await select.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(values).toHaveLength(8); // exactly CATEGORIES, nothing injected
  });
});

test.describe('Costs edit: a blank category is not silently written as Other', () => {
  const PURCHASE_ID = 'e2e-picker-purchase-blank-category';
  const ITEM = 'E2E Picker Blank Category Purchase';

  test.beforeEach(async ({ page }) => {
    await seedDemo(page);
    await seedRaw(page, 'purchases', {
      id: PURCHASE_ID, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
      date: '2026-08-01', category: '', item: ITEM, vendor: '', cost: 40,
      notes: '', ammoId: null, rounds: null, addedToInventory: false, firearmId: null,
    });
    await page.reload();
  });

  test('a blank category displays as "Not recorded"', async ({ page }) => {
    await openThePurchase(page, ITEM);
    const select = page.getByLabel('Category');
    // The assertion the pre-fix build fails: `p.category || 'Other'` on load
    // meant this rendered 'Other', not blank -- a display bug that primes the
    // data bug in the next test, since the dirty-tracker baseline was taken
    // from the already-substituted state.
    await expect(select).toHaveValue('');
    const selectedLabel = await select.locator('option:checked').textContent();
    expect(selectedLabel?.trim()).toBe('Not recorded');
  });

  test('editing an unrelated field and saving does not write "Other" over a blank category', async ({ page }) => {
    expect((await storedPurchase(page, PURCHASE_ID)).category).toBe('');
    await openThePurchase(page, ITEM);
    // Touch a field that has nothing to do with category, the way a shooter
    // fixing a typo'd cost would -- Category is never clicked.
    await page.getByLabel('Cost ($)').fill('42');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Costs & Purchases' })).toBeVisible();
    // This is the defect stated as an assertion: pre-fix, `setCategory(p.category
    // || 'Other')` had already turned the blank into 'Other' before the shooter
    // touched anything, so ANY save -- not just an untouched one -- wrote 'Other'
    // into a record that never said so.
    expect((await storedPurchase(page, PURCHASE_ID)).category).toBe('');
  });
});

test.describe('Costs edit: a deleted ammo link reads "(removed)", never "-- Not linked --"', () => {
  const PURCHASE_ID = 'e2e-picker-purchase-ghost-ammo';
  const ITEM = 'E2E Picker Ghost Ammo Purchase';
  const GHOST_AMMO_ID = 'e2e-does-not-exist-ammo';

  test.beforeEach(async ({ page }) => {
    await seedDemo(page);
    await seedRaw(page, 'purchases', {
      id: PURCHASE_ID, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
      date: '2026-08-01', category: 'Ammo Purchase', item: ITEM, vendor: '', cost: 200,
      notes: '', ammoId: GHOST_AMMO_ID, rounds: 500, addedToInventory: false, firearmId: null,
    });
    await page.reload();
  });

  test('the ammo-link picker shows "(removed)", not "-- Not linked --"', async ({ page }) => {
    await openThePurchase(page, ITEM);
    const select = page.getByLabel('Which ammo can');
    // The assertion the pre-fix build fails: it fell through to
    // "-- Not linked --", a different, false statement.
    await expect(select).toHaveValue(GHOST_AMMO_ID);
    await expect(select.locator('option:checked')).toHaveText('(removed)');
  });

  test('ROUND TRIP: an untouched save keeps the dead ammo id', async ({ page }) => {
    // Regression guard: this passes on main too, unfixed -- the ammoId state
    // was never corrupted, only the select's DOM rendering fell through to
    // "-- Not linked --", so an untouched Save round-tripped correctly even
    // pre-fix. The test above (display) is what catches the lie.
    expect((await storedPurchase(page, PURCHASE_ID)).ammoId).toBe(GHOST_AMMO_ID);
    await openThePurchase(page, ITEM);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Costs & Purchases' })).toBeVisible();
    expect((await storedPurchase(page, PURCHASE_ID)).ammoId).toBe(GHOST_AMMO_ID);
  });
});
