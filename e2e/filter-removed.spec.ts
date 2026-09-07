import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { seedDemo, gotoTab, gotoSection } from './helpers';

/* D9 (session 141 UI-lows batch): "a filter that names a deleted item reads
 * 'All ...' while it keeps filtering." Every select this can happen to now
 * shares one helper (src/ui/removedOption.ts) — see that file's docstring for
 * the rule. Three sites, three shapes of "how the record went away while the
 * filter kept pointing at it":
 *  - Log's gun filter is module-scope (searchFilter.ts), so it genuinely
 *    survives a real navigate-away-and-delete-and-come-back round trip.
 *  - Progress's Trends gun filter is ordinary component state, so it only
 *    survives while the SCREEN stays mounted — reproduced here by deleting
 *    the gun out from under it (as a second tab sharing the same local
 *    database would) and then triggering the screen's own in-place data
 *    refresh (adding a Goal), never navigating away.
 *  - MalfunctionsScreen's magazine filter is also component state, and this
 *    screen is read-only (no in-place refresh at all) — its filter can only
 *    ever hold an id that resolves, or one seeded before the screen loads,
 *    which the browser's own <select> API has no way to preselect without a
 *    matching <option>. selectStaleValue() below fires the exact same real
 *    'change' event a click would, carrying the value through the
 *    component's actual onChange handler, so the assertions that follow are
 *    on what the app itself renders in response — not on anything faked.
 */

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

/** Hard-delete a record straight out of IndexedDB — the same primitive the
 *  app's own "forever" delete paths use, without driving their UI. */
async function deleteRaw(page: Page, store: string, id: string) {
  await page.evaluate(async ({ store, id }) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('firearmlog');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(id);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }, { store, id });
}

function gunRecord(id: string, name: string, seq: number) {
  return {
    id, createdAt: 1_700_000_000_000 + seq, updatedAt: 1_700_000_000_000 + seq,
    name, manufacturer: 'Test', model: 'Test', caliber: '9mm', category: 'Pistol',
    serialNumber: null, dateAcquired: '', startingRoundCount: 0,
    recoilSpringInterval: null, recoilSpringWeight: null,
    barrelName: null, barrelInstallDate: null, barrelStartRounds: null,
    deepCleanInterval: null, photoIds: [], referenceId: null, notes: '',
  };
}

function magRecord(id: string, label: string, firearmId: string) {
  return {
    id, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
    label, firearmIds: [firearmId], active: true, totalRounds: 0, springHistory: [], notes: '',
  };
}

/** Minimal valid Match record — same field set as missing-field-crash.spec.ts's
 *  datelessMatch(), since that's the house shape a raw-seeded match needs to
 *  render and open cleanly. */
function matchRecord(id: string, name: string, matchType: string, seq: number) {
  return {
    id, createdAt: 1_700_000_000_000 + seq, updatedAt: 1_700_000_000_000 + seq,
    date: '2026-08-01', name, matchType, division: 'Open',
    powerFactor: 'Minor', firearmId: '', scoringType: 'uspsa', notes: '', stages: [],
    totalRounds: null, matchPercent: null, divisionPlace: null, divisionOf: null,
    overallPlace: null, overallOf: null,
  };
}

/** Fire a real 'change' event on a <select> carrying a value that has no
 *  rendered <option> for it — see the file header for why this is the only
 *  way to reach this state, and why it's still a real exercise of the
 *  component's own onChange handler and render logic, not a faked DOM. */
async function selectStaleValue(select: Locator, value: string) {
  await select.evaluate((el, v) => {
    const opt = document.createElement('option');
    opt.value = v;
    el.appendChild(opt);
    (el as HTMLSelectElement).value = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test.describe('D9: a filter naming a deleted item reads "(removed)", not "All ..."', () => {
  test('Log: deleting the filtered gun leaves the badge honest and the select truthful', async ({ page }) => {
    await seedDemo(page);

    const gunName = `E2E Filter Removed Gun ${Date.now()}`;
    await gotoSection(page, 'Guns');
    await page.getByRole('button', { name: '+ Add Gun' }).click();
    await page.getByRole('textbox', { name: 'What this Gun is called' }).fill(gunName);
    await page.getByRole('button', { name: 'Save gun', exact: true }).click();
    await expect(page.getByText(gunName)).toBeVisible();

    // Filter the Log by this gun.
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: /Search & Filter/ }).click();
    const gunSelect = page.getByLabel('One gun');
    await gunSelect.selectOption({ label: gunName });
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: 'Search & Filter (1)' })).toBeVisible();

    // Delete the gun for good — no logged sessions, so "Delete permanently"
    // is offered (GunRemoveSheet).
    await gotoSection(page, 'Guns');
    await page.getByText(gunName).click();
    await page.getByRole('button', { name: 'Retire or remove this gun…' }).click();
    await page.getByRole('button', { name: 'Delete permanently' }).click();
    await page.getByRole('button', { name: 'Delete Permanently' }).click();
    await expect(page.getByText(gunName)).toHaveCount(0);

    // Back on the Log: the pre-fix build falls through to "All guns" here
    // while the list stays filtered by the dead id and the badge still
    // claims one active filter — the lie this fix closes.
    await gotoTab(page, 'Log');
    await expect(page.getByRole('button', { name: 'Search & Filter (1)' })).toBeVisible();
    await page.getByRole('button', { name: 'Search & Filter (1)' }).click();
    const reopened = page.getByLabel('One gun');
    await expect(reopened.locator('option:checked')).toHaveText('(removed)');

    // Picking "All guns" clears it for good.
    await reopened.selectOption('');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: 'Search & Filter', exact: true })).toBeVisible();
  });

  test('Progress: a gun deleted while the Trends filter is set to it shows "(removed)"', async ({ page }) => {
    await seedDemo(page);

    const GUN_ID = 'e2e-filter-removed-progress-gun';
    const GUN_NAME = 'E2E Filter Removed Progress Gun';
    await seedRaw(page, 'firearms', gunRecord(GUN_ID, GUN_NAME, 1));
    await page.reload();

    await gotoTab(page, 'Progress');
    await page.getByRole('button', { name: 'Filters' }).first().click();
    const gunSelect = page.getByLabel('Gun', { exact: true });
    await gunSelect.selectOption({ label: GUN_NAME });
    await expect(gunSelect).toHaveValue(GUN_ID);

    // The gun is deleted without this screen ever unmounting — exactly what
    // a second tab sharing the same local database would do (rule 41: no
    // server, so any "another actor changed the data" story is local).
    await deleteRaw(page, 'firearms', GUN_ID);

    // Adding a Goal is the lightest action on this screen that re-reads every
    // store (ProgressScreen's own `bump`) without leaving it — the filter's
    // own state isn't part of that re-read, so it survives untouched while
    // the firearms list underneath it changes. Pre-fix, the select silently
    // falls back to "All guns" here.
    await page.getByRole('button', { name: '+ Add Goal' }).click();
    await page.getByLabel('Goal', { exact: true }).fill('E2E filter-removed probe goal');
    await page.getByRole('button', { name: 'Add Goal', exact: true }).click();

    await expect(gunSelect.locator('option:checked')).toHaveText('(removed)');
    await gunSelect.selectOption('');
    await expect(gunSelect).toHaveValue('');
  });

  test('MalfunctionsScreen: a hard-deleted magazine reads "(removed)" in the filter, not "All magazines"', async ({ page }) => {
    await seedDemo(page);

    const GUN_ID = 'e2e-filter-removed-malf-gun';
    const KEEP_ID = 'e2e-filter-removed-malf-mag-keep';
    const GONE_ID = 'e2e-filter-removed-malf-mag-gone';
    await seedRaw(page, 'firearms', gunRecord(GUN_ID, 'E2E Filter Removed Malf Gun', 1));
    await seedRaw(page, 'magazines', magRecord(KEEP_ID, 'E2E Keep Mag', GUN_ID));
    await seedRaw(page, 'magazines', magRecord(GONE_ID, 'E2E Gone Mag', GUN_ID));
    // Hard-deleted BEFORE the screen ever loads — so this isn't a staleness
    // question, it's the exact "the filter names an id today's list doesn't
    // have" shape, with at least one other magazine still on file (list
    // non-empty, so this test never exercises the `{magazines.length > 0 ||
    // filter.magazineId !== ''}` wrapper's second disjunct).
    //
    // Cold audit F3 (session 141): that second disjunct — magazines.length
    // === 0 AND filter.magazineId !== '' — has no test here, and honestly
    // can't: filter is plain useState that resets to emptyMalfFilter() on
    // every mount, magazines only loads on mount (this screen has no
    // in-place refresh — see the file header above), and there's no debug
    // hook exposing React state to an e2e test. So the only way to get
    // filter.magazineId non-empty is to first render the select with a
    // non-empty magazines list (which makes `magazines.length > 0` already
    // true, the same disjunct this test exercises) and pick a real option —
    // by the time a delete could empty the list, the screen would have to
    // remount to see it, which resets the filter to '' again. The widening
    // is covered by code review and by the two-branch symmetry with the
    // reachable half above, not by a browser-driven assertion; a prior
    // version of this comment incorrectly claimed removedOption()'s own
    // unit tests covered it — they cover only the pure "(removed)" label
    // decision, never this JSX wrapper.
    await deleteRaw(page, 'magazines', GONE_ID);
    await page.reload();

    await gotoSection(page, 'Malfunctions');
    await page.getByRole('button', { name: /Search & Filter/ }).click();
    // Not { exact: true } -- unlike ProgressScreen's Gun select (an explicit
    // aria-label="Gun"), this field's accessible name comes from an implicit
    // wrapping <label>, and Chromium's computed name for it folds in the
    // select's own text content (every <option>, not just the selected one).
    // A plain substring match still resolves this one uniquely: no other
    // field on this sheet's accessible name contains "Magazine".
    const magSelect = page.getByLabel('Magazine');
    // The real, still-existing magazine is offered normally.
    await expect(magSelect.locator('option', { hasText: 'E2E Keep Mag' })).toHaveCount(1);

    await selectStaleValue(magSelect, GONE_ID);
    await expect(magSelect).toHaveValue(GONE_ID);
    await expect(magSelect.locator('option:checked')).toHaveText('(removed)');
    await expect(page.getByRole('button', { name: 'Search & Filter (1)' })).toBeVisible();

    await magSelect.selectOption('');
    await expect(magSelect).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Search & Filter', exact: true })).toBeVisible();
  });

  // Cold audit F2 (session 141): the Compete filter's Match type / Division
  // selects are the same D9 shape as Log's and MalfunctionsScreen's above —
  // module-scope filter (competeFilter.ts), options derived from surviving
  // matches (competeFilterOptions), matches hard-deleted via MatchScreens'
  // own reallyDelete (deleteOne('matches', id), no undo). No seedDemo here:
  // its bundled 18-month history isn't guaranteed to leave exactly one match
  // of a given type, and this test needs to know that for certain — MATCH_A
  // is the only match of its type, MATCH_B a different type so the filter
  // bar (and its badge) still has something to render once MATCH_A is gone.
  test('Compete: deleting the last match of a filtered type leaves the badge honest and the select truthful', async ({ page }) => {
    const MATCH_A_ID = 'e2e-filter-removed-match-a';
    const MATCH_B_ID = 'e2e-filter-removed-match-b';
    const MATCH_A_NAME = 'E2E Filter Removed Steel Match';
    await page.goto('/');
    await page.getByRole('button', { name: "Skip for now — I'm just looking around" }).click();
    await expect(page.getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible();
    await seedRaw(page, 'matches', matchRecord(MATCH_A_ID, MATCH_A_NAME, 'Steel Challenge', 1));
    await seedRaw(page, 'matches', matchRecord(MATCH_B_ID, 'E2E Filter Removed Local Match', 'Local / Outlaw', 2));
    await page.reload();

    await gotoTab(page, 'Compete');
    await page.getByRole('button', { name: 'Filter', exact: true }).click();
    // Not { exact: true } -- this field's label implicitly wraps the <select>
    // (no aria-label, unlike ProgressScreen's Gun filter), and Chromium's
    // computed accessible name for that shape folds in every <option>'s text,
    // not just the selected one (same quirk noted above for MalfunctionsScreen's
    // Magazine field). A plain substring match still resolves uniquely: no
    // other field's name on this sheet contains "Match type".
    const typeSelect = page.getByLabel('Match type');
    await typeSelect.selectOption({ label: 'Steel Challenge' });
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: 'Filter (1)' })).toBeVisible();
    await expect(page.getByText(MATCH_A_NAME)).toBeVisible();

    // Delete the filtered match for good — MatchScreens' own irreversible path.
    await page.getByText(MATCH_A_NAME).click();
    await page.getByRole('button', { name: 'Delete match' }).click();
    await page.getByRole('dialog', { name: 'Delete this match?' })
      .getByRole('button', { name: 'Delete match' }).click();
    await expect(page.getByText(MATCH_A_NAME)).toHaveCount(0);

    // Back on Compete: the pre-fix build falls through to "All types" here
    // while the list stays filtered by the dead type and the badge still
    // claims one active filter.
    await gotoTab(page, 'Compete');
    await expect(page.getByRole('button', { name: 'Filter (1)' })).toBeVisible();
    await page.getByRole('button', { name: 'Filter (1)' }).click();
    const reopened = page.getByLabel('Match type');
    await expect(reopened.locator('option:checked')).toHaveText('(removed)');

    // Picking "All types" clears it for good.
    await reopened.selectOption('');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: 'Filter', exact: true })).toBeVisible();
  });
});
