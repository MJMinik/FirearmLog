// PractiScore SCSA download file -> one Match record, ready to store.
//
// THIS MODULE IS PURE. It turns one picked entry from a parsed download file
// (scsaForm.ts) into the exact `fields` object the import screen hands to
// `putOne('matches', stampNew(...))` — the same call a hand-entered match goes
// through. It touches no database, no screen and no settings, and it computes
// no score of its own: every number that reaches the log is produced by
// scoreSteelStage in competition.ts, the same code that scores a typed match.
//
// THE ONE RULE THAT MATTERS MOST (build spec §8, refusal 3): the app never
// writes numbers it cannot independently reproduce. Before returning fields,
// this module re-scores every stage with the app's own scorer and compares
// against the file's stage totals and match total, in whole hundredths. Any
// mismatch refuses the entry and nothing is written.
//
// Decision 3 (Michael, 10 Aug 2026): the file's run times already CONTAIN the
// three-second miss penalties — proved on 2,595 of 2,595 rows. So each run is
// stored the way a hand-entered run is stored: the raw time with the penalty
// seconds subtracted back out, and the miss count beside it. The scorer then
// re-adds them, and the round trip is proved lossless by the refusal-3 check
// on every import, not just in the test suite.

import type { MatchStage } from './types.ts';
import { scoreSteelStage, steelMatchTotal, STEEL_MISS_PENALTY } from './competition.ts';
import { toHundredths, type ScsaEntry } from './scsaForm.ts';

/** The file's ER line writes the match date as YYYYMMDD. The app stores
 *  YYYY-MM-DD everywhere. Returns '' for anything malformed — the screen's
 *  existing "Pick the match date" guard then stops the save, exactly as it does
 *  for a USPSA paste that carried no date. A date nobody stated is a date
 *  nobody can check, so nothing here ever falls back to today. */
export function scsaDateKey(yyyymmdd: string): string {
  const t = (yyyymmdd ?? '').trim();
  if (!/^\d{8}$/.test(t)) return '';
  const y = Number(t.slice(0, 4));
  const mm = Number(t.slice(4, 6));
  const dd = Number(t.slice(6, 8));
  // A real calendar check, not flat bounds: '20260231' is eight digits with
  // mm<=12 and dd<=31 and is still not a date. Date.UTC normalises overflow
  // (Feb 31 -> Mar 3), so a round-trip that changes any component means the
  // components never named a real day.
  const d = new Date(Date.UTC(y, mm - 1, dd));
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return '';
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
}

/** What the screen supplies alongside the picked entry. Every one of these is
 *  visible and editable on the confirm step before anything is written. */
export interface SteelImportOptions {
  firearmId: string;
  /** The division to store. Seeded by the screen from the entry's mapped
   *  division (or the club's own name when the code is unrecognised — §12:
   *  shown, never guessed), and editable before saving. */
  division: string;
  matchName: string;
  /** YYYY-MM-DD. Seeded from the ER line's match date — never the download
   *  date — and editable before saving. */
  date: string;
  entryFee: number | null;
}

export type SteelBuildResult =
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; message: string };

/** Build the storable fields for one picked entry, or refuse.
 *
 *  Refuses when: the entry is not importable (no scores, or a degenerate
 *  match); a run is shorter than its own penalty seconds (never observed in
 *  twelve real files, and a file that does it is lying about something); or
 *  the app's own scorer cannot reproduce the file's stage totals or match
 *  total exactly (refusal 3). A refusal writes nothing.
 */
export function buildSteelMatchFields(entry: ScsaEntry, opts: SteelImportOptions): SteelBuildResult {
  if (!entry.importable) {
    return {
      ok: false,
      message: entry.blockedReason ?? "This entry can't be imported from this file.",
    };
  }

  const penaltyH = Math.round(STEEL_MISS_PENALTY * 100);
  const stages: MatchStage[] = [];

  for (const st of entry.stages) {
    const strings: (number | null)[] = [];
    const stringMisses: (number | null)[] = [];
    for (const run of st.runs) {
      const rawH = toHundredths(run.time) - penaltyH * run.penalties;
      if (rawH < 0) {
        // Never seen in a real file: across twelve samples no run is shorter
        // than three seconds times its miss count. A file that does this is
        // internally inconsistent, and subtracting into a negative time would
        // store a number that never happened.
        return {
          ok: false,
          message:
            "This file can't be read safely — one of the recorded runs is shorter than " +
            'its own penalty time, so the scores cannot be reconstructed. Nothing was imported.',
        };
      }
      strings.push(rawH / 100);
      stringMisses.push(run.penalties);
    }

    const declared =
      Number.isInteger(st.declaredStrings) && st.declaredStrings >= 2 && st.declaredStrings <= 7
        ? st.declaredStrings
        : null;

    stages.push({
      number: st.stageNumber,
      points: null,
      time: null,
      percent: null,
      notes: '',
      // An official stage (matched by its SC- code, never by number or name)
      // lands under the app's own canonical name. A club-invented or
      // foreign-coded stage keeps steelStage '' and carries the club's own
      // name in steelStageName, so it is shown as the club named it.
      steelStage: st.canonicalStageName ?? '',
      steelStageName: st.canonicalStageName === null && st.clubStageName !== '' ? st.clubStageName : null,
      // The file's declared string count is the authority (§9.5): one club ran
      // a genuine four-string stage that is not Outer Limits, and only this
      // field lets the scorer drop the right number of runs on it.
      steelStringsDeclared: declared,
      // The file records no stop-plate information; false is the same
      // no-claim default every hand-entered string starts from. A run the
      // timer capped still round-trips exactly: min(raw + penalties, 30)
      // reproduces the recorded 30.00.
      stringStopMissed: st.runs.map(() => false),
      strings,
      stringMisses,
    });
  }

  // Refusal 3 — the app's own scorer must reproduce the file, to the hundredth.
  let sumH = 0;
  for (let i = 0; i < stages.length; i++) {
    const scored = scoreSteelStage(stages[i]);
    const fileH = toHundredths(entry.stages[i].fileStageTotal);
    if (scored.stageTime === null || toHundredths(scored.stageTime) !== fileH) {
      return {
        ok: false,
        message:
          "This file's scores don't add up the way Steel Challenge scoring says they should, " +
          'so the app cannot verify them. Nothing was imported.',
      };
    }
    sumH += fileH;
  }
  if (entry.fileTotal !== null && sumH !== toHundredths(entry.fileTotal)) {
    return {
      ok: false,
      message:
        "This file's stage times don't add up to its own match total, " +
        'so the app cannot verify it. Nothing was imported.',
    };
  }
  // Belt and braces: the same total through the app's match-level scorer.
  const appTotal = steelMatchTotal(stages);
  if (entry.fileTotal !== null && (appTotal === null || toHundredths(appTotal) !== toHundredths(entry.fileTotal))) {
    return {
      ok: false,
      message:
        "This file's scores could not be reproduced by the app's own scoring, " +
        'so it cannot be imported safely. Nothing was imported.',
    };
  }

  return {
    ok: true,
    fields: {
      date: opts.date,
      name: opts.matchName.trim() || 'Steel Challenge Match',
      matchType: 'Steel Challenge',
      scoringType: 'steel',
      division: opts.division,
      // Steel scoring has no power factor. '' rather than a defaulted 'Minor':
      // a power factor nobody stated is a fact nobody can check — the same
      // principle as the date above.
      powerFactor: '',
      firearmId: opts.firearmId,
      totalRounds: null,
      // Finishing place is deliberately NOT stored (spec §9.3): the file's
      // place is the overall place across every division in that match — it
      // looks like a division result and is not one.
      overallPlace: null,
      overallOf: null,
      divisionPlace: null,
      divisionOf: null,
      matchPercent: null,
      stages,
      entryFee: opts.entryFee,
      practiScoreUrl: '',
      notes: entry.membership
        ? `Imported from a PractiScore Steel Challenge file (member# ${entry.membership}).`
        : 'Imported from a PractiScore Steel Challenge file.',
      legacy: {
        source: 'scsa-download',
        memberNumber: entry.membership,
        competitorNumber: entry.competitorNumber,
        matchIndex: entry.matchIndex,
        matchLabel: entry.matchName,
        divisionCode: entry.divisionCode,
        clubDivisionName: entry.divisionName,
      },
    },
  };
}
