// The bridge test: real PractiScore download files, through the APP'S OWN scorer.
//
// The parser tests prove the file is read correctly. These prove the number that
// would reach Michael's log is the number PractiScore published -- which is a
// different claim, and the one that actually matters. Nothing here recomputes
// Steel scoring; it drives scoreSteelStage, the same function a hand-typed match
// goes through, exactly as the importer will.
//
// It also proves the miss reconstruction chosen on 10 August 2026 (decision 3)
// is LOSSLESS. The file's run times already contain three seconds per miss. The
// importer subtracts them back out to store a raw time plus a miss count, the
// way a hand-entered run is stored, and the scorer adds them again. If that
// round trip lost anything, these totals would stop matching.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScsaForm, type ScsaStageScore, type ScsaEntry } from '../src/lib/scsaForm.ts';
import {
  scoreSteelStage,
  steelMatchTotal,
  steelStringsExpected,
  STEEL_MAX_STRING,
  STEEL_MISS_PENALTY,
} from '../src/lib/competition.ts';

import { Guncraft8stage } from './fixtures/scsa-guncraft-8stage.ts';
import { RedbrushMultigun } from './fixtures/scsa-redbrush-multigun.ts';
import { DeertribeShuffledOrder } from './fixtures/scsa-deertribe-shuffled-order.ts';
import { Scsa363NoMainMatch } from './fixtures/scsa-scsa363-no-main-match.ts';
import { Wnpl6stage } from './fixtures/scsa-wnpl-6stage.ts';
import { DapForeignStageCode } from './fixtures/scsa-dap-foreign-stage-code.ts';
import { MedfordInventedStages } from './fixtures/scsa-medford-invented-stages.ts';
import { BluffsBlankMemberships } from './fixtures/scsa-bluffs-blank-memberships.ts';
import { MedfordClassifiersSameDay } from './fixtures/scsa-medford-classifiers-same-day.ts';
import { TriggerguardManyPenalties } from './fixtures/scsa-triggerguard-many-penalties.ts';
import { GcfgFourStringInvented } from './fixtures/scsa-gcfg-four-string-invented.ts';

const FIXTURES: [string, string][] = [
  ['guncraft-8stage', Guncraft8stage],
  ['redbrush-multigun', RedbrushMultigun],
  ['deertribe-shuffled-order', DeertribeShuffledOrder],
  ['scsa363-no-main-match', Scsa363NoMainMatch],
  ['wnpl-6stage', Wnpl6stage],
  ['dap-foreign-stage-code', DapForeignStageCode],
  ['medford-invented-stages', MedfordInventedStages],
  ['bluffs-blank-memberships', BluffsBlankMemberships],
  ['medford-classifiers-same-day', MedfordClassifiersSameDay],
  ['triggerguard-many-penalties', TriggerguardManyPenalties],
  ['gcfg-four-string-invented', GcfgFourStringInvented],
];

/** Exactly what the importer will store for one stage: the raw time with the
 *  penalty seconds taken back out, the miss count beside it, and the string
 *  count the FILE declared. This is decision 3 and the four-string decision,
 *  expressed as the only function that needs to know about either. */
function toStoredStage(s: ScsaStageScore) {
  return {
    steelStage: s.canonicalStageName ?? '',
    steelStringsDeclared: s.declaredStrings,
    strings: s.runs.map((r) => r.time - STEEL_MISS_PENALTY * r.penalties),
    stringMisses: s.runs.map((r) => r.penalties),
    stringStopMissed: s.runs.map(() => false),
  };
}

function parsed(text: string, label: string) {
  const r = parseScsaForm(text);
  assert.equal(r.ok, true, label);
  return (r as { ok: true; form: { entries: ScsaEntry[] } }).form;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

test("the app's own scorer reproduces every published stage time and match total", () => {
  let stages = 0;
  let entries = 0;
  for (const [name, text] of FIXTURES) {
    const form = parsed(text, name);
    for (const e of form.entries) {
      if (e.stages.length === 0) continue;
      for (const s of e.stages) {
        const scored = scoreSteelStage(toStoredStage(s));
        assert.equal(
          scored.stageTime,
          round2(s.fileStageTotal),
          `${name} competitor ${e.competitorNumber} stage ${s.stageNumber} ` +
            `(${s.officialCode || s.clubStageName}, ${s.declaredStrings} strings)`,
        );
        stages += 1;
      }
      if (e.fileTotal !== null) {
        assert.equal(
          steelMatchTotal(e.stages.map(toStoredStage)),
          round2(e.fileTotal),
          `${name} competitor ${e.competitorNumber} match total`,
        );
      }
      entries += 1;
    }
  }
  // Eleven clubs. Not one disagreement between this app's scoring and the
  // scores PractiScore actually published.
  assert.equal(stages, 2070);
  assert.equal(entries, 371);
});

test("Michael's own match, end to end, comes out at 222.41", () => {
  const form = parsed(Guncraft8stage, 'guncraft');
  const me = form.entries.find((e) => e.membership === 'A185231')!;
  const stored = me.stages.map(toStoredStage);
  assert.equal(steelMatchTotal(stored), 222.41);
  // And the run this app drops is the one PractiScore dropped, on every stage.
  for (let i = 0; i < stored.length; i++) {
    const scored = scoreSteelStage(stored[i]);
    assert.equal(scored.droppedIndex !== null, true, `stage ${i + 1} drops a run`);
    const slowest = scored.strings.reduce(
      (best, s, idx) => ((s.capped ?? -1) > (scored.strings[best].capped ?? -1) ? idx : best),
      0,
    );
    assert.equal(scored.droppedIndex, slowest);
  }
});

test('the miss reconstruction is lossless, including at the 30-second cap', () => {
  let penalised = 0;
  let cappedWithPenalty = 0;
  for (const [name, text] of FIXTURES) {
    const form = parsed(text, name);
    for (const e of form.entries) {
      for (const s of e.stages) {
        const stored = toStoredStage(s);
        for (let i = 0; i < s.runs.length; i++) {
          const run = s.runs[i];
          if (run.penalties === 0) continue;
          penalised += 1;
          // Taking the penalty out must never produce a negative time.
          assert.ok(stored.strings[i] >= 0, `${name}: ${run.time}s with ${run.penalties} misses`);
          // And putting it back must land exactly on the recorded time.
          const scored = scoreSteelStage(stored);
          assert.equal(scored.strings[i].capped, round2(run.time));
          if (run.time === STEEL_MAX_STRING) cappedWithPenalty += 1;
        }
      }
    }
  }
  assert.equal(penalised, 568, 'penalised strings across the eleven files');
  assert.ok(cappedWithPenalty > 0, 'at least one penalised run sits at the 30-second cap');
});

// --------------------------------------------------- the four-string decision

test('a four-string stage that is not Outer Limits scores correctly (GCF&G)', () => {
  const form = parsed(GcfgFourStringInvented, 'gcfg');
  const entry = form.entries.find((e) => e.competitorNumber === 1)!;
  const stage1 = entry.stages.find((s) => s.stageNumber === 1)!;
  assert.equal(stage1.declaredStrings, 4);
  assert.equal(stage1.canonicalStageName, null, 'club-invented, so the name says nothing');

  const stored = toStoredStage(stage1);
  assert.equal(scoreSteelStage(stored).stageTime, round2(stage1.fileStageTotal));

  // THE DEFECT THIS CHANGE FIXES, pinned so it cannot come back. Take the
  // declared count away and the scorer expects five strings, decides a complete
  // stage is unfinished, drops nothing, and returns the sum of all four.
  const withoutDeclared = { ...stored, steelStringsDeclared: undefined };
  const broken = scoreSteelStage(withoutDeclared);
  assert.equal(broken.droppedIndex, null, 'nothing is dropped');
  assert.notEqual(broken.stageTime, round2(stage1.fileStageTotal));
  assert.ok(
    (broken.stageTime ?? 0) > round2(stage1.fileStageTotal),
    'and the total comes out TOO HIGH -- a wrong number, arrived at silently',
  );
});

test('the declared count is bounded, and falls back to the name outside those bounds', () => {
  // Below 2 there is nothing left after dropping the worst; above 7 cannot occur,
  // because a score row has room for seven strings and no more.
  assert.equal(steelStringsExpected('Plate Rack Plus', 4), 4);
  assert.equal(steelStringsExpected(undefined, 2), 2);
  assert.equal(steelStringsExpected(undefined, 7), 7);
  for (const bad of [1, 0, -3, 8, 99, 4.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(steelStringsExpected('Whatever', bad), 5, `declared ${bad} falls back`);
    assert.equal(steelStringsExpected('Outer Limits', bad), 4, `declared ${bad} falls back`);
  }
  assert.equal(steelStringsExpected('Whatever', null), 5);
  assert.equal(steelStringsExpected('Whatever', undefined), 5);
});

test('hand entry is completely unaffected -- no declared count, same answers', () => {
  // The guarantee that matters for everything already in the log: passing no
  // declared count must behave exactly as this function did before it existed.
  assert.equal(steelStringsExpected('Outer Limits'), 4);
  assert.equal(steelStringsExpected('5 to Go'), 5);
  assert.equal(steelStringsExpected(''), 5);
  assert.equal(steelStringsExpected(undefined), 5);

  const outerLimits = {
    steelStage: 'Outer Limits',
    strings: [4.1, 3.9, 5.2, 4.0],
    stringMisses: [0, 0, 0, 0],
    stringStopMissed: [false, false, false, false],
  };
  const scored = scoreSteelStage(outerLimits);
  assert.equal(scored.stringsExpected, 4);
  assert.equal(scored.stageTime, 12.0, 'best 3 of 4');
  assert.equal(scored.droppedIndex, 2);

  // A five-string stage with only four entered is still treated as unfinished,
  // which is the behaviour that makes a partially logged stage keep what was
  // logged. That is deliberate and must not change.
  const partial = {
    steelStage: '5 to Go',
    strings: [4.1, 3.9, 5.2, 4.0],
    stringMisses: [0, 0, 0, 0],
    stringStopMissed: [false, false, false, false],
  };
  const partialScored = scoreSteelStage(partial);
  assert.equal(partialScored.stringsExpected, 5);
  assert.equal(partialScored.droppedIndex, null);
  assert.equal(partialScored.stageTime, 17.2, 'keeps all four');
});

test('a fully-capped stage scores as the file says (Deer Tribe)', () => {
  const form = parsed(DeertribeShuffledOrder, 'deertribe');
  let checked = 0;
  for (const e of form.entries) {
    for (const s of e.stages) {
      if (s.runs.length === 0 || !s.runs.every((r) => r.time === STEEL_MAX_STRING)) continue;
      const scored = scoreSteelStage(toStoredStage(s));
      assert.equal(scored.stageTime, round2(s.fileStageTotal));
      checked += 1;
    }
  }
  assert.equal(checked, 15, 'fifteen stages where every run timed out');
});

test('a club-invented stage carries no official name into the log', () => {
  const form = parsed(MedfordInventedStages, 'medford');
  const e = form.entries.find((x) => x.stages.length === 4)!;
  for (const s of e.stages.filter((x) => x.officialCode === '')) {
    const stored = toStoredStage(s);
    // Empty steelStage means "generic", which is what the app already supports;
    // the club's own name travels separately so nothing is invented or lost.
    assert.equal(stored.steelStage, '');
    assert.equal(scoreSteelStage(stored).stageTime, round2(s.fileStageTotal));
  }
});
