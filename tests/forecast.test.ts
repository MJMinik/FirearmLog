import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maintForecast, forecastLine } from '../src/lib/forecast.ts';
import type { Session } from '../src/lib/types.ts';

const GUN = 'fa-1';
const OTHER_GUN = 'fa-2';

/** Fixed "now" shared by most tests — mirrors maintenance.test.ts's NOW pattern.
 * June 11, 2026. Trailing-90-day window: cutoff = 2026-03-13 (excluded, see the
 * boundary tests below), today = 2026-06-11. */
const NOW = new Date(2026, 5, 11);
const CUTOFF = '2026-03-13';       // exactly 90 days before NOW
const CUTOFF_PLUS_ONE = '2026-03-14'; // 89 days before NOW (inside the window)

function session(
  date: string, rounds: number,
  opts: { type?: string; planned?: boolean; gunId?: string } = {}
): Session {
  const { type = 'practice', planned = false, gunId = GUN } = opts;
  return {
    id: `se-${date}-${gunId}-${type}-${planned}`, createdAt: 0, updatedAt: 0,
    date, type, guns: [{ firearmId: gunId, rounds }],
    location: '', distances: '', notes: '', ammoUsage: [], drills: [],
    targetMediaIds: [], malfunctions: [], selfRating: null, rangeFee: null,
    planned, checklist: null
  };
}

// ---------------------------------------------------------------------------
// The evidence gate
// ---------------------------------------------------------------------------

test('gate: exactly 3 live sessions and 300 rounds in window passes (non-null)', () => {
  const sessions = [
    session('2026-04-01', 100),
    session('2026-04-15', 100),
    session('2026-05-01', 100)
  ];
  assert.notEqual(maintForecast(500, GUN, sessions, NOW), null);
  assert.notEqual(forecastLine(500, GUN, sessions, NOW), null);
});

test('gate: only 2 live sessions in window fails, even with 300 rounds', () => {
  const sessions = [
    session('2026-04-01', 150),
    session('2026-05-01', 150)
  ];
  assert.equal(maintForecast(500, GUN, sessions, NOW), null);
  assert.equal(forecastLine(500, GUN, sessions, NOW), null);
});

test('gate: exactly 200 rounds across 3 sessions passes', () => {
  const sessions = [
    session('2026-04-01', 67),
    session('2026-04-15', 67),
    session('2026-05-01', 66)
  ];
  assert.notEqual(maintForecast(500, GUN, sessions, NOW), null);
});

test('gate: 199 rounds across 3 sessions fails (one round short)', () => {
  const sessions = [
    session('2026-04-01', 67),
    session('2026-04-15', 66),
    session('2026-05-01', 66)
  ];
  assert.equal(maintForecast(500, GUN, sessions, NOW), null);
});

test('a session outside the 90-day window counts toward neither gate', () => {
  const sessions = [
    session('2026-04-01', 100),
    session('2026-05-01', 100),
    // Well outside the window, and alone would blow past both gates.
    session('2026-02-01', 5000)
  ];
  // Only 2 sessions / 200 rounds actually qualify — still below the 3-session gate.
  assert.equal(maintForecast(500, GUN, sessions, NOW), null);
});

test('boundary: a session dated exactly 90 days ago (the cutoff) is excluded', () => {
  const sessions = [
    session('2026-04-01', 100),
    session('2026-05-01', 100),
    session(CUTOFF, 5000) // excluded: date > cutoff is false when date === cutoff
  ];
  assert.equal(maintForecast(500, GUN, sessions, NOW), null);
});

test('boundary: a session dated 89 days ago (one day inside the cutoff) is included', () => {
  const sessions = [
    session('2026-04-01', 100),
    session('2026-05-01', 100),
    session(CUTOFF_PLUS_ONE, 100)
  ];
  assert.notEqual(maintForecast(500, GUN, sessions, NOW), null);
});

test('dry-fire sessions never count toward either gate, even with huge rounds', () => {
  const sessions = [
    session('2026-04-01', 100),
    session('2026-05-01', 100),
    session('2026-05-15', 10000, { type: 'dry_fire' })
  ];
  assert.equal(maintForecast(500, GUN, sessions, NOW), null);
});

test('planned sessions never count toward either gate, even with huge rounds', () => {
  const sessions = [
    session('2026-04-01', 100),
    session('2026-05-01', 100),
    session('2026-05-15', 10000, { planned: true })
  ];
  assert.equal(maintForecast(500, GUN, sessions, NOW), null);
});

test('sessions for a different gun never count', () => {
  const sessions = [
    session('2026-04-01', 100),
    session('2026-05-01', 100),
    session('2026-05-15', 10000, { gunId: OTHER_GUN })
  ];
  assert.equal(maintForecast(500, GUN, sessions, NOW), null);
});

test('a session dated after now does not count', () => {
  const sessions = [
    session('2026-04-01', 100),
    session('2026-05-01', 100),
    session('2026-06-12', 10000) // one day after NOW
  ];
  assert.equal(maintForecast(500, GUN, sessions, NOW), null);
});

test('remainingRounds of 0 returns null even above the gate', () => {
  const sessions = [
    session('2026-04-01', 100),
    session('2026-04-15', 100),
    session('2026-05-01', 100)
  ];
  assert.equal(maintForecast(0, GUN, sessions, NOW), null);
  assert.equal(forecastLine(0, GUN, sessions, NOW), null);
});

test('negative remainingRounds returns null even above the gate', () => {
  const sessions = [
    session('2026-04-01', 100),
    session('2026-04-15', 100),
    session('2026-05-01', 100)
  ];
  assert.equal(maintForecast(-50, GUN, sessions, NOW), null);
  assert.equal(forecastLine(-50, GUN, sessions, NOW), null);
});

// ---------------------------------------------------------------------------
// Bound math (known rate, hand-computable)
// ---------------------------------------------------------------------------
// 900 rounds across the 90-day window -> rate 10/day. Remaining 300:
// optimistic = 300 / (10 * 1.5)  = 20 days     -> NOW + 20d  = 2026-07-01 -> "early July"
// pessimistic = 300 / (10 * 0.67) = 44.776... days -> NOW + 44.78d = 2026-07-25 -> "late July"

const KNOWN_RATE_SESSIONS = [
  session('2026-04-01', 300),
  session('2026-04-15', 300),
  session('2026-05-01', 300)
];

test('bound math: known rate produces exact earliest/latest bucket phrases', () => {
  assert.deepEqual(maintForecast(300, GUN, KNOWN_RATE_SESSIONS, NOW), {
    earliest: 'early July',
    latest: 'late July'
  });
});

test('forecastLine renders the range shape: "due roughly X to Y"', () => {
  assert.equal(
    forecastLine(300, GUN, KNOWN_RATE_SESSIONS, NOW),
    'At your recent pace, due roughly early July to late July'
  );
});

// ---------------------------------------------------------------------------
// Collapse case: both bounds land in the same month + bucket + year
// ---------------------------------------------------------------------------
// Same 10/day rate, "now" = June 1 2026, remaining 45:
// optimistic = 45 / 15  = 3 days     -> 2026-06-04 -> "early June"
// pessimistic = 45 / 6.7 = 6.716 days -> 2026-06-07 -> "early June" (same bucket)

const JUNE1 = new Date(2026, 5, 1);
const COLLAPSE_SESSIONS = [
  session('2026-04-02', 300),
  session('2026-04-22', 300),
  session('2026-05-12', 300)
];

test('bounds in the same month+bucket+year collapse to one phrase', () => {
  assert.deepEqual(maintForecast(45, GUN, COLLAPSE_SESSIONS, JUNE1), {
    earliest: 'early June',
    latest: 'early June'
  });
});

test('forecastLine renders the collapsed shape: "due roughly X" (no "to")', () => {
  assert.equal(
    forecastLine(45, GUN, COLLAPSE_SESSIONS, JUNE1),
    'At your recent pace, due roughly early June'
  );
});

// ---------------------------------------------------------------------------
// Months-away case: pessimistic bound beyond ~365 days
// ---------------------------------------------------------------------------
// Same 10/day rate, remaining 3000:
// pessimistic = 3000 / 6.7 = 447.76 days (> 365)

test('forecastLine renders "Months away" when the pessimistic bound exceeds ~365 days', () => {
  assert.equal(
    forecastLine(3000, GUN, KNOWN_RATE_SESSIONS, NOW),
    'Months away at your recent pace'
  );
});

// ---------------------------------------------------------------------------
// Bucket edges: day 10 vs 11 (early/mid), day 20 vs 21 (mid/late)
// ---------------------------------------------------------------------------
// "now" = April 1 2026, same 10/day rate. optimisticDays = remaining / 15.

const APRIL1 = new Date(2026, 3, 1);
const APRIL_EDGE_SESSIONS = [
  session('2026-02-01', 300),
  session('2026-02-20', 300),
  session('2026-03-12', 300)
];

test('bucket edge: day 10 is early, day 11 is mid', () => {
  // remaining 135 -> optimistic 9 days -> 2026-04-10 -> early
  assert.equal(maintForecast(135, GUN, APRIL_EDGE_SESSIONS, APRIL1)!.earliest, 'early April');
  // remaining 150 -> optimistic 10 days -> 2026-04-11 -> mid
  assert.equal(maintForecast(150, GUN, APRIL_EDGE_SESSIONS, APRIL1)!.earliest, 'mid-April');
});

test('bucket edge: day 20 is mid, day 21 is late', () => {
  // remaining 285 -> optimistic 19 days -> 2026-04-20 -> mid
  assert.equal(maintForecast(285, GUN, APRIL_EDGE_SESSIONS, APRIL1)!.earliest, 'mid-April');
  // remaining 300 -> optimistic 20 days -> 2026-04-21 -> late
  assert.equal(maintForecast(300, GUN, APRIL_EDGE_SESSIONS, APRIL1)!.earliest, 'late April');
});

// ---------------------------------------------------------------------------
// December/January year wrap
// ---------------------------------------------------------------------------
// "now" = Dec 20 2026, same 10/day rate, remaining 90:
// optimistic = 6 days  -> 2026-12-26 -> "late December"
// pessimistic = 13.43 days -> 2027-01-02 -> "early January" (different month AND year)

const DEC20 = new Date(2026, 11, 20);
const DEC_WRAP_SESSIONS = [
  session('2026-09-22', 300),
  session('2026-10-31', 300),
  session('2026-11-30', 300)
];

test('December/January year wrap renders correct month names and does not collapse', () => {
  assert.deepEqual(maintForecast(90, GUN, DEC_WRAP_SESSIONS, DEC20), {
    earliest: 'late December',
    latest: 'early January'
  });
});

test('forecastLine across the year wrap renders the range shape with correct months', () => {
  assert.equal(
    forecastLine(90, GUN, DEC_WRAP_SESSIONS, DEC20),
    'At your recent pace, due roughly late December to early January'
  );
});

// ---------------------------------------------------------------------------
// Multi-gun sessions: only THIS gun's rounds feed the rate
// ---------------------------------------------------------------------------
// Found by the session-131 mutation round (mutant m10: dropping the per-gun
// filter in the rounds sum survived every test above, because every fixture
// session named exactly one gun). A real session often names two -- log the
// Erebus and the Apollo in one range trip -- and the other gun's rounds must
// not inflate this gun's pace.
// 3 sessions of 100 rounds for GUN + 500 for OTHER_GUN in the same session:
// correct rate = 300/90 = 3.333/day; polluted rate would be 1800/90 = 20/day.
// Remaining 300: correct optimistic = 300/(3.333*1.5) = 60d -> NOW+60 =
// 2026-08-10 -> "early August"; polluted would be 10d -> "late June".

test('a session naming two guns contributes only this gun\'s rounds to the rate', () => {
  const twoGun = (date: string): Session => ({
    id: `se-${date}-two`, createdAt: 0, updatedAt: 0,
    date, type: 'practice',
    guns: [{ firearmId: GUN, rounds: 100 }, { firearmId: OTHER_GUN, rounds: 500 }],
    location: '', distances: '', notes: '', ammoUsage: [], drills: [],
    targetMediaIds: [], malfunctions: [], selfRating: null, rangeFee: null,
    planned: false, checklist: null
  });
  const sessions = [twoGun('2026-04-01'), twoGun('2026-04-15'), twoGun('2026-05-01')];
  assert.deepEqual(maintForecast(300, GUN, sessions, NOW), {
    earliest: 'early August',
    latest: 'late October'
  });
});
