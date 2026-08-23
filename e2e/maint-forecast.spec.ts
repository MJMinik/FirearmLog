import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedDemo, gotoSection } from './helpers';
import { dayKey } from '../src/lib/dates.ts';

// Maintenance forecasting, UI half (pass 2 of 2). `src/lib/forecast.ts` (pass 1,
// fully unit tested) computes the copy; this spec proves it actually reaches the
// two approved surfaces — Gun Detail's Upkeep card and the Gun Maintenance
// screen's per-gun list — and reaches ONLY those two: Home is deliberately not a
// surface (its cards are for measured facts, a projection is neither) and this
// spec asserts the line is absent there too.
//
// Three fresh guns, one per gate outcome, so the assertions are about the GATE
// rather than the bound math (already exhaustively covered by
// tests/forecast.test.ts):
//   - Below-gate: 2 live sessions -- under the 3-session evidence floor. No line.
//   - Above-gate: 3 sessions / 900 rounds in the trailing-90-day window -- clears
//     both gates, recoil spring is not yet due, so a real "due roughly" line.
//   - Due: rounds already exceed the recoil-spring interval, so the item level
//     is 'due' and the forecast is withheld regardless of the gate (a projection
//     for something already due is not useful copy).
//
// Every gun also gets a `deep_clean` entry dated TODAY (after every seeded
// session), which zeroes that gun's since-last-deep-clean counter. Deep clean's
// own interval is much larger than anything these guns fire in a 90-day window,
// so with that counter at zero its forecast always lands past the one-year
// "Months away" cutoff -- a real string, but not one that starts with "At your
// recent pace, due roughly" or matches capital-letter /At your recent pace/, so
// it can never masquerade as the recoil-spring line the assertions below are
// checking for. Without that reset entry the Due gun's deep-clean row would
// independently clear the forecast gate (same sessions, same window) and print
// a real "due roughly" line of its own -- true of deep clean, but exactly the
// kind of noise that would make the Due-card exclusion assertion flaky for a
// reason that has nothing to do with what this spec is actually checking.
//
// Session dates are computed AT RUNTIME relative to today (never hardcoded), so
// this keeps passing for as long as the codebase does, and the "due roughly ..."
// assertions pin the PREFIX only -- never a specific month -- for the same reason.
//
// Seeded straight into IndexedDB (the seedRaw pattern from missing-field-crash.spec.ts)
// because the UI has no path to a gun with a chosen round history and a chosen
// "now" in one step; every seeded record carries every field its type declares,
// mirroring the tests/*.test.ts factories, so it survives the read boundary
// (src/lib/recordShape.ts) unchanged.

const GUN_BELOW = 'e2e-fc-below';
const GUN_ABOVE = 'e2e-fc-above';
const GUN_DUE = 'e2e-fc-due';
const GUN_WARN = 'e2e-fc-warn';

const NAME_BELOW = 'Forecast Gate Below';
const NAME_ABOVE = 'Forecast Gate Above';
const NAME_DUE = 'Forecast Due Now';
const NAME_WARN = 'Forecast Warn Soon';

const RECOIL_INTERVAL = 3000;

/** Local day-key N days before today -- never a hardcoded date. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dayKey(d);
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

function gunRecord(id: string, name: string, seq: number) {
  return {
    id, createdAt: 1_700_000_000_000 + seq, updatedAt: 1_700_000_000_000 + seq,
    name, manufacturer: 'Test', model: 'Test', caliber: '9mm', category: 'Pistol',
    serialNumber: null, dateAcquired: '', startingRoundCount: 0,
    recoilSpringInterval: RECOIL_INTERVAL, recoilSpringWeight: null,
    barrelName: null, barrelInstallDate: null, barrelStartRounds: null,
    deepCleanInterval: null,
    photoIds: [], referenceId: null, notes: '',
  };
}

function sessionRecord(id: string, gunId: string, date: string, rounds: number, seq: number) {
  return {
    id, createdAt: 1_700_000_000_000 + seq, updatedAt: 1_700_000_000_000 + seq,
    date, type: 'practice', guns: [{ firearmId: gunId, rounds }],
    location: '', distances: '', notes: '', ammoUsage: [], drills: [],
    targetMediaIds: [], malfunctions: [], selfRating: null, rangeFee: null,
    planned: false, checklist: null,
  };
}

function maintRecord(id: string, gunId: string, date: string, type: string, seq: number) {
  return {
    id, createdAt: 1_700_000_000_000 + seq, updatedAt: 1_700_000_000_000 + seq,
    date, firearmId: gunId, type, performedBy: 'Self', partsReplaced: '', notes: '',
  };
}

/** Seeds the three guns, their sessions, and their maintenance history, then
 * reloads so the app's IndexedDB reads pick up what was written underneath it. */
async function seedForecastGuns(page: Page): Promise<void> {
  await seedDemo(page);

  await seedRaw(page, 'firearms', gunRecord(GUN_BELOW, NAME_BELOW, 1));
  await seedRaw(page, 'firearms', gunRecord(GUN_ABOVE, NAME_ABOVE, 2));
  await seedRaw(page, 'firearms', gunRecord(GUN_DUE, NAME_DUE, 3));
  await seedRaw(page, 'firearms', gunRecord(GUN_WARN, NAME_WARN, 4));

  // Recoil spring last changed year 2000 -- ancient, so every seeded session
  // counts toward "rounds since" for every gun.
  await seedRaw(page, 'maintenance', maintRecord('e2e-fc-rs-below', GUN_BELOW, '2000-01-01', 'recoil_spring', 10));
  await seedRaw(page, 'maintenance', maintRecord('e2e-fc-rs-above', GUN_ABOVE, '2000-01-01', 'recoil_spring', 11));
  await seedRaw(page, 'maintenance', maintRecord('e2e-fc-rs-due', GUN_DUE, '2000-01-01', 'recoil_spring', 12));
  await seedRaw(page, 'maintenance', maintRecord('e2e-fc-rs-warn', GUN_WARN, '2000-01-01', 'recoil_spring', 16));

  // Deep clean "done today" on every gun -- see the header comment for why.
  const today = daysAgo(0);
  await seedRaw(page, 'maintenance', maintRecord('e2e-fc-dc-below', GUN_BELOW, today, 'deep_clean', 13));
  await seedRaw(page, 'maintenance', maintRecord('e2e-fc-dc-above', GUN_ABOVE, today, 'deep_clean', 14));
  await seedRaw(page, 'maintenance', maintRecord('e2e-fc-dc-due', GUN_DUE, today, 'deep_clean', 15));
  await seedRaw(page, 'maintenance', maintRecord('e2e-fc-dc-warn', GUN_WARN, today, 'deep_clean', 17));

  // Below-gate: 2 live sessions, 150 rounds each -- 300 rounds, but only 2
  // sessions, under the 3-session evidence floor.
  await seedRaw(page, 'sessions', sessionRecord('e2e-fc-s-below-1', GUN_BELOW, daysAgo(10), 150, 20));
  await seedRaw(page, 'sessions', sessionRecord('e2e-fc-s-below-2', GUN_BELOW, daysAgo(20), 150, 21));

  // Above-gate: 3 sessions, 300 rounds each -- 900 in the window, clears both
  // gates. Remaining (recoil spring) = 3000 - 900 = 2100; both bounds land
  // comfortably under a year.
  await seedRaw(page, 'sessions', sessionRecord('e2e-fc-s-above-1', GUN_ABOVE, daysAgo(10), 300, 22));
  await seedRaw(page, 'sessions', sessionRecord('e2e-fc-s-above-2', GUN_ABOVE, daysAgo(20), 300, 23));
  await seedRaw(page, 'sessions', sessionRecord('e2e-fc-s-above-3', GUN_ABOVE, daysAgo(30), 300, 24));

  // Due: 3 sessions, 1100 rounds each -- 3300 >= the 3000 interval, so the
  // recoil-spring item itself is level 'due' and the forecast is withheld.
  await seedRaw(page, 'sessions', sessionRecord('e2e-fc-s-due-1', GUN_DUE, daysAgo(10), 1100, 25));
  await seedRaw(page, 'sessions', sessionRecord('e2e-fc-s-due-2', GUN_DUE, daysAgo(20), 1100, 26));
  await seedRaw(page, 'sessions', sessionRecord('e2e-fc-s-due-3', GUN_DUE, daysAgo(30), 1100, 27));

  // Warn: 3 sessions, 917 rounds each -- 2751 since the spring change sits in
  // the 90%-but-not-due band (2700 <= 2751 < 3000), so the recoil-spring item
  // is level 'warn' and appears on Home's Needs Attention card. It ALSO clears
  // the forecast gate (3 sessions, 2751 rounds, remaining 249) -- which is what
  // gives the Home-exclusion test teeth for the "due roughly" shape: this
  // gun's alert row on Home is exactly where a leak would render.
  await seedRaw(page, 'sessions', sessionRecord('e2e-fc-s-warn-1', GUN_WARN, daysAgo(10), 917, 28));
  await seedRaw(page, 'sessions', sessionRecord('e2e-fc-s-warn-2', GUN_WARN, daysAgo(20), 917, 29));
  await seedRaw(page, 'sessions', sessionRecord('e2e-fc-s-warn-3', GUN_WARN, daysAgo(30), 917, 30));

  await page.reload();
}

/** The anchored shape forecastLine renders for a real range -- prefix only,
 * never a specific month (dates are relative to the real today). */
const DUE_ROUGHLY = /^At your recent pace, due roughly /;
/** Any forecast text at all, in either of its two shapes ("due roughly ..." or
 * "Months away ..."). Capital-A on purpose -- forecastLine's only other shape,
 * "Months away at your recent pace", uses a lowercase "at" and must not match. */
const ANY_FORECAST = /At your recent pace/;

/** The Gun Maintenance card for one gun, scoped by its own <h2> heading so a
 * substring match on another gun's card (or the demo data) can't cross over. */
function gunCard(page: Page, name: string) {
  return page.getByRole('main').locator('.card').filter({
    has: page.getByRole('heading', { name, exact: true }),
  });
}

test.describe('maintenance forecasting reaches Gun Maintenance and Gun Detail, and only those', () => {
  test('below the evidence gate: no forecast text on that gun\'s card', async ({ page }) => {
    await seedForecastGuns(page);
    await gotoSection(page, 'Gun Maintenance');
    const card = gunCard(page, NAME_BELOW);
    await expect(card).toBeVisible();
    await expect(card.getByText(ANY_FORECAST)).toHaveCount(0);
  });

  test('above the evidence gate: exactly one due-roughly line, in the recoil-spring row, after the measured detail', async ({ page }) => {
    await seedForecastGuns(page);
    await gotoSection(page, 'Gun Maintenance');
    const card = gunCard(page, NAME_ABOVE);
    await expect(card).toBeVisible();

    // Exactly one line on the whole card matches the anchored "due roughly"
    // shape -- deep clean's own forecast on this gun lands past the one-year
    // cutoff ("Months away..."), which does not match this anchored pattern.
    await expect(card.getByText(DUE_ROUGHLY)).toHaveCount(1);

    const recoilRow = card.locator('.row').filter({ hasText: 'Recoil spring' });
    await expect(recoilRow).toBeVisible();
    await expect(recoilRow.getByText(DUE_ROUGHLY)).toHaveCount(1);
    // The measured detail is still present and still comes first.
    await expect(recoilRow.getByText('of 3,000 rounds')).toBeVisible();
    // innerText() is the WHOLE row (label, detail, forecast) on separate lines, so
    // DUE_ROUGHLY's `^` anchor (which only matches the very start of the string,
    // not the start of each line) can't locate it here -- that anchor is for the
    // per-element getByText matches above. Ordering is checked against the literal
    // prefix instead.
    const rowText = await recoilRow.innerText();
    expect(rowText.indexOf('of 3,000 rounds')).toBeGreaterThanOrEqual(0);
    expect(rowText.indexOf('of 3,000 rounds')).toBeLessThan(rowText.indexOf('At your recent pace, due roughly'));
  });

  test('already due: the recoil-spring row shows Due and no forecast text on that card', async ({ page }) => {
    await seedForecastGuns(page);
    await gotoSection(page, 'Gun Maintenance');
    const card = gunCard(page, NAME_DUE);
    await expect(card).toBeVisible();

    const recoilRow = card.locator('.row').filter({ hasText: 'Recoil spring' });
    await expect(recoilRow.getByText('Due', { exact: true })).toBeVisible();
    // The due ROW carries neither forecast shape -- case-insensitive, so even
    // "Months away at your recent pace" would be caught here.
    await expect(recoilRow.getByText(/at your recent pace/i)).toHaveCount(0);
    // Card-wide, the "due roughly" range shape is absent (capital-A on purpose:
    // this gun's deep-clean row legitimately carries the months-away shape).
    await expect(card.getByText(ANY_FORECAST)).toHaveCount(0);
  });

  test('Gun Detail\'s Upkeep card shows the same three things for the above-gate gun', async ({ page }) => {
    await seedForecastGuns(page);
    await gotoSection(page, 'Gun Maintenance');
    const card = gunCard(page, NAME_ABOVE);
    await card.getByRole('button', { name: 'Open Gun' }).click();

    await expect(page.getByRole('heading', { name: NAME_ABOVE, exact: true })).toBeVisible();
    const upkeep = page.getByRole('main').locator('.card').filter({
      has: page.getByRole('heading', { name: 'Upkeep', exact: true }),
    });
    await expect(upkeep).toBeVisible();

    await expect(upkeep.getByText(DUE_ROUGHLY)).toHaveCount(1);
    const recoilRow = upkeep.locator('.row').filter({ hasText: 'Recoil spring' });
    await expect(recoilRow).toBeVisible();
    await expect(recoilRow.getByText(DUE_ROUGHLY)).toHaveCount(1);
    await expect(recoilRow.getByText('of 3,000 rounds')).toBeVisible();
    const rowText = await recoilRow.innerText();
    expect(rowText.indexOf('of 3,000 rounds')).toBeGreaterThanOrEqual(0);
    expect(rowText.indexOf('of 3,000 rounds')).toBeLessThan(rowText.indexOf('At your recent pace, due roughly'));
  });

  test('Home never shows forecast text -- it is a measured-facts surface, not a projection one', async ({ page }) => {
    await seedForecastGuns(page);
    // seedDemo already lands on Home; seedForecastGuns reloads afterward, which
    // returns to Home too, but go there explicitly so this test does not depend
    // on that incidental behavior.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible();
    // The warn gun's recoil-spring alert is ON Home (proving the surface a
    // leak would render into is actually present in this fixture) ...
    await expect(page.getByText(NAME_WARN).first()).toBeVisible();
    // ... and case-INSENSITIVE here, unlike the card assertions: on Home we
    // exclude BOTH forecast shapes -- "At your recent pace, due roughly ..."
    // and "Months away at your recent pace" -- so a leak of either is caught.
    await expect(page.getByText(/at your recent pace/i)).toHaveCount(0);
  });
});
