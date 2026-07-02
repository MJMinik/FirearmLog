// Generates the bundled sample dataset -> public/demo-dataset.bin.
//
// Why a script (not a hand-made binary): the demo is the FIRST thing a new user
// loads, so it must be valid, rich, and reproducible. This builds a realistic
// ~18-month competitive-pistol-shooter log and packages it with the app's OWN
// buildFlog(), so the output is guaranteed to round-trip through parseFlog() /
// restoreSnapshot() (the same validated path a real Pull uses).
//
// Run:  node --experimental-strip-types scripts/make-demo.ts
//
// Coverage on purpose: 110+ sessions (live / dry-fire / class), 30+ matches
// including several Steel Challenge (per-string times, an Outer Limits) so the
// new Steel scoring shows up in the demo; USPSA club/sectional/area with a few
// A/C/D stage breakdowns; classifiers trending C -> A; plus ammo (FIFO),
// costs, maintenance, magazines, optics, parts, goals, and skill assessments.
// No media (photos) -- keeps the file robust; photo refs are left empty.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildFlog, type Snapshot } from '../src/lib/flog.ts';

// ---- deterministic RNG (mulberry32) so the demo is stable across rebuilds ----
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(20260702);
const pick = <T>(arr: T[]): T => arr[Math.floor(r() * arr.length)];
const randint = (lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
const round = (x: number, d = 2): number => { const p = 10 ** d; return Math.round(x * p) / p; };
const chance = (p: number): boolean => r() < p;

// ---- date helpers (noon UTC avoids any day-shift when read as a local date) ----
const dayMs = 86400000;
const iso = (d: Date): string => d.toISOString().slice(0, 10);
const at = (isoDate: string): number => Date.parse(isoDate + 'T12:00:00Z');
const START = new Date('2025-01-06T12:00:00Z'); // first Monday of the log

type Rec = Record<string, unknown>;
const stores: Record<string, Rec[]> = {
  firearms: [], sessions: [], drills: [], ammunition: [], purchases: [],
  maintenance: [], malfunctions: [], magazines: [], optics: [], parts: [],
  goals: [], skills: [], matches: [], classifiers: [], references: [], trash: [],
  meta: [],
};
const stamp = (isoDate: string) => ({ createdAt: at(isoDate), updatedAt: at(isoDate) });

// ===================== FIREARMS =====================
const guns = [
  { id: 'fa-dr920', name: 'Shadow Systems DR920', manufacturer: 'Shadow Systems', model: 'DR920', caliber: '9mm', dateAcquired: '2024-12-20', notes: 'Primary Carry Optics gun.' },
  { id: 'fa-staccato', name: 'Staccato XC', manufacturer: 'Staccato', model: 'XC', caliber: '9mm', dateAcquired: '2025-05-17', notes: 'Limited Optics build. My nice gun.' },
  { id: 'fa-g34', name: 'Glock 34 Gen5 MOS', manufacturer: 'Glock', model: '34 Gen5 MOS', caliber: '9mm', dateAcquired: '2025-01-05', notes: 'Backup / practice CO gun.' },
  { id: 'fa-shadow2', name: 'CZ Shadow 2', manufacturer: 'CZ', model: 'Shadow 2', caliber: '9mm', dateAcquired: '2024-11-01', notes: 'Steel Challenge centerfire + Production fun.' },
  { id: 'fa-victory', name: 'S&W Victory', manufacturer: 'Smith & Wesson', model: 'SW22 Victory', caliber: '.22 LR', dateAcquired: '2025-02-10', notes: 'Steel Challenge rimfire (RFPO).' },
  { id: 'fa-g19', name: 'Glock 19 Gen5', manufacturer: 'Glock', model: '19 Gen5', caliber: '9mm', dateAcquired: '2024-10-01', notes: 'Carry / general practice.' },
];
for (const g of guns) {
  stores.firearms.push({
    id: g.id, ...stamp(g.dateAcquired),
    name: g.name, manufacturer: g.manufacturer, model: g.model, caliber: g.caliber,
    category: 'Pistol', serialNumber: `DEMO-${g.id.slice(3).toUpperCase()}`,
    dateAcquired: g.dateAcquired, startingRoundCount: 0,
    deepCleanInterval: 5000, recoilSpringInterval: 5000,
    photoIds: [], referenceId: null, notes: g.notes, status: 'active',
  });
}
const centerfire = ['fa-dr920', 'fa-staccato', 'fa-g34', 'fa-shadow2', 'fa-g19'];

// ===================== OPTICS =====================
const optics = [
  { id: 'op-507c', firearmId: 'fa-dr920', make: 'Holosun', model: '507C X2', dot: '2 MOA dot / 32 ring', install: '2024-12-21' },
  { id: 'op-sro', firearmId: 'fa-staccato', make: 'Trijicon', model: 'SRO', dot: '2.5 MOA', install: '2025-05-18' },
  { id: 'op-507comp', firearmId: 'fa-g34', make: 'Holosun', model: '507Comp', dot: '2 MOA / CRS', install: '2025-01-06' },
  { id: 'op-rmr', firearmId: 'fa-victory', make: 'Trijicon', model: 'RMR Type 2', dot: '3.25 MOA', install: '2025-02-11' },
];
for (const o of optics) {
  stores.optics.push({
    id: o.id, ...stamp(o.install), firearmId: o.firearmId, make: o.make, model: o.model,
    installDate: o.install, dotSize: o.dot, zeroDist: '15 yards', mountHeight: 'Direct milled / plate',
    torqueSpec: '15 in-lb', settingsSnapshot: 'Brightness 8, dot only',
    batteryLog: [{ date: o.install, notes: 'New battery at install' }], notes: '',
  });
}

// ===================== MAGAZINES =====================
const magSpecs = [
  ['fa-dr920', 4], ['fa-staccato', 4], ['fa-g34', 3], ['fa-shadow2', 3], ['fa-victory', 2], ['fa-g19', 3],
] as const;
let magN = 0;
for (const [fid, count] of magSpecs) {
  for (let i = 1; i <= count; i++) {
    magN++;
    stores.magazines.push({
      id: `mg-${magN}`, ...stamp('2025-01-06'), label: `${fid.slice(3, 6).toUpperCase()}-${i}`,
      firearmIds: [fid], active: true, totalRounds: randint(2000, 9000), springHistory: [], notes: '',
    });
  }
}

// ===================== AMMUNITION (FIFO cans) =====================
const ammo = [
  { id: 'am-blazer115', brand: 'Blazer Brass', caliber: '9mm', grain: '115', bulletType: 'FMJ', cpr: 0.21, notes: 'Bulk practice.' },
  { id: 'am-fed124', brand: 'Federal AE', caliber: '9mm', grain: '124', bulletType: 'FMJ', cpr: 0.24, notes: 'Practice / classifiers.' },
  { id: 'am-aa147', brand: 'Atlanta Arms', caliber: '9mm', grain: '147', bulletType: 'FMJ', cpr: 0.29, notes: 'Match ammo — soft shooting.' },
  { id: 'am-sig124', brand: 'SIG Elite', caliber: '9mm', grain: '124', bulletType: 'FMJ', cpr: 0.27, notes: 'Match backup.' },
  { id: 'am-cci22', brand: 'CCI Standard Velocity', caliber: '.22 LR', grain: '40', bulletType: 'LRN', cpr: 0.08, notes: 'Steel rimfire.' },
];
for (const a of ammo) {
  stores.ammunition.push({
    id: a.id, ...stamp('2025-01-04'), brand: a.brand, caliber: a.caliber, grain: a.grain,
    bulletType: a.bulletType, quantity: randint(800, 3000), costPerRound: a.cpr, notes: a.notes,
  });
}
const cf9 = ['am-blazer115', 'am-fed124', 'am-aa147', 'am-sig124'];

// ===================== DRILLS =====================
const drills: [string, 'live' | 'dry' | 'both', string, string, string][] = [
  ['Bill Drill', 'live', 'time', '6 shots from the holster at 7 yards, all A.', 'Draw and fire six rounds at one target at 7 yd. Goal: all A, sub-2.0s. Builds recoil control and splits.'],
  ['Failure Drill', 'both', 'time', 'Two to the body, one to the head.', 'Mozambique: 2 body + 1 head from the holster. Trains transitions to a smaller target under speed.'],
  ['El Presidente', 'live', 'time', 'Classic 12-round test with a turn and reload.', 'Back to targets, turn, 2 each on 3 targets, reload, 2 each again. 10 yd. The all-around test.'],
  ['Dot Torture', 'live', 'points', '50 rounds, 50 dots, fundamentals under pressure.', 'Slow-fire accuracy standard across draws, one-hand, and transitions. Score out of 50.'],
  ['Doubles / Hammers', 'both', 'time', 'Controlled pairs, recoil management.', 'Pairs on one target — hammers (one sight picture) and doubles (two). Chase flat, fast splits.'],
  ['Draw to First Shot', 'both', 'time', 'Holster to first A.', 'Par-time draws to an A at 7 yd. The single highest-value speed skill.'],
  ['Reload Practice', 'dry', 'time', 'Slide-lock and in-battery reloads.', 'Dry reload reps to a par time. Index the mag well, insert, drive out. Build to sub-1.2s.'],
  ['Transitions', 'both', 'time', 'Target-to-target eye/gun speed.', 'Two to six targets, move the eyes first. Trains snappy, accurate transitions.'],
  ['Precision Slow Fire', 'live', 'points', 'Group work at distance.', 'Slow, perfect reps at 15–25 yd. Rebuilds trigger control when speed erodes it.'],
  ['Accelerator (Steel)', 'live', 'time', 'SCSA-style plate stage practice.', 'Five plates, best-of runs. Trains the Steel Challenge rhythm and transitions.'],
  ['1-Reload-1', 'both', 'time', 'One shot, reload, one shot.', 'Isolates the reload against the clock. 7 yd, par time to both A hits.'],
  ['Blake Drill', 'live', 'time', 'Six shots across three targets.', 'One each on three targets, then back — chase transition speed with control.'],
  ['Box Drill', 'both', 'time', 'Body-body then head-head across two targets.', 'Two targets: bodies then heads. Trains transition + elevation change.'],
  ['Wide Transitions', 'both', 'time', 'Big swings between targets.', 'Trains eye lead and grip stability across wide arrays.'],
];
for (const [name, fire, scoring, brief, full] of drills) {
  stores.drills.push({
    id: `drx-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    ...stamp('2025-01-04'), name, gunCategories: ['Pistol'], fire, briefDescription: brief,
    fullDescription: full, scoring, requiresHolster: fire !== 'dry' || chance(0.5), tags: [],
  });
}
const liveDrills = drills.filter((d) => d[1] !== 'dry').map((d) => d[0]);
const dryDrills = drills.filter((d) => d[1] !== 'live').map((d) => d[0]);
const distances = ['5 yd', '7 yd', '10 yd', '12 yd', '15 yd', '25 yd'];

// ===================== SESSIONS (≈110 over ~18 months) =====================
// Weekly rhythm: usually 1 live practice + 1–2 dry-fire, a class about monthly.
let seN = 0;
const liveRanges = ['Echo Valley', 'Take Aim', 'Ancient City Shooting Range'];
const skillBase = 5; // trends up over time
const weeks = 76;
for (let w = 0; w < weeks; w++) {
  const monday = new Date(START.getTime() + w * 7 * dayMs);
  const ratingCreep = Math.min(3, Math.floor(w / 22)); // +0..3 over the log
  // --- live practice (most weeks) ---
  if (chance(0.82)) {
    const d = new Date(monday.getTime() + randint(1, 5) * dayMs);
    const gun = pick(['fa-dr920', 'fa-dr920', 'fa-g34', 'fa-shadow2', 'fa-g19']);
    const can = gun === 'fa-shadow2' ? pick(cf9) : pick(cf9);
    const rounds = randint(120, 340);
    const nDrills = randint(1, 4);
    const chosen = new Set<string>();
    while (chosen.size < nDrills) chosen.add(pick(liveDrills));
    seN++;
    const id = `se-${String(seN).padStart(3, '0')}`;
    stores.sessions.push({
      id, ...stamp(iso(d)), date: iso(d), type: 'practice',
      guns: [{ firearmId: gun, rounds }], location: pick(liveRanges), distances: '',
      notes: chance(0.25) ? pick(['Good grip day.', 'Draw felt slow, need reps.', 'Dot tracking clean.', 'Worked weak-hand.', 'Sloppy at speed — dialed it back.']) : '',
      ammoUsage: [{ ammoId: can, rounds }],
      drills: [...chosen].map((name) => ({
        name, distance: pick(distances),
        time: /Torture|Slow Fire/.test(name) ? null : round(1.4 + r() * 2.6, 2),
        score: /Torture/.test(name) ? randint(42, 50) : null,
        maxScore: /Torture/.test(name) ? 50 : null, notes: '',
      })),
      targetMediaIds: [], malfunctions: [],
      selfRating: {
        focus: Math.min(9, skillBase + ratingCreep + randint(-1, 1)),
        fundamentals: Math.min(9, skillBase + ratingCreep + randint(-1, 1)),
        satisfaction: Math.min(9, skillBase + ratingCreep + randint(-1, 2)),
      },
      rangeFee: chance(0.7) ? randint(15, 30) : null, planned: false, instructor: null, checklist: null,
    });
    // occasional malfunction tied to this live session
    if (chance(0.12)) {
      stores.malfunctions.push({
        id: `mf-${seN}`, ...stamp(iso(d)), sessionId: id, date: iso(d), firearmId: gun,
        type: pick(['Failure to feed', 'Failure to eject', 'Light primer strike', 'Failure to return to battery']),
        resolution: pick(['Tap-rack, ran fine', 'Cleared and continued', 'Swapped magazine']),
        notes: '', ammoId: can, magazineId: null, roundCount: randint(50, rounds),
      });
    }
  }
  // --- dry-fire (frequent) ---
  const dryCount = chance(0.5) ? 2 : 1;
  for (let k = 0; k < dryCount; k++) {
    if (!chance(0.75)) continue;
    const d = new Date(monday.getTime() + randint(0, 6) * dayMs);
    const nDrills = randint(1, 3);
    const chosen = new Set<string>();
    while (chosen.size < nDrills) chosen.add(pick(dryDrills));
    seN++;
    stores.sessions.push({
      id: `se-${String(seN).padStart(3, '0')}`, ...stamp(iso(d)), date: iso(d), type: 'dry_fire',
      guns: [{ firearmId: pick(['fa-dr920', 'fa-g34', 'fa-staccato']), rounds: 0 }],
      location: 'Home (dry)', distances: '', notes: chance(0.15) ? pick(['15 min before dinner.', 'Par times tightening.', 'Reload reps.']) : '',
      ammoUsage: [], drills: [...chosen].map((name) => ({
        name, distance: pick(['3 yd', '5 yd', '7 yd']),
        time: round(1.0 + r() * 1.4, 2), score: null, maxScore: null, notes: '',
      })),
      targetMediaIds: [], malfunctions: [],
      selfRating: { focus: Math.min(9, skillBase + ratingCreep + randint(-1, 1)), fundamentals: Math.min(9, skillBase + ratingCreep + randint(-1, 1)), satisfaction: Math.min(9, skillBase + ratingCreep) },
      rangeFee: null, planned: false, instructor: null, checklist: null,
    });
  }
  // --- class (~monthly) ---
  if (w % 5 === 4) {
    const d = new Date(monday.getTime() + 6 * dayMs);
    seN++;
    stores.sessions.push({
      id: `se-${String(seN).padStart(3, '0')}`, ...stamp(iso(d)), date: iso(d), type: 'class',
      guns: [{ firearmId: 'fa-dr920', rounds: randint(300, 600) }], location: pick(liveRanges), distances: '',
      notes: 'Structured coaching day.', ammoUsage: [{ ammoId: pick(cf9), rounds: randint(300, 600) }],
      drills: [{ name: pick(liveDrills), distance: '7 yd', time: round(1.6 + r() * 1.5, 2), score: null, maxScore: null, notes: '' }],
      targetMediaIds: [], malfunctions: [],
      selfRating: { focus: Math.min(9, 6 + ratingCreep), fundamentals: Math.min(9, 6 + ratingCreep), satisfaction: Math.min(9, 7 + ratingCreep) },
      rangeFee: null, planned: false,
      instructor: pick(['Ben Stoeger', 'Joel Park', 'Hwansik Kim', 'local GM']), checklist: null,
    });
  }
}

// ===================== MATCHES (≈32: USPSA + Steel) =====================
const MINOR = { a: 5, c: 3, d: 1 };
function stagePointsMinor(a: number, c: number, d: number, m: number, ns: number, p: number): number {
  return Math.max(0, MINOR.a * a + MINOR.c * c + MINOR.d * d - 10 * (m + ns + p));
}
let mtN = 0;
// USPSA monthly club matches + periodic sectionals/area, trending upward.
const clubMonths = 24; // ~1–2 matches/month across the log (still all in-window)
const pctBase = 74;
for (let i = 0; i < clubMonths; i++) {
  const d = new Date(at('2025-02-08') + i * 21 * dayMs); // ~every 3 weeks
  const isBig = i > 0 && i % 6 === 0; // a sectional every ~4 months
  const gun = chance(0.75) ? 'fa-dr920' : 'fa-g34';
  const division = 'Carry Optics';
  const nStages = isBig ? randint(4, 6) : randint(3, 5);
  const stages: Rec[] = [];
  for (let s = 1; s <= nStages; s++) {
    if (chance(0.35)) {
      // A/C/D breakdown stage
      const shots = randint(10, 28);
      const a = Math.round(shots * (0.72 + r() * 0.2));
      const c = Math.max(0, Math.min(shots - a, randint(1, 6)));
      const dd = Math.max(0, Math.min(shots - a - c, randint(0, 2)));
      const m = shots - a - c - dd > 0 && chance(0.3) ? 1 : 0;
      const pts = stagePointsMinor(a, c, dd - (m ? 0 : 0), m, 0, chance(0.15) ? 1 : 0);
      const time = round(shots * (0.55 + r() * 0.25), 2);
      stages.push({ number: s, points: pts, time, percent: round(70 + r() * 28, 1), notes: '', alphas: a, charlies: c, deltas: dd, misses: m, noShoots: 0, procedurals: 0 });
    } else {
      stages.push({ number: s, points: randint(45, 130), time: round(9 + r() * 22, 2), percent: round(68 + r() * 30, 1), notes: '' });
    }
  }
  mtN++;
  const pct = round(Math.min(92, pctBase + i * 0.7 + (r() * 6 - 3)), 1);
  const divOf = isBig ? randint(18, 40) : randint(8, 22);
  const ovOf = isBig ? randint(60, 140) : randint(20, 55);
  stores.matches.push({
    id: `mt-${mtN}`, ...stamp(iso(d)), date: iso(d),
    name: isBig ? pick(['Spring Sectional', 'Fall Sectional', 'Sunshine Sectional', 'Gator Classic']) : `${pick(liveRanges)} Club Match`,
    matchType: isBig ? 'USPSA Level 2' : 'USPSA Level 1 (club match)', division, powerFactor: 'Minor',
    scoringType: 'uspsa', firearmId: gun, totalRounds: nStages * randint(18, 32),
    overallPlace: Math.max(1, Math.round(ovOf * (1 - pct / 110))), overallOf: ovOf,
    divisionPlace: Math.max(1, Math.round(divOf * (1 - pct / 108))), divisionOf: divOf,
    matchPercent: pct, stages, entryFee: isBig ? randint(100, 160) : randint(25, 45),
    practiScoreUrl: '', notes: isBig && chance(0.5) ? 'Bigger match — good experience.' : '',
  });
}

// A couple of Limited Optics matches on the Staccato once acquired.
for (const dISO of ['2025-08-16', '2026-03-21']) {
  mtN++;
  const nStages = randint(4, 6);
  const stages: Rec[] = [];
  for (let s = 1; s <= nStages; s++) stages.push({ number: s, points: randint(60, 140), time: round(11 + r() * 20, 2), percent: round(74 + r() * 22, 1), notes: '' });
  stores.matches.push({
    id: `mt-${mtN}`, ...stamp(dISO), date: dISO, name: pick(['Area 6 Championship', 'State Championship']),
    matchType: pick(['USPSA Area Championship', 'USPSA State Championship']), division: 'Limited Optics', powerFactor: 'Minor',
    scoringType: 'uspsa', firearmId: 'fa-staccato', totalRounds: nStages * randint(20, 30),
    overallPlace: randint(15, 60), overallOf: randint(120, 260), divisionPlace: randint(4, 18), divisionOf: randint(20, 45),
    matchPercent: round(80 + r() * 12, 1), stages, entryFee: randint(150, 220), practiScoreUrl: '', notes: 'Travel match.',
  });
}

// ---- Steel Challenge matches (the new feature, shown in the demo) ----
const steelStageNames = ['5 to Go', 'Showdown', 'Smoke & Hope', 'Outer Limits', 'Accelerator', 'The Pendulum', 'Speed Option', 'Roundabout'];
function steelStrings(fast: number, count: 4 | 5): { strings: (number | null)[]; misses: number[]; stops: boolean[] } {
  const strings: (number | null)[] = [];
  const misses: number[] = [];
  const stops: boolean[] = [];
  for (let i = 0; i < count; i++) {
    strings.push(round(fast + r() * 1.6, 2));
    const miss = chance(0.12) ? 1 : 0;
    misses.push(miss);
    stops.push(false);
  }
  return { strings, misses, stops };
}
const steelSpecs = [
  { d: '2025-04-19', gun: 'fa-victory', div: 'Rimfire Pistol Open', fast: 2.4 },
  { d: '2025-07-12', gun: 'fa-shadow2', div: 'Carry Optics', fast: 3.0 },
  { d: '2025-10-18', gun: 'fa-victory', div: 'Rimfire Pistol Open', fast: 2.2 },
  { d: '2026-01-24', gun: 'fa-shadow2', div: 'Carry Optics', fast: 2.9 },
  { d: '2026-05-16', gun: 'fa-victory', div: 'Rimfire Pistol Open', fast: 2.0 },
];
for (const sp of steelSpecs) {
  mtN++;
  const nStages = randint(4, 6);
  const chosen: string[] = [];
  while (chosen.length < nStages) { const n = pick(steelStageNames); if (!chosen.includes(n)) chosen.push(n); }
  if (!chosen.includes('Outer Limits') && chance(0.7)) chosen[chosen.length - 1] = 'Outer Limits';
  const stages: Rec[] = chosen.map((sn, i) => {
    const count = sn === 'Outer Limits' ? 4 : 5;
    const g = steelStrings(sp.fast, count as 4 | 5);
    return { number: i + 1, points: null, time: null, percent: null, notes: '', steelStage: sn, strings: g.strings, stringMisses: g.misses, stringStopMissed: g.stops };
  });
  stores.matches.push({
    id: `mt-${mtN}`, ...stamp(sp.d), date: sp.d, name: pick(['Steel Challenge Club Match', 'SCSA Monthly Steel', 'Rimfire Steel Blast']),
    matchType: 'Steel Challenge', division: sp.div, powerFactor: 'Minor', scoringType: 'steel',
    firearmId: sp.gun, totalRounds: nStages * randint(25, 40),
    overallPlace: randint(3, 30), overallOf: randint(30, 70), divisionPlace: randint(1, 10), divisionOf: randint(6, 20),
    matchPercent: null, stages, entryFee: randint(20, 30), practiScoreUrl: '', notes: chance(0.5) ? 'Fun, fast, humbling.' : '',
  });
}

// ===================== CLASSIFIERS (C -> A trend) =====================
const classifierList = [
  ['99-11', 'Down the Middle'], ['03-09', 'On the Move'], ['13-02', 'Tic-Tac-Toe'], ['99-63', 'Take Heed'],
  ['06-03', 'Can You Count'], ['18-03', 'Down the Middle 2'], ['08-01', 'Pucker Factor'], ['20-01', 'Eye of the Tiger'],
  ['99-08', 'Gabby'], ['09-14', 'Eye of the Bullseye'], ['99-46', 'Table Stakes'], ['06-10', 'Baby Advanced'],
  ['22-01', 'Fast Break'], ['99-53', 'Down the Middle 3'], ['13-01', 'Steel Fever'],
];
classifierList.forEach(([code, name], i) => {
  const d = new Date(at('2025-01-26') + i * 32 * dayMs);
  const pct = round(Math.min(80, 55 + i * 1.6 + (r() * 8 - 4)), 1);
  stores.classifiers.push({
    id: `cl-${i + 1}`, ...stamp(iso(d)), date: iso(d), code, name, division: 'Carry Optics',
    hitFactor: round(3.5 + r() * 4, 2), percent: pct, notes: '',
  });
});

// ===================== PURCHASES (ammo FIFO + gear/training/travel) =====================
let puN = 0;
const addPurchase = (dateISO: string, category: string, item: string, vendor: string, cost: number, extra: Rec = {}) => {
  puN++;
  stores.purchases.push({ id: `pu-${puN}`, ...stamp(dateISO), date: dateISO, category, item, vendor, cost: round(cost, 2), notes: '', ...extra });
};
// periodic ammo restocks feeding the cans (FIFO cost basis)
for (let i = 0; i < 12; i++) {
  const dISO = iso(new Date(at('2025-01-04') + i * 42 * dayMs));
  const can = pick(cf9);
  const rounds = 1000;
  const cpr = ammo.find((a) => a.id === can)!.cpr;
  addPurchase(dISO, 'Ammo Purchase', `1,000 rds ${ammo.find((a) => a.id === can)!.brand}`, pick(['Target Sports', 'SGAmmo', 'Freedom Munitions']), rounds * cpr, { ammoId: can, rounds, addedToInventory: true });
}
addPurchase('2025-02-10', 'Ammo Purchase', '5,000 rds CCI Standard Velocity .22', 'Cabelas', 5000 * 0.07, { ammoId: 'am-cci22', rounds: 5000, addedToInventory: true });
addPurchase('2025-01-15', 'Gear / Equipment', 'DAA Alpha-X holster + pouches', 'Double-Alpha', 289.0);
addPurchase('2025-03-02', 'Gear / Equipment', 'Range bag + eyes/ears', 'Amazon', 164.5);
addPurchase('2025-05-17', 'Gear / Equipment', 'Staccato XC magazines (x4)', 'Staccato', 320.0);
addPurchase('2025-06-20', 'Training / Class', 'Ben Stoeger 2-day class', 'Stoeger Pro Shop', 400.0);
addPurchase('2025-09-06', 'Training / Class', 'Local GM private lesson', 'Take Aim', 150.0);
addPurchase('2025-08-15', 'Travel', 'Hotel — Area match', 'Marriott', 268.0);
addPurchase('2026-03-20', 'Travel', 'Fuel + hotel — State match', '—', 340.0);
addPurchase('2026-02-01', 'Gear / Equipment', 'Spare optic (507Comp)', 'Optics Planet', 349.99);

// ===================== MAINTENANCE =====================
let maN = 0;
const addMaint = (dateISO: string, firearmId: string, type: string, parts: string, notes: string) => {
  maN++;
  stores.maintenance.push({ id: `ma-${maN}`, ...stamp(dateISO), date: dateISO, firearmId, type, performedBy: 'Self', partsReplaced: parts, notes });
};
for (let i = 0; i < 18; i++) {
  const dISO = iso(new Date(at('2025-02-01') + i * 30 * dayMs));
  const g = pick(centerfire);
  const type = pick(['field_strip', 'field_strip', 'deep_clean', 'spring_change']);
  addMaint(dISO, g, type,
    type === 'spring_change' ? 'Recoil spring' : '',
    type === 'deep_clean' ? 'Full detail strip.' : type === 'spring_change' ? 'Scheduled spring swap.' : 'Clean & lube after practice.');
}

// ===================== PARTS =====================
const partSpecs = [
  ['fa-dr920', 'Recoil spring assembly', 'SS-RSA-9', 39.98, 'Shadow Systems'],
  ['fa-dr920', 'Competition trigger', 'SS-CT', 129.0, 'Shadow Systems'],
  ['fa-staccato', 'Recoil master spring kit', 'ST-RM', 49.0, 'Staccato'],
  ['fa-g34', 'Steel guide rod', 'ZEV-GR', 34.5, 'ZEV'],
  ['fa-shadow2', 'CGW competition hammer', 'CGW-H', 89.0, 'Cajun Gun Works'],
  ['fa-victory', 'Volquartsen sear', 'VQ-S', 64.0, 'Volquartsen'],
  ['fa-g19', 'Night sights', 'TFX-19', 119.0, 'Truglo'],
];
partSpecs.forEach(([firearmId, name, partNumber, cost, vendor], i) => {
  stores.parts.push({ id: `pt-${i + 1}`, ...stamp('2025-01-20'), firearmId, name, quantity: 1, partNumber, datePurchased: '2025-01-20', notes: 'Spares/upgrade', cost, vendor });
});

// ===================== GOALS =====================
const goalSpecs = [
  ['Bill Drill under 2.0s clean', 'Speed', 'under 2.0s', true, '2025-01-05', '2025-04-12'],
  ['Draw to first A under 1.0s', 'Speed', 'under 1.0s', true, '2025-01-05', '2025-08-02'],
  ['Reach USPSA B class', 'Classification', 'B in Carry Optics', true, '2025-01-10', '2025-11-15'],
  ['Reach USPSA A class', 'Classification', 'A in Carry Optics', false, '2025-11-20', ''],
  ['Shoot a Steel Challenge match', 'Competition', 'Enter one SCSA match', true, '2025-02-15', '2025-04-19'],
  ['Sub-1.2s standing reload', 'Speed', 'under 1.2s', false, '2025-06-01', ''],
  ['Dot Torture clean at 5 yd', 'Accuracy', '50/50', false, '2025-03-01', ''],
  ['Place top-10 division at a sectional', 'Competition', 'Top 10 CO', false, '2025-09-01', ''],
];
goalSpecs.forEach(([text, category, target, achieved, dateSet, dateAchieved], i) => {
  stores.goals.push({ id: `go-${i + 1}`, ...stamp(dateSet as string), text, category, target, achieved, dateSet, dateAchieved });
});

// ===================== SKILL ASSESSMENTS (quarterly, trending up) =====================
const skillKeys = ['draw', 'reload', 'splits', 'transitions', 'accuracy', 'movement', 'mental', 'recoil'];
for (let i = 0; i < 7; i++) {
  const dISO = iso(new Date(at('2025-01-05') + i * 80 * dayMs));
  const base = 5 + i * 0.6;
  const ratings: Record<string, number> = {};
  for (const k of skillKeys) ratings[k] = Math.max(3, Math.min(9, Math.round(base + (r() * 2 - 1))));
  stores.skills.push({ id: `sk-${i + 1}`, ...stamp(dISO), date: dISO, ratings, notes: '' });
}

// ===================== REFERENCES (a user-made care guide) =====================
stores.references.push({
  id: 'refx-dr920', ...stamp('2025-01-06'), name: 'DR920 — my cleaning schedule', category: 'Pistol',
  deepCleanRounds: 5000, recoilSpringRounds: 5000,
  checklist: ['Field strip', 'Brush barrel + feed ramp', 'Wipe rails, re-lube', 'Wipe optic lens', 'Function check'],
  guidance: 'Quick wipe every range trip; full detail + spring check at 5,000 rounds.',
  links: [{ label: 'shadowsystemscorp.com', url: 'https://shadowsystemscorp.com' }],
});

// ===================== META (owner settings) =====================
stores.meta.push({ key: 'settings', value: { ownerName: 'Demo Shooter', theme: '', checklistCustomItems: { essentials: [], night: [], tactical: [] } } });

// ===================== BUILD =====================
let newest = 0;
for (const arr of Object.values(stores)) for (const rec of arr) {
  const u = (rec as { updatedAt?: number }).updatedAt;
  if (typeof u === 'number' && u > newest) newest = u;
}
const snapshot: Snapshot = { exportedAt: Date.now(), lastModified: newest, stores, media: [] };
const bytes = buildFlog(snapshot);
const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo-dataset.bin');
writeFileSync(outPath, bytes);

const counts = Object.fromEntries(Object.entries(stores).map(([k, v]) => [k, v.length]));
console.log('Wrote', outPath, `(${bytes.length} bytes)`);
console.log('Counts:', JSON.stringify(counts));
