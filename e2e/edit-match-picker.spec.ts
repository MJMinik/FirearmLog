import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

/* A picker must be able to show what the record holds (session 106, 6 Aug 2026).
 *
 * THE DEFECT: a <select> whose value matches no <option> renders the FIRST option. The
 * PractiScore importer stores the division column verbatim, so an imported match can
 * hold "O". DIVISIONS[0] is 'Carry Optics', so the Edit screen showed Carry Optics
 * while the record said "O", and Save wrote "O" straight back.
 *
 * WHY THESE TESTS LOOK REDUNDANT AND ARE NOT: eighteen existing checks missed this
 * because every one of them changed the value AWAY and none changed it back. A test
 * that only travels in one direction cannot see a one-way door. Every case below
 * round-trips, and the assertions that matter are the ones AFTER a second save.
 *
 * The record is seeded straight into IndexedDB rather than through the UI, because the
 * UI cannot produce this state -- which is the whole point. It arrives by import. */

const MATCH_ID = 'e2e-picker-match';

/** Write a match record directly, the way an import would, then reload so the app
 *  reads it fresh. `division` is written verbatim: no normalisation anywhere. */
async function seedMatch(page: Page, division: string, matchType = 'USPSA Level 1 (club match)',
  opts: { minimal?: boolean } = {}) {
  await page.evaluate(async ({ id, division, matchType, minimal }) => {
    // A gun is REQUIRED by the form's own validation, so a match seeded without one
    // cannot be saved and the round-trip tests never reach their assertion. Read a real
    // one from the seeded demo rather than inventing an id.
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
      id, date: '2026-08-02', name: 'Picker Round Trip', matchType, division,
      powerFactor: 'Minor', firearmId, scoringType: 'uspsa',
      totalRounds: null, matchPercent: null, divisionPlace: null, divisionOf: null,
      overallPlace: null, overallOf: null, stages: [],
      // `minimal` omits the optional string fields entirely, which is the shape an
      // older record actually has. The default keeps `notes` so the other tests are
      // exercising a normal record rather than the edge case.
      ...(minimal ? {} : { notes: '' }),
    };
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('firearmlog');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('matches', 'readwrite');
        tx.objectStore('matches').put(rec);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { id: MATCH_ID, division, matchType, minimal: !!opts.minimal });
  await page.reload();
}

/** The division as the RECORD holds it, read back out of IndexedDB. This is the only
 *  assertion that means anything: what the screen shows is exactly what was in doubt. */
async function storedMatch(page: Page): Promise<{ division: string; updatedAt: number }> {
  return page.evaluate(async (id) => new Promise<{ division: string; updatedAt: number }>((resolve, reject) => {
    const open = indexedDB.open('firearmlog');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const req = db.transaction('matches', 'readonly').objectStore('matches').get(id);
      req.onsuccess = () => {
        const v = req.result; db.close();
        resolve({ division: v ? String(v.division) : '<<missing>>', updatedAt: v ? Number(v.updatedAt ?? 0) : -1 });
      };
      req.onerror = () => { db.close(); reject(req.error); };
    };
  }), MATCH_ID);
}

async function storedDivision(page: Page): Promise<string> {
  return (await storedMatch(page)).division;
}

/** Press Save and WAIT FOR THE WRITE, not for a screen.
 *
 *  Written this way after three rewrites of a navigation assertion, each of which
 *  failed on where the app goes next rather than on anything these tests are about.
 *  `updatedAt` moves on every save, including one that changes nothing, so it proves
 *  the record was rewritten even when the value under test is expected to be identical
 *  -- which is exactly the case here and the reason a division assertion alone would
 *  have passed against a save that never happened. */
async function saveAndWaitForWrite(page: Page) {
  const before = await storedMatch(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await storedMatch(page)).updatedAt, { timeout: 10_000 })
    .not.toBe(before.updatedAt);
}

async function openTheMatch(page: Page) {
  await gotoTab(page, 'Compete');
  await page.getByText('Picker Round Trip').first().click();
  const edit = page.getByRole('button', { name: /Edit/ }).first();
  await edit.click();
  await expect(page.getByLabel('What this match is called')).toBeVisible();
}

test.describe('Edit Match: the picker shows what the record holds', () => {
  test('an unrecognised division displays as itself, not as the first option', async ({ page }) => {
    await seedDemo(page);
    await seedMatch(page, 'O');
    await openTheMatch(page);

    const picker = page.getByLabel('Division');
    // The assertion the pre-fix build fails: it rendered 'Carry Optics' here.
    await expect(picker).toHaveValue('O');
    await expect(picker).not.toHaveValue('Carry Optics');
  });

  test('ROUND TRIP: saving without touching anything leaves the record unchanged', async ({ page }) => {
    await seedDemo(page);
    await seedMatch(page, 'O');
    expect(await storedDivision(page)).toBe('O');

    await openTheMatch(page);
    await saveAndWaitForWrite(page);

    // This is the whole defect stated as an assertion. Pre-fix it also passed, because
    // the wrong value was only ever on screen -- so the test above is what catches the
    // lie, and this one guarantees the fix did not introduce a write of its own.
    expect(await storedDivision(page)).toBe('O');
  });

  test('a recognised division is untouched and offers nothing', async ({ page }) => {
    await seedDemo(page);
    await seedMatch(page, 'Limited');
    await openTheMatch(page);

    await expect(page.getByLabel('Division')).toHaveValue('Limited');
    await expect(page.getByText('Check this division')).toHaveCount(0);
  });
});

test.describe('Edit Match: the suggestion is offered, never applied', () => {
  test('the callout names the stored value and what it probably means', async ({ page }) => {
    await seedDemo(page);
    await seedMatch(page, 'O');
    await openTheMatch(page);

    await expect(page.getByText('Check this division')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change it to Open' })).toBeVisible();
  });

  test('DECLINING the suggestion changes nothing, through a save', async ({ page }) => {
    await seedDemo(page);
    await seedMatch(page, 'O');
    await openTheMatch(page);

    await expect(page.getByText('Check this division')).toBeVisible();
    // Do not press it. Save anyway.
    await saveAndWaitForWrite(page);
    expect(await storedDivision(page)).toBe('O');
  });

  test('ACCEPTING it writes the real division and retires the unrecognised entry', async ({ page }) => {
    await seedDemo(page);
    await seedMatch(page, 'O');
    await openTheMatch(page);

    await page.getByRole('button', { name: 'Change it to Open' }).click();
    await expect(page.getByLabel('Division')).toHaveValue('Open');
    // The callout has done its job and goes away.
    await expect(page.getByText('Check this division')).toHaveCount(0);
    // And the entry that only existed to represent 'O' is gone from the list.
    await expect(page.getByLabel('Division').locator('option', { hasText: /^O$/ })).toHaveCount(0);

    await saveAndWaitForWrite(page);
    expect(await storedDivision(page)).toBe('Open');
  });

  test('a value nobody can interpret gets no suggestion at all', async ({ page }) => {
    await seedDemo(page);
    await seedMatch(page, 'ZZ');
    await openTheMatch(page);

    await expect(page.getByLabel('Division')).toHaveValue('ZZ');
    await expect(page.getByText('Check this division')).toHaveCount(0);
  });
});

test.describe('Edit Match: a record missing a string field still saves', () => {
  /* Found by this build's own fixture, 6 Aug 2026, and fixed on contact. A stored match
   * lacking practiScoreUrl or notes -- a record written before the field existed, an
   * older .flog restore, an import that never set it -- put undefined into form state
   * typed as string, and Save threw "Cannot read properties of undefined (reading
   * 'trim')" as an UNHANDLED rejection. No message, no error screen: the button simply
   * did nothing, which is worse than a visible failure because nothing tells the user
   * the save did not happen.
   *
   * This test is named rather than left implicit. The round-trip tests above happen to
   * cover it, because their fixture omits practiScoreUrl too -- but coverage that
   * depends on a fixture staying incomplete is coverage that disappears the day someone
   * tidies the fixture. */
  test('a match with no practiScoreUrl and no notes saves without a silent crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await seedDemo(page);
    await seedMatch(page, 'Limited', 'USPSA Level 1 (club match)', { minimal: true });
    await openTheMatch(page);
    await saveAndWaitForWrite(page);

    expect(await storedDivision(page)).toBe('Limited');
    expect(errors, 'saving must not throw an unhandled error').toEqual([]);
  });
});

test.describe('Edit Match: the one-way door', () => {
  test('changing match type across sports and back RESTORES the division', async ({ page }) => {
    await seedDemo(page);
    await seedMatch(page, 'Revolver');
    await openTheMatch(page);
    await expect(page.getByLabel('Division')).toHaveValue('Revolver');

    // Steel Challenge has no bare 'Revolver' division, so the division has to move.
    await page.getByLabel('Match type').selectOption('Steel Challenge');
    await expect(page.getByLabel('Division')).not.toHaveValue('Revolver');

    // Straight back. Pre-fix this landed on 'Carry Optics' and stayed there: two taps
    // to lose a value, with nothing said and no way back.
    await page.getByLabel('Match type').selectOption('USPSA Level 1 (club match)');
    await expect(page.getByLabel('Division')).toHaveValue('Revolver');
  });

  test('a division valid in BOTH sports is not disturbed by the switch', async ({ page }) => {
    await seedDemo(page);
    await seedMatch(page, 'Open');
    await openTheMatch(page);

    await page.getByLabel('Match type').selectOption('Steel Challenge');
    // Steel Challenge has Open too, so nothing should move.
    await expect(page.getByLabel('Division')).toHaveValue('Open');
    await page.getByLabel('Match type').selectOption('USPSA Level 1 (club match)');
    await expect(page.getByLabel('Division')).toHaveValue('Open');
  });

  test('LOADING a Steel match does not count as a switch', async ({ page }) => {
    // The load effect changes scoringType, which used to fire the snap and replace the
    // division before the record was ever shown. This is that path.
    await seedDemo(page);
    await seedMatch(page, 'Rimfire Pistol Iron', 'Steel Challenge');
    await openTheMatch(page);
    await expect(page.getByLabel('Division')).toHaveValue('Rimfire Pistol Iron');
    expect(await storedDivision(page)).toBe('Rimfire Pistol Iron');
  });
});
