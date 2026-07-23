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
// Media: four real (anonymous) target photos ride on the newest live session.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildFlog, type Snapshot } from '../src/lib/flog.ts';
import { STOCK_DRILLS, stockDrillId } from '../src/lib/stockDrills.ts';
import type { Media } from '../src/lib/types.ts';

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

// ===================== STORY-FRAME DRILL MODEL (session 58, July 12 2026) =====================
// The demo log must tell a TRUE story (DESIGN_DIRECTION §4, the story frame):
// skills improve with fast early gains that flatten, a layoff shows up as a
// couple of slow sessions, and no sample ever beats a personal-best floor.
// Numbers are the domain seat's table for a Carry Optics C→solid-B climber
// (board memo 2026-07-12). All values come from a SECOND rng stream (r2), and
// every draw the OLD code made on the main stream is still burned in place —
// so the main stream (which decides session/match/classifier structure, picks,
// and counts) is byte-identical to the pre-fix demo. Only the story-bearing
// numbers change.
const r2 = rng(20260712);
let gaussSpare: number | null = null;
function gauss(): number { // Box–Muller on r2
  if (gaussSpare !== null) { const v = gaussSpare; gaussSpare = null; return v; }
  let u = 0;
  while (u === 0) u = r2();
  const v = r2();
  const mag = Math.sqrt(-2 * Math.log(u));
  gaussSpare = mag * Math.sin(2 * Math.PI * v);
  return mag * Math.cos(2 * Math.PI * v);
}
// start avg → end avg (seconds), session-to-session SD, hard floor, canonical distance.
const DRILL_MODEL: Record<string, { start: number; end: number; sd: number; floor: number; dist: string }> = {
  'Bill Drill':          { start: 3.9,  end: 2.8,  sd: 0.25, floor: 2.45, dist: '7 yd' },
  'Draw to First Shot':  { start: 1.85, end: 1.35, sd: 0.10, floor: 1.20, dist: '7 yd' },
  '1-Reload-1':          { start: 3.5,  end: 2.6,  sd: 0.20, floor: 2.30, dist: '7 yd' },
  'Doubles / Hammers':   { start: 0.35, end: 0.26, sd: 0.03, floor: 0.22, dist: '7 yd' },
  'Transitions':         { start: 0.55, end: 0.42, sd: 0.05, floor: 0.38, dist: '7 yd' },
  'Wide Transitions':    { start: 0.95, end: 0.70, sd: 0.06, floor: 0.62, dist: '10 yd' },
  'Box Drill':           { start: 5.8,  end: 4.4,  sd: 0.35, floor: 4.0,  dist: '10 yd' },
  'Failure Drill':       { start: 3.1,  end: 2.4,  sd: 0.20, floor: 2.15, dist: '7 yd' },
  'Blake Drill':         { start: 3.6,  end: 2.7,  sd: 0.25, floor: 2.40, dist: '7 yd' },
  'El Presidente':       { start: 9.5,  end: 7.4,  sd: 0.6,  floor: 6.8,  dist: '10 yd' },
  'Accelerator (Steel)': { start: 7.0,  end: 5.4,  sd: 0.45, floor: 4.9,  dist: '10 yd' },
  'Reload Practice':     { start: 2.0,  end: 1.45, sd: 0.12, floor: 1.30, dist: '5 yd' },
};
const runningBest: Record<string, number> = {};
// Layoff tracking: a ≥14-day gap makes the next two sessions run ~8% slow —
// the log doesn't flatter, and neither does time off. (Sessions are generated
// in near-date order within the week loop; the approximation is deliberate
// and fine for demo data — the visible effect is what matters.)
let lastSessionAt = START.getTime();
let slowSessionsLeft = 0;
function layoffCheck(t: number): void {
  if (t - lastSessionAt >= 14 * dayMs) slowSessionsLeft = 2;
  else if (slowSessionsLeft > 0) slowSessionsLeft--;
  lastSessionAt = Math.max(lastSessionAt, t);
}
function drillTime(name: string, week: number, dry: boolean): number | null {
  const m = DRILL_MODEL[name];
  if (!m) return null; // untimed drills are handled by their own models
  let v = m.end + (m.start - m.end) * Math.exp(-week / 26) + gauss() * m.sd;
  if (dry) v *= 0.92; // par-time reps without recoil run a touch faster
  if (slowSessionsLeft > 0) v *= 1.08;
  const floor = dry ? m.floor * 0.92 : m.floor;
  const key = name + (dry ? '#dry' : '');
  const best = runningBest[key];
  // Never below the class-appropriate floor, and never a sudden leap more
  // than ~8% past the shooter's own best in that modality — PRs arrive in
  // inches, not miles. (8%, not tighter: drills that mostly live in dry-fire
  // leave only a handful of live samples across the whole log, and a tighter
  // ratchet starves them of the curve they're genuinely on.)
  v = Math.max(v, floor, best !== undefined ? best * 0.92 : 0);
  if (best === undefined || v < best) runningBest[key] = v;
  return round(v, 2);
}
// Dot Torture, the way the drill is really used: climb to a clean 50 at 3 yd,
// then step back a yard mid-log, dip, and rebuild — arc AND honest wobble.
function dotTorture(week: number): { score: number; dist: string } {
  if (week < 40) {
    const s = Math.round(44 + 6 * (1 - Math.exp(-week / 14)) + gauss() * 1.5);
    return { score: Math.max(42, Math.min(50, s)), dist: '3 yd' };
  }
  const s = Math.round(46 + 4 * (1 - Math.exp(-(week - 40) / 12)) + gauss() * 1.2);
  return { score: Math.max(44, Math.min(50, s)), dist: '4 yd' };
}

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
// F4 (session 55): the library is SHIPPED APP CONTENT now — the single source
// is src/lib/stockDrills.ts and the demo imports it (DRY: the two can never
// drift). Demo drills carry the same fixed 'drs-' stock ids, and the demo
// settings carry `drillsSeeded` so loading the sample can't double-seed.
for (const d of STOCK_DRILLS) {
  // RNG-stream preservation: the old `fire !== 'dry' || chance(0.5)` only
  // ROLLED for dry drills (short-circuit). The flag is deliberate in the
  // stock library now, but that roll must still happen in the same spot, or
  // every random value downstream shifts and the whole regenerated demo
  // churns for no reason.
  if (d.fire === 'dry') void chance(0.5);
  stores.drills.push({
    id: stockDrillId(d.name),
    ...stamp('2025-01-04'), name: d.name, gunCategories: ['Pistol'], fire: d.fire,
    briefDescription: d.brief, fullDescription: d.full, scoring: d.scoring,
    requiresHolster: d.holster, tags: [],
  });
}
const liveDrills = STOCK_DRILLS.filter((d) => d.fire !== 'dry').map((d) => d.name);
const dryDrills = STOCK_DRILLS.filter((d) => d.fire !== 'live').map((d) => d.name);
// (distances list removed July 12 2026 — drills now carry canonical distances from DRILL_MODEL)

// ===================== SESSIONS (≈110 over ~18 months) =====================
// Weekly rhythm: usually 1 live practice + 1–2 dry-fire, a class about monthly.
let seN = 0;
const liveRanges = ['Echo Valley', 'Cypress Creek Range', 'Ancient City Shooting Range'];
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
    layoffCheck(d.getTime());
    stores.sessions.push({
      id, ...stamp(iso(d)), date: iso(d), type: 'practice',
      guns: [{ firearmId: gun, rounds }], location: pick(liveRanges), distances: '',
      notes: chance(0.25) ? pick(['Good grip day.', 'Draw felt slow, need reps.', 'Dot tracking clean.', 'Worked weak-hand.', 'Sloppy at speed — dialed it back.']) : '',
      ammoUsage: [{ ammoId: can, rounds }],
      drills: [...chosen].map((name) => {
        void r(); // burn the old distance draw (main-stream preservation)
        if (/Torture/.test(name)) {
          void r(); // burn the old score draw
          const dt = dotTorture(w);
          return { name, distance: dt.dist, time: null, score: dt.score, maxScore: 50, notes: '' };
        }
        if (/Slow Fire/.test(name)) {
          return { name, distance: '15 yd', time: null, score: null, maxScore: null, notes: '' };
        }
        void r(); // burn the old time draw
        return { name, distance: DRILL_MODEL[name]?.dist ?? '7 yd', time: drillTime(name, w, false), score: null, maxScore: null, notes: '' };
      }),
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
    layoffCheck(d.getTime());
    // Stranger-test F5 (session 60): dry-fire sessions used to ship rounds: 0,
    // so the round-count report truthfully showed "0 dry reps" for every gun --
    // a lie in the flash-forward (the arc says this shooter dry-fires twice a
    // week). Reps are derived ARITHMETICALLY from values already drawn (nDrills,
    // w, k) -- deliberately NO new RNG draws, so the shared stream is untouched
    // and every other number in the dataset (and the shipped screenshots'
    // anchors) stays byte-identical.
    const dryReps = 40 + 25 * nDrills + ((w + k) % 5) * 8; // 65-155 presses, varied
    stores.sessions.push({
      id: `se-${String(seN).padStart(3, '0')}`, ...stamp(iso(d)), date: iso(d), type: 'dry_fire',
      guns: [{ firearmId: pick(['fa-dr920', 'fa-g34', 'fa-staccato']), rounds: dryReps }],
      location: 'Home (dry)', distances: '', notes: chance(0.15) ? pick(['15 min before dinner.', 'Par times tightening.', 'Reload reps.']) : '',
      ammoUsage: [], drills: [...chosen].map((name) => {
        void r(); void r(); // burn the old distance + time draws (main-stream preservation)
        return { name, distance: DRILL_MODEL[name]?.dist ?? '5 yd', time: drillTime(name, w, true), score: null, maxScore: null, notes: '' };
      }),
      targetMediaIds: [], malfunctions: [],
      selfRating: { focus: Math.min(9, skillBase + ratingCreep + randint(-1, 1)), fundamentals: Math.min(9, skillBase + ratingCreep + randint(-1, 1)), satisfaction: Math.min(9, skillBase + ratingCreep) },
      rangeFee: null, planned: false, instructor: null, checklist: null,
    });
  }
  // --- class (~monthly) ---
  if (w % 5 === 4) {
    const d = new Date(monday.getTime() + 6 * dayMs);
    seN++;
    layoffCheck(d.getTime());
    stores.sessions.push({
      id: `se-${String(seN).padStart(3, '0')}`, ...stamp(iso(d)), date: iso(d), type: 'class',
      guns: [{ firearmId: 'fa-dr920', rounds: randint(300, 600) }], location: pick(liveRanges), distances: '',
      notes: 'Structured coaching day.', ammoUsage: [{ ammoId: pick(cf9), rounds: randint(300, 600) }],
      drills: (() => {
        const name = pick(liveDrills);
        void r(); // burn the old time draw (main-stream preservation)
        if (/Torture/.test(name)) {
          const dt = dotTorture(w);
          return [{ name, distance: dt.dist, time: null, score: dt.score, maxScore: 50, notes: '' }];
        }
        if (/Slow Fire/.test(name)) {
          return [{ name, distance: '15 yd', time: null, score: null, maxScore: null, notes: '' }];
        }
        return [{ name, distance: DRILL_MODEL[name]?.dist ?? '7 yd', time: drillTime(name, w, false), score: null, maxScore: null, notes: '' }];
      })(),
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
const steelStageNames = ['5 to Go', 'Showdown', 'Smoke & Hope', 'Outer Limits', 'Accelerator', 'Pendulum', 'Speed Option', 'Roundabout'];
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

// ===================== IDPA CLUB MATCH THREAD (session 75, July 23 2026) =====================
// Four IDPA club matches on the DR920 in Carry Optics (CO) -- board conferral,
// session 75 (July 23 2026; recorded in the build journal): a solid-but-crossing-over
// B-class USPSA shooter tries IDPA on the side, starting rough and genuinely improving, with an honest wobble mid-thread
// (nobody's arc is a straight line). The shooter is UNRANKED in IDPA on purpose: no
// IDPA classifier/rank record is ever added anywhere -- IDPA has no classifier store
// in this app (stores.classifiers is USPSA-only), so that's true by construction, not
// by omission. Runs on its OWN rng stream (rIdpa) so every record already generated
// (sessions, USPSA/Steel matches, classifiers, goals) stays byte-identical -- this
// section only APPENDS. Placed BEFORE the dry-fire volume pass on purpose: that pass
// sums totalRounds across stores.matches to size the dry:live ratio, so these rounds
// must already be in the array when it runs (see its liveRoundTotal loop below).
const rIdpa = rng(20260723);
const idpaJitter = (): number => round((rIdpa() - 0.5) * 1.0, 2); // +/-0.5s organic wobble
interface IdpaStageSpec {
  rounds: number; pace: number; down1: number; down3: number; miss?: number;
  pe?: number; hnt?: number; fp?: number; ftdr?: number;
}
function idpaStage(number: number, spec: IdpaStageSpec): Rec {
  const time = round(spec.rounds * spec.pace + idpaJitter(), 2);
  const down0 = spec.rounds - spec.down1 - spec.down3 - (spec.miss ?? 0);
  return {
    number, points: null, time, percent: null, notes: '',
    idpaDown0: down0, idpaDown1: spec.down1, idpaDown3: spec.down3,
    idpaMisses: spec.miss ?? 0, idpaNonThreatHits: spec.hnt ?? 0,
    idpaProceduralErrors: spec.pe ?? 0, idpaFlagrantPenalties: spec.fp ?? 0,
    idpaFailureToDoRight: spec.ftdr ?? 0,
  };
}
const IDPA_VENUE = 'Cypress Creek Range'; // the shooter's home IDPA club -- same range each time
const idpaSpecs: { d: string; fee: number; overallOf: number; overallPlace: number; divOf: number; divPlace: number; stages: IdpaStageSpec[]; notes: string }[] = [
  {
    // M1: "first IDPA" energy -- 5 stages, 95 rounds, heavy points down (42), ONE PE.
    d: '2025-06-28', fee: 25, overallOf: 38, overallPlace: 30, divOf: 14, divPlace: 11,
    notes: 'First IDPA match. A lot to think about besides just shooting.',
    stages: [
      { rounds: 18, pace: 1.30, down1: 5, down3: 1, miss: 1 },              // pts 13 -- the rough one
      { rounds: 20, pace: 1.30, down1: 4, down3: 1, miss: 1 },              // pts 12
      { rounds: 16, pace: 1.30, down1: 3, down3: 1 },                       // pts 6
      { rounds: 23, pace: 1.30, down1: 3, down3: 1, pe: 1 },                // pts 6 + one Procedural Error
      { rounds: 18, pace: 1.30, down1: 2, down3: 1 },                       // pts 5
    ],
  },
  {
    // M2: improving, honest wobble -- 5 stages, 95 rounds, 28 points down, ONE HNT.
    d: '2025-10-04', fee: 25, overallOf: 36, overallPlace: 21, divOf: 13, divPlace: 8,
    notes: 'Better pace, but target ID cost a non-threat hit on stage 3.',
    stages: [
      { rounds: 18, pace: 1.20, down1: 1, down3: 1 },                       // pts 4
      { rounds: 20, pace: 1.20, down1: 3, down3: 1 },                       // pts 6
      { rounds: 17, pace: 1.20, down1: 3, down3: 1, hnt: 1 },               // pts 6 + one Hit on Non-Threat
      { rounds: 22, pace: 1.20, down1: 3, down3: 1 },                       // pts 6
      { rounds: 18, pace: 1.20, down1: 3, down3: 1 },                       // pts 6
    ],
  },
  {
    // M3: 6 stages, 110 rounds, only 19 points down, NO penalties -- a genuinely clean day.
    d: '2026-02-07', fee: 30, overallOf: 34, overallPlace: 14, divOf: 12, divPlace: 5,
    notes: 'Clean match -- first one with no procedurals or non-threat hits.',
    stages: [
      { rounds: 16, pace: 1.10, down1: 2, down3: 0 },   // pts 2
      { rounds: 18, pace: 1.10, down1: 3, down3: 0 },   // pts 3
      { rounds: 20, pace: 1.10, down1: 3, down3: 0 },   // pts 3
      { rounds: 17, pace: 1.10, down1: 2, down3: 1 },   // pts 5
      { rounds: 19, pace: 1.10, down1: 2, down3: 0 },   // pts 2
      { rounds: 20, pace: 1.10, down1: 4, down3: 0 },   // pts 4
    ],
  },
  {
    // M4: 5 stages, 95 rounds, 14 points down, ONE PE -- still not perfect, the arc stays honest.
    d: '2026-05-30', fee: 30, overallOf: 40, overallPlace: 11, divOf: 15, divPlace: 4,
    notes: 'Best finish yet. One procedural on stage 3 -- rushed the position.',
    stages: [
      { rounds: 18, pace: 1.00, down1: 1, down3: 0 },              // pts 1
      { rounds: 20, pace: 1.00, down1: 3, down3: 0 },              // pts 3
      { rounds: 17, pace: 1.00, down1: 3, down3: 0, pe: 1 },       // pts 3 + one Procedural Error
      { rounds: 22, pace: 1.00, down1: 3, down3: 0 },              // pts 3
      { rounds: 18, pace: 1.00, down1: 4, down3: 0 },              // pts 4
    ],
  },
];
for (const sp of idpaSpecs) {
  mtN++;
  const totalRounds = sp.stages.reduce((sum, st) => sum + st.rounds, 0);
  const stages: Rec[] = sp.stages.map((st, i) => idpaStage(i + 1, st));
  stores.matches.push({
    id: `mt-${mtN}`, ...stamp(sp.d), date: sp.d, name: `${IDPA_VENUE} IDPA Club Match`,
    matchType: 'IDPA Match', division: 'Carry Optics (CO)', powerFactor: 'Minor', scoringType: 'idpa',
    firearmId: 'fa-dr920', totalRounds,
    overallPlace: sp.overallPlace, overallOf: sp.overallOf, divisionPlace: sp.divPlace, divisionOf: sp.divOf,
    matchPercent: null, stages, entryFee: sp.fee, practiScoreUrl: '', notes: sp.notes,
  });
}

// ===================== DRY-FIRE VOLUME PASS (A5, batch 2, July 17 2026) =====================
// Realism fix: the shooter's story is dry-fire-HEAVY (common training doctrine is
// several dry reps per live round), but the in-rhythm loop above dry-fired only
// ~a third of live volume — backwards. This pass ADDS dry-fire sessions until
// total dry reps reach ~3x total live rounds, on a SEPARATE rng stream so every
// record already generated (the live drill arc, classifiers, matches, goals)
// stays byte-identical. Reps per added session stay believable for a focused
// dry block (~220–480, under the 500/evening plausibility cap the story tests
// keep). Drill times respect the same class-appropriate floors as the rest of
// the log. NOTE: a genuinely 3:1 ratio at 60–150 reps/session would need ~700
// dry sessions (implausible); realistic per-session volume is the honest knob.
const rDry = rng(20260717);
const isDry = (s: Rec): boolean => (s as { type: string }).type === 'dry_fire';
const isPlanned = (s: Rec): boolean => (s as { planned?: boolean }).planned === true;
const gunRounds = (s: Rec): number =>
  ((s as { guns: { rounds: number }[] }).guns ?? []).reduce((a, g) => a + (g.rounds || 0), 0);
// Coupling note: planned (not-yet-shot) sessions are EXCLUDED from both totals,
// matching the dry:live ratio test in tests/demoStory.test.ts exactly — keep the
// two in step (a planned session is intent, not volume). The demo currently makes
// no planned sessions, so this is belt-and-suspenders, but the handling must agree.
let liveRoundTotal = 0;
for (const s of stores.sessions) if (!isDry(s) && !isPlanned(s)) liveRoundTotal += gunRounds(s);
for (const m of stores.matches) liveRoundTotal += (m as { totalRounds: number | null }).totalRounds ?? 0;
let dryRepTotal = 0;
for (const s of stores.sessions) if (isDry(s) && !isPlanned(s)) dryRepTotal += gunRounds(s);
const dryTarget = liveRoundTotal * 3;
const dryGunPool = ['fa-dr920', 'fa-g34', 'fa-staccato'];
const dryDrillPool = STOCK_DRILLS.filter((d) => d.fire !== 'live').map((d) => d.name);
const dryNotes = ['Par times tightening.', 'Reload reps before bed.', 'Draw + first shot, 20 min.',
  'Transitions on the wall dots.', '10 min after work.', 'Wide array, eye lead.'];
let dryGuard = 0;
while (dryRepTotal < dryTarget && dryGuard < 4000) {
  dryGuard++;
  const wk = Math.floor(rDry() * weeks);
  const monday = new Date(START.getTime() + wk * 7 * dayMs);
  const d = new Date(monday.getTime() + Math.floor(rDry() * 7) * dayMs);
  const nDrills = 1 + Math.floor(rDry() * 3); // 1–3
  const chosen = new Set<string>();
  while (chosen.size < nDrills) chosen.add(dryDrillPool[Math.floor(rDry() * dryDrillPool.length)]);
  const reps = 220 + Math.floor(rDry() * 260); // 220–479 presses, a focused block
  const ratingCreep = Math.min(3, Math.floor(wk / 22));
  seN++;
  stores.sessions.push({
    id: `se-${String(seN).padStart(3, '0')}`, ...stamp(iso(d)), date: iso(d), type: 'dry_fire',
    guns: [{ firearmId: dryGunPool[Math.floor(rDry() * dryGunPool.length)], rounds: reps }],
    location: 'Home (dry)', distances: '',
    notes: rDry() < 0.18 ? dryNotes[Math.floor(rDry() * dryNotes.length)] : '',
    ammoUsage: [],
    drills: [...chosen].map((name) => {
      const m = DRILL_MODEL[name];
      // Dry runs sit a touch faster than live and never beat the dry floor
      // (floor * 0.92), the same limit the rest of the log respects.
      const t = Math.max(m.end * 0.92 * (0.97 + rDry() * 0.32), m.floor * 0.92 + 0.03);
      return { name, distance: m.dist, time: round(t, 2), score: null, maxScore: null, notes: '' };
    }),
    targetMediaIds: [], malfunctions: [],
    selfRating: {
      focus: Math.min(9, skillBase + ratingCreep + (rDry() < 0.5 ? 0 : 1)),
      fundamentals: Math.min(9, skillBase + ratingCreep + (rDry() < 0.5 ? 0 : 1)),
      satisfaction: Math.min(9, skillBase + ratingCreep),
    },
    rangeFee: null, planned: false, instructor: null, checklist: null,
  });
  dryRepTotal += reps;
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
  // Solid-B ending (Michael, 2026-07-12; was a straight line to 80 = A on the
  // record): fast early gains that flatten — C at the start, ending ~70–75 so
  // the best-6-of-recent-8 average sits firmly in B and "Make A class" stays
  // honestly open. One r() draw, same as before (main-stream preservation).
  const pct = round(Math.min(75.5, 55 + 19 * (1 - Math.exp(-i / 6)) + (r() * 6 - 3)), 1);
  stores.classifiers.push({
    id: `cl-${i + 1}`, ...stamp(iso(d)), date: iso(d), code, name, division: 'Carry Optics',
    hitFactor: round(3.5 + r() * 4, 2), percent: pct, notes: '',
  });
});

// A second USPSA division: Limited Optics on the Staccato — climbing through
// 2025-26, currently a solid B. Fixed percents so the demo's class is stable:
// best 6 of these 8 average ~63.5% (B band = 60-74.9%).
const loScores = [55, 58, 60, 62, 64, 66, 68, 61];
loScores.forEach((pct, i) => {
  const [code, name] = classifierList[i];
  const d = new Date(at('2025-08-20') + i * 26 * dayMs);
  stores.classifiers.push({
    id: `cl-lo-${i + 1}`, ...stamp(iso(d)), date: iso(d), code, name, division: 'Limited Optics',
    hitFactor: round(3.5 + r() * 4, 2), percent: pct, notes: '',
  });
});

// A third USPSA division: Production on the CZ Shadow 2 — newer here, a C.
// Best 6 of these 6 average ~49.8% (C band = 40-59.9%).
const prodScores = [44, 47, 49, 51, 53, 55];
prodScores.forEach((pct, i) => {
  const [code, name] = classifierList[i];
  const d = new Date(at('2025-03-15') + i * 40 * dayMs);
  stores.classifiers.push({
    id: `cl-prod-${i + 1}`, ...stamp(iso(d)), date: iso(d), code, name, division: 'Production',
    hitFactor: round(3 + r() * 3, 2), percent: pct, notes: '',
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
addPurchase('2025-09-06', 'Training / Class', 'Local GM private lesson', 'Cypress Creek Range', 150.0);
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

// ===================== GOALS (derived from the data — the story frame) =====================
// A demo goal may be marked "achieved" ONLY on a date the log's own data earns
// it (board memo 2026-07-12 — the pre-fix demo claimed a sub-2.0 Bill Drill
// "achieved" while the drill data averaged 3+ seconds). Targets are re-tuned
// to this shooter's class: the old sub-1.0 draw / sub-2.0 Bill are GM standards.
// Goal ids and order are UNCHANGED (go-4 stays the pinned North Star below).

// First date a drill's 3-run live-fire average crosses under a threshold.
function firstCross(drillName: string, under: number): string {
  const times: { d: string; t: number }[] = [];
  for (const se of [...stores.sessions].sort((a, b) => (a as { date: string }).date.localeCompare((b as { date: string }).date))) {
    const s = se as { date: string; type: string; drills?: { name: string; time: number | null }[] };
    if (s.type === 'dry_fire') continue;
    for (const dr of s.drills ?? []) {
      if (dr.name !== drillName || dr.time == null) continue;
      times.push({ d: s.date, t: dr.time });
      if (times.length >= 3) {
        const last3 = times.slice(-3);
        if (last3.reduce((p, c) => p + c.t, 0) / 3 < under) return last3[2].d;
      }
    }
  }
  return '';
}
// First date the rolling best-6-of-recent-8 Carry Optics classifier average
// reaches a class floor (USPSA's actual shape, close enough for demo data).
function classCrossDate(minPct: number): string {
  const co = (stores.classifiers as { date: string; division: string; percent: number }[])
    .filter((c) => c.division === 'Carry Optics')
    .sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 3; i < co.length; i++) {
    const best6 = co.slice(Math.max(0, i - 7), i + 1).map((c) => c.percent).sort((a, b) => b - a).slice(0, 6);
    if (best6.reduce((p, c) => p + c, 0) / best6.length >= minPct) return co[i].date;
  }
  return '';
}
const billDate = firstCross('Bill Drill', 3.0);
const drawDate = firstCross('Draw to First Shot', 1.4);
const bClassDate = classCrossDate(60);
const steelDate = (stores.matches as { date: string; scoringType?: string }[])
  .filter((m) => m.scoringType === 'steel').map((m) => m.date).sort()[0] ?? '';
// Top-10 at a sectional counts only AFTER the goal existed (set 2025-09-01).
const top10Date = (stores.matches as { date: string; matchType: string; divisionPlace: number | null }[])
  .filter((m) => m.matchType.includes('Level 2') && m.date > '2025-09-01' && (m.divisionPlace ?? 99) <= 10)
  .map((m) => m.date).sort()[0] ?? '';
// "Make A class" is born INSIDE the log, days after B falls — authorship visible.
const aClassSet = bClassDate ? iso(new Date(at(bClassDate) + 5 * dayMs)) : '2025-11-20';

const goalSpecs = [
  ['Bill Drill under 3.0s clean', 'Speed', 'under 3.0s', !!billDate, '2025-01-05', billDate],
  ['Draw to first A under 1.4s', 'Speed', 'under 1.4s', !!drawDate, '2025-01-05', drawDate],
  ['Reach USPSA B class', 'Classification', 'B in Carry Optics', !!bClassDate, '2025-01-10', bClassDate],
  ['Reach USPSA A class', 'Classification', 'A in Carry Optics', false, aClassSet, ''],
  ['Shoot a Steel Challenge match', 'Competition', 'Enter one SCSA match', !!steelDate, '2025-02-15', steelDate],
  ['Sub-1.2s standing reload', 'Speed', 'under 1.2s', false, '2025-06-01', ''],
  ['Dot Torture clean at 5 yd', 'Accuracy', '50/50', false, '2025-03-01', ''],
  ['Place top-10 division at a sectional', 'Competition', 'Top 10 CO', !!top10Date, '2025-09-01', top10Date],
] as const;
goalSpecs.forEach(([text, category, target, achieved, dateSet, dateAchieved], i) => {
  stores.goals.push({
    id: `go-${i + 1}`, ...stamp(dateSet), text, category, target, achieved, dateSet, dateAchieved,
    // An achieved goal was last touched the day it fell, not the day it was set.
    ...(achieved && dateAchieved ? { updatedAt: at(dateAchieved) } : {}),
  });
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

// ===================== MALFUNCTION ↔ MAGAZINE TAGS =====================
// Malfunctions carry the magazine when the shooter knew it (added July 9 2026,
// Michael's catch: the site's malfunction walkthrough says the log knows the
// magazine behind a malfunction, and the Malfunctions screen filters by
// magazine — so the sample records should actually demonstrate it. A shooter
// who SWAPPED the magazine certainly knew which one; otherwise it's a coin
// flip, since sometimes you just don't know).
// Runs as a post-pass on a SEPARATE RNG stream so every other demo record
// stays byte-identical to the previous build. (NOTE, July 12 2026: the
// story-frame regeneration above deliberately changed drill times/distances,
// Dot Torture scores, CO classifier percents, and all goals — any marketing-
// site screenshot showing THOSE numbers needs re-capture; flagged on the
// launch checklist. Structure, ids, matches, and everything else still match.)
const rMag = rng(20260709);
const magsByGun = new Map<string, string[]>();
for (const mg of stores.magazines as { id: string; firearmIds: string[] }[]) {
  for (const fid of mg.firearmIds) {
    magsByGun.set(fid, [...(magsByGun.get(fid) ?? []), mg.id]);
  }
}
const malfs = stores.malfunctions as { firearmId: string; resolution: string; date: string; magazineId: string | null }[];
for (const mf of malfs) {
  const mags = magsByGun.get(mf.firearmId);
  if (!mags || mags.length === 0) continue;
  const knewTheMag = mf.resolution === 'Swapped magazine' || rMag() < 0.5;
  if (knewTheMag) mf.magazineId = mags[Math.floor(rMag() * mags.length)];
}
// The site walkthrough opens the NEWEST malfunction — it must be one that knows.
const newestMf = [...malfs].sort((a, b) => a.date.localeCompare(b.date)).pop();
if (newestMf && !newestMf.magazineId) {
  newestMf.magazineId = (magsByGun.get(newestMf.firearmId) ?? [])[0] ?? null;
}

// ===================== META (owner settings) =====================
// goldenGoalId 'go-4' = "Reach USPSA A class": the demo ships with a North Star
// already pinned, so the Home card and the pinned Goals row show in the sample
// log. (F10, session 55: the wizard's goal question also stays quiet on top of
// this — an install with goals of its own is never asked, see lib/northStar.ts.)
// F4: drillsSeeded rides in the demo settings — the sample log ships WITH the
// stock library (drs- ids above), so the app-side seeder must see "already
// seeded" and never pile a second copy on top.
// Session 59: sampleLogLoaded rides here too — the flag that pins the
// "You're exploring a sample log / Start my own log" banner travels INSIDE the
// sample's own settings (atomic with the data, no app-side race), and any
// real log's settings simply don't carry it. tests/demoStory.test.ts asserts
// it, so a regenerated demo can never silently lose the exit banner.
stores.meta.push({ key: 'settings', value: { ownerName: 'Demo Shooter', theme: '', checklistCustomItems: { essentials: [], night: [], tactical: [] }, goldenGoalId: 'go-4', drillsSeeded: true, sampleLogLoaded: true } });

// ===================== BUILD =====================
let newest = 0;
for (const arr of Object.values(stores)) for (const rec of arr) {
  const u = (rec as { updatedAt?: number }).updatedAt;
  if (typeof u === 'number' && u > newest) newest = u;
}
// ===================== TARGET PHOTOS (July 8 2026) =====================
// Four REAL (and anonymous) portrait target photos — Michael's own, chosen for
// the sample log so a visitor's "look around" (and the website's session-report
// screenshot) shows genuine media. Pre-downscaled to the app's own photo size
// (PHOTO_MAX_EDGE 1600 / q80), ~1 MB total, attached to the newest live session.
const targetDir = join(dirname(fileURLToPath(import.meta.url)), 'demo-assets', 'targets');
const photoSession = (stores.sessions as { id: string; date: string; type: string; planned: boolean; targetMediaIds: string[] }[])
  .filter((se) => se.type !== 'dry_fire' && !se.planned)
  .sort((a, b) => b.date.localeCompare(a.date))[0];
const demoMedia: Media[] = ['t1.jpg', 't2.jpg', 't3.jpg', 't4.jpg'].map((f, i) => {
  const buf = readFileSync(join(targetDir, f));
  return {
    id: `md-demo-target-${i + 1}`,
    ...stamp(photoSession.date),
    ownerType: 'session' as const,
    ownerId: photoSession.id,
    kind: 'image' as const,
    name: `Target ${i + 1}`,
    annotations: [],
    mime: 'image/jpeg',
    data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  };
});
photoSession.targetMediaIds = demoMedia.map((m) => m.id);

const snapshot: Snapshot = { exportedAt: Date.now(), lastModified: newest, stores, media: demoMedia };
const bytes = buildFlog(snapshot);
const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo-dataset.bin');
writeFileSync(outPath, bytes);

const counts = Object.fromEntries(Object.entries(stores).map(([k, v]) => [k, v.length]));
console.log('Wrote', outPath, `(${bytes.length} bytes)`);
console.log('Counts:', JSON.stringify(counts));
