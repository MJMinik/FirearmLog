import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

/* D1 (picker sweep, session 139): the classifier division select on
 * CompeteScreen.tsx never carried the session-106 repair (`optionsWithStored`)
 * -- it mapped DIVISIONS with no stored-value injection at all. A classifier
 * whose division is blank or unlisted (a migration-carried record, or a hand
 * edit) displayed as DIVISIONS[0], "Carry Optics", while the record held
 * something else, and an untouched Save wrote the wrong division straight
 * back -- moving that score into another division's classification math.
 *
 * Seeded straight into IndexedDB, the way edit-match-picker.spec.ts reaches
 * this same shape of state for matches: no UI path produces a classifier
 * with a blank or unlisted division, only import or a hand-edited backup. */

const CLASSIFIER_ID = 'e2e-picker-classifier';
const CODE = 'E2E-PICK-01';

async function seedClassifier(page: Page, division: string) {
  await page.evaluate(async ({ id, division, code }) => {
    const rec = {
      id, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
      date: '2026-08-01', code, name: '', division,
      hitFactor: null, percent: null, notes: '',
    };
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('firearmlog');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('classifiers', 'readwrite');
        tx.objectStore('classifiers').put(rec);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { id: CLASSIFIER_ID, division, code: CODE });
  await page.reload();
}

async function storedClassifier(page: Page): Promise<{ division: string; updatedAt: number }> {
  return page.evaluate(async (id) => new Promise<{ division: string; updatedAt: number }>((resolve, reject) => {
    const open = indexedDB.open('firearmlog');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const req = db.transaction('classifiers', 'readonly').objectStore('classifiers').get(id);
      req.onsuccess = () => {
        const v = req.result; db.close();
        resolve({ division: v ? String(v.division) : '<<missing>>', updatedAt: v ? Number(v.updatedAt ?? 0) : -1 });
      };
      req.onerror = () => { db.close(); reject(req.error); };
    };
  }), CLASSIFIER_ID);
}

async function storedDivision(page: Page): Promise<string> {
  return (await storedClassifier(page)).division;
}

/** Press Save and WAIT FOR THE WRITE, not for navigation -- mirrors
 *  edit-match-picker.spec.ts's saveAndWaitForWrite. `updatedAt` moves on
 *  every save, including one that changes nothing, so it proves the record
 *  was actually rewritten even when the division under test is expected to
 *  come back identical. */
async function saveAndWaitForWrite(page: Page) {
  const before = await storedClassifier(page);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(async () => (await storedClassifier(page)).updatedAt, { timeout: 10_000 })
    .not.toBe(before.updatedAt);
}

async function openTheClassifier(page: Page) {
  await gotoTab(page, 'Compete');
  await page.getByText(CODE, { exact: false }).first().click();
  await expect(page.getByRole('heading', { name: 'Edit Classifier' })).toBeVisible();
}

function divisionSelect(page: Page) {
  return page.getByLabel('Division');
}

test.describe('Classifier edit: the division picker shows what the record holds', () => {
  test('an unlisted division ("CO") displays as itself, not Carry Optics', async ({ page }) => {
    await seedDemo(page);
    await seedClassifier(page, 'CO');
    await openTheClassifier(page);

    const select = divisionSelect(page);
    // The assertion the pre-fix build fails: it rendered 'Carry Optics' here.
    await expect(select).toHaveValue('CO');
    await expect(select).not.toHaveValue('Carry Optics');
  });

  test('ROUND TRIP: an unlisted division survives an untouched save', async ({ page }) => {
    await seedDemo(page);
    await seedClassifier(page, 'CO');
    expect(await storedDivision(page)).toBe('CO');

    await openTheClassifier(page);
    // This is the whole defect stated as an assertion. Pre-fix this also
    // passed, because the wrong value was only ever on screen -- so the test
    // above (display) is what catches the lie, and this one guarantees the
    // fix did not introduce a write of its own.
    await saveAndWaitForWrite(page);
    expect(await storedDivision(page)).toBe('CO');
  });

  test('a blank division displays as "Not recorded" and round-trips blank', async ({ page }) => {
    // The importer writes '' when a results table has no division column
    // (session-106 finding), so this is a real shipped state, not just CO.
    await seedDemo(page);
    await seedClassifier(page, '');
    expect(await storedDivision(page)).toBe('');

    await openTheClassifier(page);
    const select = divisionSelect(page);
    await expect(select).toHaveValue('');
    const labels = await select.locator('option').evaluateAll((os) => os.map((o) => o.textContent?.trim() ?? ''));
    expect(labels[0]).toBe('Not recorded');

    await saveAndWaitForWrite(page);
    expect(await storedDivision(page)).toBe('');
  });

  test('a recognised division is untouched and offers no extra option', async ({ page }) => {
    await seedDemo(page);
    await seedClassifier(page, 'Limited');
    await openTheClassifier(page);

    const select = divisionSelect(page);
    await expect(select).toHaveValue('Limited');
    const values = await select.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(values).toHaveLength(9); // exactly DIVISIONS, nothing injected
  });
});
