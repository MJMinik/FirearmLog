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
//
// STOCK LIBRARY VERSION 2 (the eight Steel Challenge stage drills, built from
// scsa_rulebook_facts.md against SCSA_DRILLS_SPEC.md section 3): the library
// grew from 14 to 22 entries. Growing STOCK_DRILLS is free for two of the
// three cases the settings guard has to handle — a fresh install still gets
// the whole array at first seed, and an "own library" install is still only
// marked, never added to — but an install that already carries
// `drillsSeeded: true` from before this shipped will never re-enter the
// `'seed'` branch on its own, so it would never pick up the eight new
// entries. `drillsSeededV2` and `stockDrillsV2Action` below exist to give
// exactly that install (and only that install) a one-time, idempotent
// top-up. See ensureStockDrills for the wiring.

import { countAll, getAll, getSettings, putSettings, seedDrillsWithSettings, withExclusiveIo } from './db.ts';
import { stampNew } from './stamps.ts';
import type { AppSettings, DrillDef, GunCategory } from './types.ts';

/** Stock ids: 'drs-' + slug — same slug rule the demo generator always used. */
export function stockDrillId(name: string): string {
  return 'drs-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** One authored stock drill entry. `categories` defaults to `['Pistol']`
 *  when absent — every original drill relies on that default; the eight
 *  Steel Challenge stage drills below set it explicitly, since that sport is
 *  shot with pistols (centerfire and rimfire — rimfire pistol is still the
 *  'Pistol' category, caliber isn't tracked here), rimfire rifles, and PCC. */
type StockDrillEntry = {
  name: string; fire: DrillDef['fire']; scoring: string;
  brief: string; full: string; holster: boolean;
  categories?: GunCategory[];
};

/**
 * The original 14, verbatim from the demo generator (name, fire mode,
 * scoring, brief, full). requiresHolster is now DELIBERATE (the demo
 * randomized it): true exactly where the drill starts from the holster.
 */
export const STOCK_DRILLS_V1: readonly StockDrillEntry[] = [
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

/** Every fact cited below (distances, sizes, heights, box counts, string
 *  counts, and the start-position rules) traces to scsa_rulebook_facts.md,
 *  read from the 2026 SCSA rulebook 10 September 2026. Where that file
 *  states a figure was not read this session (the exact miss-penalty
 *  seconds; the unlabeled second near plate on Roundabout; which of
 *  Accelerator's two round plates is the 10" and which is the 12"), the text
 *  below says so instead of guessing. Steel Challenge divisions: Open,
 *  Limited, Production, and similar centerfire-handgun divisions; Rimfire
 *  Pistol; Rimfire Rifle; and Pistol Caliber Carbine (PCC) — hence
 *  `categories: ['Pistol', 'Rifle', 'PCC']` on all eight, and hence the
 *  8.2.3 aiming-point paragraph in every one of them: `holster: true` is
 *  only the centerfire-handgun truth, and a rimfire or PCC shooter reading
 *  just that flag would be misled without it. */
const STEEL_CHALLENGE_CATEGORIES: GunCategory[] = ['Pistol', 'Rifle', 'PCC'];

const STANDARD_START = 'In centerfire handgun, you load and holster before the beep, hands raised above your shoulders in the surrender position, fully visible from behind (8.2.2). In Rimfire Pistol, Rimfire Rifle, and Pistol Caliber Carbine, you don\'t holster: instead, before the signal, you hold on an aiming point (a marker, cone, flag, or sign no wider than 9") set 10\' in front of your box, 18-24" high, finger off the trigger and outside the trigger guard (8.2.3).';

const STANDARD_STRING_RULE = 'You may fire as many rounds as you need each string (9.1.1). Best four of five strings count toward your score, the worst dropped (9.1.2). No string may run longer than 30 seconds (9.2). Any of the four standard plates hit before the stop plate counts; a missed plate carries a time penalty under section 10. Your time stops on your last shot fired (9.2.2).';

export const STOCK_DRILLS_V2_STEEL: readonly StockDrillEntry[] = [
  { name: 'Steel Challenge: Five to Go', fire: 'both', scoring: 'time', holster: true,
    categories: STEEL_CHALLENGE_CATEGORIES,
    brief: 'SCSA stage SC-101: four plates and a stop plate, best 4 of 5 strings.',
    full: `Five to Go is Steel Challenge stage SC-101, the first of the sport's eight standard courses of fire (SCSA Rulebook Appendix B.1). Like every Steel Challenge stage it uses five plates: four standard plates you can take in any order, plus a stop plate that has to be your last hit of the string (9.1.1).

Set up from a single 3' x 3' shooting box. Working left to right as you face downrange: the first standard plate is a 10" round plate 30' downrange and 10'3" left of center, its center 5' high. The second is a 10" round plate 36' downrange, 3'5" left of center, 5' high. The third is a 10" round plate 45' downrange, 3'5" right of center, 5' high. The fourth is a 10" round plate 54' downrange, 10'3" right of center, 5' high. So the four standard plates climb away from you as your eye moves right, the farthest almost twice the distance of the nearest. The stop plate breaks that pattern: it's a 12" round plate, 21' downrange and 17'1" right of center, 5' high. It sits closer to you than any standard plate, and farther right than all of them (Appendix B.1).

One box only, 3' x 3' (2.2).

${STANDARD_START}

${STANDARD_STRING_RULE}

Because the standard plates step away from you left to right and the stop plate sits closest of all, off to the far right, Five to Go asks you to keep swinging past three plates that are getting farther before you come back to the nearest target on the stage to finish it. It's a fair test of whether your transitions slow down as distance builds, and whether you can call the near, easy-looking stop plate cleanly instead of rushing it.

As a suggestion only, and no substitute for the real course of fire: rough this shape in at home by taping four scaled circles to a wall or fence stepping away to one side, and a fifth, smaller circle standing in for the stop plate off to the other side and closer than the rest. Dry-run the order left to right, finishing on the stop plate, and time yourself against a par pulled from your own live strings.

Layout: SCSA Rulebook 2026, Appendix B.1; procedure: sections 2.2, 8.2, 9.1.` },

  { name: 'Steel Challenge: Showdown', fire: 'both', scoring: 'time', holster: true,
    categories: STEEL_CHALLENGE_CATEGORIES,
    brief: 'SCSA stage SC-102: two shooting boxes, three strings from one and two from the other, best 4 of 5.',
    full: `Showdown is Steel Challenge stage SC-102 (Appendix B.2). It carries the same five-plate shape as every stage, four standard plates plus a stop plate that must be your last hit (9.1.1), but it's one of only two SCSA stages shot from more than one box.

The inventory is two 10" round plates, two 18"x24" rectangles, and a 12" stop plate. The two round plates sit close in, 30' downrange, 4' left and 4' right of center, 5' high. The stop plate is farther out, on the center line, 36' downrange, 5' high. The two rectangles are the farthest targets on the stage, 75' downrange, 9' left and 9' right of center, 5'6" high (Appendix B.2).

Showdown uses two 3' x 3' boxes, 6' apart, left and right of center (2.2). You shoot three of your five strings from one box and two from the other, in any combination you like: 3 and 2, 2 and 3, or 2-2-1 are all acceptable (8.2.4). There is no movement between boxes during a string; a string fired from the wrong box doesn't count, and you reshoot it (2.2, 8.2.4).

In centerfire handgun, you load and holster before the beep, hands raised above your shoulders in the surrender position, fully visible from behind (8.2.2). In Rimfire Pistol, Rimfire Rifle, and Pistol Caliber Carbine, you don't holster: on this stage an aiming point (a marker, cone, flag, or sign no wider than 9") is placed in front of each shooting box, 10' away and 18-24" high, and you hold on it, finger off the trigger and outside the trigger guard, until the signal (8.2.3).

${STANDARD_STRING_RULE}

The near round plates and the far rectangles sit at opposite ends of the stage, so within a single box you're already working a near-to-far transition. The layer Showdown adds on top is box management: committing to your 3/2 split (or your own combination) and keeping count of which box you're in, since losing track costs you a full reshoot of every string fired from the wrong one.

As a suggestion only: mark two spots about 6' apart at home, pick your box order ahead of time, and dry-run stepping cleanly between them between strings, never during one. That drills the box discipline and the count, not the shooting itself.

Layout: SCSA Rulebook 2026, Appendix B.2; procedure: sections 2.2, 8.2, 9.1.` },

  { name: 'Steel Challenge: Smoke & Hope', fire: 'both', scoring: 'time', holster: true,
    categories: STEEL_CHALLENGE_CATEGORIES,
    brief: 'SCSA stage SC-103: four big rectangles in close, a small stop plate out front, best 4 of 5.',
    full: `Smoke & Hope is Steel Challenge stage SC-103 (Appendix B.3), shot from a single box under the standard five-plate rule: four standard plates in any order, then a stop plate that must be your last hit (9.1.1).

Unusually for a standard stage, all four standard plates are large 18"x24" rectangles rather than round plates, and the stop plate is the small 12" round target. Working left to right: two rectangles sit close, 21' downrange, 14' left and 14' right of center, 5'6" high. Two more sit a little farther and a little narrower, 27' downrange, 9' left and 9' right of center, 5'6" high. The stop plate is out past all four, 42' downrange on the center line, 5' high (Appendix B.3).

One box only, 3' x 3' (2.2).

${STANDARD_START}

${STANDARD_STRING_RULE}

With four big rectangles standing in close and grouped in pairs, Smoke & Hope rewards raw speed on the standard plates; there's very little reason to miss one. The real discipline the stage tests sits past that: whether you can shift down in target size and reach out to the smaller, farther stop plate without carrying the same all-out swing you used on the rectangles.

As a suggestion only: tape four large rectangles to a wall in two close pairs, with one smaller circle farther out standing in for the stop plate, and dry-run the speed-then-precision shift. That's a stand-in for the sight-picture change, not for the live shot.

Layout: SCSA Rulebook 2026, Appendix B.3; procedure: sections 2.2, 8.2, 9.1.` },

  { name: 'Steel Challenge: Outer Limits', fire: 'both', scoring: 'time', holster: true,
    categories: STEEL_CHALLENGE_CATEGORIES,
    brief: 'SCSA stage SC-104: three boxes, one move on the clock, best 3 of 4 strings.',
    full: `Outer Limits is Steel Challenge stage SC-104 (Appendix B.4), and it's the odd stage out in two ways: it's the only one that moves you mid-string, and it's shot as four strings instead of five, so your best three count rather than your best four (9.1.2). It keeps the same underlying rule as every stage: four standard plates plus a stop plate that must be hit last (9.1.1).

The inventory is two 12" round plates, two 18"x24" rectangles, and a 12" stop plate. The two round plates, the "20-yard plates," sit 60' downrange, 12' left and 12' right of center, 5' high. The two rectangles, the "35-yard plates," are the farthest targets on the stage, 105' downrange, 6' left and 6' right of center, 5'6" high. The stop plate sits closer than either pair, 54' downrange on the center line, 5' high. These distances are drawn from the center box (Appendix B.4).

Outer Limits uses three 4' x 4' boxes, larger than the standard 3' x 3', spaced 6' apart: left, center, and right (2.2). You only use two of the three. Start in the outside box on your weak side and engage the round plate and the rectangle on that side of the center line; then, while the clock is running, move to the middle box and engage the remaining round plate, the remaining rectangle, and the stop plate (2.2). Box-to-box movement is permitted on this stage specifically, since movement after the start signal is otherwise not allowed on any Steel Challenge stage (8.3.1.1).

In centerfire handgun, you load and holster before the beep, hands raised above your shoulders in the surrender position, fully visible from behind (8.2.2). In Rimfire Pistol, Rimfire Rifle, and Pistol Caliber Carbine, you don't holster: on this stage an aiming point (a marker, cone, flag, or sign no wider than 9") is placed in front of each shooting box, 10' away and 18-24" high, and you hold on it, finger off the trigger and outside the trigger guard, until the signal (8.2.3).

You may fire as many rounds as you need each string (9.1.1). Best three of four strings count (9.1.2). No string may run longer than 30 seconds (9.2). Any standard plate hit before the stop plate counts; a missed plate carries a time penalty under section 10. Your time stops on your last shot fired (9.2.2).

This is the one stage that asks you to shoot accurately while your whole stance is in motion, on top of the usual plate-to-plate speed: two close-in plates from a stand, a full box-to-box move under a running clock, then two more plates, including a 105' shot, and the stop plate to close it out.

As a suggestion only: mark two spots about 6' apart at home. Dry-present at an imaginary far target from the first spot, then step deliberately to the second and dry-present again. That rehearses the footwork and the transition, not live target engagement.

Layout: SCSA Rulebook 2026, Appendix B.4; procedure: sections 2.2, 8.2, 9.1.` },

  { name: 'Steel Challenge: Accelerator', fire: 'both', scoring: 'time', holster: true,
    categories: STEEL_CHALLENGE_CATEGORIES,
    brief: 'SCSA stage SC-105: a near pair and a far pair on opposite sides, stop plate between, best 4 of 5.',
    full: `Accelerator is Steel Challenge stage SC-105 (Appendix B.5), not to be confused with the app's separate "Accelerator (Steel)" generic plate-rack practice drill; this one is the real stage. It follows the standard five-plate rule: four standard plates in any order, then a stop plate that must be your last hit (9.1.1).

The inventory is one 10" round plate, one 12" round plate, two 18"x24" rectangles, and a 12" stop plate. The diagram doesn't label which round plate is the 10" and which is the 12", so this description doesn't guess. A near pair sits at 30' downrange on your left: a round plate 12' left of center (5' high) and a rectangle 4' left of center (5'6" high), 8' apart from each other. A far pair sits at 60' downrange on your right: a round plate 6' right of center (5' high) and a rectangle 20' right of center (5'6" high), 14' apart from each other. The stop plate sits between the two pairs in distance, 45' downrange on the center line, 5' high (Appendix B.5).

One box only, 3' x 3' (2.2).

${STANDARD_START}

${STANDARD_STRING_RULE}

With a close pair on one side of the stage and a farther pair on the other, Accelerator asks for a diagonal swing across the full width of the array, changing both distance and direction as you work through it, with the stop plate sitting on the center line between the two.

As a suggestion only: set two scaled targets close together on one side of a wall and two farther apart on the other, with a fifth, smaller target between them for the stop plate, and dry-run the diagonal order. That's a stand-in for the swing, not for the live shot.

Layout: SCSA Rulebook 2026, Appendix B.5; procedure: sections 2.2, 8.2, 9.1.` },

  { name: 'Steel Challenge: Pendulum', fire: 'both', scoring: 'time', holster: true,
    categories: STEEL_CHALLENGE_CATEGORIES,
    brief: 'SCSA stage SC-106: four round plates in a line, the outer two a foot higher, best 4 of 5.',
    full: `Pendulum is Steel Challenge stage SC-106 (Appendix B.6), run under the standard five-plate rule: four standard plates in any order, then a stop plate that must be your last hit (9.1.1).

The inventory is two 10" round plates, two 12" round plates, and a 12" stop plate. All four standard plates sit in a single line at 54' downrange: 12' left of center, 6' left of center, 6' right of center, and 12' right of center. The two outer plates, at 12' left and right, are the larger 12" plates and stand 6' high. The two inner plates, at 6' left and right, are the smaller 10" plates and stand 5' high, a foot lower than the outer pair. The stop plate is closer than the line of four, 30' downrange on the center line, 5' high (Appendix B.6).

One box only, 3' x 3' (2.2).

${STANDARD_START}

${STANDARD_STRING_RULE}

The four standard plates sit in a straight line but at two different heights, a foot apart, so working across them left to right (or right to left) swings your point of aim up and down as well as sideways, plate to plate, before you come back in to the near, waist-height stop plate.

As a suggestion only: tape four scaled circles to a wall in a straight line, the outer two set about a foot higher than the inner two, and dry-run the order across the mixed heights. That drills the aim adjustment, not the live shot.

Layout: SCSA Rulebook 2026, Appendix B.6; procedure: sections 2.2, 8.2, 9.1.` },

  { name: 'Steel Challenge: Speed Option', fire: 'both', scoring: 'time', holster: true,
    categories: STEEL_CHALLENGE_CATEGORIES,
    brief: 'SCSA stage SC-107: four plates in close, the stop plate is the farthest target on the stage, best 4 of 5.',
    full: `Speed Option is Steel Challenge stage SC-107 (Appendix B.7), run under the standard five-plate rule: four standard plates in any order, then a stop plate that must be your last hit (9.1.1). It's also unusual in its inventory: here the stop plate is a large 18"x24" rectangle rather than a round plate.

The four standard plates are all 12" round plates. One sits 24' downrange, 6.5' right of center, 5' high. Another sits 30' downrange, 12' left of center, 5' high. Another sits 45' downrange, 21' right of center, 5' high. The last sits 60' downrange, 6' left of center, 5' high. The stop plate, the 18"x24" rectangle, is the farthest target on the entire stage: 105' downrange, 21.5' left of center, 5'6" high (Appendix B.7).

One box only, 3' x 3' (2.2).

${STANDARD_START}

${STANDARD_STRING_RULE}

The four standard plates are close in and scattered left and right rather than in a clean row, which is its own read-and-transition test, but the plate that defines this stage is the stop plate, sitting more than twice as far out as any standard plate. Speed Option asks you to bank speed on the close work, then commit to a clean, unhurried call on a genuinely long final shot.

As a suggestion only: set four scaled circles up close in a scattered, non-linear pattern, and one smaller target well past them for the stop plate, and dry-run the order, finishing on the far one. That rehearses the sequencing and the long final presentation, not the live shot.

Layout: SCSA Rulebook 2026, Appendix B.7; procedure: sections 2.2, 8.2, 9.1.` },

  { name: 'Steel Challenge: Roundabout', fire: 'both', scoring: 'time', holster: true,
    categories: STEEL_CHALLENGE_CATEGORIES,
    brief: 'SCSA stage SC-108: two plates in close, two farther out, stop plate between, best 4 of 5.',
    full: `Roundabout is Steel Challenge stage SC-108 (Appendix B.8), the last of the eight, run under the standard five-plate rule: four standard plates in any order, then a stop plate that must be your last hit (9.1.1).

The inventory is four 12" round plates and a 12" stop plate. Two standard plates sit close, 21' downrange: one 2' left of center, the other on the same line off to the right (the diagram doesn't label that plate's exact offset, so this description doesn't guess at a figure). Both stand 5' high. Two more standard plates sit farther out, 45' downrange: one 9' left of center, one 8' right of center, both 5' high. The stop plate sits between the near and far pairs in distance, 30' downrange, 2' right of center, 5' high (Appendix B.8).

One box only, 3' x 3' (2.2).

${STANDARD_START}

${STANDARD_STRING_RULE}

Roundabout's stop plate sits geographically between the near pair and the far pair: at 30' downrange, it's closer than the far plates but farther than the near ones, right in your natural sweep from near to far. Since every standard plate has to fall before the stopper counts, Roundabout is a genuine test of finishing what you started, working past a target that's positioned to tempt you into calling it early.

As a suggestion only: tape two scaled circles close together, two more farther out, and a fifth, smaller one between the two groups for the stop plate, and dry-run working near to far and back to the stopper last. That's a stand-in for the sequencing, not the live shot.

Layout: SCSA Rulebook 2026, Appendix B.8; procedure: sections 2.2, 8.2, 9.1.` },
];

/**
 * The authored library: the original 14 stock drills, then the eight Steel
 * Challenge stage drills (stock library version 2), in Appendix B order.
 */
export const STOCK_DRILLS: readonly StockDrillEntry[] = [...STOCK_DRILLS_V1, ...STOCK_DRILLS_V2_STEEL];

function defsFor(entries: readonly StockDrillEntry[], now: number): DrillDef[] {
  return entries.map((d) => stampNew(
    {
      name: d.name,
      gunCategories: d.categories ?? ['Pistol'],
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

/** The library as storable records (fixed ids → idempotent writes). */
export function stockDrillDefs(now: number): DrillDef[] {
  return defsFor(STOCK_DRILLS, now);
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

export type StockDrillsV2Action = 'none' | 'wait' | 'topup';

/**
 * Decide what the version-2 top-up should do, for an install where v1
 * (the original 14) has already had its say. Pure, same shape as
 * stockDrillsAction above, so every branch is unit-tested without IndexedDB.
 *
 *  - v2 already ran to completion: 'none', forever.
 *  - v1 hasn't seeded yet: 'wait' — when it does run, it seeds the full
 *    22-drill STOCK_DRILLS array directly (see ensureStockDrills), so there
 *    is nothing separate for v2 to add.
 *  - v1 ran, and NO 'drs-' id survives in the drills store (either this was
 *    always an "own library, mark-only" install, or it was seeded and every
 *    stock drill was later deleted): 'none'. Both histories look the same
 *    from here on purpose — the existing promise that a shooter's deletion
 *    of the stock library is respected forever must hold for the new eight
 *    exactly like it holds for the original 14.
 *  - v1 ran, and at least one 'drs-' id survives (even if it's not all 14):
 *    'topup' — the install is still eligible, and gets all eight new drills.
 */
export function stockDrillsV2Action(input: {
  seededV1: boolean | undefined;
  seededV2: boolean | undefined;
  hasAnyStockDrill: boolean;
}): StockDrillsV2Action {
  if (input.seededV2) return 'none';          // once per install, forever
  if (!input.seededV1) return 'wait';         // v1 hasn't run yet; it will seed all 22 directly
  if (!input.hasAnyStockDrill) return 'none'; // own-library mark, OR every stock drill was deleted
  return 'topup';
}

/**
 * Run the seed check against the database. Returns true only the single time
 * the library is actually written (so the caller knows to re-render);
 * marking-only and no-op runs return false. Fail-safe: a storage hiccup can
 * never break an app open — it just means we try again next time.
 *
 * Covers both the original seed (v1: 0 → 14, now 0 → 22 on a fresh install)
 * and the version-2 top-up (an install that already carried `drillsSeeded`
 * from before the eight Steel Challenge drills shipped gets them added once,
 * by fixed id, so a crash-retry can never duplicate them).
 */
export async function ensureStockDrills(now: number = Date.now()): Promise<boolean> {
  try {
    // Cheap early-exit on every open, no lock needed: once both v1 and v2
    // are done, there is nothing left to ever check again.
    const early = await getSettings<AppSettings>();
    if (early?.drillsSeeded && early?.drillsSeededV2) return false;
    // Decision AND write under the SAME cross-tab exclusion as restore/import/
    // erase, so a second tab's restore can't interleave with our reads/writes.
    return await withExclusiveIo('the drill seed', async () => {
      const settings = await getSettings<AppSettings>();
      if (settings?.drillsSeeded && settings?.drillsSeededV2) return false; // another tab finished meanwhile

      if (!settings?.drillsSeeded) {
        const gunCount = await countAll('firearms');
        const drillCount = gunCount > 0 ? (await getAll<{ id: string }>('drills')).length : 0;
        const action = stockDrillsAction({ seeded: settings?.drillsSeeded, gunCount, drillCount });
        if (action === 'none') return false; // no gun yet; stays eligible for next open
        if (action === 'mark') {
          // An own-library install never owes the v2 top-up either — mark both.
          await putSettings<AppSettings>({ drillsSeeded: true, drillsSeededV2: true });
          return false; // nothing on screen changed
        }
        // Fresh install: the whole library (now 22) AND both guards, one
        // atomic transaction, all-or-nothing.
        await seedDrillsWithSettings<AppSettings>(stockDrillDefs(now), { drillsSeeded: true, drillsSeededV2: true });
        return true;
      }

      // v1 already ran, on a build before the eight Steel Challenge drills
      // existed (or earlier this same open, in the branch above — but that
      // branch always sets drillsSeededV2 too, so it never falls through
      // here). Decide the v2 top-up on its own.
      if (settings.drillsSeededV2) return false;
      const stockDrillIds = (await getAll<{ id: string }>('drills')).filter((d) => d.id.startsWith('drs-'));
      const v2 = stockDrillsV2Action({
        seededV1: settings.drillsSeeded,
        seededV2: settings.drillsSeededV2,
        hasAnyStockDrill: stockDrillIds.length > 0,
      });
      if (v2 === 'none') {
        await putSettings<AppSettings>({ drillsSeededV2: true }); // stop checking on future opens
        return false;
      }
      // Top-up: only the eight new Steel Challenge stage drills, never the
      // original 14 — same transaction shape as v1, same fixed-id
      // idempotency, same exclusive-io lock.
      await seedDrillsWithSettings<AppSettings>(defsFor(STOCK_DRILLS_V2_STEEL, now), { drillsSeededV2: true });
      return true;
    });
  } catch (e) {
    console.error('Stock drill seed check failed', e);
    return false; // resilience-first: never let the seed break an app open
  }
}
