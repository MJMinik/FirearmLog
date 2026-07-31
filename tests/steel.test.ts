import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// Steel Challenge (SCSA) scoring — time-only; string = raw + 3s/miss, capped at 30;
// stop-plate-missed = 30. A stage drops the single slowest string: best 4 of 5, and
// best 3 of 4 on Outer Limits. Match total = sum of stage times, lowest wins. Worked
// examples verified by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreSteelStage,
  steelMatchTotal,
  steelStringsExpected,
  scoringTypeFor,
  STEEL_MAX_STRING,
  STEEL_DIVISIONS, STEEL_DIVISION_ALIASES, canonicalDivision,
} from '../src/lib/competition.ts';
import { competeFilterOptions, matchMatchesCompeteFilter, emptyCompeteFilter } from '../src/lib/competeFilter.ts';

test('STEEL_DIVISIONS is the exact official SCSA competition-division list', () => {
  // Verbatim from the official SCSA classification records
  // (https://scsa.org/classification), cross-checked vs the 2026-03 Rulebook Appendix D.
  // Guards a domain-critical, cited constant against accidental edits AND against
  // "helpfully" normalizing the intentionally non-uniform names (rimfire Optics/Iron,
  // PCC Optics/Iron, revolver Optical Sight/Iron Sight).
  //
  // CORRECTED: the three rimfire entries read "Open" here and in the constant.
  // SCSA has no rimfire Open division -- Appendix A2, the scsa.org peak-time
  // table and SCSA announcement 683 all say Optics, and Open appears in none of
  // them. This test had the wrong names locked in, so it guarded the error.
  // "Rimfire Revolver Optic" is SINGULAR in SCSA's list while pistol and rifle
  // are plural; that inconsistency is theirs and is deliberately preserved.
  assert.deepEqual(STEEL_DIVISIONS, [
    'Open', 'Limited', 'Limited Optics', 'Production', 'Single Stack', 'Carry Optics',
    'Optical Sight Revolver', 'Iron Sight Revolver',
    'PCC Optics', 'PCC Iron',
    'Rimfire Pistol Optics', 'Rimfire Pistol Iron',
    'Rimfire Rifle Optics', 'Rimfire Rifle Iron',
    'Rimfire Revolver Optic', 'Rimfire Revolver Iron',
    'Other',
  ]);
  // The point of finding H4: rimfire divisions the USPSA DIVISIONS list omitted.
  for (const d of ['Rimfire Pistol Optics', 'Rimfire Rifle Iron', 'Optical Sight Revolver']) {
    assert.ok(STEEL_DIVISIONS.includes(d), `Steel list missing division: ${d}`);
  }
  // No rimfire division may ever be called Open again.
  for (const d of STEEL_DIVISIONS) {
    assert.ok(!(d.startsWith('Rimfire') && d.endsWith('Open')),
      `SCSA has no rimfire Open division, found: ${d}`);
  }
});

test('best 4 of 5: drops the single slowest string', () => {
  const s = scoreSteelStage({ strings: [3.21, 3.44, 3.6, 3.71, 4.9] });
  assert.equal(s.stageTime, 13.96); // 3.21 + 3.44 + 3.60 + 3.71
  assert.equal(s.droppedIndex, 4); // the 4.90 string
  assert.equal(s.stringsExpected, 5);
});

test('a miss adds 3s and can make a string the one dropped', () => {
  // String 0 raw 3.10 + 1 miss = 6.10 -> becomes the slowest -> dropped.
  const s = scoreSteelStage({
    strings: [3.1, 3.44, 3.6, 3.71, 3.8],
    stringMisses: [1, 0, 0, 0, 0],
  });
  assert.equal(s.strings[0].capped, 6.1);
  assert.equal(s.droppedIndex, 0);
  assert.equal(s.stageTime, 14.55); // 3.44 + 3.60 + 3.71 + 3.80
});

test('stop plate never hit scores the 30s max (and is the dropped string)', () => {
  const s = scoreSteelStage({
    strings: [3.2, 3.4, 3.6, 3.7, null],
    stringStopMissed: [false, false, false, false, true],
  });
  assert.equal(s.strings[4].capped, STEEL_MAX_STRING);
  assert.equal(s.droppedIndex, 4);
  assert.equal(s.stageTime, 13.9); // the four real strings
});

test('a string time is capped at 30s', () => {
  const s = scoreSteelStage({ strings: [29.5], stringMisses: [1] }); // 29.5 + 3 = 32.5 -> 30
  assert.equal(s.strings[0].capped, 30);
});

test('Outer Limits: 4 strings, best 3 count (the slowest is dropped)', () => {
  assert.equal(steelStringsExpected('Outer Limits'), 4); // 4 strings SHOT
  const s = scoreSteelStage({ steelStage: 'Outer Limits', strings: [4.0, 4.5, 5.0, 5.5] });
  assert.equal(s.droppedIndex, 3); // the 5.5 string (slowest) is dropped
  assert.equal(s.stageTime, 13.5); // best 3: 4.0 + 4.5 + 5.0
});

test('fewer than 5 strings entered on a 5-string stage keeps them all (nothing to drop)', () => {
  const s = scoreSteelStage({ strings: [3.0, 3.5, 4.0, 4.5] });
  assert.equal(s.droppedIndex, null);
  assert.equal(s.stageTime, 15.0);
});

test('nothing entered -> null stage time, no crash', () => {
  const s = scoreSteelStage({ strings: [null, null] });
  assert.equal(s.stageTime, null);
  assert.equal(scoreSteelStage({}).stageTime, null);
});

test('match total sums stage times (lowest wins)', () => {
  const total = steelMatchTotal([
    { strings: [3.21, 3.44, 3.6, 3.71, 4.9] }, // 13.96 (best 4 of 5)
    { steelStage: 'Outer Limits', strings: [4.0, 4.5, 5.0, 5.5] }, // 13.50 (best 3 of 4)
  ]);
  assert.equal(total, 27.46);
  assert.equal(steelMatchTotal([]), null);
});

test('scoringTypeFor maps match types', () => {
  assert.equal(scoringTypeFor('Steel Challenge'), 'steel');
  assert.equal(scoringTypeFor('IDPA Match'), 'idpa');
  assert.equal(scoringTypeFor('USPSA Level 1 (club match)'), 'uspsa');
});

test('canonicalDivision: every retired rimfire name still resolves to a real one', () => {
  // The alias is what stops a saved match orphaning. Each old name must land on
  // a division that is actually IN the list -- an alias pointing at a name the
  // picker does not offer would reintroduce the snap-to-Open bug it exists to
  // prevent.
  // Assert the three retired names LITERALLY. Iterating the map alone verifies
  // it against itself: empty the map and the loop runs zero assertions and goes
  // green, which is exactly the edit most likely to happen in a future cleanup.
  assert.deepEqual(Object.keys(STEEL_DIVISION_ALIASES).sort(), [
    'Rimfire Pistol Open', 'Rimfire Revolver Open', 'Rimfire Rifle Open',
  ]);
  assert.equal(canonicalDivision('Rimfire Pistol Open'), 'Rimfire Pistol Optics');
  assert.equal(canonicalDivision('Rimfire Rifle Open'), 'Rimfire Rifle Optics');
  assert.equal(canonicalDivision('Rimfire Revolver Open'), 'Rimfire Revolver Optic');
  for (const [oldName, newName] of Object.entries(STEEL_DIVISION_ALIASES)) {
    assert.equal(canonicalDivision(oldName), newName);
    assert.ok(STEEL_DIVISIONS.includes(newName),
      `alias target not in STEEL_DIVISIONS: ${newName}`);
    assert.ok(!STEEL_DIVISIONS.includes(oldName),
      `retired name still in the list: ${oldName}`);
  }
  // Anything else passes through untouched, across every sport.
  for (const d of ['Open', 'Carry Optics', 'PCC Iron', 'Production', 'Other', '']) {
    assert.equal(canonicalDivision(d), d);
  }
});

test('a retired rimfire name never appears as its own filter option', () => {
  // A logbook holding one match saved before the rename and one after used to
  // offer BOTH names in the Compete dropdown, each matching a disjoint half of
  // the same real division.
  const matches = [
    { division: 'Rimfire Pistol Open' },
    { division: 'Rimfire Pistol Optics' },
    { division: 'Carry Optics' },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any[];
  const { divisions } = competeFilterOptions(matches);
  assert.deepEqual(divisions.sort(), ['Carry Optics', 'Rimfire Pistol Optics']);
  assert.ok(!divisions.includes('Rimfire Pistol Open'));
  // ...and selecting the canonical name matches BOTH stored spellings.
  const f = { ...emptyCompeteFilter(), division: 'Rimfire Pistol Optics' };
  assert.equal(matches.filter((m) => matchMatchesCompeteFilter(m, f)).length, 2);
});

test('no source file renders a stored division without canonicalising it', () => {
  // The rename is only real if the retired name never reaches a screen, and
  // there is no single render path to test. This is a source-level guard: any
  // file that shows or compares a division must at least know the function
  // exists. It caught nothing on its own -- the four surfaces it names were
  // found by a reviewer -- but it stops the next one being added silently.
  const files = [
    'src/ui/MatchRow.tsx', 'src/ui/MatchScreens.tsx', 'src/ui/screens.tsx',
    'src/ui/reportLaunch.ts', 'src/lib/competeFilter.ts', 'src/lib/searchFilter.ts',
  ];
  for (const f of files) {
    const src = readFileSync(join(process.cwd(), f), 'utf8');
    assert.ok(src.includes('canonicalDivision'), f + ' shows or compares a division but never canonicalises one');
  }
});
