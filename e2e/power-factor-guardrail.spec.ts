import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// T3-6a (July 23 2026): USPSA's Minor-only divisions -- Production, Carry Optics,
// Limited Optics, and PCC -- can't actually be scored Major, so the match form
// locks the Power Factor segment to Minor and disables Major there, with an
// InfoTip explaining why. Switching to any other division re-enables the choice.
// Runs on both the desktop and phone projects.

type Page = import('@playwright/test').Page;

// A cold audit (session after the initial build) found that a TRUE legacy record
// -- one already stored with division 'Carry Optics' / powerFactor 'Major' before
// this guardrail existed -- did NOT get corrected on edit: the form's initial
// `division` state defaults to 'Carry Optics', so when the loaded record is ALSO
// Carry Optics, the guardrail effect's dependency array never actually changes and
// the effect never re-runs after the legacy powerFactor loads. The form can no
// longer CREATE such a record (this guardrail prevents that going forward), so the
// only way to reproduce the legacy case is to write one directly into IndexedDB,
// bypassing the app entirely -- exactly what a pre-existing install or a sync file
// from before this guardrail shipped would look like.
async function seedLegacyMatch(page: Page, overrides: Record<string, unknown> = {}): Promise<void> {
  await page.evaluate(async (overrides) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('firearmlog', 2);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const now = Date.now();
    const record = {
      id: 'legacy-major-co', createdAt: now, updatedAt: now,
      date: '2025-01-01', name: 'Legacy CO Major', matchType: 'USPSA Level 1 (club match)',
      division: 'Carry Optics', powerFactor: 'Major', firearmId: 'fa-dr920',
      totalRounds: null, overallPlace: null, overallOf: null, divisionPlace: null, divisionOf: null,
      matchPercent: null, stages: [], entryFee: null, practiScoreUrl: '', notes: '',
      ...overrides,
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('matches', 'readwrite');
      tx.objectStore('matches').put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, overrides);
}

/** Reads a match record straight from IndexedDB -- the ground truth for what was
 *  actually persisted, independent of anything the UI renders. */
async function readMatchPowerFactor(page: Page, id: string): Promise<string | undefined> {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('firearmlog', 2);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const record = await new Promise<{ powerFactor?: string } | undefined>((resolve, reject) => {
      const tx = db.transaction('matches', 'readonly');
      const getReq = tx.objectStore('matches').get(id);
      getReq.onsuccess = () => resolve(getReq.result as { powerFactor?: string } | undefined);
      getReq.onerror = () => reject(getReq.error);
    });
    db.close();
    return record?.powerFactor;
  }, id);
}

test.describe('Power factor guardrail (T3-6a)', () => {
  test('switching into a Minor-only division forces Minor and disables Major; switching out re-enables it', async ({ page }) => {
    await seedDemo(page); // seeds a gun so the match form has one to pick
    await gotoTab(page, 'Compete');
    await page.getByRole('main').getByRole('button', { name: '+ Log Match' }).click();
    await expect(page.getByRole('heading', { name: 'Log Match' })).toBeVisible();

    // getByLabel is unreliable for the Division <select> here (its accessible
    // name picks up option text too), so target it by a USPSA-only option that's
    // always present regardless of what's currently selected -- same technique
    // idpa-scoring.spec.ts uses.
    const division = page.locator('select', { has: page.locator('option', { hasText: 'Single Stack' }) });
    const major = page.getByRole('button', { name: 'Major', exact: true });
    const minor = page.getByRole('button', { name: 'Minor', exact: true });

    // Open is not Minor-only: Major is a real, enabled choice.
    await division.selectOption('Open');
    await expect(major).not.toHaveAttribute('aria-disabled', 'true');
    await major.click();
    await expect(major).toHaveAttribute('aria-pressed', 'true');

    // Switching into Carry Optics (Minor-only) snaps back to Minor and disables Major.
    await division.selectOption('Carry Optics');
    await expect(minor).toHaveAttribute('aria-pressed', 'true');
    await expect(major).toHaveAttribute('aria-pressed', 'false');
    await expect(major).toHaveAttribute('aria-disabled', 'true');
    // The InfoTip explains why -- open it and check the wording.
    await page.getByRole('button', { name: 'Help for Power Factor' }).click();
    await expect(page.getByText(/Major isn.t available in this division/)).toBeVisible();
    // Major can't be picked while disabled.
    await major.click({ force: true });
    await expect(minor).toHaveAttribute('aria-pressed', 'true');

    // Switching to Limited (not Minor-only) re-enables the choice, and Major is a
    // real, clickable option again.
    await division.selectOption('Limited');
    await expect(major).not.toHaveAttribute('aria-disabled', 'true');
    await major.click();
    await expect(major).toHaveAttribute('aria-pressed', 'true');
  });

  test('a fresh Open/Major record is left alone on re-open (Open is never Minor-only)', async ({ page }) => {
    // Built through the UI (Open/Major is a perfectly legal combination), then
    // re-opened for edit to confirm the guardrail has no opinion about a division
    // it doesn't apply to.
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    await page.getByRole('main').getByRole('button', { name: '+ Log Match' }).click();
    await page.getByLabel('What this match is called').fill('Open Major Test');
    await page.locator('select', { has: page.locator('option', { hasText: 'Single Stack' }) }).selectOption('Open');
    await page.getByRole('button', { name: 'Major', exact: true }).click();
    await page.getByRole('button', { name: 'Save match' }).click();
    await expect(page.getByRole('heading', { name: 'Open Major Test' })).toBeVisible();

    // Re-open for edit: Open/Major is untouched (Open is never Minor-only).
    await page.getByRole('button', { name: 'Edit' }).click();
    const major = page.getByRole('button', { name: 'Major', exact: true });
    await expect(major).toHaveAttribute('aria-pressed', 'true');
    await expect(major).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('a TRUE legacy record (Carry Optics/Major, pre-dating this guardrail) is corrected on edit and Save persists Minor', async ({ page }) => {
    // The form itself can no longer create a Carry Optics/Major match, so this
    // seeds one directly into IndexedDB -- exactly what an install from before
    // this guardrail shipped, or an untouched sync file, would carry.
    await seedDemo(page);
    await seedLegacyMatch(page);
    await page.reload();
    await gotoTab(page, 'Compete');

    await page.getByRole('main').getByRole('button', { name: /Legacy CO Major/ }).click();
    await expect(page.getByRole('heading', { name: 'Legacy CO Major' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Match' })).toBeVisible();

    // The legacy Major is corrected to Minor on load, not left pressed AND
    // disabled at once (the exact bug the audit caught).
    const major = page.getByRole('button', { name: 'Major', exact: true });
    const minor = page.getByRole('button', { name: 'Minor', exact: true });
    await expect(minor).toHaveAttribute('aria-pressed', 'true');
    await expect(major).toHaveAttribute('aria-pressed', 'false');
    await expect(major).toHaveAttribute('aria-disabled', 'true');

    // Saving persists the corrected Minor -- read the record back from IndexedDB
    // itself, not just what the UI renders.
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { name: 'Legacy CO Major' })).toBeVisible();
    await expect(async () => {
      expect(await readMatchPowerFactor(page, 'legacy-major-co')).toBe('Minor');
    }).toPass();
  });
});
