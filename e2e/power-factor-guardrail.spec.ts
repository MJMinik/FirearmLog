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
      const req = indexedDB.open('firearmlog');
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
      const req = indexedDB.open('firearmlog');
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

// power-factor-codes fix (POWER_FACTOR_NORMALISATION_SPEC.md): PractiScore's own
// pages write the short codes 'Min'/'Maj', not the full words, and a record
// imported before this fix stores exactly that short code -- the "pre-fix shape"
// these tests seed directly into IndexedDB, the same way seedLegacyMatch above
// reproduces a record from before the T3-6a guardrail.
test.describe('Power factor short codes (power-factor-codes fix)', () => {
  test('a match seeded with the short code "Maj" shows Major pressed on Edit Match, and Save leaves it unchanged', async ({ page }) => {
    await seedDemo(page);
    await seedLegacyMatch(page, {
      id: 'legacy-maj-open', name: 'Legacy Maj Open', matchType: 'USPSA Level 1 (club match)',
      division: 'Open', powerFactor: 'Maj',
    });
    await page.reload();
    await gotoTab(page, 'Compete');

    await page.getByRole('main').getByRole('button', { name: /Legacy Maj Open/ }).click();
    await expect(page.getByRole('heading', { name: 'Legacy Maj Open' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Match' })).toBeVisible();

    // The pressed state reads the CANONICAL form of what's stored -- a record
    // holding 'Maj' shows Major pressed, not neither button lit (the exact
    // defect spec section 1.2 step 4 describes: "nothing on the screen tells
    // them what the record holds").
    const major = page.getByRole('button', { name: 'Major', exact: true });
    const minor = page.getByRole('button', { name: 'Minor', exact: true });
    await expect(major).toHaveAttribute('aria-pressed', 'true');
    await expect(minor).toHaveAttribute('aria-pressed', 'false');

    // Saving without touching the control leaves the stored short code exactly
    // as it was -- nothing is written on load, and an untouched field is never
    // silently rewritten to the full word.
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { name: 'Legacy Maj Open' })).toBeVisible();
    await expect(async () => {
      expect(await readMatchPowerFactor(page, 'legacy-maj-open')).toBe('Maj');
    }).toPass();
  });

  test('a match seeded with powerFactor "Min" in a Minor-only division survives an untouched Save as "Min" (Michael\'s own data shape)', async ({ page }) => {
    // Michael shoots Minor, and PractiScore's real pages write 'Min', not
    // 'Minor' -- so this is what every one of his own imported matches
    // actually looks like on disk. Before this branch, the T3-6a guardrail
    // effect compared the raw string to the literal 'Minor', so a stored
    // 'Min' in a Minor-only division ('Min' !== 'Minor') rewrote itself to
    // 'Minor' on every single Edit Match, whether the shooter touched the
    // power factor control or not.
    await seedDemo(page);
    await seedLegacyMatch(page, {
      id: 'legacy-min-co', name: 'Legacy Min Carry Optics', matchType: 'USPSA Level 1 (club match)',
      division: 'Carry Optics', powerFactor: 'Min',
    });
    await page.reload();
    await gotoTab(page, 'Compete');

    await page.getByRole('main').getByRole('button', { name: /Legacy Min Carry Optics/ }).click();
    await expect(page.getByRole('heading', { name: 'Legacy Min Carry Optics' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Match' })).toBeVisible();

    // 'Min' already reads as Minor -- the guardrail recognises it as already
    // correct for this Minor-only division and has nothing to fix.
    const minor = page.getByRole('button', { name: 'Minor', exact: true });
    await expect(minor).toHaveAttribute('aria-pressed', 'true');

    // Saving untouched must leave the exact short code on disk -- 'Min', not
    // a silently "corrected" 'Minor'.
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { name: 'Legacy Min Carry Optics' })).toBeVisible();
    await expect(async () => {
      expect(await readMatchPowerFactor(page, 'legacy-min-co')).toBe('Min');
    }).toPass();
  });

  test('switching an existing Steel match to a USPSA type in the form presses Minor and Save writes "Minor" (cold audit M-3)', async ({ page }) => {
    // The Steel rider (decision 4a) leaves powerFactor at '' when a non-USPSA
    // match loads. Before M-3's fix, nothing in the form ever moved it off ''
    // again -- so picking a USPSA match type for an EXISTING Steel record left
    // neither segmented-control button pressed, and an untouched Save would
    // write '' onto a record now typed USPSA, which has no legal empty power
    // factor.
    await seedDemo(page);
    await seedLegacyMatch(page, {
      id: 'legacy-steel-to-uspsa', name: 'Legacy Steel To USPSA', matchType: 'Steel Challenge',
      division: 'Open', powerFactor: '',
    });
    await page.reload();
    await gotoTab(page, 'Compete');

    await page.getByRole('main').getByRole('button', { name: /Legacy Steel To USPSA/ }).click();
    await expect(page.getByRole('heading', { name: 'Legacy Steel To USPSA' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Match' })).toBeVisible();

    // Still Steel on open -- no power-factor control at all.
    await expect(page.getByRole('group', { name: 'Power factor' })).toHaveCount(0);

    await page.getByLabel('Match type').selectOption('USPSA Level 1 (club match)');

    // The moment the type becomes USPSA, the empty power factor gets a real
    // default -- Minor pressed, not neither button lit.
    const minor = page.getByRole('button', { name: 'Minor', exact: true });
    await expect(minor).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { name: 'Legacy Steel To USPSA' })).toBeVisible();
    await expect(async () => {
      expect(await readMatchPowerFactor(page, 'legacy-steel-to-uspsa')).toBe('Minor');
    }).toPass();
  });

  test('a Steel match seeded with powerFactor "" keeps it "" through an unrelated edit (the Steel rider, decision 4a)', async ({ page }) => {
    await seedDemo(page);
    await seedLegacyMatch(page, {
      id: 'legacy-steel-blank-pf', name: 'Legacy Steel Blank PF', matchType: 'Steel Challenge',
      division: 'Open', powerFactor: '',
    });
    await page.reload();
    await gotoTab(page, 'Compete');

    await page.getByRole('main').getByRole('button', { name: /Legacy Steel Blank PF/ }).click();
    await expect(page.getByRole('heading', { name: 'Legacy Steel Blank PF' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Match' })).toBeVisible();

    // Steel has no power-factor concept -- the segmented control doesn't even
    // render for it, so there is nothing on this screen that could have
    // written a value into the field.
    await expect(page.getByRole('group', { name: 'Power factor' })).toHaveCount(0);

    // An edit with nothing to do with power factor -- renaming the match --
    // used to default the empty field to 'Minor' on load and write that back
    // on Save. It must still be '' after this save.
    await page.getByLabel('What this match is called').fill('Legacy Steel Blank PF Renamed');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { name: 'Legacy Steel Blank PF Renamed' })).toBeVisible();
    await expect(async () => {
      expect(await readMatchPowerFactor(page, 'legacy-steel-blank-pf')).toBe('');
    }).toPass();
  });
});
