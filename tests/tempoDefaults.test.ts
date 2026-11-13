import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  latestSteelDivision, latestTypicalDraw, steelStageIndexForDrill
} from '../src/lib/tempoDefaults.ts';
import type { MatchLike, SessionLike, SkillSetLike } from '../src/lib/tempoDefaults.ts';
import { SCSA_STAGES } from '../src/lib/scsaPeaks.ts';
import { STOCK_DRILLS_V2_STEEL, stockDrillId } from '../src/lib/stockDrills.ts';

// ── latestSteelDivision ─────────────────────────────────────────────────────

const steel = (date: string, division: string, extra: Partial<MatchLike> = {}): MatchLike =>
  ({ id: `m-${date}-${division}`, date, division, scoringType: 'steel', createdAt: 1, ...extra });

test('division: no matches at all gives null', () => {
  assert.equal(latestSteelDivision([]), null);
});

test('division: the most recent steel match wins, whatever order the store returns', () => {
  const a = steel('2026-01-10', 'Open');
  const b = steel('2026-05-16', 'Carry Optics');
  const c = steel('2025-11-02', 'Limited');
  assert.equal(latestSteelDivision([a, b, c]), 'Carry Optics');
  assert.equal(latestSteelDivision([c, b, a]), 'Carry Optics');
  assert.equal(latestSteelDivision([b, c, a]), 'Carry Optics');
});

test('division: a short code or odd capitals stored by a results import still finds its division', () => {
  // The results importer keeps the file's own text, so "CO" and "carry optics"
  // are both real stored values for Carry Optics.
  assert.equal(latestSteelDivision([steel('2026-05-16', 'CO')]), 'Carry Optics');
  assert.equal(latestSteelDivision([steel('2026-05-16', 'carry optics')]), 'Carry Optics');
  assert.equal(latestSteelDivision([steel('2026-05-16', ' Open ')]), 'Open');
  // "REV" means USPSA Revolver, which the peak table does not hold: no guess.
  assert.equal(latestSteelDivision([steel('2026-05-16', 'REV')]), null);
  // A code on the newest match beats a full name on an older one.
  assert.equal(latestSteelDivision([steel('2026-01-10', 'Open'), steel('2026-05-16', 'LO')]), 'Limited Optics');
});

test('division: a match in the Trash is ignored, even when it is the newest', () => {
  const live = steel('2026-01-10', 'Open');
  const trashed = steel('2026-06-01', 'Carry Optics', { deletedAt: 1750000000000 });
  assert.equal(latestSteelDivision([live, trashed]), 'Open');
  assert.equal(latestSteelDivision([trashed]), null);
  // deletedAt null or 0 means live (softDelete.ts: a real timestamp is what trashes).
  assert.equal(latestSteelDivision([steel('2026-06-01', 'Limited', { deletedAt: null })]), 'Limited');
  assert.equal(latestSteelDivision([steel('2026-06-01', 'Limited', { deletedAt: 0 })]), 'Limited');
});

test('division: only steel matches count; USPSA, IDPA and untyped matches do not', () => {
  const list: MatchLike[] = [
    { id: 'u', date: '2026-06-06', division: 'Carry Optics', scoringType: 'uspsa' },
    { id: 'i', date: '2026-06-07', division: 'Carry Optics', scoringType: 'idpa' },
    { id: 'n', date: '2026-06-08', division: 'Carry Optics' }, // old record, no scoringType
    steel('2025-04-19', 'Production')
  ];
  assert.equal(latestSteelDivision(list), 'Production');
  assert.equal(latestSteelDivision(list.slice(0, 3)), null);
});

test('division: a newer steel match in a division with no peaks ("Other", blank, a typo) is skipped', () => {
  const list = [
    steel('2026-01-10', 'Single Stack'),
    steel('2026-03-01', 'Other'),
    steel('2026-04-01', ''),
    steel('2026-05-01', 'Carry Optix'),
    steel('2026-06-01', 'toString') // an inherited object key must not count as a division
  ];
  assert.equal(latestSteelDivision(list), 'Single Stack');
});

test('division: old rimfire "Open" names come back as the names the peak table uses', () => {
  assert.equal(latestSteelDivision([steel('2026-05-16', 'Rimfire Pistol Open')]), 'Rimfire Pistol Optics');
  assert.equal(latestSteelDivision([steel('2026-05-16', 'Rimfire Rifle Open')]), 'Rimfire Rifle Optics');
  assert.equal(latestSteelDivision([steel('2026-05-16', 'Rimfire Revolver Open')]), 'Rimfire Revolver Optic');
});

test('division: two matches on one day are split by createdAt, then id, never by list order', () => {
  const early = steel('2026-05-16', 'Open', { id: 'a', createdAt: 100 });
  const late = steel('2026-05-16', 'Limited', { id: 'b', createdAt: 200 });
  assert.equal(latestSteelDivision([early, late]), 'Limited');
  assert.equal(latestSteelDivision([late, early]), 'Limited');
  const x = steel('2026-05-16', 'Open', { id: 'x', createdAt: 100 });
  const y = steel('2026-05-16', 'Production', { id: 'y', createdAt: 100 });
  assert.equal(latestSteelDivision([x, y]), 'Production');
  assert.equal(latestSteelDivision([y, x]), 'Production');
});

test('division: records with missing or malformed fields are skipped, not trusted and not thrown on', () => {
  const junk = [
    null, undefined, 42, 'steel',
    { scoringType: 'steel' },
    { scoringType: 'steel', date: '2026-05-16' },
    { scoringType: 'steel', division: 'Open' },
    { scoringType: 'steel', date: 'May 16', division: 'Open' },
    { scoringType: 'steel', date: 20260516, division: 'Open' },
    { scoringType: 'steel', date: '2026-05-16', division: 7 }
  ] as unknown as MatchLike[];
  assert.equal(latestSteelDivision(junk), null);
  assert.equal(latestSteelDivision([...junk, steel('2024-01-01', 'PCC Iron')]), 'PCC Iron');
  assert.equal(latestSteelDivision(undefined as unknown as MatchLike[]), null);
});

test('division: a match with no createdAt or id still competes on its date', () => {
  const bare: MatchLike = { date: '2026-06-01', division: 'PCC Optics', scoringType: 'steel' };
  assert.equal(latestSteelDivision([steel('2026-01-10', 'Open'), bare]), 'PCC Optics');
});

// ── latestTypicalDraw ───────────────────────────────────────────────────────

const sess = (id: string, date: string, extra: Partial<SessionLike> = {}): SessionLike => ({ id, date, ...extra });
const set = (id: string, sessionId: string, typicalSec: number | null | undefined, extra: Partial<SkillSetLike> = {}): SkillSetLike =>
  ({ id, sessionId, date: '2020-01-01', skill: 'draw', typicalSec, createdAt: 1, ...extra });

test('draw: empty arrays give null', () => {
  assert.equal(latestTypicalDraw([], []), null);
  assert.equal(latestTypicalDraw([], [sess('s1', '2026-11-03')]), null);
});

test('draw: the typical time of the newest draw set, dated by its session', () => {
  const sessions = [sess('s1', '2026-09-01'), sess('s2', '2026-11-03'), sess('s3', '2026-10-15')];
  const sets = [set('a', 's1', 1.6), set('b', 's2', 1.31), set('c', 's3', 1.45)];
  assert.deepEqual(latestTypicalDraw(sets, sessions), { sec: 1.31, date: '2026-11-03' });
  assert.deepEqual(latestTypicalDraw([...sets].reverse(), [...sessions].reverse()), { sec: 1.31, date: '2026-11-03' });
});

test('draw: the session\'s date decides, not the copy of it on the set', () => {
  // The set's own date says 2026-12-31, but its session is the older one.
  const sessions = [sess('s1', '2026-09-01'), sess('s2', '2026-11-03')];
  const sets = [set('a', 's1', 1.9, { date: '2026-12-31' }), set('b', 's2', 1.31, { date: '2026-01-01' })];
  assert.deepEqual(latestTypicalDraw(sets, sessions), { sec: 1.31, date: '2026-11-03' });
});

test('draw: a set from a session in the Trash is ignored, even when it is the newest', () => {
  const sessions = [sess('s1', '2026-09-01'), sess('s2', '2026-11-03', { deletedAt: 1760000000000 })];
  const sets = [set('a', 's1', 1.6), set('b', 's2', 1.31)];
  assert.deepEqual(latestTypicalDraw(sets, sessions), { sec: 1.6, date: '2026-09-01' });
  assert.equal(latestTypicalDraw([set('b', 's2', 1.31)], sessions), null);
});

test('draw: only draw sets count', () => {
  const sessions = [sess('s1', '2026-09-01'), sess('s2', '2026-11-03')];
  const sets = [
    set('a', 's1', 1.6),
    set('b', 's2', 1.1, { skill: 'reload' }),
    set('c', 's2', 0.25, { skill: 'split' }),
    set('d', 's2', 1.0, { skill: undefined })
  ];
  assert.deepEqual(latestTypicalDraw(sets, sessions), { sec: 1.6, date: '2026-09-01' });
});

test('draw: a newer set with no usable typical time is passed over for an older one that has it', () => {
  const sessions = [sess('old', '2026-09-01'), sess('new', '2026-11-03')];
  for (const bad of [null, undefined, 0, -1.2, NaN, Infinity, -Infinity, '1.31' as unknown as number]) {
    const sets = [set('a', 'old', 1.6), set('b', 'new', bad)];
    assert.deepEqual(latestTypicalDraw(sets, sessions), { sec: 1.6, date: '2026-09-01' }, `typicalSec ${String(bad)}`);
  }
  assert.equal(latestTypicalDraw([set('b', 'new', null)], sessions), null);
});

test('draw: two sets on one session are split by createdAt, then id, never by list order', () => {
  const sessions = [sess('s1', '2026-11-03')];
  const first = set('a', 's1', 1.5, { createdAt: 100 });
  const second = set('b', 's1', 1.4, { createdAt: 200 });
  assert.equal(latestTypicalDraw([first, second], sessions)!.sec, 1.4);
  assert.equal(latestTypicalDraw([second, first], sessions)!.sec, 1.4);
  const x = set('x', 's1', 1.5, { createdAt: 100 });
  const y = set('y', 's1', 1.4, { createdAt: 100 });
  assert.equal(latestTypicalDraw([x, y], sessions)!.sec, 1.4);
  assert.equal(latestTypicalDraw([y, x], sessions)!.sec, 1.4);
});

test('draw: two sessions on one day are split the same way', () => {
  const sessions = [sess('s1', '2026-11-03'), sess('s2', '2026-11-03')];
  const a = set('a', 's1', 1.5, { createdAt: 100 });
  const b = set('b', 's2', 1.4, { createdAt: 200 });
  assert.equal(latestTypicalDraw([a, b], sessions)!.sec, 1.4);
  assert.equal(latestTypicalDraw([b, a], sessions)!.sec, 1.4);
});

test('draw: a set whose session record is missing falls back to its own date', () => {
  // Same sets every other screen still counts (activeSkillSets only drops trashed ones).
  const sets = [set('a', 'gone', 1.7, { date: '2026-08-08' })];
  assert.deepEqual(latestTypicalDraw(sets, []), { sec: 1.7, date: '2026-08-08' });
  // ...and it competes on that date against a set with a real session.
  assert.deepEqual(
    latestTypicalDraw([...sets, set('b', 's1', 1.2)], [sess('s1', '2026-08-09')]),
    { sec: 1.2, date: '2026-08-09' });
});

test('draw: a set with no usable date anywhere is skipped', () => {
  assert.equal(latestTypicalDraw([set('a', 'gone', 1.7, { date: undefined })], []), null);
  assert.equal(latestTypicalDraw([set('a', 'gone', 1.7, { date: 'Aug 8' })], []), null);
  // A session that exists but carries a malformed date: fall back to the set's own.
  assert.deepEqual(
    latestTypicalDraw([set('a', 's1', 1.7, { date: '2026-08-08' })], [sess('s1', 'yesterday')]),
    { sec: 1.7, date: '2026-08-08' });
});

test('draw: junk in either array is skipped, not thrown on', () => {
  const sessions = [null, 7, { date: '2026-01-01' }, sess('s1', '2026-11-03')] as unknown as SessionLike[];
  const sets = [null, 'draw', { skill: 'draw', typicalSec: 1.1 }, set('a', 's1', 1.31)] as unknown as SkillSetLike[];
  assert.deepEqual(latestTypicalDraw(sets, sessions), { sec: 1.31, date: '2026-11-03' });
  assert.equal(latestTypicalDraw(undefined as unknown as SkillSetLike[], undefined as unknown as SessionLike[]), null);
});

test('draw: the stored figure comes back untouched (the screen does the cutting)', () => {
  assert.equal(latestTypicalDraw([set('a', 's1', 1.317)], [sess('s1', '2026-11-03')])!.sec, 1.317);
});

// ── steelStageIndexForDrill ─────────────────────────────────────────────────

test('stage drill: each built-in Steel Challenge stage drill maps to its SCSA_STAGES index', () => {
  STOCK_DRILLS_V2_STEEL.forEach((d, i) => {
    assert.equal(steelStageIndexForDrill(stockDrillId(d.name)), i, d.name);
    assert.equal(d.name, `Steel Challenge: ${SCSA_STAGES[i].name}`);
  });
  assert.equal(steelStageIndexForDrill('drs-steel-challenge-smoke-hope'), 2);
  assert.equal(steelStageIndexForDrill('drs-steel-challenge-outer-limits'), 3);
});

test('stage drill: anything else is -1', () => {
  // The generic plate-rack practice drill, which is NOT the SC-105 stage.
  assert.equal(steelStageIndexForDrill(stockDrillId('Accelerator (Steel)')), -1);
  assert.equal(steelStageIndexForDrill(stockDrillId('Bill Drill')), -1);
  // A shooter's own drill: 'drx-' ids never match, whatever the drill is called.
  assert.equal(steelStageIndexForDrill('drx-steel-challenge-smoke-hope'), -1);
  assert.equal(steelStageIndexForDrill('drx-1a2b3c'), -1);
  assert.equal(steelStageIndexForDrill('steel-challenge-smoke-hope'), -1);
  assert.equal(steelStageIndexForDrill(''), -1);
  assert.equal(steelStageIndexForDrill(undefined), -1);
  assert.equal(steelStageIndexForDrill(null), -1);
  assert.equal(steelStageIndexForDrill(3), -1);
});
