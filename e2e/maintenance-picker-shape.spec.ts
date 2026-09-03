import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedDemo, gotoSection } from './helpers';

/* D3 (picker sweep, session 139): MaintenanceScreens.tsx's "What was done"
 * select offers only the six MAINT_TYPES plus a placeholder. The migration
 * reader writes `type` verbatim, so a legacy id like 'spring_change' (the
 * codebase already knows this exact id exists -- maintLabel() humanises it
 * to "Spring change" for the LIST screen) has no option on Edit, and the
 * select falls through to the placeholder, "Choose what was done...". The
 * list screen and the edit screen disagree about the very same record.
 *
 * This is a pure DISPLAY defect, not a data-corruption one: the form's `type`
 * state is set directly from the loaded record (no `|| fallback`), and
 * saveProblem() only checks `if (!type)` -- true for the JS state, which
 * still holds 'spring_change' whether or not the select can show it. So an
 * untouched Save round-trips the value correctly even pre-fix; what fails
 * pre-fix is the SELECT ITSELF, and the real risk this fixes is a shooter
 * "correcting" what looks like an unset field into the wrong six-item type,
 * silently changing which maintenance forecast (deep_clean / recoil_spring)
 * the record counts against.
 *
 * Seeded straight into IndexedDB: a fresh gun (so this file needs no
 * assumptions about the demo dataset) plus a maintenance entry the UI's own
 * "What was done" dropdown could never produce on its own. */

const GUN_ID = 'e2e-picker-maint-gun';
const GUN_NAME = 'E2E Picker Maintenance Gun';
const ENTRY_ID = 'e2e-picker-maint-entry';

function gunRecord() {
  return {
    id: GUN_ID, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
    name: GUN_NAME, manufacturer: 'Test', model: 'Test', caliber: '9mm', category: 'Pistol',
    serialNumber: null, dateAcquired: '', startingRoundCount: 0,
    recoilSpringInterval: null, recoilSpringWeight: null,
    barrelName: null, barrelInstallDate: null, barrelStartRounds: null,
    deepCleanInterval: null, photoIds: [], referenceId: null, notes: '',
  };
}

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

async function storedMaintType(page: Page): Promise<string> {
  return page.evaluate(async (id) => new Promise<string>((resolve, reject) => {
    const open = indexedDB.open('firearmlog');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const req = db.transaction('maintenance', 'readonly').objectStore('maintenance').get(id);
      req.onsuccess = () => { const v = req.result; db.close(); resolve(v ? String(v.type) : '<<missing>>'); };
      req.onerror = () => { db.close(); reject(req.error); };
    };
  }), ENTRY_ID);
}

/** From the Guns list, open the seeded gun and tap its "Recent Work" row --
 *  the same row GunDetail.tsx already labels with maintLabel(m.type). */
async function openTheEntry(page: Page) {
  await gotoSection(page, 'Guns');
  await page.getByText(GUN_NAME, { exact: false }).first().click();
  await expect(page.getByRole('heading', { name: GUN_NAME, exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Spring change', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Edit Work' })).toBeVisible();
}

function typeSelect(page: Page) {
  return page.getByLabel('What was done');
}

test.describe('Maintenance edit: the "What was done" picker shows what the record holds', () => {
  test.beforeEach(async ({ page }) => {
    await seedDemo(page);
    await seedRaw(page, 'firearms', gunRecord());
    await seedRaw(page, 'maintenance', {
      id: ENTRY_ID, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
      date: '2026-08-01', firearmId: GUN_ID, type: 'spring_change',
      performedBy: 'Self', partsReplaced: '', notes: '',
    });
    await page.reload();
  });

  test('a legacy type ("spring_change") displays as "Spring change" -- the same word the list uses', async ({ page }) => {
    await openTheEntry(page);
    const select = typeSelect(page);
    // The assertion the pre-fix build fails: it fell through to the
    // placeholder, "Choose what was done...", not the real type.
    await expect(select).toHaveValue('spring_change');
    const selectedLabel = await select.locator('option:checked').textContent();
    expect(selectedLabel?.trim()).toBe('Spring change');
  });

  test('ROUND TRIP: an untouched save keeps the legacy type', async ({ page }) => {
    // Regression guard: this passes on main too, unfixed -- D3 is a pure
    // display defect (the select's DOM rendering fell through to the
    // placeholder; the `type` state itself was never corrupted), so an
    // untouched Save round-tripped correctly even pre-fix. The test above
    // (display) is what catches the lie.
    expect(await storedMaintType(page)).toBe('spring_change');
    await openTheEntry(page);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { name: GUN_NAME, exact: false })).toBeVisible();
    expect(await storedMaintType(page)).toBe('spring_change');
  });

  test('a known type is untouched and offers no extra option', async ({ page }) => {
    await seedRaw(page, 'maintenance', {
      id: 'e2e-picker-maint-known', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_001,
      date: '2026-08-02', firearmId: GUN_ID, type: 'deep_clean',
      performedBy: 'Self', partsReplaced: '', notes: '',
    });
    await page.reload();
    await gotoSection(page, 'Guns');
    await page.getByText(GUN_NAME, { exact: false }).first().click();
    await page.getByRole('button', { name: 'Deep Clean', exact: false }).first().click();
    await expect(page.getByRole('heading', { name: 'Edit Work' })).toBeVisible();

    const select = typeSelect(page);
    await expect(select).toHaveValue('deep_clean');
    const values = await select.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    // The placeholder ('') plus exactly the six MAINT_TYPES -- nothing injected.
    expect(values).toHaveLength(7);
  });
});
