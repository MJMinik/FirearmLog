import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedDemo, gotoTab, gotoSection } from './helpers';

/* A record missing a field the model says is required (session 107, 6 Aug 2026).
 *
 * THE DEFECT. `types.ts` declares most record fields as a plain required `string`, and
 * nothing enforced it: `parseFlog` passes `stores` through verbatim, so an older backup
 * or an import that never set a field puts `undefined` where the type promises a string.
 * The first `.localeCompare` or `.startsWith` in a render path throws, and React unmounts
 * the WHOLE SCREEN rather than one row. Measured: a match with no `date` produced
 * "Couldn't load this screen" on the Compete tab.
 *
 * WHY THAT WAS MORE THAN COSMETIC, and what the third test is really about: the screen
 * that would let you edit or delete the offending record is the screen it kills. The
 * record becomes unreachable from the UI. Rendering is half the fix; REACHING it is the
 * half that matters.
 *
 * WHY IT IS SEEDED STRAIGHT INTO IndexedDB. The UI cannot produce this state, which is
 * the whole point — it arrives by restore or by import. Deliberately the same seeding
 * shape as the Edit Match picker spec so the two read alike.
 *
 * WHY MORE THAN THE COMPETE TAB. A sweep found dozens of call sites of this class across
 * more than twenty files, and a large share were not sorts — `CompeteScreen.tsx:98` is a
 * `.startsWith` filter on the same screen as the sort that crashed. The fix is at the
 * read boundary, so
 * these tests walk several screens: proving only the reported screen would not show the
 * class is closed.
 *
 * A HARNESS NOTE, because false greens cost two rounds during the build and the pattern
 * is worth more than the tests. Both are recorded on `expectScreenAlive` below. The short
 * version: never assert an ABSENCE without first waiting for a PRESENCE, and read that
 * presence from inside the screen body, because the navigation repeats the screen's own
 * words outside it. Every test here was run against the pre-fix tree and its result
 * recorded — FIVE of the six fail without it, and the one that does not is labelled as the
 * regression guard it actually is rather than counted as proof.
 *
 * THE SHARPEST THING LEARNED HERE, recorded on FIREARM_ID below: whether this defect
 * crashes anything is ORDER-DEPENDENT. `a.name.localeCompare(b.name)` throws only when
 * the damaged row is the receiver, so the same missing field in the same store either
 * kills the screen or does nothing at all depending on where the record sorts. A test
 * that seeds it in the wrong position passes against the broken build — which is exactly
 * what happened here, twice — and "I could not reproduce it" is not evidence of absence
 * for anything in this class. */

const MATCH_ID = 'e2e-nodate-match';
const SESSION_ID = 'e2e-nodate-session';
// The id decides whether this record CRASHES anything, which is the sharpest thing this
// spec learned. IndexedDB returns records in key order, so the id fixes where the damaged
// row starts in the array — and `a.name.localeCompare(b.name)` only throws when the bad
// row is the RECEIVER (`a`), never when it is the argument, because `localeCompare(undefined)`
// quietly compares against the string "undefined". Seeded first, the same defect with the
// same data does not throw at all. So this id is chosen to sort AFTER the demo guns
// (`fa-…`), which is where a real imported record would land anyway. Measured both ways.
const FIREARM_ID = 'zz-e2e-noname-firearm';

/** Write a record with the named keys simply absent — the shape a damaged restore has. */
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

const datelessMatch = (over: Record<string, unknown> = {}) => ({
  id: MATCH_ID, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
  name: 'Dateless Match', matchType: 'USPSA Level 1 (club match)', division: 'Open',
  powerFactor: 'Minor', firearmId: '', scoringType: 'uspsa', notes: '', stages: [],
  totalRounds: null, matchPercent: null, divisionPlace: null, divisionOf: null,
  overallPlace: null, overallOf: null, ...over,
});

/** The app's own dead-screen state, however the CSS cases it. */
const DEAD = /load this screen/i;

/**
 * Wait for the screen to SETTLE — meaning it has rendered either its own heading or the
 * death message — and only then decide which one it was.
 *
 * Written this way after two harness defects in a row, both false greens:
 *   1. `toHaveCount(0)` on the death message passed instantly, before the screen had
 *      rendered anything at all.
 *   2. Waiting for `getByRole('heading', …)` page-wide passed on a DEAD screen, because
 *      the desktop navigation carries the same words outside the screen body. Measured:
 *      a probe printed "COULDN'T LOAD THIS SCREEN" from `main` while that assertion was
 *      green.
 * So: everything is read from `main`, and the wait ends on either outcome rather than on
 * the one we hope for. A wait that can only end in success is not a wait.
 */
async function expectScreenAlive(page: Page, heading: RegExp) {
  const main = page.getByRole('main');
  // A HEADING inside main, not the words anywhere in main. Third false green of the
  // build: the sections menu lists "Gun Maintenance" as an ordinary label, so a text
  // match was satisfied by a screen we had never navigated to.
  const title = main.getByRole('heading', { name: heading });
  await expect.poll(async () => {
    if (DEAD.test(await main.innerText().catch(() => ''))) return 'dead';
    return (await title.count()) > 0 ? 'alive' : 'waiting';
  }, { timeout: 15_000, message: `screen never settled (waiting for a ${heading} heading or the error state)` })
    .not.toBe('waiting');
  expect(await main.innerText(), `the screen died instead of rendering ${heading}`).not.toMatch(DEAD);
}

/** Any uncaught page error fails this spec, whatever screen produced it. */
function watchForCrashes(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

test.describe('a record missing a required string does not take a screen down', () => {
  test('the Compete tab renders with a match that has no date', async ({ page }) => {
    const errors = watchForCrashes(page);
    await seedDemo(page);
    await seedRaw(page, 'matches', datelessMatch());   // no `date` key at all
    await page.reload();
    await gotoTab(page, 'Compete');

    await expectScreenAlive(page, /Compete/);
    await expect(page.getByRole('main').getByText('Dateless Match')).toBeVisible();
    expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('the dateless match reads as blank, not as "Invalid Date"', async ({ page }) => {
    // Michael's decision 3a: bottom of the list, date shown blank. Not hidden — hiding a
    // record makes the app lie about what it holds — and not flagged as damaged, which
    // is alarming for what is almost certainly an import artefact.
    await seedDemo(page);
    await seedRaw(page, 'matches', datelessMatch());
    await page.reload();
    await gotoTab(page, 'Compete');
    await expectScreenAlive(page, /Compete/);

    // Assert the ROW's own text, not the whole screen. `not.toMatch` over all of
    // `main` is satisfied by the row being absent entirely, by a missing date cell,
    // and by "1970-01-01" — three wrong outcomes that all look like a pass.
    const row = page.getByRole('main').getByText('Dateless Match').first();
    await expect(row).toBeVisible();
    const rowText = await row.locator('xpath=ancestor::li[1] | xpath=ancestor::*[@data-match-row][1]')
      .first().innerText().catch(async () => (await row.innerText()));
    expect(rowText, 'the row itself must not print a placeholder date')
      .not.toMatch(/Invalid Date|undefined|NaN|1970/);
    expect(rowText).toMatch(/Dateless Match/);
  });

  test('the dateless match can still be OPENED — the part that made it a trap', async ({ page }) => {
    await seedDemo(page);
    await seedRaw(page, 'matches', datelessMatch());
    await page.reload();
    await gotoTab(page, 'Compete');
    await expectScreenAlive(page, /Compete/);
    await page.getByRole('main').getByText('Dateless Match').first().click();

    // The DETAIL screen's own heading, not the words anywhere on the page. An audit
    // of these tests replaced this click with a 200ms wait and the test still passed:
    // `toContainText('Dateless Match')` was satisfied by the LIST we had never left,
    // and `toHaveCount(0)` on the death message is satisfied by any screen at all.
    // The header calls reachability "the half that matters"; it was the half not proven.
    // MatchScreens.tsx:251 renders `<h1>{match.name}</h1>` on the detail screen only.
    await expectScreenAlive(page, /Dateless Match/);
  });

  // REGRESSION GUARD, not proof of today's change: yesterday's Edit Match branch already
  // defaults a stage's missing `notes` at the form boundary, so this passes on the
  // pre-fix tree too. Kept deliberately and labelled honestly — it guards that fix
  // against being undone, and the read boundary now covers the same shape a second way.
  test('a nested stage row with no notes does not take the match detail down', async ({ page }) => {
    const errors = watchForCrashes(page);
    await seedDemo(page);
    await seedRaw(page, 'matches', datelessMatch({
      date: '2026-08-02', name: 'Stage Row Match',
      // No `notes` key on the stage — the shape a record written before stage notes has.
      stages: [{ number: 1, points: 100, time: 12.5, percent: null }],
    }));
    await page.reload();
    await gotoTab(page, 'Compete');
    await expectScreenAlive(page, /Compete/);
    await page.getByRole('main').getByText('Stage Row Match').first().click();

    await expectScreenAlive(page, /Stage Row Match/);   // the detail heading, not the list
    expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('the Log screen renders with a session that has no date', async ({ page }) => {
    const errors = watchForCrashes(page);
    await seedDemo(page);
    await seedRaw(page, 'sessions', {
      id: SESSION_ID, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
      type: 'practice', location: 'Nowhere', distances: '', notes: '',
      guns: [], ammoUsage: [], drills: [], targetMediaIds: [], malfunctions: [],
      selfRating: null, rangeFee: null, planned: false,
    });
    await page.reload();
    await gotoTab(page, 'Log');

    await expectScreenAlive(page, /Log/);
    expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('Gun Maintenance renders with a firearm that has no name', async ({ page }) => {
    // A different store, a different field, a name rather than a date — the point being
    // that the fix is not date-shaped and not Compete-shaped.
    //
    // Aimed at Gun Maintenance rather than the Guns list ON PURPOSE. The Guns list does
    // not sort by name, so it survives a nameless firearm on the pre-fix build too, and a
    // test pointed there passes either way and proves nothing. `MaintenanceScreens.tsx:39`
    // does sort by name, so this one genuinely fails without the read boundary. Measured,
    // not assumed: both variants were run against the pre-fix tree.
    const errors = watchForCrashes(page);
    await seedDemo(page);
    await seedRaw(page, 'firearms', {
      id: FIREARM_ID, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
      manufacturer: 'Atlas', model: 'Erebus', caliber: '9mm', category: 'Pistol',
      serialNumber: null, dateAcquired: '', notes: '', referenceId: null,
    });
    await page.reload();
    await gotoSection(page, 'Gun Maintenance');

    await expectScreenAlive(page, /Gun Maintenance/);
    expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
