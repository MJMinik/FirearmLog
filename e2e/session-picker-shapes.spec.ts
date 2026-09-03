import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedDemo, gotoTab, openGunsSection } from './helpers';

/* D5, D6 (session half), D7 (picker sweep, session 139) -- three separate
 * SessionForm.tsx picker defects, grouped in one file because they all live
 * on the same screen and share the same seeding idiom: write the record
 * straight into IndexedDB the way an import or a prior version of the form
 * would, then reload so the app reads it fresh. None of these states is
 * reachable by driving the current UI alone. */

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

async function getAllFrom<T>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(async (store) => new Promise<T[]>((resolve, reject) => {
    const open = indexedDB.open('firearmlog');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => { db.close(); resolve(req.result as T[]); };
      req.onerror = () => { db.close(); reject(req.error); };
    };
  }), store);
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

/** Open an existing session by its unique location text, and wait for the
 *  form's async load (getOne) to actually land -- SessionForm initialises
 *  its state after mount, and acting before that lands gets silently
 *  reverted by it (the same race edit-match-picker.spec.ts's openTheMatch
 *  guards against). Waiting for the loaded Where field's value is the signal
 *  that every other loaded field (kind, guns, malfunctions...) is in too,
 *  since they're all set in the same effect. */
async function openTheSession(page: Page, locationText: string) {
  await gotoTab(page, 'Log');
  await page.locator('.row-tap', { hasText: locationText }).first().click();
  await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
  await expect(page.getByLabel('Where')).toHaveValue(locationText);
}

/** Press the navbar Save button and wait for a return to the Log tab --
 *  SessionForm's onSaved sets the tab, which only happens after doPersist's
 *  session write AND its malfunction/skill-set rewrites have all resolved
 *  (they run sequentially, awaited, inside the same async function). */
async function saveAndReturnToLog(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();
}

test.describe('D5: a malfunction re-pointed to another gun clears the old magazine', () => {
  const GUN_A_ID = 'e2e-picker-repoint-a';
  const GUN_B_ID = 'e2e-picker-repoint-b';
  const GUN_A_NAME = 'E2E Picker Gun Alpha';
  const GUN_B_NAME = 'E2E Picker Gun Bravo';
  const MAG_A_ID = 'e2e-picker-repoint-mag-a';
  const MAG_B_ID = 'e2e-picker-repoint-mag-b';
  const SESSION_ID = 'e2e-picker-repoint-session';
  const MALF_ID = 'e2e-picker-repoint-malf';
  const LOCATION = 'E2E Picker Repoint Session';

  test.beforeEach(async ({ page }) => {
    await seedDemo(page);
    await seedRaw(page, 'firearms', gunRecord(GUN_A_ID, GUN_A_NAME, 1));
    await seedRaw(page, 'firearms', gunRecord(GUN_B_ID, GUN_B_NAME, 2));
    // Gun A needs a magazine OF ITS OWN here: magazinesForFirearm() falls
    // back to offering every magazine on file when a gun has none linked,
    // which would let gun B's magazine keep working as a coincidental
    // option after the re-point. Giving A its own mag closes that back
    // door, so the fixture actually exercises "B's magazine has no option
    // under A" rather than "it happens to still have one."
    await seedRaw(page, 'magazines', magRecord(MAG_A_ID, 'Picker Mag A1', GUN_A_ID));
    await seedRaw(page, 'magazines', magRecord(MAG_B_ID, 'Picker Mag B1', GUN_B_ID));
    await seedRaw(page, 'sessions', {
      id: SESSION_ID, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
      date: '2026-08-01', type: 'practice',
      guns: [{ firearmId: GUN_A_ID, rounds: 50 }, { firearmId: GUN_B_ID, rounds: 30, magIds: [MAG_B_ID] }],
      location: LOCATION, distances: '', notes: '', ammoUsage: [], drills: [],
      targetMediaIds: [], malfunctions: [], selfRating: null, rangeFee: null,
      planned: false, checklist: null,
    });
    await seedRaw(page, 'malfunctions', {
      id: MALF_ID, sessionId: SESSION_ID, date: '2026-08-01', firearmId: GUN_B_ID,
      type: 'Stovepipe', resolution: '', notes: '', ammoId: null, magazineId: MAG_B_ID, roundCount: null,
    });
    await page.reload();
  });

  test('removing gun B re-points the malfunction to gun A and clears its magazine', async ({ page }) => {
    await openTheSession(page, LOCATION);
    await openGunsSection(page);

    const gunsCard = page.getByTestId('session-guns-card');
    const bToggle = gunsCard.getByRole('button', { name: GUN_B_NAME });
    await expect(bToggle).toHaveAttribute('aria-pressed', 'true');
    await bToggle.click(); // remove gun B from the session

    const whichGun = page.locator('label', { hasText: 'Which gun' }).locator('select');
    // NOT a hasText('Magazine') label filter: that matches on the label's full
    // textContent, which includes every <option> under it -- and the "How you
    // cleared it" select's merged options are pooled from every malfunction in
    // the demo dataset (savedClearMethods), one of which happens to contain
    // the word "magazine". getByLabel uses the accessible-name algorithm
    // instead, where a nested <select> contributes only its OWN selected
    // option, not its whole option list, so it doesn't fall into that trap.
    const magazine = page.getByLabel('Magazine (optional)');
    await expect(whichGun).toHaveValue(GUN_A_ID);
    // The field reads "— Not sure —" both pre- and post-fix -- B's mag has
    // no option under A either way, so the browser falls through to the
    // first <option>, which happens to already be the blank one. That is
    // exactly the shape of this defect (memo: "displayed as no magazine at
    // all"): the LIE is not on screen, it is in what Save writes next, which
    // is why the assertion that actually distinguishes pre-fix from post-fix
    // is on the STORED record below, not on this display.
    await expect(magazine).toHaveValue('');

    await saveAndReturnToLog(page);

    // Malfunctions are rewritten with a NEW id on every save (the old ids are
    // deleted and replaced), so read back by sessionId rather than MALF_ID.
    const rows = (await getAllFrom<{ sessionId: string; firearmId: string; magazineId: string | null }>(page, 'malfunctions'))
      .filter((m) => m.sessionId === SESSION_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].firearmId).toBe(GUN_A_ID);
    // This is the defect stated as an assertion: pre-fix, magazineId still
    // held MAG_B_ID here -- gun A's malfunction carrying gun B's magazine,
    // while the field itself displayed no magazine at all.
    expect(rows[0].magazineId, 'the old gun\'s magazine must not survive a re-point').toBeNull();
  });

  test('hand-changing the malfunction row\'s own "Which gun" clears the magazine too (second door)', async ({ page }) => {
    // Cold audit, session 140: the ~531 effect only re-points a malfunction
    // AUTOMATICALLY, when its gun leaves the session -- that's the test
    // above. This is the SAME defect through a door the effect never
    // covers: a shooter switching this row's own "Which gun" select by
    // hand, with BOTH guns still selected in the session. Neither gun ever
    // leaves the session here, so the effect never fires at all.
    await openTheSession(page, LOCATION);

    const whichGun = page.locator('label', { hasText: 'Which gun' }).locator('select');
    const magazine = page.getByLabel('Magazine (optional)');
    await expect(whichGun).toHaveValue(GUN_B_ID);
    await expect(magazine).toHaveValue(MAG_B_ID);

    await whichGun.selectOption(GUN_A_ID);
    // The assertion this test exists to prove: without the onChange clear,
    // magazineId stays MAG_B_ID underneath the new gun. The third-door fix
    // (below, and in the malfunction row's own Magazine select) means the
    // field wouldn't even go back to lying by then -- it would correctly
    // show "Picker Mag B1 (other gun)" rather than falling through to
    // "— Not sure —" -- so this is the assertion that actually distinguishes
    // "cleared" from "merely truthfully labelled": Save must write null, not
    // a real, just-differently-owned id.
    await expect(magazine).toHaveValue('');

    await saveAndReturnToLog(page);
    const rows = (await getAllFrom<{ sessionId: string; firearmId: string; magazineId: string | null }>(page, 'malfunctions'))
      .filter((m) => m.sessionId === SESSION_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].firearmId).toBe(GUN_A_ID);
    expect(rows[0].magazineId, 'a hand gun-change must clear the old magazine too').toBeNull();
  });

  test('a magazine unlinked from the malfunction\'s gun shows "(other gun)", never "— Not sure —" (third door)', async ({ page }) => {
    // Cold audit, session 140: a magazineId that still resolves to a real
    // magazine, just not one linked to THIS malfunction's gun -- unlinked
    // from the gun after the malfunction was logged, or arriving this way
    // via import -- is neither "removed" (the magazine exists) nor a case
    // the D5 re-point fixes touch (no re-point happens here at all). Its own
    // scenario, its own session, so the beforeEach malfunction (and its
    // single Magazine select) doesn't collide with this one's locator.
    const SESSION_ID_3 = 'e2e-picker-repoint-other-gun-session';
    const MALF_ID_3 = 'e2e-picker-repoint-other-gun-malf';
    const LOCATION_3 = 'E2E Picker Other-Gun Mag Session';
    await seedRaw(page, 'sessions', {
      id: SESSION_ID_3, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
      date: '2026-08-01', type: 'practice', guns: [{ firearmId: GUN_A_ID, rounds: 20 }],
      location: LOCATION_3, distances: '', notes: '', ammoUsage: [], drills: [],
      targetMediaIds: [], malfunctions: [], selfRating: null, rangeFee: null,
      planned: false, checklist: null,
    });
    // MAG_B_ID exists (magRecord in beforeEach) but its firearmIds is
    // [GUN_B_ID] only -- gun A never has it, so it can never appear as an
    // option under gun A's own scoped magazinesForFirearm() list. Gun A
    // already has its OWN real magazine (MAG_A_ID) linked, which is what
    // keeps magazinesForFirearm() from falling back to offering every
    // magazine on file -- the same reasoning the beforeEach comment gives
    // for the re-point test above.
    await seedRaw(page, 'malfunctions', {
      id: MALF_ID_3, sessionId: SESSION_ID_3, date: '2026-08-01', firearmId: GUN_A_ID,
      type: 'Failure to feed', resolution: '', notes: '', ammoId: null, magazineId: MAG_B_ID, roundCount: null,
    });
    await page.reload();

    await openTheSession(page, LOCATION_3);
    const magazine = page.getByLabel('Magazine (optional)');
    // The assertion the pre-fix build fails: it fell through to
    // "— Not sure —" exactly like a real "nothing picked" state, even though
    // the magazine is real and simply belongs to a different gun.
    await expect(magazine).toHaveValue(MAG_B_ID);
    await expect(magazine.locator('option:checked')).toHaveText('Picker Mag B1 (other gun)');
    // Gun A's own real magazine is still offered alongside the ghost row.
    await expect(magazine.locator('option', { hasText: 'Picker Mag A1' })).toHaveCount(1);

    await saveAndReturnToLog(page);
    const rows = (await getAllFrom<{ sessionId: string; magazineId: string | null }>(page, 'malfunctions'))
      .filter((m) => m.sessionId === SESSION_ID_3);
    expect(rows).toHaveLength(1);
    expect(rows[0].magazineId, 'untouched, the other-gun magazine id must round-trip unchanged').toBe(MAG_B_ID);
  });
});

test.describe('D6: a reference to a deleted ammo can or magazine reads "(removed)"', () => {
  const GUN_A_ID = 'e2e-picker-ghost-a';
  const GUN_A_NAME = 'E2E Picker Ghost Gun';
  const MAG_A_ID = 'e2e-picker-ghost-mag-real';
  const GHOST_MAG_ID = 'e2e-does-not-exist-magazine';
  const GHOST_AMMO_ID_SESSION = 'e2e-does-not-exist-ammo-session';
  const GHOST_AMMO_ID_MALF = 'e2e-does-not-exist-ammo-malf';

  test.beforeEach(async ({ page }) => {
    await seedDemo(page);
    await seedRaw(page, 'firearms', gunRecord(GUN_A_ID, GUN_A_NAME, 1));
    await seedRaw(page, 'magazines', magRecord(MAG_A_ID, 'Picker Real Mag A1', GUN_A_ID));
  });

  test('a session ammo row whose can is gone shows "(removed)", not "Pick ammo..."', async ({ page }) => {
    const SESSION_ID = 'e2e-picker-ghost-session-ammo';
    await seedRaw(page, 'sessions', {
      id: SESSION_ID, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
      date: '2026-08-01', type: 'practice', guns: [{ firearmId: GUN_A_ID, rounds: 20 }],
      location: 'E2E Picker Ghost Ammo Session', distances: '', notes: '',
      ammoUsage: [{ ammoId: GHOST_AMMO_ID_SESSION, rounds: 20 }], drills: [],
      targetMediaIds: [], malfunctions: [], selfRating: null, rangeFee: null,
      planned: false, checklist: null,
    });
    await page.reload();

    await openTheSession(page, 'E2E Picker Ghost Ammo Session');
    // exact: true -- "Ammo 1" is otherwise a case-insensitive substring of
    // the neighbouring rounds input's own aria-label, "Rounds of ammo 1".
    const ammoSelect = page.getByLabel('Ammo 1', { exact: true });
    // The assertion the pre-fix build fails: it fell through to
    // "Pick ammo...", a false "nothing chosen" reading.
    await expect(ammoSelect).toHaveValue(GHOST_AMMO_ID_SESSION);
    await expect(ammoSelect.locator('option:checked')).toHaveText('(removed)');

    await saveAndReturnToLog(page);
    const rows = (await getAllFrom<{ id: string; ammoUsage: { ammoId: string; rounds: number }[] }>(page, 'sessions'))
      .filter((s) => s.id === SESSION_ID);
    expect(rows[0].ammoUsage).toEqual([{ ammoId: GHOST_AMMO_ID_SESSION, rounds: 20 }]);
  });

  test('a malfunction\'s ammo link that is gone shows "(removed)"', async ({ page }) => {
    const SESSION_ID = 'e2e-picker-ghost-malf-ammo';
    const MALF_ID = 'e2e-picker-ghost-malf-ammo-row';
    await seedRaw(page, 'sessions', {
      id: SESSION_ID, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
      date: '2026-08-01', type: 'practice', guns: [{ firearmId: GUN_A_ID, rounds: 20 }],
      location: 'E2E Picker Ghost Malf Ammo Session', distances: '', notes: '', ammoUsage: [],
      drills: [], targetMediaIds: [], malfunctions: [], selfRating: null, rangeFee: null,
      planned: false, checklist: null,
    });
    await seedRaw(page, 'malfunctions', {
      id: MALF_ID, sessionId: SESSION_ID, date: '2026-08-01', firearmId: GUN_A_ID,
      type: 'Failure to feed', resolution: '', notes: '',
      ammoId: GHOST_AMMO_ID_MALF, magazineId: null, roundCount: null,
    });
    await page.reload();

    await openTheSession(page, 'E2E Picker Ghost Malf Ammo Session');
    const ammoSelect = page.locator('label', { hasText: 'Ammo' }).locator('select').first();
    await expect(ammoSelect).toHaveValue(GHOST_AMMO_ID_MALF);
    await expect(ammoSelect.locator('option:checked')).toHaveText('(removed)');

    await saveAndReturnToLog(page);
    const rows = (await getAllFrom<{ sessionId: string; ammoId: string | null }>(page, 'malfunctions'))
      .filter((m) => m.sessionId === SESSION_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].ammoId).toBe(GHOST_AMMO_ID_MALF);
  });

  test('a malfunction\'s magazine that was hard-deleted shows "(removed)", never "— Not sure —"', async ({ page }) => {
    const SESSION_ID = 'e2e-picker-ghost-malf-mag';
    const MALF_ID = 'e2e-picker-ghost-malf-mag-row';
    await seedRaw(page, 'sessions', {
      id: SESSION_ID, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
      date: '2026-08-01', type: 'practice', guns: [{ firearmId: GUN_A_ID, rounds: 20, magIds: [MAG_A_ID] }],
      location: 'E2E Picker Ghost Malf Mag Session', distances: '', notes: '', ammoUsage: [],
      drills: [], targetMediaIds: [], malfunctions: [], selfRating: null, rangeFee: null,
      planned: false, checklist: null,
    });
    await seedRaw(page, 'malfunctions', {
      id: MALF_ID, sessionId: SESSION_ID, date: '2026-08-01', firearmId: GUN_A_ID,
      type: 'Failure to feed', resolution: '', notes: '',
      ammoId: null, magazineId: GHOST_MAG_ID, roundCount: null,
    });
    await page.reload();

    await openTheSession(page, 'E2E Picker Ghost Malf Mag Session');
    // getByLabel, not a hasText label filter -- see the comment on the D5
    // test above for why hasText('Magazine') is unsafe here.
    const magSelect = page.getByLabel('Magazine (optional)');
    // The assertion the pre-fix build fails: a hard-deleted magazine (no
    // gun re-point involved) fell through to "— Not sure —" exactly like a
    // real "nothing picked" state.
    await expect(magSelect).toHaveValue(GHOST_MAG_ID);
    await expect(magSelect.locator('option:checked')).toHaveText('(removed)');
    // The real magazine on this gun is still offered alongside the ghost row.
    await expect(magSelect.locator('option', { hasText: 'Picker Real Mag A1' })).toHaveCount(1);

    await saveAndReturnToLog(page);
    const rows = (await getAllFrom<{ sessionId: string; magazineId: string | null }>(page, 'malfunctions'))
      .filter((m) => m.sessionId === SESSION_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].magazineId).toBe(GHOST_MAG_ID);
  });
});

test.describe('D7: an unrecognised session kind gets its own chip', () => {
  const GUN_ID = 'e2e-picker-kind-gun';
  const SESSION_ID = 'e2e-picker-kind-session';
  const LOCATION = 'E2E Picker Kind Session';

  test.beforeEach(async ({ page }) => {
    await seedDemo(page);
    await seedRaw(page, 'firearms', gunRecord(GUN_ID, 'E2E Picker Kind Gun', 1));
    // Michael's own real log has one session typed 'competition' -- the CSV
    // importer keeps any type the source column carries (csvPlan.ts: "anything
    // else is kept"), but the segmented control only ever pressed the three
    // built-in kinds.
    await seedRaw(page, 'sessions', {
      id: SESSION_ID, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
      date: '2026-08-01', type: 'competition', guns: [{ firearmId: GUN_ID, rounds: 40 }],
      location: LOCATION, distances: '', notes: '', ammoUsage: [], drills: [],
      targetMediaIds: [], malfunctions: [], selfRating: null, rangeFee: null,
      planned: false, checklist: null,
    });
    await page.reload();
  });

  test('a "competition" session shows a pressed "Competition" chip, and only that one', async ({ page }) => {
    await openTheSession(page, LOCATION);
    const seg = page.getByRole('group', { name: 'Session kind' });
    // The assertion the pre-fix build fails: none of the three built-in
    // chips reads pressed for an unrecognised kind, so the segmented control
    // silently claimed nothing was selected.
    await expect(seg.getByRole('button', { name: 'Live practice' })).toHaveAttribute('aria-pressed', 'false');
    await expect(seg.getByRole('button', { name: 'Dry fire' })).toHaveAttribute('aria-pressed', 'false');
    await expect(seg.getByRole('button', { name: 'Class' })).toHaveAttribute('aria-pressed', 'false');
    const extra = seg.getByRole('button', { name: 'Competition', exact: true });
    await expect(extra).toBeVisible();
    await expect(extra).toHaveAttribute('aria-pressed', 'true');
  });

  test('ROUND TRIP: an untouched save keeps the unrecognised kind', async ({ page }) => {
    // Regression guard: this passes on main too, unfixed -- the `kind` state
    // was never corrupted, only the segmented control's rendering left every
    // chip unpressed, so an untouched Save round-tripped correctly even
    // pre-fix. The test above (display) is what catches the lie.
    await openTheSession(page, LOCATION);
    await saveAndReturnToLog(page);
    const rows = (await getAllFrom<{ id: string; type: string }>(page, 'sessions')).filter((s) => s.id === SESSION_ID);
    expect(rows[0].type).toBe('competition');
  });
});
