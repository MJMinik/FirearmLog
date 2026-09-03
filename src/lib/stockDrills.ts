// The stock drill library (F4, session 55 — built on the stock-drill-library
// branch per the signed session-54 spec).
//
// The app used to ship NO drills: the authored 14-drill library lived only in
// scripts/make-demo.ts, so a fresh install's Drills screen — and the session
// form's drill picker — were empty. This module promotes the library to
// shipped app content, in ONE place: the app seeds from here, and make-demo
// imports from here (DRY — the library can never drift between the two).
//
// ID scheme — three prefixes, three owners (load-bearing, don't blur them):
//   'dr-'  import-derived drills. The prefix used to matter to a live write
//          path — commitDataSet, which rewrote a CSV data set by deleting
//          every 'dr-' id first and sparing 'drx-'/'drs-' — but commitDataSet
//          had no live caller anywhere in the app and was deleted (D-2,
//          session 140). Today the app's ONE "replace everything" path is
//          restoreSnapshot / restoreFromFile (db.ts), and it clears and
//          rewrites the WHOLE drills store from the backup's own drills
//          section; it does not single out 'dr-' ids. The prefix survives
//          here as the historical marker CSV-imported drills carried, not as
//          a live behaviour.
//   'drx-' user-created drills — ids only; no code branches on this prefix today.
//   'drs-' STOCK drills (this module) — fixed ids, so seeding is idempotent
//          (a crash-retry overwrites, never duplicates): 'drs-…'.startsWith('dr-')
//          is FALSE (third character is 's', not '-') — verified in node, and
//          pinned by a unit test so a future prefix change can't silently break it.
//
// Seeding rules, each earned (the northStar pattern, session 47–55):
//  - AT MOST ONCE PER INSTALL: the `drillsSeeded` settings guard. Clear All
//    wipes settings, so "Start fresh" re-seeds — Michael's Q1 answer.
//  - ONLY ONCE THE LOG IS REAL (≥1 gun): a goal-less, gun-less fresh install
//    must stay GENUINELY empty, or the sample-data confirm gate and the
//    backup-restore freshness check start lying.
//  - AN INSTALL WITH DRILLS OF ITS OWN IS MARKED, NOT ADDED TO: an upgrade
//    or restored backup that already has a drill library (imported 'dr-' or
//    custom 'drx-') would get name-duplicates ("Bill Drill" twice in the
//    picker) if we piled the stock set on top. We mark it seeded and add
//    nothing — mirrors the North Star "never touch an existing pin" rule.
//  - FAIL-SAFE: a storage hiccup never breaks an app open; we try again next
//    open.

import { countAll, getAll, getSettings, putSettings, seedDrillsWithSettings, withExclusiveIo } from './db.ts';
import { stampNew } from './stamps.ts';
import type { AppSettings, DrillDef } from './types.ts';

/** Stock ids: 'drs-' + slug — same slug rule the demo generator always used. */
export function stockDrillId(name: string): string {
  return 'drs-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * The authored library, verbatim from the demo generator (name, fire mode,
 * scoring, brief, full). requiresHolster is now DELIBERATE (the demo
 * randomized it): true exactly where the drill starts from the holster.
 */
export const STOCK_DRILLS: readonly {
  name: string; fire: DrillDef['fire']; scoring: string;
  brief: string; full: string; holster: boolean;
}[] = [
  { name: 'Bill Drill', fire: 'live', scoring: 'time', holster: true,
    brief: '6 shots from the holster at 7 yards, all A.',
    full: 'Draw and fire six rounds at one target at 7 yd. Goal: all A, sub-2.0s. Builds recoil control and splits.' },
  { name: 'Failure Drill', fire: 'both', scoring: 'time', holster: true,
    brief: 'Two to the body, one to the head.',
    full: 'Mozambique: 2 body + 1 head from the holster. Trains transitions to a smaller target under speed.' },
  { name: 'El Presidente', fire: 'live', scoring: 'time', holster: true,
    brief: 'Classic 12-round test with a turn and reload.',
    full: 'Back to targets, turn, 2 each on 3 targets, reload, 2 each again. 10 yd. The all-around test.' },
  { name: 'Dot Torture', fire: 'live', scoring: 'points', holster: true,
    brief: '50 rounds, 50 dots, fundamentals under pressure.',
    full: 'Slow-fire accuracy standard across draws, one-hand, and transitions. Score out of 50.' },
  { name: 'Doubles / Hammers', fire: 'both', scoring: 'time', holster: false,
    brief: 'Controlled pairs, recoil management.',
    full: 'Pairs on one target — hammers (one sight picture) and doubles (two). Chase flat, fast splits.' },
  { name: 'Draw to First Shot', fire: 'both', scoring: 'time', holster: true,
    brief: 'Holster to first A.',
    full: 'Par-time draws to an A at 7 yd. The single highest-value speed skill.' },
  { name: 'Reload Practice', fire: 'dry', scoring: 'time', holster: false,
    brief: 'Slide-lock and in-battery reloads.',
    full: 'Dry reload reps to a par time. Index the mag well, insert, drive out. Build to sub-1.2s.' },
  { name: 'Transitions', fire: 'both', scoring: 'time', holster: false,
    brief: 'Target-to-target eye/gun speed.',
    full: 'Two to six targets, move the eyes first. Trains snappy, accurate transitions.' },
  { name: 'Precision Slow Fire', fire: 'live', scoring: 'points', holster: false,
    brief: 'Group work at distance.',
    full: 'Slow, perfect reps at 15–25 yd. Rebuilds trigger control when speed erodes it.' },
  { name: 'Accelerator (Steel)', fire: 'live', scoring: 'time', holster: false,
    brief: 'SCSA-style plate stage practice.',
    full: 'Five plates, best-of runs. Trains the Steel Challenge rhythm and transitions.' },
  { name: '1-Reload-1', fire: 'both', scoring: 'time', holster: false,
    brief: 'One shot, reload, one shot.',
    full: 'Isolates the reload against the clock. 7 yd, par time to both A hits.' },
  { name: 'Blake Drill', fire: 'live', scoring: 'time', holster: false,
    brief: 'Six shots across three targets.',
    full: 'One each on three targets, then back — chase transition speed with control.' },
  { name: 'Box Drill', fire: 'both', scoring: 'time', holster: false,
    brief: 'Body-body then head-head across two targets.',
    full: 'Two targets: bodies then heads. Trains transition + elevation change.' },
  { name: 'Wide Transitions', fire: 'both', scoring: 'time', holster: false,
    brief: 'Big swings between targets.',
    full: 'Trains eye lead and grip stability across wide arrays.' },
];

/** The library as storable records (fixed ids → idempotent writes). */
export function stockDrillDefs(now: number): DrillDef[] {
  return STOCK_DRILLS.map((d) => stampNew(
    {
      name: d.name,
      gunCategories: ['Pistol'],
      fire: d.fire,
      briefDescription: d.brief,
      fullDescription: d.full,
      scoring: d.scoring,
      requiresHolster: d.holster,
      tags: [],
    },
    stockDrillId(d.name),
    now
  ));
}

export type StockDrillsAction = 'none' | 'mark' | 'seed';

/**
 * Decide what the seeder should do. Pure — no storage — so every branch is
 * unit-tested without IndexedDB.
 */
export function stockDrillsAction(input: {
  seeded: boolean | undefined;
  gunCount: number;
  drillCount: number;
}): StockDrillsAction {
  if (input.seeded) return 'none';          // once per install, forever
  if (input.gunCount === 0) return 'none';  // the log isn't real yet
  if (input.drillCount > 0) return 'mark';  // they have a library — don't duplicate it
  return 'seed';
}

/**
 * Run the seed check against the database. Returns true only the single time
 * the library is actually written (so the caller knows to re-render);
 * marking-only and no-op runs return false. Fail-safe: a storage hiccup can
 * never break an app open — it just means we try again next time.
 */
export async function ensureStockDrills(now: number = Date.now()): Promise<boolean> {
  try {
    // Cheap early-exit on every open, no lock needed: once seeded, never again.
    if ((await getSettings<AppSettings>())?.drillsSeeded) return false;
    // Decision AND write under the SAME cross-tab exclusion as restore/import/
    // erase, so a second tab's restore can't interleave with our reads/writes.
    return await withExclusiveIo('the drill seed', async () => {
      const settings = await getSettings<AppSettings>();
      if (settings?.drillsSeeded) return false; // another tab seeded meanwhile
      const gunCount = await countAll('firearms');
      const drillCount = gunCount > 0 ? (await getAll<{ id: string }>('drills')).length : 0;
      const action = stockDrillsAction({ seeded: settings?.drillsSeeded, gunCount, drillCount });
      if (action === 'none') return false;
      if (action === 'mark') {
        await putSettings<AppSettings>({ drillsSeeded: true });
        return false; // nothing on screen changed
      }
      // Seed: all 14 drills AND the guard in ONE transaction — all-or-nothing.
      await seedDrillsWithSettings<AppSettings>(stockDrillDefs(now), { drillsSeeded: true });
      return true;
    });
  } catch (e) {
    console.error('Stock drill seed check failed', e);
    return false; // resilience-first: never let the seed break an app open
  }
}
