// Board memo DRILL_GROUPING_BOARD_MEMO_2026-09-10, decisions 1-5 all (a): the
// Drills screen groups by the skill each drill trains. These tests cover the
// pure grouping logic in lib/drillGroups.ts — every one of the built-in 22's
// fixed ids resolves to a real skill (never Custom), a custom drill's own
// `skill` field decides its section (falling back to Custom when blank or
// unrecognized), sections are alphabetical within themselves, empty sections
// never appear, and the seven-plus-Custom order is exactly the board's §1
// order with Custom last.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupDrills,
  groupForDrill,
  SKILL_ORDER,
  SKILL_GROUPS,
} from '../src/lib/drillGroups.ts';
import { stockDrillDefs, STOCK_DRILLS } from '../src/lib/stockDrills.ts';
import { stampNew } from '../src/lib/stamps.ts';
import type { DrillDef, DrillSkill } from '../src/lib/types.ts';

const customDrill = (id: string, name: string, skill?: DrillSkill): DrillDef =>
  stampNew(
    {
      name, gunCategories: ['Pistol'], fire: 'live' as const,
      briefDescription: '', fullDescription: '', scoring: '',
      requiresHolster: false, tags: [], ...(skill ? { skill } : {}),
    },
    id, 1000
  );

// Board memo §1's own bucket counts for the 22 built-ins, used below to
// confirm groupDrills reproduces that table exactly, not just "some" grouping.
const EXPECTED_COUNTS: Record<DrillSkill, number> = {
  draw: 1, reloads: 2, transitions: 6, recoilSplits: 2,
  accuracyTrigger: 2, stageSkills: 1, steelChallenge: 8,
};

test('every one of the 22 built-in ids resolves to a real skill, never custom', () => {
  const defs = stockDrillDefs(1234);
  assert.equal(defs.length, 22, 'sanity: the library is still 22');
  for (const d of defs) {
    const group = groupForDrill(d);
    assert.notEqual(group, 'custom', `${d.name} (${d.id}) must not fall back to Custom`);
    assert.ok(
      Object.prototype.hasOwnProperty.call(SKILL_GROUPS, group),
      `${d.name} (${d.id}) resolves to a real skill key, got ${String(group)}`
    );
  }
});

test('the built-in 22 land in the board\'s §1 bucket counts exactly', () => {
  const defs = stockDrillDefs(1234);
  const counts: Partial<Record<DrillSkill, number>> = {};
  for (const d of defs) {
    const g = groupForDrill(d);
    if (g === 'custom') continue;
    counts[g] = (counts[g] ?? 0) + 1;
  }
  assert.deepEqual(counts, EXPECTED_COUNTS);
});

test('the seven-plus-Custom section order is fixed: SKILL_ORDER is the board\'s §1 order, Custom last', () => {
  assert.deepEqual(SKILL_ORDER, [
    'draw', 'reloads', 'transitions', 'recoilSplits',
    'accuracyTrigger', 'stageSkills', 'steelChallenge',
  ]);
  const defs = stockDrillDefs(1234);
  const withCustom = [...defs, customDrill('drx-x', 'Zzz Custom Drill')];
  const sections = groupDrills(withCustom);
  assert.deepEqual(sections.map((s) => s.key), [...SKILL_ORDER, 'custom']);
});

test('every non-empty section\'s drills sort alphabetically (localeCompare)', () => {
  const defs = stockDrillDefs(1234);
  const sections = groupDrills(defs);
  for (const s of sections) {
    const names = s.drills.map((d) => d.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(names, sorted, `${s.label} is not alphabetical: ${names.join(', ')}`);
  }
});

test('empty sections are omitted entirely', () => {
  // Only drills that land in Draw and Reloads — every other built-in section,
  // and Custom, must be absent from the result.
  const drawDrill = stockDrillDefs(1234).find((d) => d.name === 'Draw to First Shot')!;
  const reloadDrill = stockDrillDefs(1234).find((d) => d.name === '1-Reload-1')!;
  const sections = groupDrills([drawDrill, reloadDrill]);
  assert.deepEqual(sections.map((s) => s.key), ['draw', 'reloads']);
});

test('a custom drill with skill "reloads" lands in Reloads, alongside the built-in reload drills', () => {
  const mine = customDrill('drx-mine', 'My Reload Drill', 'reloads');
  const sections = groupDrills([...stockDrillDefs(1234), mine]);
  const reloads = sections.find((s) => s.key === 'reloads')!;
  assert.ok(reloads, 'Reloads section exists');
  assert.ok(reloads.drills.some((d) => d.id === 'drx-mine'), 'the custom drill is in Reloads');
  assert.equal(sections.some((s) => s.key === 'custom'), false, 'nothing else fell into Custom');
});

test('a custom drill with no skill lands in Custom, shown last', () => {
  const mine = customDrill('drx-blank', 'My Blank Drill');
  const sections = groupDrills([...stockDrillDefs(1234), mine]);
  assert.equal(sections[sections.length - 1].key, 'custom');
  assert.ok(sections[sections.length - 1].drills.some((d) => d.id === 'drx-blank'));
});

test('a bogus skill value lands in Custom', () => {
  const mine = customDrill('drx-bogus', 'Bogus Skill Drill', 'not-a-real-skill' as unknown as DrillSkill);
  const group = groupForDrill(mine);
  assert.equal(group, 'custom');
});

test('groupForDrill never looks at a built-in drill\'s own skill field, even if one were present', () => {
  // A built-in id always wins over anything stored in `skill`, since the
  // built-in 22 never carry that field in real data (decision 4) — this
  // proves the lookup is truly id-first, not merely "usually" id-first.
  const billDrill = stockDrillDefs(1234).find((d) => d.name === 'Bill Drill')!;
  const tampered: DrillDef = { ...billDrill, skill: 'draw' };
  assert.equal(groupForDrill(tampered), 'recoilSplits');
});

test('the generic "Accelerator (Steel)" drill and the real "Steel Challenge: Accelerator" stage never collide', () => {
  const generic = STOCK_DRILLS.find((d) => d.name === 'Accelerator (Steel)')!;
  const stage = STOCK_DRILLS.find((d) => d.name === 'Steel Challenge: Accelerator')!;
  assert.ok(generic && stage);
  const defs = stockDrillDefs(1234);
  const genericDef = defs.find((d) => d.name === 'Accelerator (Steel)')!;
  const stageDef = defs.find((d) => d.name === 'Steel Challenge: Accelerator')!;
  assert.equal(groupForDrill(genericDef), 'transitions');
  assert.equal(groupForDrill(stageDef), 'steelChallenge');
});
