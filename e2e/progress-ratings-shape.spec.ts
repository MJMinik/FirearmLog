import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';
import { formatDayKey } from '../src/lib/dates.ts';

/* D8 (picker sweep, session 139): ProgressScreen.tsx's SkillSheet rebuilt a
 * skill check's `ratings` map from SKILL_AREAS alone before every save, and
 * `putOne` REPLACES the stored document -- so a rating key the app doesn't
 * currently recognise (an older skill area, a hand-edited or imported one)
 * was silently deleted the first time anyone edited the check, even a check
 * that only touched ONE of the eight known areas. This is the one finding in
 * the sweep that DESTROYS data on Save rather than merely mis-displaying it,
 * and the bottom "Save changes" button is unconditional (not gated on
 * `dirty`), so even an untouched open-then-save could trigger it.
 *
 * Seeded straight into IndexedDB: no rating picker in this form can ever
 * write a key outside SKILL_AREAS, so an unknown key only ever arrives via
 * import or a hand-edited backup. Two checks are seeded (not one) because
 * the "History" list that opens a check for EDITING only renders once there
 * are 2+ skill assessments (ProgressScreen.tsx: `history.length > 1`). */

// Dates set well outside the bundled demo dataset's own span (2019, not
// 2026), so a formatDayKey-text lookup can never collide with a real demo
// skill check that happens to land on the same calendar day.
const TARGET_ID = 'e2e-picker-skill-foo';
const TARGET_DATE = '2019-01-05';
const OTHER_ID = 'e2e-picker-skill-other';
const OTHER_DATE = '2019-01-06';

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

async function storedRatings(page: Page): Promise<Record<string, number>> {
  return page.evaluate(async (id) => new Promise<Record<string, number>>((resolve, reject) => {
    const open = indexedDB.open('firearmlog');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const req = db.transaction('skills', 'readonly').objectStore('skills').get(id);
      req.onsuccess = () => { const v = req.result; db.close(); resolve(v ? v.ratings : {}); };
      req.onerror = () => { db.close(); reject(req.error); };
    };
  }), TARGET_ID);
}

async function storedRatingsById(page: Page, id: string): Promise<Record<string, number>> {
  return page.evaluate(async (id) => new Promise<Record<string, number>>((resolve, reject) => {
    const open = indexedDB.open('firearmlog');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const req = db.transaction('skills', 'readonly').objectStore('skills').get(id);
      req.onsuccess = () => { const v = req.result; db.close(); resolve(v ? v.ratings : {}); };
      req.onerror = () => { db.close(); reject(req.error); };
    };
  }), id);
}

test.describe('Progress: editing a skill check keeps ratings the app does not recognise', () => {
  test.beforeEach(async ({ page }) => {
    await seedDemo(page);
    await seedRaw(page, 'skills', {
      id: TARGET_ID, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
      date: TARGET_DATE, ratings: { draw: 5, foo: 7 }, notes: '',
    });
    await seedRaw(page, 'skills', {
      id: OTHER_ID, createdAt: 1_700_000_000_001, updatedAt: 1_700_000_000_001,
      date: OTHER_DATE, ratings: { reload: 4 }, notes: '',
    });
    await page.reload();
  });

  test('editing one known rating and saving leaves an unknown key ("foo") untouched', async ({ page }) => {
    await gotoTab(page, 'Progress');
    // The History row for the target check, by its date.
    await page.getByRole('button', { name: formatDayKey(TARGET_DATE), exact: false }).first().click();
    // Scoped to the sheet (role="dialog"): the Progress screen behind it has
    // its own "Draw"-labelled controls (a North Star star toggle, a goal
    // checkbox, an evidence link, the trend chart's own aria-label...), so an
    // unscoped getByLabel('Draw') is ambiguous the moment any of those exist.
    const sheet = page.getByRole('dialog', { name: 'Edit Check' });
    await expect(sheet).toBeVisible();
    const draw = sheet.getByLabel('Draw', { exact: true });
    await expect(draw).toHaveValue('5');

    // Change the one KNOWN rating this sheet can see.
    await draw.selectOption('8');
    await sheet.getByRole('button', { name: 'Save changes' }).click();
    await expect(sheet).toHaveCount(0);

    // The assertion the pre-fix build fails: 'foo' used to vanish the moment
    // ANY known rating was edited and saved, because putOne replaces the
    // whole ratings map and the pre-fix rebuild only ever knew SKILL_AREAS.
    const ratings = await storedRatings(page);
    expect(ratings.foo, 'a rating key outside SKILL_AREAS must survive an edit').toBe(7);
    expect(ratings.draw).toBe(8);
  });

  test('clearing a known rating to blank still removes it, unaffected by the fix', async ({ page }) => {
    // Constraining test (cold audit, session 140): the fix keeps the STORED
    // ratings as its base and only deletes the SKILL_AREAS keys before
    // re-adding them -- a weaker version of that fix (spreading the stored
    // ratings and re-adding rated areas, but skipping the `delete r[a.key]`
    // step first) would pass the 'foo' test above just as well, because it
    // never touches unknown keys either way. It would also let a known
    // rating that was just CLEARED survive from the spread, since nothing
    // ever removes it. This test only goes red for that specific mistake:
    // seed two known ratings, clear one to blank, and require it to be
    // GONE from the saved document, not merely unwritten.
    const CLEAR_ID = 'e2e-picker-skill-clear-known';
    const CLEAR_DATE = '2019-01-08';
    await seedRaw(page, 'skills', {
      id: CLEAR_ID, createdAt: 1_700_000_000_003, updatedAt: 1_700_000_000_003,
      date: CLEAR_DATE, ratings: { draw: 5, reload: 4 }, notes: '',
    });
    await page.reload();
    await gotoTab(page, 'Progress');
    await page.getByRole('button', { name: formatDayKey(CLEAR_DATE), exact: false }).first().click();
    const sheet = page.getByRole('dialog', { name: 'Edit Check' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel('Draw', { exact: true })).toHaveValue('5');
    await expect(sheet.getByLabel('Reload', { exact: true })).toHaveValue('4');

    await sheet.getByLabel('Draw', { exact: true }).selectOption('');
    await sheet.getByRole('button', { name: 'Save changes' }).click();
    await expect(sheet).toHaveCount(0);

    expect(await storedRatingsById(page, CLEAR_ID)).toEqual({ reload: 4 });
  });

  test('a stored 0 still reads as blank, unaffected by the fix', async ({ page }) => {
    await seedRaw(page, 'skills', {
      id: 'e2e-picker-skill-zero', createdAt: 1_700_000_000_002, updatedAt: 1_700_000_000_002,
      date: '2019-01-07', ratings: { draw: 0, reload: 6 }, notes: '',
    });
    await page.reload();
    await gotoTab(page, 'Progress');
    await page.getByRole('button', { name: formatDayKey('2019-01-07'), exact: false }).first().click();
    const sheet = page.getByRole('dialog', { name: 'Edit Check' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel('Draw', { exact: true })).toHaveValue('');
    await expect(sheet.getByLabel('Reload', { exact: true })).toHaveValue('6');
  });
});
