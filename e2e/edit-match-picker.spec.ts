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
  opts: { minimal?: boolean; stageWithoutNotes?: boolean; noDivision?: boolean; noMatchType?: boolean } = {}) {
  await page.evaluate(async ({ id, division, matchType, minimal, stageWithoutNotes, noDivision, noMatchType }) => {
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
      id, date: '2026-08-02', name: 'Picker Round Trip',
      ...(noMatchType ? {} : { matchType }),
      ...(noDivision ? {} : { division }),
      powerFactor: 'Minor', firearmId, scoringType: 'uspsa',
      totalRounds: null, matchPercent: null, divisionPlace: null, divisionOf: null,
      overallPlace: null, overallOf: null,
      // A stage row with no `notes` key at all -- the shape an older record has, and the
      // one that used to take the screen down during render.
      stages: stageWithoutNotes ? [{ number: 1, points: 100, time: 12.5, percent: null }] : [],
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
  }, { id: MATCH_ID, division, matchType, minimal: !!opts.minimal,
       stageWithoutNotes: !!opts.stageWithoutNotes, noDivision: !!opts.noDivision,
       noMatchType: !!opts.noMatchType });
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

/** The division <select>, by id.
 *
 *  NOT getByLabel('Division'): the suggestion callout is labelled "Check this division",
 *  which getByLabel matches as a substring, so the locator resolved to two elements the
 *  moment the callout appeared. And the field's own accessible name absorbs the selected
 *  option's text, because the <label> wraps the <select> -- so the name is not stable
 *  either. The id is. */
function divisionPicker(page: Page) {
  return page.locator('#match-division-select');
}

async function openTheMatch(page: Page) {
  await gotoTab(page, 'Compete');
  await page.getByText('Picker Round Trip').first().click();
  const edit = page.getByRole('button', { name: /Edit/ }).first();
  await edit.click();
  await expect(page.getByLabel('What this match is called')).toBeVisible();
  // The edit form initialises its state ASYNC after mount (setName/setMatchType/
  // ...). An interaction dispatched before that init lands is silently reverted
  // by it — the fail-then-pass flake this file carried (third occurrence 22 Aug
  // 2026, ~23% rate measured over 22 runs; same race class match-mags.spec.ts
  // hit with its rename fill). A person cannot act before the values paint; the
  // tests must not either — wait for the initialised VALUE, not mere visibility.
  await expect(page.getByLabel('What this match is called')).toHaveValue('Picker Round Trip');
}

test.describe('Edit Match: the picker shows what the record holds', () => {
  test('an unrecognised division displays as itself, not as the first option', async ({ page }) => {
    await seedDemo(page);
    await seedMatch(page, 'O');
    await openTheMatch(page);

    const picker = divisionPicker(page);
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

    await expect(divisionPicker(page)).toHaveValue('Limited');
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
    await expect(divisionPicker(page)).toHaveValue('Open');
    // The callout has done its job and goes away.
    await expect(page.getByText('Check this division')).toHaveCount(0);
    // And the entry that only existed to represent 'O' is gone from the list.
    // Assert on the option VALUES, not their text. The first version matched text
    // /^O$/ against an option whose label is 'O (not a recognised division)', so it
    // could never match and passed against any implementation, including one that
    // never removed the entry. A cold audit measured it at 0 before the click too.
    const values = await divisionPicker(page).locator('option')
      .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(values).not.toContain('O');

    await saveAndWaitForWrite(page);
    expect(await storedDivision(page)).toBe('Open');
  });

  test('a value nobody can interpret gets no suggestion at all', async ({ page }) => {
    await seedDemo(page);
    await seedMatch(page, 'ZZ');
    await openTheMatch(page);

    await expect(divisionPicker(page)).toHaveValue('ZZ');
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

test.describe('Edit Match: what the cold audit found', () => {
  /* Every case here is a defect a fresh-eyes audit measured against the first version of
   * this branch. They are E2E rather than unit tests because each one was invisible in
   * the pure functions and only showed up at the rendered <select>. */

  test('a legacy Steel division name shows ITSELF, not centerfire Open', async ({ page }) => {
    // Measured pre-fix: the picker rendered 'Open' while the callout underneath said the
    // record was 'Rimfire Pistol Open'. The screen contradicted itself, and it did so for
    // exactly the records STEEL_DIVISION_ALIASES was written to protect.
    await seedDemo(page);
    await seedMatch(page, 'Rimfire Pistol Open', 'Steel Challenge');
    await openTheMatch(page);

    await expect(divisionPicker(page)).toHaveValue('Rimfire Pistol Open');
    await expect(page.getByRole('button', { name: 'Change it to Rimfire Pistol Optics' })).toBeVisible();
  });

  test('a padded division is shown and offered, not silently swapped', async ({ page }) => {
    // Measured pre-fix: 'Open ' rendered as 'Carry Optics' with NO callout at all.
    await seedDemo(page);
    await seedMatch(page, 'Open ');
    await openTheMatch(page);

    await expect(divisionPicker(page)).toHaveValue('Open ');
    await expect(page.getByRole('button', { name: 'Change it to Open' })).toBeVisible();
  });

  test('a stage with no notes does not take the whole screen down', async ({ page }) => {
    // Measured pre-fix: st.notes.trim() runs inside a useMemo during RENDER, so an
    // undefined stage note did not merely break Save -- Edit Match never appeared, and
    // the error boundary showed "Something went wrong" instead.
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await seedDemo(page);
    await seedMatch(page, 'Limited', 'USPSA Level 1 (club match)', { stageWithoutNotes: true });
    await openTheMatch(page);

    await expect(divisionPicker(page)).toHaveValue('Limited');
    expect(errors, 'rendering must not throw').toEqual([]);
  });

  test('accepting the suggestion leaves focus on the field it changed', async ({ page }) => {
    // Measured pre-fix: document.activeElement was <body>. A keyboard user was dropped at
    // the top of the document with nothing announced.
    await seedDemo(page);
    await seedMatch(page, 'O');
    await openTheMatch(page);

    await page.getByRole('button', { name: 'Change it to Open' }).click();
    await expect(divisionPicker(page)).toBeFocused();
  });
});

test.describe('Edit Match: round 3 of the cold audit', () => {
  test('the padded-value callout names the SPACES, not a difference you cannot see', async ({ page }) => {
    // Measured pre-fix: "saved as Open, which is not one of the divisions in the list.
    // It probably means Open." HTML collapses the trailing space, so the sentence read
    // as nonsense and nothing told the user what the button would actually change.
    await seedDemo(page);
    await seedMatch(page, 'Open ');
    await openTheMatch(page);
    await expect(page.getByText(/with extra spaces around it/)).toBeVisible();
    await expect(page.getByText(/which is not one of the divisions in the list/)).toHaveCount(0);
  });

  test('an injected legacy name is LABELLED, not shown identical to the real ones', async ({ page }) => {
    // Measured pre-fix: the option read plain 'Rimfire Pistol Open', visually identical
    // to the two real Rimfire Pistol entries, while the callout called it unlisted. The
    // label test checked the canonicalised value and the injection test checked the raw
    // one, so they disagreed about the same option.
    await seedDemo(page);
    await seedMatch(page, 'Rimfire Pistol Open', 'Steel Challenge');
    await openTheMatch(page);
    const labels = await divisionPicker(page).locator('option')
      .evaluateAll((os) => os.map((o) => o.textContent?.trim() ?? ''));
    expect(labels[0]).toBe('Rimfire Pistol Open (not in the list)');
  });

  test('a match-type change never invents a division for a record that had none', async ({ page }) => {
    // Measured in round 4: a record holding '' came back 'Open' after one match-type tap
    // and a save. Round 3 made blank a first-class state; round 4 found the fallback
    // still fabricating a value for it.
    await seedDemo(page);
    await seedMatch(page, '');
    await openTheMatch(page);
    await page.getByLabel('Match type').selectOption('Steel Challenge');
    await saveAndWaitForWrite(page);
    expect(await storedDivision(page), 'a blank division must stay blank').toBe('');
  });

  test('five sport switches and a division picked in the middle: nothing is discarded', async ({ page }) => {
    // Round 4 sabotaged the old parking map and watched 21 of 21 tests pass, because no
    // test switched sports more than twice or changed the division while in the second
    // sport. The parking is gone now, but the property it was meant to protect is the
    // one worth asserting, so this walks the sequence that exposed the gap.
    await seedDemo(page);
    await seedMatch(page, 'Revolver');
    await openTheMatch(page);

    await page.getByLabel('Match type').selectOption('Steel Challenge');
    await divisionPicker(page).selectOption('Rimfire Pistol Iron');
    await page.getByLabel('Match type').selectOption('USPSA Level 1 (club match)');
    await expect(divisionPicker(page)).toHaveValue('Rimfire Pistol Iron');
    await page.getByLabel('Match type').selectOption('Steel Challenge');
    await divisionPicker(page).selectOption('PCC Iron');
    await page.getByLabel('Match type').selectOption('IDPA Match');
    await page.getByLabel('Match type').selectOption('Steel Challenge');
    // The shooter's LAST choice survives every switch. Under the old parking map this
    // came back 'Rimfire Pistol Iron' -- an earlier choice silently reinstated over a
    // later one.
    await expect(divisionPicker(page)).toHaveValue('PCC Iron');
  });

  test('a match with no matchType at all still opens', async ({ page }) => {
    // Round 4: the screen went behind the error boundary with "Something went wrong",
    // because scoringTypeFor calls .startsWith on it. matchType and date were the two
    // string fields never defaulted at the load boundary.
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await seedDemo(page);
    await seedMatch(page, 'Limited', 'USPSA Level 1 (club match)', { noMatchType: true });
    await openTheMatch(page);
    await expect(divisionPicker(page)).toHaveValue('Limited');
    expect(errors, 'a missing matchType must not take the screen down').toEqual([]);
  });

  test('the detail screen and the edit screen agree about the same record', async ({ page }) => {
    // Round 4 measured the detail screen reading 'Rimfire Pistol Optics' while Edit one
    // tap away showed 'Rimfire Pistol Open (not in the list)'.
    await seedDemo(page);
    await seedMatch(page, 'Rimfire Pistol Open', 'Steel Challenge');
    await gotoTab(page, 'Compete');
    await page.getByText('Picker Round Trip').first().click();
    await expect(page.getByText('Rimfire Pistol Open', { exact: false }).first()).toBeVisible();
  });

  test('a blank division shows as Not set rather than as the first division', async ({ page }) => {
    // The importer writes '' when the results table carries no division column, so this
    // is a shipped state. Measured pre-fix: it rendered 'Carry Optics' with no callout.
    await seedDemo(page);
    await seedMatch(page, '');
    await openTheMatch(page);
    await expect(divisionPicker(page)).toHaveValue('');
    const labels = await divisionPicker(page).locator('option')
      .evaluateAll((os) => os.map((o) => o.textContent?.trim() ?? ''));
    expect(labels[0]).toBe('Not set');
  });

  test('CHOOSING A MATCH TYPE MUST NOT REWRITE THE DIVISION', async ({ page }) => {
    // The sharpest finding of the round, and a breach of the binding decision that
    // nothing is written the user did not choose. Measured pre-fix END TO END: load a
    // match holding 'Rimfire Pistol Open', pick Steel Challenge, press Save, and the
    // stored division came back 'Rimfire Pistol Optics'. The user changed a match type
    // and the app changed a division.
    await seedDemo(page);
    await seedMatch(page, 'Rimfire Pistol Open', 'USPSA Level 1 (club match)');
    await openTheMatch(page);
    await page.getByLabel('Match type').selectOption('Steel Challenge');
    await saveAndWaitForWrite(page);
    // ASSERT THE VALUE, NOT THE ABSENCE OF ONE WRONG VALUE. The first version read
    // `.not.toBe('Rimfire Pistol Optics')`, which 'Open' satisfies, and '' satisfies, and
    // 'zzz' satisfies. It was GREEN while the division was being rewritten to 'Open' --
    // a test named for the constraint it was failing to check, which is why the defect
    // survived a whole audit round.
    expect(await storedDivision(page),
      'a match-type change must never write ANY division the user did not choose')
      .toBe('Rimfire Pistol Open');
  });

  test('the field points a screen reader at the correction', async ({ page }) => {
    // The whole accessibility fix had NO test, which the audit found by stripping every
    // aria attribute and watching 15/15 still pass.
    await seedDemo(page);
    await seedMatch(page, 'O');
    await openTheMatch(page);
    await expect(divisionPicker(page)).toHaveAttribute('aria-describedby', 'division-suggestion');
    const block = page.locator('#division-suggestion');
    await expect(block).toHaveAttribute('role', 'group');
    await expect(block).toHaveAttribute('aria-labelledby', 'division-suggestion-label');
  });

  test('a record with no division at all does not silently become Carry Optics', async ({ page }) => {
    // Fix 5 (setDivision(m.division ?? '')) had no test either.
    await seedDemo(page);
    await seedMatch(page, 'Limited', 'USPSA Level 1 (club match)', { noDivision: true });
    await openTheMatch(page);
    await expect(divisionPicker(page)).toHaveValue('');
    await saveAndWaitForWrite(page);
    expect(await storedDivision(page)).toBe('');
  });
});

test.describe('Edit Match: the one-way door', () => {
  test('changing match type across sports and back RESTORES the division', async ({ page }) => {
    await seedDemo(page);
    await seedMatch(page, 'Revolver');
    await openTheMatch(page);
    await expect(divisionPicker(page)).toHaveValue('Revolver');

    // Steel Challenge has no bare 'Revolver'. The division STAYS ANYWAY, shown as
    // not-in-the-list, because replacing it would be writing something the shooter did
    // not choose. This assertion inverted when the snap effect was removed in round 4:
    // it used to require the value to move, which is the behaviour that turned out to be
    // the defect.
    await page.getByLabel('Match type').selectOption('Steel Challenge');
    await expect(divisionPicker(page)).toHaveValue('Revolver');

    await page.getByLabel('Match type').selectOption('USPSA Level 1 (club match)');
    await expect(divisionPicker(page)).toHaveValue('Revolver');
  });

  test('a division valid in BOTH sports is not disturbed by the switch', async ({ page }) => {
    await seedDemo(page);
    await seedMatch(page, 'Open');
    await openTheMatch(page);

    await page.getByLabel('Match type').selectOption('Steel Challenge');
    // Steel Challenge has Open too, so nothing should move.
    await expect(divisionPicker(page)).toHaveValue('Open');
    await page.getByLabel('Match type').selectOption('USPSA Level 1 (club match)');
    await expect(divisionPicker(page)).toHaveValue('Open');
  });

  test('LOADING a Steel match does not count as a switch', async ({ page }) => {
    // The load effect changes scoringType, which used to fire the snap and replace the
    // division before the record was ever shown. This is that path.
    await seedDemo(page);
    await seedMatch(page, 'Rimfire Pistol Iron', 'Steel Challenge');
    await openTheMatch(page);
    await expect(divisionPicker(page)).toHaveValue('Rimfire Pistol Iron');
    expect(await storedDivision(page)).toBe('Rimfire Pistol Iron');
  });
});
