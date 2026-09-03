import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedDemo, gotoSection } from './helpers';

/* D2 (picker sweep, session 139): AmmoScreens.tsx used to load an EXISTING
 * can's blank bullet type as 'FMJ' (`setBulletType(a.bulletType || 'FMJ')`),
 * so a can whose bullet type the migration reader left blank ('' -- Pistol
 * Tracker's `str(a.bulletType)` on a source with no bullet type) displayed
 * FMJ, and the "Discard changes?" baseline was taken AFTER that substitution
 * -- so a Save that only touched quantity still wrote FMJ into a record that
 * never said so. The fix drops the fallback and gives the stored value
 * (including '', and any value outside BULLET_TYPES) its own option.
 *
 * D6's ammo half lives here too: the delete-confirmation copy that used to
 * promise affected sessions "will show 'ammo deleted'," which nothing in the
 * app renders -- the real answer is "(removed)".
 *
 * Seeded straight into IndexedDB, the way edit-match-picker.spec.ts reaches
 * states the UI itself cannot produce: this form's own Add flow always
 * starts a NEW can on 'FMJ' (BULLET_TYPES[0]), so a blank or unlisted bullet
 * type only ever arrives via a migration or a hand-edited backup. A brand
 * not in the demo dataset ("Blazer Brass" is a real demo can) keeps the
 * seeded row unambiguous to find. */

const AMMO_ID = 'e2e-picker-ammo';
const BRAND = 'E2E Picker Ammo';

async function seedAmmo(page: Page, bulletType: string, quantity = 500) {
  await page.evaluate(async ({ id, bulletType, quantity, brand }) => {
    const rec = {
      id, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
      brand, caliber: '9mm', grain: '115', bulletType,
      quantity, costPerRound: 0, notes: '',
    };
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('firearmlog');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('ammunition', 'readwrite');
        tx.objectStore('ammunition').put(rec);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { id: AMMO_ID, bulletType, quantity, brand: BRAND });
  await page.reload();
}

/** The stored can, read back out of IndexedDB -- the only assertion that
 *  means anything for a round trip. */
async function storedAmmo(page: Page): Promise<{ bulletType: string; quantity: number; updatedAt: number }> {
  return page.evaluate(async (id) => new Promise<{ bulletType: string; quantity: number; updatedAt: number }>((resolve, reject) => {
    const open = indexedDB.open('firearmlog');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const req = db.transaction('ammunition', 'readonly').objectStore('ammunition').get(id);
      req.onsuccess = () => {
        const v = req.result; db.close();
        resolve({
          bulletType: v ? String(v.bulletType) : '<<missing>>',
          quantity: v ? Number(v.quantity) : -1,
          updatedAt: v ? Number(v.updatedAt ?? 0) : -1,
        });
      };
      req.onerror = () => { db.close(); reject(req.error); };
    };
  }), AMMO_ID);
}

async function openTheCan(page: Page) {
  await gotoSection(page, 'Ammo');
  await page.getByText(BRAND, { exact: false }).first().click();
  await expect(page.getByRole('heading', { name: 'Edit Ammo' })).toBeVisible();
}

function bulletTypeSelect(page: Page) {
  return page.getByLabel('Bullet type');
}

async function saveAndWaitForWrite(page: Page) {
  const before = await storedAmmo(page);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(async () => (await storedAmmo(page)).updatedAt, { timeout: 10_000 })
    .not.toBe(before.updatedAt);
}

test.describe('Ammo edit: the bullet-type picker shows what the record holds', () => {
  test('a blank bullet type displays as "Not recorded", not FMJ', async ({ page }) => {
    await seedDemo(page);
    await seedAmmo(page, '');
    await openTheCan(page);

    const select = bulletTypeSelect(page);
    // The assertion the pre-fix build fails: it rendered 'FMJ' here.
    await expect(select).toHaveValue('');
    await expect(select).not.toHaveValue('FMJ');
    const labels = await select.locator('option').evaluateAll((os) => os.map((o) => o.textContent?.trim() ?? ''));
    expect(labels[0]).toBe('Not recorded');
  });

  test('ROUND TRIP: changing quantity and saving leaves a blank bullet type blank', async ({ page }) => {
    await seedDemo(page);
    await seedAmmo(page, '');
    expect((await storedAmmo(page)).bulletType).toBe('');

    await openTheCan(page);
    await page.locator('#ammo-quantity-input').fill('600');
    await saveAndWaitForWrite(page);

    // This is the whole defect stated as an assertion: pre-fix, the form's
    // own state (seeded to 'FMJ' on load) is what gets written back, no
    // matter that only quantity was touched on screen.
    const after = await storedAmmo(page);
    expect(after.bulletType, 'a blank bullet type must not become FMJ on an unrelated edit').toBe('');
    expect(after.quantity).toBe(600);
  });

  test('an unlisted bullet type gets its own option and round-trips unchanged', async ({ page }) => {
    // A value outside BULLET_TYPES entirely -- a hand-edited backup, or a
    // future bullet type this build doesn't know about yet.
    await seedDemo(page);
    await seedAmmo(page, 'Hollow Point Custom');
    await openTheCan(page);

    const select = bulletTypeSelect(page);
    await expect(select).toHaveValue('Hollow Point Custom');
    await expect(select).not.toHaveValue('FMJ');

    await saveAndWaitForWrite(page);
    expect((await storedAmmo(page)).bulletType).toBe('Hollow Point Custom');
  });

  test('a recognised bullet type is untouched and offers no extra option', async ({ page }) => {
    await seedDemo(page);
    await seedAmmo(page, 'JHP');
    await openTheCan(page);

    const select = bulletTypeSelect(page);
    await expect(select).toHaveValue('JHP');
    const values = await select.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    // Exactly the 9 BULLET_TYPES -- nothing injected for a value already in the list.
    expect(values).toHaveLength(9);
  });
});

test.describe('Ammo delete: the confirmation says what the app actually shows', () => {
  test('sessions that used this ammo will show "(removed)", not the old broken promise', async ({ page }) => {
    await seedDemo(page);
    await seedAmmo(page, 'FMJ');
    // A session referencing this can, so usedBy > 0 and the confirmation
    // takes the branch naming affected sessions.
    await page.evaluate(async (ammoId) => {
      const firearmId = await new Promise<string>((resolve, reject) => {
        const o = indexedDB.open('firearmlog');
        o.onerror = () => reject(o.error);
        o.onsuccess = () => {
          const db = o.result;
          const r = db.transaction('firearms', 'readonly').objectStore('firearms').getAll();
          r.onsuccess = () => { const all = r.result || []; db.close(); resolve(all.length ? String(all[0].id) : ''); };
          r.onerror = () => { db.close(); reject(r.error); };
        };
      });
      const rec = {
        id: 'e2e-picker-ammo-session', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
        date: '2026-08-01', type: 'practice', guns: [{ firearmId, rounds: 50 }],
        location: '', distances: '', notes: '', ammoUsage: [{ ammoId, rounds: 50 }],
        drills: [], targetMediaIds: [], malfunctions: [], selfRating: null, rangeFee: null,
        planned: false, checklist: null,
      };
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('firearmlog');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('sessions', 'readwrite');
          tx.objectStore('sessions').put(rec);
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      });
    }, AMMO_ID);
    await page.reload();

    await openTheCan(page);
    await page.getByRole('button', { name: 'Delete Ammo' }).click();
    // The assertion the pre-fix build fails: the sheet used to say
    // `will show "ammo deleted."`, a string nothing in the app renders.
    await expect(page.getByText('will show "(removed)" for it', { exact: false })).toBeVisible();
    await expect(page.getByText('ammo deleted', { exact: false })).toHaveCount(0);
  });
});
