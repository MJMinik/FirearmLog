// The importer's write module, proved against every real file.
//
// scsaScorerAgreement.test.ts proves the app's scorer reproduces the files
// using its OWN independent copy of the reconstruction. These tests prove the
// PRODUCTION reconstruction — buildSteelMatchFields, the function whose output
// actually reaches the log — produces records the scorer verifies, and that a
// file the scorer cannot verify is refused rather than written.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScsaForm, type ScsaEntry, type ScsaForm } from '../src/lib/scsaForm.ts';
import { scoreSteelStage, steelMatchTotal } from '../src/lib/competition.ts';
import { buildSteelMatchFields, scsaDateKey, type SteelImportOptions } from '../src/lib/scsaImport.ts';
import type { MatchStage } from '../src/lib/types.ts';

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
import { UspsaDegenerateOneString } from './fixtures/scsa-uspsa-degenerate-one-string.ts';

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

function parsed(text: string): ScsaForm {
  const r = parseScsaForm(text);
  assert.ok(r.ok, 'fixture must parse');
  return (r as { ok: true; form: ScsaForm }).form;
}

function optsFor(form: ScsaForm, entry: ScsaEntry): SteelImportOptions {
  return {
    firearmId: 'fa_test',
    division: entry.storedDivision ?? entry.divisionName ?? entry.divisionCode,
    matchName: form.matchName,
    date: scsaDateKey(form.matchDate),
    entryFee: null,
  };
}

const H = (n: number): number => Math.round(n * 100);

test('every importable entry in every fixture builds, and the built record reproduces the file exactly', () => {
  let entriesBuilt = 0;
  let stagesChecked = 0;
  for (const [name, text] of FIXTURES) {
    const form = parsed(text);
    for (const entry of form.entries.filter((e) => e.importable)) {
      const r = buildSteelMatchFields(entry, optsFor(form, entry));
      assert.ok(r.ok, `${name} #${entry.competitorNumber} must build: ${r.ok ? '' : r.message}`);
      const stages = (r as { ok: true; fields: { stages: MatchStage[] } }).fields.stages;
      assert.equal(stages.length, entry.stages.length, `${name} #${entry.competitorNumber} stage count`);
      for (let i = 0; i < stages.length; i++) {
        const scored = scoreSteelStage(stages[i]);
        assert.ok(scored.stageTime !== null);
        assert.equal(H(scored.stageTime as number), H(entry.stages[i].fileStageTotal),
          `${name} #${entry.competitorNumber} stage ${entry.stages[i].stageNumber}`);
        // PER-RUN attribution, not just totals: totals are order-invariant, so
        // without this a build that reverses every stage's runs (each time and
        // miss count on the wrong run) passes every total check. Found by a
        // tests-constrain-anything audit that ran exactly that mutant, green.
        const runs = entry.stages[i].runs;
        assert.equal(scored.strings.length, runs.length);
        for (let j = 0; j < runs.length; j++) {
          assert.equal(H(scored.strings[j].capped as number), H(runs[j].time),
            `${name} #${entry.competitorNumber} stage ${entry.stages[i].stageNumber} run ${j + 1}`);
          assert.equal(scored.strings[j].misses, runs[j].penalties);
        }
        stagesChecked++;
      }
      if (entry.fileTotal !== null) {
        const total = steelMatchTotal(stages);
        assert.ok(total !== null);
        assert.equal(H(total as number), H(entry.fileTotal),
          `${name} #${entry.competitorNumber} match total`);
      }
      entriesBuilt++;
    }
  }
  // The point of printing the counts: a claim like "every entry" is worth
  // having only as a number somebody can compare against the files.
  assert.ok(entriesBuilt >= 300, `built ${entriesBuilt} entries (expected the full field, 300+)`);
  assert.ok(stagesChecked >= 1500, `checked ${stagesChecked} stages`);
});

test("Michael's published 222.41 comes through the production builder", () => {
  const form = parsed(Guncraft8stage);
  const me = form.entries.find((e) => e.membership.toUpperCase() === 'A185231');
  assert.ok(me, 'his row is untouched by anonymisation');
  const r = buildSteelMatchFields(me as ScsaEntry, optsFor(form, me as ScsaEntry));
  assert.ok(r.ok);
  const fields = (r as { ok: true; fields: Record<string, unknown> }).fields;
  const total = steelMatchTotal(fields.stages as MatchStage[]);
  assert.equal(total, 222.41);
  assert.equal(fields.date, '2026-08-09');
  assert.equal(fields.matchType, 'Steel Challenge');
  assert.equal(fields.scoringType, 'steel');
  assert.equal(fields.division, 'Open');
});

test('official stages land under canonical names; club stages keep the club name (Deer Tribe shuffled order)', () => {
  const form = parsed(DeertribeShuffledOrder);
  const entry = form.entries.find((e) => e.importable) as ScsaEntry;
  const r = buildSteelMatchFields(entry, optsFor(form, entry));
  assert.ok(r.ok);
  const stages = (r as { ok: true; fields: { stages: MatchStage[] } }).fields.stages;
  // Deer Tribe runs Roundabout as its stage 1: identity must come from the
  // code, never from the running order.
  const s1 = stages.find((s) => s.number === 1) as MatchStage;
  assert.equal(s1.steelStage, 'Roundabout');
  assert.equal(s1.steelStageName, null);
});

test('a club-invented four-string stage stores the club name and the declared count, and scores best 3 of 4 (GCF&G)', () => {
  const form = parsed(GcfgFourStringInvented);
  const entry = form.entries.find((e) => e.importable && e.stages.some((s) => s.declaredStrings === 4)) as ScsaEntry;
  assert.ok(entry, 'a scored four-string stage exists in this fixture');
  const r = buildSteelMatchFields(entry, optsFor(form, entry));
  assert.ok(r.ok);
  const stages = (r as { ok: true; fields: { stages: MatchStage[] } }).fields.stages;
  const four = stages.find((s) => s.steelStringsDeclared === 4) as MatchStage;
  assert.ok(four, 'declared count stored');
  assert.equal(four.steelStage, '', 'not forced onto an official stage');
  assert.ok(four.steelStageName, 'club name carried');
  const scored = scoreSteelStage(four);
  // Four strings entered, four declared: exactly one must be dropped. Without
  // steelStringsDeclared the name rule expects five and drops nothing.
  assert.equal(scored.droppedIndex !== null, true, 'one string dropped on a complete 4-string stage');
});

test('an entry with no scores refuses with its own reason', () => {
  for (const [, text] of FIXTURES) {
    const form = parsed(text);
    for (const entry of form.entries.filter((e) => !e.importable)) {
      const r = buildSteelMatchFields(entry, optsFor(form, entry));
      assert.equal(r.ok, false);
      assert.ok((r as { ok: false; message: string }).message.length > 0);
    }
  }
});

test('the degenerate USPSA-through-the-Steel-form file is refused before any entry could build', () => {
  const r = parseScsaForm(UspsaDegenerateOneString);
  assert.equal(r.ok, false);
  assert.equal((r as { ok: false; code: string }).code, 'all-degenerate');
});

test('refusal 3: a doctored stage total refuses the entry, and nothing is returned', () => {
  const form = parsed(Guncraft8stage);
  const entry = form.entries.find((e) => e.importable) as ScsaEntry;
  const doctored: ScsaEntry = {
    ...entry,
    stages: entry.stages.map((s, i) => (i === 0 ? { ...s, fileStageTotal: s.fileStageTotal + 0.01 } : s)),
  };
  const r = buildSteelMatchFields(doctored, optsFor(form, doctored));
  assert.equal(r.ok, false);
  assert.match((r as { ok: false; message: string }).message, /Nothing was imported/);
});

test('refusal 3: two stage totals doctored to COMPENSATE (+0.01 / -0.01) still refuse — only the per-stage compare can see this', () => {
  // The sum of stage totals and the match total both stay unchanged, so the
  // match-level checks pass; the per-stage compare is the only guard standing.
  // This input exists because a mutation round proved the simpler doctorings
  // are caught by two overlapping guards, which had left the per-stage compare
  // unproven on its own.
  const form = parsed(Guncraft8stage);
  const entry = form.entries.find((e) => e.importable && e.stages.length >= 2) as ScsaEntry;
  const doctored: ScsaEntry = {
    ...entry,
    stages: entry.stages.map((s, i) =>
      i === 0 ? { ...s, fileStageTotal: s.fileStageTotal + 0.01 }
      : i === 1 ? { ...s, fileStageTotal: s.fileStageTotal - 0.01 }
      : s),
  };
  const r = buildSteelMatchFields(doctored, optsFor(form, doctored));
  assert.equal(r.ok, false);
});

test('refusal 3: a doctored match total refuses the entry', () => {
  const form = parsed(Guncraft8stage);
  const entry = form.entries.find((e) => e.importable && e.fileTotal !== null) as ScsaEntry;
  const doctored: ScsaEntry = { ...entry, fileTotal: (entry.fileTotal as number) + 0.01 };
  const r = buildSteelMatchFields(doctored, optsFor(form, doctored));
  assert.equal(r.ok, false);
});

test('a run shorter than its own penalty seconds refuses (never observed in a real file)', () => {
  const form = parsed(Guncraft8stage);
  const entry = form.entries.find((e) => e.importable) as ScsaEntry;
  const doctored: ScsaEntry = {
    ...entry,
    stages: entry.stages.map((s, i) =>
      i === 0
        ? { ...s, runs: s.runs.map((run, j) => (j === 0 ? { ...run, time: 2.5, penalties: 1 } : run)) }
        : s),
  };
  const r = buildSteelMatchFields(doctored, optsFor(form, doctored));
  assert.equal(r.ok, false);
  assert.match((r as { ok: false; message: string }).message, /shorter than/);
});

test('what is deliberately NOT stored: place, percent, power factor', () => {
  const form = parsed(RedbrushMultigun);
  const entry = form.entries.find((e) => e.importable && e.place !== null) as ScsaEntry;
  assert.ok(entry, 'an entry with a file place exists');
  const r = buildSteelMatchFields(entry, optsFor(form, entry));
  assert.ok(r.ok);
  const fields = (r as { ok: true; fields: Record<string, unknown> }).fields;
  // The file's place is the overall place across every division in that match;
  // storing it would put a number in the log that looks like a division result
  // and is not one (spec §9.3).
  assert.equal(fields.overallPlace, null);
  assert.equal(fields.overallOf, null);
  assert.equal(fields.divisionPlace, null);
  assert.equal(fields.divisionOf, null);
  assert.equal(fields.matchPercent, null);
  assert.equal(fields.powerFactor, '');
});

test('multi-gun: two entries of one person build as two distinct records (Red Brush)', () => {
  const form = parsed(RedbrushMultigun);
  const byKey = new Map<string, ScsaEntry[]>();
  for (const e of form.entries) {
    if (e.groupKey === null) continue;
    const g = byKey.get(e.groupKey) ?? [];
    g.push(e);
    byKey.set(e.groupKey, g);
  }
  const multi = [...byKey.values()].find((g) => g.length > 1 && g.every((e) => e.importable));
  assert.ok(multi, 'a fully importable multi-gun shooter exists');
  const records = (multi as ScsaEntry[]).map((e) => {
    const r = buildSteelMatchFields(e, optsFor(form, e));
    assert.ok(r.ok);
    return (r as { ok: true; fields: Record<string, unknown> }).fields;
  });
  assert.ok(records.length >= 2);
  const legacies = records.map((f) => (f.legacy as { competitorNumber: number }).competitorNumber);
  assert.equal(new Set(legacies).size, legacies.length, 'each record keeps its own competitor number');
});

test('the screen-supplied fields flow through: a changed division, an entry fee, the date', () => {
  // The division the user picks OVERRIDES the seed, the fee is stored, and the
  // date is the one passed in — none of these were pinned before a test audit
  // proved each could be ignored without a failure.
  const form = parsed(Guncraft8stage);
  const entry = form.entries.find((e) => e.importable) as ScsaEntry;
  const r = buildSteelMatchFields(entry, {
    firearmId: 'fa_test', division: 'Limited Optics', matchName: 'Renamed Match',
    date: '2026-08-10', entryFee: 35,
  });
  assert.ok(r.ok);
  const fields = (r as { ok: true; fields: Record<string, unknown> }).fields;
  assert.equal(fields.division, 'Limited Optics');
  assert.equal(fields.entryFee, 35);
  assert.equal(fields.date, '2026-08-10');
  assert.equal(fields.name, 'Renamed Match');
});

test('scsaDateKey converts the ER date and refuses garbage', () => {
  assert.equal(scsaDateKey('20260809'), '2026-08-09');
  assert.equal(scsaDateKey('20261301'), '');   // month 13
  assert.equal(scsaDateKey('20260231'), '');   // Feb 31 — passes flat bounds, is not a date
  assert.equal(scsaDateKey('2026080'), '');    // 7 digits
  assert.equal(scsaDateKey(''), '');
  assert.equal(scsaDateKey('yesterday'), '');
});
