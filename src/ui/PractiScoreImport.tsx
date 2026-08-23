// Import a match from PractiScore (spec §7.3, M8). Three steps on one screen:
//   1) paste or load the exported results (or try the built-in sample),
//   2) tap which competitor is you,
//   3) preview the Match, pick the gun you shot, and confirm.
// Nothing is written until the final "Save match" — it creates one ordinary
// Match record (editable/deletable like any other). The parser is pure + tested
// in src/lib/practiscore.ts; this file is just the screen around it.
//
// STEEL CHALLENGE (build spec 10 Aug 2026, decision 3: ONE screen that works
// out what it has been given). A PractiScore SCSA download file announces
// itself — its first line starts `AA,` — so whether it arrives through the
// file chooser or pasted into the box, it is routed to the Steel flow before
// the USPSA parser ever sees it (refusal 4: the wrong door refuses, or here,
// redirects — the USPSA reader can never misread a download file). The Steel
// flow: confirm which match the file is (name + date shot, read from the file
// before anything else) -> pick your entry or entries from the whole field ->
// per-entry gun + division -> save. Each selected entry becomes its own Match
// record (decision 2: a multi-gun shooter is two entries and two records).
// ALL selected entries are verified before ANY is written: a refusal writes
// nothing, never half.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, Firearm, Match } from '../lib/types.ts';
import { getAll, getSettings, putMany, putOne, putSettings } from '../lib/db.ts';
import { stampNew } from '../lib/stamps.ts';
import { newId } from '../lib/id.ts';
import { todayKey } from '../lib/dates.ts';
import { MATCH_TYPES, DIVISIONS, STEEL_DIVISIONS, POWER_FACTORS, suggestDivision, divisionMismatchKind } from '../lib/competition.ts';
import { divisionActuallyChanged } from '../lib/divisionNormalise.ts';
import { fieldOptions } from '../lib/selectOptions.ts';
import {
  findOwnRows, isOwnName, memberNumberVerdict, normaliseStoredNames, numberMayLift, scsaAdoptionCandidate,
  scsaCorrectedNumber, scsaDiffersCandidate, scsaNumberPatch, type NameMatch
} from '../lib/shooterMatch.ts';
import {
  parsePractiScore, countInDivision, SAMPLE_PRACTISCORE_CSV, type PsMatch
} from '../lib/practiscore.ts';
import { looksLikeNewStyleResults, looksLikeSteelChallengeResults } from '../lib/practiscoreDetect.ts';
import {
  parseScsaForm, looksLikeScsaForm, groupEntriesByPerson, type ScsaEntry, type ScsaForm
} from '../lib/scsaForm.ts';
import { buildSteelMatchFields, scsaDateKey } from '../lib/scsaImport.ts';
import { FormProblem } from './FormProblem.tsx';
import { ListSearch, matchesQuery } from './ListSearch.tsx';
import { MatchMagPicker } from './MatchMagPicker.tsx';
import { noAutofillProps } from './SuggestField.tsx';
import { ConfirmSheet } from './Sheet.tsx';
import { looseNum } from '../lib/csv.ts';
import { textTooLongMessage, fileTooLargeMessage, MAX_IMPORT_FILE_BYTES } from '../lib/inputLimits.ts';
import { findLikelyDuplicate } from '../lib/matchDupe.ts';

export function PractiScoreImport({ onCancel, onSaved }: {
  onCancel: () => void;
  onSaved: (matchId: string) => void;
}) {
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<PsMatch | null>(null);
  const [chosenIdx, setChosenIdx] = useState<number | null>(null);
  const [problem, setProblem] = useState('');

  // Preview fields the user can adjust before saving.
  const [matchName, setMatchName] = useState('');
  const [matchDate, setMatchDate] = useState(todayKey());
  const [matchType, setMatchType] = useState(MATCH_TYPES[0]);
  // Division and power factor are editable before saving, because the results
  // are not always right about them. Michael's own club scores every shooter
  // as Carry Optics whatever they actually shot, so an import would otherwise
  // write a division into the log that the shooter never competed in. What
  // PractiScore said is the starting value, never the final word.
  const [division, setDivision] = useState('');
  const [powerFactor, setPowerFactor] = useState('');
  const [firearmId, setFirearmId] = useState('');
  const [entryFee, setEntryFee] = useState('');
  // Match magazine tracking (decision 3a): the same collapsed picker rides
  // this confirm screen, optional, pre-ticked with the usual mags for the
  // gun once it's picked below. USPSA results never carry a round count, so
  // `totalRounds` is always null here -- the picker renders its "pending"
  // state; the picks themselves still save with the match.
  const [matchMagIds, setMatchMagIds] = useState<string[]>([]);
  const [matchMagOverrides, setMatchMagOverrides] = useState<{ magId: string; rounds: number }[]>([]);
  const [matchMagConditions, setMatchMagConditions] = useState<{ magId: string; tag: string }[]>([]);
  const [saving, setSaving] = useState(false);
  /* Synchronous re-entry gate for BOTH save paths. The `saving` state guard
     alone has always had a micro-window — React commits state after the
     event, so two clicks in one frame both read `saving === false` — and the
     duplicate check (23 Aug 2026) put an ASYNC read in front of
     setSaving(true), stretching that window from microseconds to a real
     IndexedDB round-trip. A double-tap on Save could then run the whole save
     twice, writing the match twice. A ref flips synchronously, so the second
     entry is refused before anything async happens. Cleared in finally on
     every exit — including the early return that opens the duplicate sheet,
     so "Save Anyway" can re-enter. */
  const saveGateRef = useRef(false);
  const [psQuery, setPsQuery] = useState(''); // audit #18 — find yourself in a big field
  // The names the shooter told us are theirs (Settings -> Who you are). Used
  // ONLY to lift their own rows to the top of the field; nothing is selected on
  // their behalf, because a household can put two shooters in one match.
  const [ownNames, setOwnNames] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null); // audit #19 — styled file picker
  /* Tap-test finding, 21 Aug 2026 (session 129, item 6): on a phone the
     adoption question sits low enough that "Not mine" can reveal the
     correction box entirely BELOW the fold — the shooter answers and sees
     nothing change. Scroll the revealed box into view (minimally — block:
     'nearest') the moment it appears. Scrolling only: the spec's §2.2
     no-keyboard-grab rule stands, so this never focuses the input. */
  const correctionBoxRef = useRef<HTMLDivElement>(null);
  /* MEMBER_DIFFERS_ACTION_SPEC.md §3 (22 Aug 2026, session 129): the same
     tap-test lesson, applied to the differs question's own reveal — the
     match-director note that appears under "Keep my number" gets the same
     scroll-into-view treatment as the correction box above. */
  const differsNoteRef = useRef<HTMLDivElement>(null);
  /* The USPSA how-to <details> is stateful for ONE reason: when the new-style
     refusal fires, its message says "the numbered steps below walk through it",
     so those steps must actually be open on the screen the message points at
     (21 Aug 2026, session 129 — the rearrangement put them behind a disclosure). */
  const [uspsaHowtoOpen, setUspsaHowtoOpen] = useState(false);

  // ── Steel Challenge download-file flow ──────────────────────────────────────
  const [steelForm, setSteelForm] = useState<ScsaForm | null>(null);
  const [steelConfirmed, setSteelConfirmed] = useState(false);
  /** Competitor numbers picked in the picker, in tap order. */
  const [steelPicked, setSteelPicked] = useState<number[]>([]);
  /** Per-entry editable details, keyed by competitor number. */
  const [steelDetails, setSteelDetails] = useState<Record<number, {
    division: string; firearmId: string; entryFee: string;
    // Match magazine tracking (decision 3a), per entry -- each entry becomes
    // its own match record with its own gun, so each gets its own picks.
    magIds: string[]; magOverrides: { magId: string; rounds: number }[]; magConditions: { magId: string; tag: string }[];
  }>>({});
  const [steelName, setSteelName] = useState('');
  const [steelDate, setSteelDate] = useState('');
  const [steelQuery, setSteelQuery] = useState('');
  /** Decision 4: the member number remembered from the last Steel import, used
   *  only to lift this shooter's entries to the top. Nothing is ever selected
   *  on their behalf. */
  const [rememberedNumber, setRememberedNumber] = useState('');
  /** MEMBER_NUMBER_PROVENANCE_SPEC.md §3, §6 (19 Aug 2026, session 128):
   *  where rememberedNumber came from. Read ONLY alongside rememberedNumber,
   *  via numberMayLift — a number the shooter TYPED in Settings may still
   *  lift a group on its own; a number the app only INHERITED, or one from a
   *  record older than this build (undefined), may confirm a suggested row
   *  but never lift one. */
  const [rememberedSource, setRememberedSource] = useState<AppSettings['scsaMemberNumberSource']>(undefined);
  /** The adoption question's own selection (spec §4): which button, if any,
   *  the shooter has tapped for THIS save. Neither is selected by default,
   *  Save works in every state, and it resets whenever the shooter leaves
   *  the finishing step — going back to the shooter list or starting over —
   *  so an old answer can never survive a changed pick set. */
  const [steelAdoptSelection, setSteelAdoptSelection] = useState<'yes' | 'no' | null>(null);
  /** The candidate the question was actually showing when "Yes" was tapped —
   *  compared again at save time so a changed pick set can never smuggle a
   *  different number through an old answer (spec §4, last bullet). */
  const [steelAdoptedCandidate, setSteelAdoptedCandidate] = useState<string | null>(null);
  /** MEMBER_DIFFERS_ACTION_SPEC.md §5 (22 Aug 2026, session 129): the
   *  differs question's own selection trio, mirroring the adoption pair
   *  above exactly — same "neither selected by default, Save works in
   *  every state" contract, reset at the same three sites (fresh file,
   *  Start over, ‹ Back to the shooter list). Structurally this can never
   *  render alongside the adoption trio: scsaAdoptionCandidate requires the
   *  stored number EMPTY, scsaDiffersCandidate requires it NON-EMPTY. */
  const [steelDiffersSelection, setSteelDiffersSelection] = useState<'file' | 'keep' | null>(null);
  /** The candidate on screen when "Use the file's number" was tapped —
   *  compared again at save time, the same staleness re-check as
   *  steelAdoptedCandidate (spec §4). */
  const [steelDiffersApproved, setSteelDiffersApproved] = useState<string | null>(null);
  /** IMPORT_PICKER_AND_CORRECT_NUMBER_SPEC.md §2 (19 Aug 2026): what the
   *  shooter typed in the "Not mine" correction box, if anything. Optional
   *  and never pre-filled — typing is an offer, not a demand. Kept across a
   *  Yes/Not-mine switch (a stray tap must never cost work, spec §2.3), and
   *  reset at exactly the three places steelAdoptSelection resets: a fresh
   *  file, "Start over", and "‹ Back to the shooter list". */
  const [steelCorrectionDraft, setSteelCorrectionDraft] = useState('');
  /** The USPSA # the shooter typed in Settings -> Who you are
   *  (MEMBER_NUMBER_SPEC.md §4) — a confirmation beside a name match on
   *  suggested rows, never a key. */
  const [storedUspsaNumber, setStoredUspsaNumber] = useState('');
  /** DUPLICATE_IMPORT_DETECTION_SPEC.md §2-3 (22 Aug 2026, session 129/130):
   *  the suspected-duplicate a save handler found, waiting on the shooter's
   *  answer. Set by save()/saveSteel() when findLikelyDuplicate hits and the
   *  check wasn't suppressed; cleared on Cancel, and on "Save Anyway" the
   *  same save re-enters itself with the check suppressed for that one tap. */
  const [confirmDupe, setConfirmDupe] = useState<{ kind: 'uspsa' | 'steel'; name: string; date: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const st = await getSettings<AppSettings>();
      // ownerName is deliberately not read — see its note in AppSettings.
      if (alive) {
        setOwnNames(normaliseStoredNames(st?.shooterNames));
        setRememberedNumber((st?.scsaMemberNumber ?? '').trim());
        setRememberedSource(st?.scsaMemberNumberSource);
        setStoredUspsaNumber((st?.uspsaMemberNumber ?? '').trim());
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => { void (async () => setFirearms(await getAll<Firearm>('firearms')))(); }, []);
  useEffect(() => {
    if (steelAdoptSelection !== 'no') return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    correctionBoxRef.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [steelAdoptSelection]);
  // MEMBER_DIFFERS_ACTION_SPEC.md §3: the same reveal-and-scroll behaviour,
  // for the differs question's own progressive disclosure.
  useEffect(() => {
    if (steelDiffersSelection !== 'keep') return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    differsNoteRef.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [steelDiffersSelection]);

  // Michael's device tap-test (7 Aug 2026): "Read results" swapped the paste card
  // for the shooter field, but the page kept its old scroll position — mid-field,
  // with the suggested "This looks like you" row sitting off-screen above. Tab and
  // screen changes already snap to the top (App.tsx scrollTop); these in-screen
  // step changes are the same movement, so they get the same snap. rAF so it runs
  // after the new step has rendered.
  const [steelFinishing, setSteelFinishing] = useState(false);
  const step = steelForm != null
    ? (!steelConfirmed ? 4 : !steelFinishing ? 5 : 6)
    : parsed == null ? 1 : chosenIdx == null ? 2 : 3;
  useEffect(() => {
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }, [step]);

  /** Route a Steel Challenge download file into the Steel flow. Returns false
   *  when the text is not a download file at all (caller continues as USPSA). */
  function tryStartSteel(t: string): boolean {
    if (!looksLikeScsaForm(t)) return false;
    const r = parseScsaForm(t);
    if (!r.ok) {
      setProblem(r.message);
      return true; // it WAS a download file — a damaged one. Never fall through to USPSA.
    }
    setSteelForm(r.form);
    setSteelConfirmed(false);
    setSteelFinishing(false);
    setSteelPicked([]);
    setSteelDetails({});
    // A fresh file is a fresh question — an answer from a previous import
    // must never survive to be honoured against this one's picks.
    setSteelAdoptSelection(null);
    setSteelAdoptedCandidate(null);
    setSteelCorrectionDraft('');
    // MEMBER_DIFFERS_ACTION_SPEC.md §5: the same reset, for the differs
    // question's own answer — one of the three sites the spec names.
    setSteelDiffersSelection(null);
    setSteelDiffersApproved(null);
    setSteelName(r.form.matchName);
    // The date the match was SHOT, never the download date. '' when the file's
    // date is malformed — the save guard then asks for it, same as USPSA.
    setSteelDate(scsaDateKey(r.form.matchDate));
    setSteelQuery('');
    setProblem('');
    return true;
  }

  function readResults() {
    setProblem('');
    // S-2: cap the pasted text before the parser walks it (guard at the boundary).
    const tooLong = textTooLongMessage(text.length);
    if (tooLong) { setProblem(tooLong); return; }
    // A download file pasted into the text box is still a download file
    // (refusal 4 / decision 3: the screen works out what it has been given).
    if (tryStartSteel(text)) return;
    try {
      const m = parsePractiScore(text);
      setParsed(m);
      setChosenIdx(null);
      setMatchName(m.name);
      // Only set a date the results actually carried. Falling back to today
      // wrote the import date onto a match shot days earlier, silently, and a
      // date nobody stated is a date nobody can check. An empty field stops at
      // the "Pick the match date" guard in save() instead.
      setMatchDate(m.date);
    } catch (e) {
      setParsed(null);
      // Steel is checked FIRST. A Steel Challenge page trips the new-style
      // detector's place-hyphen family on its own, so asking second would send a
      // Steel shooter after the old-style page he is already looking at.
      // The two messages ask for different things, and only one of them is
      // possible: the new-style one says "copy a different page", this one says
      // "you copied the right page and we cannot read it yet."
      if (looksLikeSteelChallengeResults(text)) {
        setProblem('This looks like a Steel Challenge results page. Reading those is not built yet, so nothing was imported. You can still log a Steel Challenge match by hand.');
      } else if (looksLikeNewStyleResults(text)) {
        setProblem("That looks like PractiScore’s new results page, which doesn’t carry the table this import reads. Nothing was imported. On your match page, find Old style results and tap Html Results, then tap Combined at the right-hand end of the top Overall row, and copy that whole page — the numbered steps below walk through it.");
        setUspsaHowtoOpen(true); // the message points at steps that must be visible
      } else {
        setProblem(e instanceof Error ? e.message : 'Could not read that.');
      }
    }
    setPsQuery(''); // a query from a previous field must not filter this one
  }

  function startOver() {
    // A Save that is mid-flight (the duplicate check's IndexedDB read runs
    // BEFORE setSaving(true), so `saving` is still false for a beat) must not
    // have the state it closed over torn down under it — the resumed save
    // would still write and then navigate over whatever the shooter did here
    // (cold audit, 23 Aug 2026: the same widened window the saveGateRef
    // closes for a second Save tap, closed here for the exits too).
    if (saveGateRef.current) return;
    // psQuery goes with it. A query left over from the previous paste survived
    // into the next one, where it filtered a shorter field down to nothing AND
    // switched off the suggestions — with the search box itself hidden, because
    // it only appears above eight shooters. An empty card with no way forward.
    setParsed(null); setChosenIdx(null); setProblem(''); setPsQuery('');
    // The Steel flow resets with it — same button, same promise: back to step 1.
    setSteelForm(null); setSteelConfirmed(false); setSteelFinishing(false);
    setSteelPicked([]); setSteelDetails({}); setSteelQuery('');
    // The adoption question's own answer resets too (spec §4): a shooter who
    // starts over is picking a possibly different match entirely.
    setSteelAdoptSelection(null); setSteelAdoptedCandidate(null); setSteelCorrectionDraft('');
    // MEMBER_DIFFERS_ACTION_SPEC.md §5: the same reset for the differs
    // question's own answer.
    setSteelDiffersSelection(null); setSteelDiffersApproved(null);
  }

  function toggleSteelEntry(entry: ScsaEntry) {
    if (!entry.importable) return;
    setSteelPicked((prev) => {
      if (prev.includes(entry.competitorNumber)) {
        return prev.filter((n) => n !== entry.competitorNumber);
      }
      return [...prev, entry.competitorNumber];
    });
    setSteelDetails((prev) => {
      if (prev[entry.competitorNumber]) return prev;
      return {
        ...prev,
        [entry.competitorNumber]: {
          // Seeded from the file, editable before saving. An unrecognised
          // division code starts on the club's own name for it — shown, never
          // guessed at (spec §12).
          division: entry.storedDivision ?? (entry.divisionName || entry.divisionCode),
          firearmId: '',
          entryFee: '',
          magIds: [], magOverrides: [], magConditions: [],
        },
      };
    });
  }

  async function saveSteel(skipDupeCheck = false) {
    if (saving || saveGateRef.current || steelForm == null || steelPicked.length === 0) return;
    saveGateRef.current = true;
    try {
    if (!steelDate) { setProblem('Pick the match date.'); return; }
    const entriesByNumber = new Map(steelForm.entries.map((e) => [e.competitorNumber, e]));
    // Validate EVERYTHING before writing ANYTHING: a refusal writes nothing,
    // and a half-imported multi-gun pair would be worse than a refusal.
    const toWrite: { fields: Record<string, unknown>; entry: ScsaEntry }[] = [];
    for (const n of steelPicked) {
      const entry = entriesByNumber.get(n);
      const d = steelDetails[n];
      if (!entry || !d) continue;
      if (!d.firearmId) {
        setProblem(steelPicked.length > 1
          ? `Pick which gun you shot for ${entry.firstName} ${entry.lastName} (${d?.division || 'entry'}).`
          : 'Pick which gun you shot.');
        return;
      }
      const built = buildSteelMatchFields(entry, {
        firearmId: d.firearmId,
        division: d.division,
        matchName: steelName,
        date: steelDate,
        entryFee: looseNum(d.entryFee),
      });
      if (!built.ok) { setProblem(built.message); return; }
      // Match magazine tracking (decision 3a), additive: written only when
      // something is picked for this entry, the same no-migration pattern
      // every other optional match field follows. buildSteelMatchFields is
      // left untouched -- this only adds keys onto its plain-object result.
      const fields = { ...built.fields };
      if (d.magIds.length) fields.magIds = d.magIds;
      if (d.magOverrides.length) fields.magOverrides = d.magOverrides;
      if (d.magConditions.length) fields.magConditions = d.magConditions;
      toWrite.push({ fields, entry });
    }
    if (toWrite.length === 0) { setProblem('Nothing is selected. Go back and tap your entry first.'); return; }
    // DUPLICATE_IMPORT_DETECTION_SPEC.md §1, §3 (22 Aug 2026, session
    // 129/130): one check for the shared identity every sibling in this
    // batch carries (steelName + steelDate), against the log as loaded
    // BEFORE this save — checking here, before any write, is what keeps
    // sibling records in ONE Steel save from ever tripping each other (the
    // batch-exclusion rule, spec §1's fact 2): a multi-gun save writes
    // several records sharing one date+name, and none of them exist yet
    // when this runs. A hit warns and returns; "Save Anyway" re-enters this
    // same function with the check suppressed for that one tap (spec §3).
    if (!skipDupeCheck) {
      // Fail-safe (rule 23's direction for this check): if this read throws,
      // the shooter gets today's shipped behaviour — no warning — rather than
      // an unhandled rejection eating the save. A missed warning costs one
      // duplicate the shooter chose to import twice; a broken Save costs the
      // import. The write below keeps its own try/catch either way.
      try {
        // The check sees precisely what gets saved, never a guess at it:
        // buildSteelMatchFields writes `matchName.trim() || 'Steel Challenge
        // Match'`, so a blank title still collides with a blank-title
        // re-import (cold audit, 23 Aug 2026 — the raw steelName here missed
        // exactly that case while the USPSA path four functions down got it
        // right).
        const steelWouldBeName = steelName.trim() || 'Steel Challenge Match';
        const existingMatches = await getAll<Match>('matches');
        const dupe = findLikelyDuplicate(steelDate, steelWouldBeName, existingMatches);
        if (dupe) { setConfirmDupe({ kind: 'steel', name: steelWouldBeName, date: steelDate }); return; }
      } catch { /* proceed without the warning — never block the save on the check */ }
    }
    setSaving(true);
    // ONE putMany call makes the whole save atomic: every entry's record is
    // built first, then all of them land in a single transaction. A failure
    // now writes nothing, ever — the earlier per-row putOne loop could leave
    // earlier matches saved while later ones failed; that state can't happen
    // anymore, so the catch below has only one truth to tell.
    let firstId = '';
    try {
      const now = Date.now();
      const records: unknown[] = [];
      for (const w of toWrite) {
        const mid = newId('mt');
        if (!firstId) firstId = mid;
        records.push(stampNew(w.fields, mid, now));
      }
      await putMany('matches', records);
      // Decision 4, extended by MEMBER_NUMBER_SPEC.md §3: remember the member
      // number so the next file opens with this shooter's entries lifted to
      // the top — but only when nothing is stored yet. The field is visible
      // and editable in Settings now, so whatever's there is the shooter's to
      // keep or correct; an import fills a blank, never overwrites a value
      // they can see.
      // (A) Confirmed adoption (MEMBER_NUMBER_PROVENANCE_SPEC.md §4, 19 Aug
      // 2026, session 128): a Steel save may no longer store a member number
      // silently — that silent write is exactly how a stranger's number
      // (Don Webster's, in Michael's own tap-test screenshot) got into
      // Settings and stayed there. Written only when the shooter tapped
      // "Yes — it's mine", and only when the candidate recomputed HERE from
      // what actually got written still equals the one the question was
      // showing when Yes was tapped — a changed pick set can never smuggle a
      // different number through an old answer (spec §4, last bullet).
      if (steelAdoptSelection === 'yes' && steelAdoptedCandidate) {
        const freshCandidate = scsaAdoptionCandidate(
          toWrite.map((w) => w.entry.membership),
          rememberedNumber
        );
        if (freshCandidate && freshCandidate === steelAdoptedCandidate) {
          try {
            await putSettings<AppSettings>({ scsaMemberNumber: freshCandidate, scsaMemberNumberSource: 'imported' });
            // Keep the in-memory copies in step, or a SECOND import in the
            // same sitting would still see the field as empty and askable —
            // the same staleness the original setRememberedNumber comment
            // guarded against, extended to the source (spec §5).
            setRememberedNumber(freshCandidate);
            setRememberedSource('imported');
          } catch { /* best-effort; the import already saved */ }
        }
      } else if (steelDiffersSelection === 'file' && steelDiffersApproved) {
        // (C) MEMBER_DIFFERS_ACTION_SPEC.md §4 (22 Aug 2026, session 129):
        // "Use the file's number" writes on save success only, MIRRORING THE
        // SHIPPED ADOPTION WRITE (A) DIRECTLY ABOVE — the spec's own cited
        // precedent ("the exact precedent of Yes — it's mine") IS that
        // write. IMPORTANT, recorded here because it corrects the signed
        // spec: §4's text says this goes "through scsaNumberPatch" — that is
        // not implementable, because scsaNumberPatch can only ever emit
        // source 'typed' (it is the Settings-screen write rule, the guard
        // scsaCorrectedNumber calls below in branch B). This call site
        // follows the direct write branch (A) ships today, not the
        // unbuildable one; the applier is recording this spec correction
        // separately. Same staleness re-check as (A): recompute from what
        // actually got written and only honour it if it still equals the
        // number the shooter approved on screen.
        const freshDiffers = scsaDiffersCandidate(
          toWrite.map((w) => w.entry.membership),
          rememberedNumber
        );
        if (freshDiffers && freshDiffers === steelDiffersApproved) {
          try {
            await putSettings<AppSettings>({ scsaMemberNumber: freshDiffers, scsaMemberNumberSource: 'imported' });
            setRememberedNumber(freshDiffers);
            setRememberedSource('imported');
          } catch { /* best-effort; the import already saved */ }
        }
        // "Keep my number" (steelDiffersSelection === 'keep') writes
        // nothing — spec §4's other half. It falls through to (B) below,
        // whose scsaCorrectedNumber guard requires selection === 'no';
        // steelAdoptSelection is never 'no' from this question (the
        // adoption and differs questions are structurally mutually
        // exclusive), so corrected is always null there and (B) stays
        // silent, exactly as the spec requires.
      } else {
        // (B) The correction (IMPORT_PICKER_AND_CORRECT_NUMBER_SPEC.md §2, 19
        // Aug 2026): "Not mine" no longer stores nothing and offers nothing —
        // Michael's own transposition error (Gun Craft filed A185321 where
        // A185231 is his) is the case this exists for. Every guard lives in
        // scsaCorrectedNumber, CALLED rather than restated here: the
        // selection really is 'no', the typed value is non-empty, and the
        // fill-only-when-empty contract still holds. This call site trusts
        // it completely rather than re-checking any of the three.
        const corrected = scsaCorrectedNumber(steelAdoptSelection, steelCorrectionDraft, rememberedNumber);
        if (corrected) {
          try {
            await putSettings<AppSettings>(scsaNumberPatch(corrected, rememberedNumber));
            // Mirrors the Yes branch's own staleness guard just above (spec
            // §5, extended by spec §2.8): keep the in-memory copies in step,
            // or a second import in the same sitting would see the field as
            // empty and askable again.
            setRememberedNumber(corrected);
            setRememberedSource('typed');
          } catch { /* best-effort; the import already saved, same shape as Yes */ }
        }
      }
      onSaved(firstId);
    } catch {
      setProblem("That match couldn't be saved. Nothing was written — try again.");
    } finally {
      setSaving(false);
    }
    } finally {
      saveGateRef.current = false;
    }
  }

  async function save(skipDupeCheck = false) {
    if (saving || saveGateRef.current || parsed == null || chosenIdx == null) return;
    saveGateRef.current = true;
    try {
    if (!matchDate) { setProblem('Pick the match date.'); return; }
    if (!firearmId) { setProblem('Pick which gun you shot.'); return; }
    const me = parsed.competitors[chosenIdx];
    // The division placing was worked out among the shooters PractiScore
    // scored in the division IT recorded. Change the division and that placing
    // describes a field the match never had, so it goes rather than being
    // carried across under a new label. Same principle as the date: a figure
    // nobody can check does not get written.
    // divisionActuallyChanged is false when the selection equals the raw scored string
    // OR its canonical form (spec §3.3). Saving "Carry Optics" after pre-selection on
    // a "CO" file does NOT fire the guard, so the real placing is preserved.
    const divisionChanged = divisionActuallyChanged(me.division, division, DIVISIONS);
    // DUPLICATE_IMPORT_DETECTION_SPEC.md §1, §3 (22 Aug 2026, session
    // 129/130): the would-be name is exactly the value the record below
    // writes (the same trim-or-fallback), so the check sees precisely what
    // gets saved, never a guess at it. A hit warns and returns — never a
    // silent block (the ruling's own words, spec §2) — and "Save Anyway"
    // re-enters this same function with the check suppressed for that one
    // tap (spec §3).
    const wouldBeName = matchName.trim() || 'PractiScore Match';
    if (!skipDupeCheck) {
      // Same fail-safe as saveSteel's check: a thrown read means no warning,
      // never a broken Save (rule 23 — the check must not be able to cost an
      // import it exists to protect).
      try {
        const existingMatches = await getAll<Match>('matches');
        const dupe = findLikelyDuplicate(matchDate, wouldBeName, existingMatches);
        if (dupe) { setConfirmDupe({ kind: 'uspsa', name: wouldBeName, date: matchDate }); return; }
      } catch { /* proceed without the warning — never block the save on the check */ }
    }
    setSaving(true);
    try {
      const mid = newId('mt');
      const fields = {
        date: matchDate,
        name: matchName.trim() || 'PractiScore Match',
        matchType,
        division,
        powerFactor,
        firearmId,
        totalRounds: null,
        matchPercent: me.matchPercent,
        divisionPlace: divisionChanged ? null : me.divisionPlace,
        // A blank division is not a division: counting everyone whose Div cell
        // was empty produced "N in your division" on a match that recorded none.
        // Pass the canonical saved division so an all-"CO" file counts under
        // "Carry Optics" (spec §3.3, §5.1.2).
        divisionOf: divisionChanged || me.division === '' ? null : (countInDivision(parsed.competitors, division) || null),
        overallPlace: me.overallPlace,
        overallOf: parsed.competitors.length,
        stages: me.stages.map((s) => ({ number: s.number, points: null, time: null, percent: s.percent, notes: '' })),
        // looseNum, not bare Number(): a typo like "35a" must store null, never
        // NaN — stored NaN poisons cost math and any future aggregate (L-7).
        entryFee: looseNum(entryFee),
        practiScoreUrl: '',
        notes: me.memberNumber ? `Imported from PractiScore (USPSA# ${me.memberNumber}).` : 'Imported from PractiScore.',
        legacy: { source: 'practiscore', memberNumber: me.memberNumber, classLetter: me.classLetter, matchPoints: me.matchPoints },
        // Match magazine tracking (decision 3a), additive: written only when
        // something is picked on the confirm screen above.
        ...(matchMagIds.length ? { magIds: matchMagIds } : {}),
        ...(matchMagOverrides.length ? { magOverrides: matchMagOverrides } : {}),
        ...(matchMagConditions.length ? { magConditions: matchMagConditions } : {}),
      };
      await putOne('matches', stampNew(fields, mid, Date.now()));
      onSaved(mid);
    } catch {
      // A failed WRITE gets a local, accurate message — not the global
      // "didn't finish loading" banner (L-5). Nothing was saved.
      setProblem("That match couldn't be saved. Nothing was written — try again.");
    } finally {
      setSaving(false);
    }
    } finally {
      saveGateRef.current = false;
    }
  }

  const me = parsed != null && chosenIdx != null ? parsed.competitors[chosenIdx] : null;

  // Which rows in this field carry one of the shooter's own names. Computed
  // fresh from the parse rather than stored, so changing the names in Settings
  // and coming back cannot leave a stale suggestion behind.
  // Memoised: without it this runs a regex per competitor on every keystroke in
  // the search box, on a field that can be two hundred shooters long.
  const suggested: NameMatch[] = useMemo(
    () => (parsed ? findOwnRows(parsed.competitors, ownNames) : []),
    [parsed, ownNames]
  );

  /** MEMBER_NUMBER_PROVENANCE_SPEC.md §4: the adoption question is asked only
   *  on the finishing step, only when there is something to fill — the same
   *  fill-only-when-empty contract that used to guard the old silent write —
   *  and only when the picked entries carry exactly one distinct membership
   *  number between them (scsaAdoptionCandidate, spec §6): two different ones
   *  is the household case, and asking would be a guess, so it is not asked
   *  and nothing is stored. Recomputed on every render, so a changed pick set
   *  never leaves a stale question on screen. */
  const steelAdoptionCandidate: string | null = useMemo(() => {
    if (!steelForm || !steelFinishing) return null;
    const memberships = steelPicked.map(
      (n) => steelForm.entries.find((e) => e.competitorNumber === n)?.membership ?? ''
    );
    return scsaAdoptionCandidate(memberships, rememberedNumber);
  }, [steelForm, steelFinishing, steelPicked, rememberedNumber]);

  /** MEMBER_DIFFERS_ACTION_SPEC.md §2, §5: the differs question's own
   *  candidate, computed beside steelAdoptionCandidate with the identical
   *  membership extraction and the identical per-render recompute, so a
   *  changed pick set never leaves a stale question on screen. Structurally
   *  mutually exclusive with the candidate above: scsaAdoptionCandidate
   *  requires the stored number EMPTY, scsaDiffersCandidate requires it
   *  NON-EMPTY — one block or the other ever has something to show. */
  const steelDiffersCandidate: string | null = useMemo(() => {
    if (!steelForm || !steelFinishing) return null;
    const memberships = steelPicked.map(
      (n) => steelForm.entries.find((e) => e.competitorNumber === n)?.membership ?? ''
    );
    return scsaDiffersCandidate(memberships, rememberedNumber);
  }, [steelForm, steelFinishing, steelPicked, rememberedNumber]);

  /** One shooter row. Shared so a suggested row and a row in the full field are
   *  the same button doing the same thing — a suggestion is a position, not a
   *  different kind of control. */
  function shooterRow(i: number, isSuggestion: boolean) {
    const c = parsed!.competitors[i];
    // A confirmation beside the name match, never a key — computed only for a
    // suggested row, and only when there is something to say (spec §5): null
    // means silence, not "no number".
    const numberVerdict = isSuggestion ? memberNumberVerdict(storedUspsaNumber, c.memberNumber) : null;
    return (
      <button className="row-tap" key={`${isSuggestion ? 'sug' : 'all'}-${i}`}
        aria-label={isSuggestion ? `${c.name || 'Unnamed shooter'} — suggested, this looks like you` : undefined}
        onClick={() => {
        setChosenIdx(i);
        // Seed the editable fields from the row that was picked, so a
        // change of shooter never leaves the previous one's division
        // sitting in the form. Pre-select the canonical division name
        // (spec §3.1, §3.2): if PractiScore stored "CO" the picker starts
        // on "Carry Optics", not on the short code. The raw scored string
        // stays in the preview row above. The "as scored" option in the
        // picker lets the user revert if the guess is wrong.
        setDivision(suggestDivision(c.division, DIVISIONS) ?? c.division);
        setPowerFactor(c.powerFactor || POWER_FACTORS[0]);
      }}>
        <span className="label">{c.name || '(no name)'}
          <div className="row-sub">
            {[c.division, c.classLetter && `Class ${c.classLetter}`, c.matchPercent != null ? `${c.matchPercent.toFixed(2)}%` : null]
              .filter(Boolean).join(' · ')}
          </div>
          {numberVerdict && (
            <div className="row-sub">{numberVerdict === 'match' ? 'USPSA # matches' : 'Member # differs'}</div>
          )}
        </span>
        <span className="value">{c.overallPlace != null ? `#${c.overallPlace}` : ''} ›</span>
      </button>
    );
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={() => { if (saveGateRef.current) return; onCancel(); }}>‹ Cancel</button>
        <span />
      </div>
      <h1 className="large-title">Import from PractiScore</h1>

      <FormProblem problem={problem} />

      {/* Steel step A — confirm which match this file is, before any picking.
          A folder of identically-shaped, meaninglessly-named files is no
          problem: the app says which match was grabbed before anything else. */}
      {steelForm && !steelConfirmed && (
        <div className="card">
          <h2>{steelForm.matchName || 'Steel Challenge match'}</h2>
          <p className="report-note">
            {steelDate ? `Shot ${steelDate} · ` : ''}
            {steelForm.entries.length} {steelForm.entries.length === 1 ? 'entry' : 'entries'}
            {steelForm.matches.size > 1 ? ` across ${steelForm.matches.size} side-by-side matches` : ''}.
            Is this the match you meant to load?
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="button" style={{ flex: 1 }} onClick={() => setSteelConfirmed(true)}>Yes — find my entry</button>
            <button className="button secondary" style={{ flex: 1 }} onClick={startOver}>Not this one — start over</button>
          </div>
        </div>
      )}

      {/* Steel step B — the picker. One row per ENTRY, not per person: a
          shooter who ran two guns is two entries, tied together only by the
          membership number, and each one imports as its own match. */}
      {steelForm && steelConfirmed && !steelFinishing && (
        <>
        <div className="card steel-picker-card">
          <h2>{steelForm.matchName || 'Steel Challenge match'}</h2>
          <p className="report-note">
            Tap your entry. Shot more than one gun? Tap each of your entries — every
            one you pick is saved as its own match.
          </p>
          {steelForm.entries.length > 8 && (
            <ListSearch value={steelQuery} onChange={setSteelQuery} placeholder="Search shooters by name" />
          )}
          {(() => {
            const groups = groupEntriesByPerson(steelForm.entries);
            const isMine = (g: ScsaEntry[]): boolean => {
              const remembered = rememberedNumber.toUpperCase();
              // Gated by SOURCE (MEMBER_NUMBER_PROVENANCE_SPEC.md §3, §5, 19 Aug
              // 2026, session 128 — Michael's own tap-test screenshot: a
              // stranger's number, silently remembered from a match he never
              // attended, lifted the stranger's row here with no name check of
              // any kind). A number the shooter TYPED in Settings, and one they
              // CONFIRMED with "Yes — it's mine", may each lift a group on their
              // own — both are the shooter claiming the number, and that claim is
              // exactly what the stranger's number never had. What may confirm a
              // suggested row but never lift one is a number of UNKNOWN origin:
              // no recorded source, which is every settings record written before
              // this build and every restore of an older backup.
              //
              // The first cut of this build allowed only 'typed' to lift. It was
              // reversed the same day, by Michael, after CI went red: it retired
              // Decision 4 for anyone who adopts from an import, and it made the
              // adoption question's own promise ("entries with this number go to
              // the top of the list") false.
              if (numberMayLift(rememberedNumber, rememberedSource) && g.some((e) => e.groupKey === remembered)) return true;
              // isOwnName, not a raw compare: Settings stores "Minik, Michael" but a
              // download file writes first/last in separate fields as "Michael
              // Minik" — same person, two conventions. This replaces an inline
              // `.toLowerCase()` compare that missed exactly that case (Michael's
              // Hansen file, 12 Aug 2026). The member-number branch above is untouched.
              return g.some((e) => isOwnName(`${e.firstName} ${e.lastName}`, ownNames));
            };
            const fullNameOf = (e: ScsaEntry) => `${e.firstName} ${e.lastName}`.trim();
            const entryRow = (e: ScsaEntry, suggested: boolean) => {
              const picked = steelPicked.includes(e.competitorNumber);
              const sub = [
                e.storedDivision ?? (e.divisionName || e.divisionCode || null),
                steelForm.matches.size > 1 ? (e.matchName || null) : null,
                e.importable ? null : e.blockedReason,
              ].filter(Boolean).join(' · ');
              // Same confirmation as the USPSA side, against the stored SCSA #
              // (rememberedNumber) rather than a number typed here. Only for a
              // suggested row, and only when there is something to say.
              const numberVerdict = suggested ? memberNumberVerdict(rememberedNumber, e.membership) : null;
              return (
                <button className="row-tap" key={`${suggested ? 'sug' : 'all'}-${e.competitorNumber}`}
                  aria-pressed={picked}
                  aria-disabled={!e.importable}
                  aria-label={suggested ? `${e.firstName} ${e.lastName} — suggested, this looks like you` : undefined}
                  style={e.importable ? undefined : { opacity: 0.5 }}
                  onClick={() => toggleSteelEntry(e)}>
                  {/* IMPORT_PICKER_AND_CORRECT_NUMBER_SPEC.md §3.2 (19 Aug
                      2026): a SIBLING of .label, never inside it. A picked
                      row used to carry its only feedback as a trailing dim
                      check character inside .value (Michael: "the check mark
                      appears — but you really have to be aware of this
                      change"). who-you-are.spec.ts's rowOrder helper reads
                      .label's first child, so the check lives before it, not
                      in it. aria-hidden: the state is already spoken through
                      aria-pressed on the row's own button. */}
                  {picked && <span aria-hidden="true" className="row-check">✓</span>}
                  <span className="label">{`${e.firstName} ${e.lastName}`.trim() || '(no name)'}
                    {sub && <div className="row-sub">{sub}</div>}
                    {numberVerdict && (
                      <div className="row-sub">{numberVerdict === 'match' ? 'SCSA # matches' : 'Member # differs'}</div>
                    )}
                  </span>
                  <span className="value">
                    {[e.place != null ? `#${e.place}` : null, e.fileTotal != null ? `${e.fileTotal.toFixed(2)}s` : null]
                      .filter(Boolean).join(' · ')} ›
                  </span>
                </button>
              );
            };
            const mine = steelQuery.trim() === '' ? groups.filter(isMine) : [];
            const matchesSteelQuery = (e: ScsaEntry) => matchesQuery(steelQuery, `${e.firstName} ${e.lastName}`);
            return (
              <>
                {mine.length > 0 && (
                  <>
                    <div className="suggest-block">
                      <h3 className="suggest-label">
                        {mine.reduce((n, g) => n + g.length, 0) === 1 ? 'This looks like you' : 'These look like you'}
                      </h3>
                      {mine.flatMap((g) => g.map((e) => entryRow(e, true)))}
                    </div>
                    <h3 className="field-label">Everyone who shot the match</h3>
                  </>
                )}
                {/* The full field, grouped: a person's entries sit under one
                    header (spec §6) so a multi-gun shooter reads as one person
                    with two entries, not two strangers sharing a name. */}
                {groups.map((g, gi) => {
                  const visible = g.filter(matchesSteelQuery);
                  if (visible.length === 0) return null;
                  return (
                    <div key={`grp-${gi}`}>
                      {g.length > 1 && (
                        <h3 className="field-label">
                          {fullNameOf(g[0]) || '(no name)'} — {g.length} entries, one per gun
                        </h3>
                      )}
                      {visible.map((e) => entryRow(e, false))}
                    </div>
                  );
                })}
              </>
            );
          })()}
          <button className="button secondary" style={{ marginTop: 10 }} onClick={startOver}>Start over</button>
        </div>
        {/* IMPORT_PICKER_AND_CORRECT_NUMBER_SPEC.md §3.1 (19 Aug 2026): the
            pinned pick bar replaces the in-card Continue, which used to sit
            below the WHOLE field — 78 entries stood between the suggestion
            block and the button on Michael's own Gun Craft file (spec §0.3).
            Always on screen for as long as the picker step is: the
            not-yet-picked state is precisely the one that needs explaining.
            The count is of PICKED entries, never the filtered view —
            steelPicked itself is never touched by the search box, so this is
            already the honest count whatever the filter currently shows. */}
        <div className="pick-bar">
          <div className="pick-bar-inner">
            <p className="pick-bar-status" aria-live="polite">
              {steelPicked.length === 0
                ? 'Nothing picked yet. Tap your entry to continue.'
                : steelPicked.length === 1
                  ? '1 entry picked.'
                  : `${steelPicked.length} entries picked.`}
            </p>
            <button className="button" disabled={steelPicked.length === 0}
              onClick={() => setSteelFinishing(true)}>
              {steelPicked.length <= 1 ? 'Continue' : `Continue with ${steelPicked.length} entries`}
            </button>
          </div>
        </div>
        </>
      )}

      {/* Steel step C — finish the details and save. Every field is visible and
          editable before anything is written; nothing is saved until the button. */}
      {steelForm && steelConfirmed && steelFinishing && (
        <>
        <div className="card steel-finish-card">
          <h2>Finish the details</h2>
          <label className="field">What this match is called
            <input value={steelName} onChange={(e) => setSteelName(e.target.value)}
              {...noAutofillProps} name="match-title" />
          </label>
          <label className="field">Date
            <input type="date" value={steelDate} onChange={(e) => setSteelDate(e.target.value)} />
            {steelDate === '' && (
              <span className="report-note">This file didn't carry a readable date. Pick the day you shot it.</span>
            )}
          </label>
          {steelPicked.map((n) => {
            const entry = steelForm.entries.find((e) => e.competitorNumber === n);
            const d = steelDetails[n];
            if (!entry || !d) return null;
            const patch = (p: Partial<typeof d>) => setSteelDetails((prev) => ({ ...prev, [n]: { ...prev[n], ...p } }));
            const rawDivision = entry.storedDivision ?? (entry.divisionName || entry.divisionCode);
            return (
              <div key={n} style={{ marginTop: steelPicked.length > 1 ? 14 : 0 }}>
                {steelPicked.length > 1 && (
                  <h3 className="field-label">
                    {`${entry.firstName} ${entry.lastName}`.trim()}
                    {steelForm.matches.size > 1 && entry.matchName ? ` — ${entry.matchName}` : ''}
                  </h3>
                )}
                <label className="field">Division
                  <select value={d.division} onChange={(e) => patch({ division: e.target.value })}>
                    {fieldOptions(STEEL_DIVISIONS, rawDivision, d.division).map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  {entry.storedDivision === null && entry.divisionCode !== '' && (
                    <span className="report-note">
                      The file calls this division &quot;{entry.divisionName || entry.divisionCode}&quot;, which
                      isn&apos;t one this app recognises — it is kept as written. Change it if that is wrong.
                    </span>
                  )}
                </label>
                <label className="field">Which gun did you shoot?
                  <select value={d.firearmId} onChange={(e) => patch({ firearmId: e.target.value })}>
                    <option value="">Pick one…</option>
                    {firearms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </label>
                {d.firearmId && (
                  <MatchMagPicker
                    key={d.firearmId}
                    firearmId={d.firearmId}
                    totalRounds={null}
                    initialMagIds={d.magIds}
                    initialMagOverrides={d.magOverrides}
                    initialMagConditions={d.magConditions}
                    sticky
                    onChange={(next) => patch({ magIds: next.magIds, magOverrides: next.magOverrides, magConditions: next.magConditions })} />
                )}
                <label className="field">Entry fee (optional)
                  <input inputMode="decimal" value={d.entryFee} onChange={(e) => patch({ entryFee: e.target.value })} placeholder="e.g. 35" />
                </label>
              </div>
            );
          })}
          {/* The adoption question (spec §4): not a modal, not a sheet — an
              inline block on the screen the shooter is already reading,
              immediately above the button it modifies. Tapping selects (shown
              pressed); neither is selected by default; Save works in every
              state, and ignoring it stores nothing. */}
          {steelAdoptionCandidate && (
            <>
              <p className="report-note" id="scsa-adopt-question"><b>Remember {steelAdoptionCandidate} as your SCSA #?</b></p>
              <p className="report-note">
                Next time you load a Steel Challenge file, entries with this number go to the top of the list. Skipping this changes nothing about the match you're saving.
              </p>
              {/* role="group" + aria-labelledby so a screen reader hears the two
                  buttons as the two answers to ONE question. They stay toggle
                  buttons (aria-pressed) rather than radios: a real radiogroup
                  owes arrow-key navigation, and neither answer is preselected
                  (cold audit, 19 Aug 2026, session 128). */}
              <div role="group" aria-labelledby="scsa-adopt-question"
                style={{ display: 'flex', gap: 8, marginTop: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <button className="button choice" style={{ flex: 1 }} aria-pressed={steelAdoptSelection === 'yes'}
                  onClick={() => { setSteelAdoptSelection('yes'); setSteelAdoptedCandidate(steelAdoptionCandidate); }}>
                  Yes — it's mine
                </button>
                <button className="button choice" style={{ flex: 1 }} aria-pressed={steelAdoptSelection === 'no'}
                  onClick={() => { setSteelAdoptSelection('no'); setSteelAdoptedCandidate(null); }}>
                  Not mine
                </button>
              </div>
              {/* IMPORT_PICKER_AND_CORRECT_NUMBER_SPEC.md §2.2 (19 Aug 2026):
                  progressive disclosure — the box appears only after "Not
                  mine" is pressed, and never grabs the keyboard (no
                  autoFocus): typing is an offer, not a demand, and a
                  popped-up keyboard would cover the Save button the shooter
                  is about to reach for. Never pre-filled: the file's number
                  is the very one he just rejected, and anything else would
                  be a guess (spec §2.2). No format validation, on purpose,
                  same as Settings (spec §0.8) — clubs' number formats vary. */}
              {steelAdoptSelection === 'no' && (
                <div ref={correctionBoxRef}>
                  <p className="report-note"><b>What is your SCSA #?</b></p>
                  {/* aria-describedby, not a paragraph floating loose beside the
                      field: a screen-reader user who tabs straight to the input
                      would otherwise hear only "Your SCSA #" and none of what
                      typing there actually does (cold audit, 19 Aug 2026). Same
                      wiring the Settings field already uses for its own note. */}
                  <p className="report-note" id="scsa-correction-note">
                    Type it and it is kept in Settings when you save this match. Next time you load a Steel Challenge file, entries with this number go to the top of the list. Leave it blank and nothing is kept. Either way the entry you picked is what saves.
                  </p>
                  <label className="field">Your SCSA #
                    <input value={steelCorrectionDraft} onChange={(e) => setSteelCorrectionDraft(e.target.value)}
                      aria-describedby="scsa-correction-note"
                      placeholder="SC-12345" maxLength={24} />
                  </label>
                </div>
              )}
            </>
          )}
          {/* MEMBER_DIFFERS_ACTION_SPEC.md §2-3 (22 Aug 2026, session 129):
              the second door §2.5 deliberately left closed. Mirrors the
              adoption block above exactly — same markup, same progressive
              disclosure, same "ignoring is safe" rule. Structural mutual
              exclusion with the block above: scsaAdoptionCandidate requires
              the stored number EMPTY, scsaDiffersCandidate requires it
              NON-EMPTY, so only one of these two ever has something to show. */}
          {steelDiffersCandidate && (
            <>
              <p className="report-note" id="scsa-differs-question"><b>This file lists a different SCSA # for you.</b></p>
              <p className="report-note">
                Your saved number is {rememberedNumber}. This file lists {steelDiffersCandidate}. Either could be the right one — only you know.
              </p>
              {/* role="group" + aria-labelledby, toggle buttons rather than a
                  radiogroup, neither preselected — the same reasoning as the
                  adoption question above (cold audit, 19 Aug 2026, session
                  128, carried into this second door). */}
              <div role="group" aria-labelledby="scsa-differs-question"
                style={{ display: 'flex', gap: 8, marginTop: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <button className="button choice" style={{ flex: 1 }} aria-pressed={steelDiffersSelection === 'file'}
                  onClick={() => { setSteelDiffersSelection('file'); setSteelDiffersApproved(steelDiffersCandidate); }}>
                  Use the file's number
                </button>
                <button className="button choice" style={{ flex: 1 }} aria-pressed={steelDiffersSelection === 'keep'}
                  onClick={() => { setSteelDiffersSelection('keep'); setSteelDiffersApproved(null); }}>
                  Keep my number
                </button>
              </div>
              {/* Progressive disclosure, same pattern and same reason as the
                  correction box above: the reminder only means something
                  once "Keep my number" says the club's copy is the wrong
                  one, so it only appears then (spec §3). Scrolled into view
                  the same way (Tap-test finding, 21 Aug 2026, session 129,
                  item 6) — reduced-motion respected, block: 'nearest'. */}
              {steelDiffersSelection === 'keep' && (
                <div ref={differsNoteRef}>
                  <p className="report-note">
                    If your saved number is the right one, the club's record is what needs fixing — mention it to the match director.
                  </p>
                </div>
              )}
            </>
          )}
          <button className="button secondary" style={{ marginTop: 8 }}
            onClick={() => {
              if (saveGateRef.current) return; // mid-save exit guard, same as startOver
              setSteelFinishing(false);
              setSteelAdoptSelection(null); setSteelAdoptedCandidate(null); setSteelCorrectionDraft('');
              setSteelDiffersSelection(null); setSteelDiffersApproved(null);
            }}>‹ Back to the shooter list</button>
        </div>
        {/* FINISHING_STEP_PINNED_BAR_MEMO.md, Option 2 (22 Aug 2026, session
            129/130, folded into this branch per the memo's own
            recommendation): the picker step's own pinned .pick-bar, reused
            verbatim on the Steel finishing card only — the memo's recon
            names it the tall one (per-entry details, a mag picker per
            entry, and now a question block, all above Save). The USPSA
            finishing card is untouched. The status line is advisory, never
            a gate: both questions above already promise "ignoring is safe"
            (spec §3 / MEMBER_NUMBER_PROVENANCE_SPEC.md §4), so the bar's
            job is to say what's true, not hold anyone back — Save always
            works, in every state. REPLACES the in-card Save button removed
            above (the picker step's own precedent). */}
        <div className="pick-bar">
          <div className="pick-bar-inner">
            <p className="pick-bar-status" aria-live="polite">
              {(() => {
                // Priority order (charter §1: "ready to save" would be FALSE
                // while a required field is still missing — strings 1-2
                // reuse the save guards' own vocabulary on purpose, so the
                // bar never promises something Save is about to refuse).
                const missingGun = steelPicked.some((n) => !steelDetails[n]?.firearmId);
                if (missingGun) {
                  return steelPicked.length <= 1 ? 'Pick your gun above.' : 'Pick a gun for each entry above.';
                }
                if (steelDate === '') return 'Pick the match date above.';
                // A question block is on screen and unanswered.
                if ((steelAdoptionCandidate != null && steelAdoptSelection === null) ||
                    (steelDiffersCandidate != null && steelDiffersSelection === null)) {
                  return '1 question above needs a look';
                }
                return steelPicked.length <= 1 ? '1 match ready to save' : `${steelPicked.length} matches ready to save`;
              })()}
            </p>
            <button className="button" disabled={saving} onClick={() => void saveSteel()}>
              {steelPicked.length <= 1 ? 'Save match' : `Save ${steelPicked.length} matches`}
            </button>
          </div>
        </div>
        </>
      )}

      {/* Step 1 — paste or load the export */}
      {!parsed && !steelForm && (
        <div className="card">
          {/* Actions FIRST, instructions on demand (Michael, 21 Aug 2026, session
              129, from the PR #65 tap test: "when you come to a page it just looks
              like an explanation rather than the place you are doing the import").
              The two how-to walkthroughs kept verbatim below, each behind a native
              <details> so the doing part is on screen the moment the page opens. */}
          <p className="report-note">
            <b>Paste your match results below, or load a results file</b> — a Steel
            Challenge download file, or a .csv or .txt someone sent you. To see how
            it all works first, tap "Try the sample". You pick your own row next.
          </p>
          <label className="field">Results text
            <textarea rows={8} value={text} placeholder="Paste PractiScore results here…"
              onChange={(e) => setText(e.target.value)} />
          </label>
          {/* NO extension filter (spec §10, hazard 12): the Steel Challenge
              download arrives under two names — SCSA_EventResults.csv from the
              site's SCSA Upload button, or a bare hex name with no extension
              when the report address is fetched directly (both observed on
              Michael's own matches, 14 Aug 2026). A filter keyed to either
              shape would hide the other. What the file IS is decided from its
              contents, never its name. */}
          <input ref={fileRef} type="file" style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                const tooBig = fileTooLargeMessage(f.size, MAX_IMPORT_FILE_BYTES, 'file');
                if (tooBig) setProblem(tooBig);
                else {
                  void f.text().then((t) => {
                    // A download file goes straight into the Steel flow; anything
                    // else lands in the paste box exactly as before.
                    if (!tryStartSteel(t)) { setText(t); setProblem(''); }
                  }).catch(() => setProblem('That file could not be read. Try loading it again.'));
                }
              }
              e.target.value = '';
            }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="button" style={{ flex: 1 }} disabled={!text.trim()} onClick={readResults}>Read results</button>
            <button className="button secondary" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>Load a file</button>
            <button className="button secondary" style={{ flex: 1 }} onClick={() => { setText(SAMPLE_PRACTISCORE_CSV); setProblem(''); }}>Try the sample</button>
          </div>
          <details className="import-howto">
            <summary>How to get a Steel Challenge file from PractiScore</summary>
          <p className="report-note">
            <b>Shot a Steel Challenge match?</b> Load the match's results file with
            the Load a file button above, and the app recognises it and walks you through.
            Here is how to get the file from PractiScore:
          </p>
          <ol className="report-note" style={{ paddingLeft: 20, margin: '6px 0 12px' }}>
            <li>On practiscore.com, tap <b>Scores</b>, then the <b>Steel Challenge</b> box.</li>
            <li>Search for your club, then tap your match.</li>
            <li>
              Scroll to the bottom of the results table. Under <b>Report for SCSA</b>,
              tap <b>SCSA Upload</b>.
            </li>
            <li>
              A Club Info form opens. If Club Name or Club Code is empty, fill it
              in. Sometimes both are already filled, and sometimes a list offers
              them to pick from.
            </li>
            <li>Tap <b>Make The File</b>, then save the download.</li>
          </ol>
          <p className="report-note">
            Those steps name the download <b>SCSA_EventResults.csv</b>. Reached
            another way it can instead arrive as a long jumble of letters with no
            file ending. Either one is the right file, and the app reads both.
          </p>
          </details>
          <details className="import-howto" open={uspsaHowtoOpen}
            onToggle={(e) => setUspsaHowtoOpen(e.currentTarget.open)}>
            <summary>How to copy USPSA results from PractiScore</summary>
          <p className="report-note">
            For a USPSA match, copying the results page is the way to get your
            scores out, so here is the whole path:
          </p>
          <ol className="report-note" style={{ paddingLeft: 20, margin: '6px 0 12px' }}>
            <li>Open your match on practiscore.com. PractiScore opens its new results view first. Scroll down the match page to find "Old style results".</li>
            <li>Under "Old style results", tap <b>Html Results</b>.</li>
            <li>
              A table opens with one row per stage and a row at the very top reading{' '}
              <b>Overall</b>. Tap <b>Combined</b> at the right-hand end of that top row.{' '}
              <b>Overall</b> is the row's name, not a button, and every row has a{' '}
              <b>Combined</b> — you want the one on the top row.
            </li>
            <li>
              On a phone: press and hold on the match name just above the table until a
              blue highlight appears, then drag the round handle at its lower end down
              the page. It scrolls on its own while you hold. On a computer: click
              anywhere in the page, then Command-A and Command-C.
            </li>
            <li>
              Keep dragging until the highlight covers the last shooter, let go, and tap{' '}
              <b>Copy</b>.
            </li>
            <li>Paste it in the box above.</li>
          </ol>
          <p className="report-note">
            Reach the last shooter before you let go. Stop part-way and the field arrives
            short, and your finish then reads out of a smaller number than actually shot
            the match — the places still run 1, 2, 3 with no gap, so nothing here can tell
            it happened. The menus and adverts at the top of the page do no harm; nothing
            is read from them.
          </p>
          </details>
        </div>
      )}

      {/* Step 2 — pick your row */}
      {parsed && chosenIdx == null && (
        <div className="card">
          <h2>{parsed.name || 'Match'}</h2>
          <p className="report-note">
            {parsed.competitors.length} shooters{parsed.date ? ` · ${parsed.date}` : ''}. Which one is you?
          </p>
          {/* Audit #18: search by name so you're not scrolling a 200-shooter field. */}
          {parsed.competitors.length > 8 && (
            <ListSearch value={psQuery} onChange={setPsQuery} placeholder="Search shooters by name" />
          )}
          {/* Rows carrying one of the shooter's OWN names, lifted out of the field
              and shown first. They are still ordinary rows that have to be tapped:
              two people from one household can shoot the same match, so the app
              suggests and the shooter chooses. The whole field stays below,
              unchanged, so a wrong or missing suggestion costs nothing. */}
          {suggested.length > 0 && psQuery.trim() === '' && (
            <>
              <div className="suggest-block">
                <h3 className="suggest-label">
                  {suggested.length === 1 ? 'This looks like you' : 'These look like you'}
                </h3>
                {suggested.map((m) => shooterRow(m.index, true))}
              </div>
              <h3 className="field-label">Everyone who shot the match</h3>
            </>
          )}
          {parsed.competitors.map((c, i) => (matchesQuery(psQuery, c.name) ? shooterRow(i, false) : null))}
          {/* Shown whenever nothing was suggested — including when names ARE
              stored and none matched, which is precisely when a mistyped or
              differently-spelled stored name needs pointing at. */}
          {suggested.length === 0 && parsed.competitors.length > 8 && (
            <p className="report-note" style={{ marginTop: 10 }}>
              {ownNames.length === 0
                ? 'Add your name under Settings → Who you are and this list will put you at the top next time.'
                : 'None of the names in Settings → Who you are matched anyone here. Check the spelling against the list above.'}
            </p>
          )}
          <button className="button secondary" style={{ marginTop: 10 }} onClick={startOver}>Start over</button>
        </div>
      )}

      {/* Step 3 — preview + confirm */}
      {parsed && me && (
        <>
          <div className="card">
            <h2>Your result</h2>
            <div className="row"><span className="label">Shooter</span><span className="value">{me.name || '—'}</span></div>
            <div className="row"><span className="label">Division</span><span className="value">{me.division || '—'}</span></div>
            <div className="row"><span className="label">Power factor</span><span className="value">{me.powerFactor || '—'}</span></div>
            <div className="row"><span className="label">Overall place</span><span className="value">{me.overallPlace != null ? `${me.overallPlace} of ${parsed.competitors.length}` : '—'}</span></div>
            <div className="row"><span className="label">Division place</span><span className="value">{me.divisionPlace != null ? `${me.divisionPlace} of ${countInDivision(parsed.competitors, me.division)}` : '—'}</span></div>
            <div className="row"><span className="label">Match %</span><span className="value">{me.matchPercent != null ? `${me.matchPercent.toFixed(2)}%` : '—'}</span></div>
            {me.stages.map((s) => (
              <div className="row" key={s.number}>
                <span className="label">Stage {s.number}</span>
                <span className="value">{s.percent != null ? `${s.percent.toFixed(2)}%` : '—'}</span>
              </div>
            ))}
          </div>

          <div className="card">
            <h2>Finish the details</h2>
            <label className="field">What this match is called
              <input value={matchName} onChange={(e) => setMatchName(e.target.value)} placeholder="Spring Classic"
                {...noAutofillProps} name="match-title" />
            </label>
            <label className="field">Date
              <input type="date" value={matchDate} onChange={(e) => setMatchDate(e.target.value)} />
              {matchDate === '' && (
                <span className="report-note">These results didn't carry a date. Pick the day you shot it.</span>
              )}
            </label>
            <label className="field">Type
              <select value={matchType} onChange={(e) => setMatchType(e.target.value)}>
                {MATCH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="field">Division
              <select value={division} onChange={(e) => setDivision(e.target.value)}>
                {/* Whatever the results said stays in this list PERMANENTLY, so
                    choosing from ours never overwrites it and never strands the
                    shooter away from it. See fieldOptions above for why. */}
                {fieldOptions(DIVISIONS, me.division, division).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {/* When the picker shows the canonical name for what the results said
                  (e.g. "Carry Optics" for "CO"), tell the user what the results said
                  and that the placing is preserved. Only shown when they differ and
                  the canonical is not the same string PractiScore wrote (spec §3.1).
                  The sentence names the ACTUAL difference (audit finding 1): calling
                  "carry optics" or "Open " a short code is false, and the spacing/case
                  differences are invisible without the quotes -- same lesson as the
                  divisionMismatchKind callout on the match screen. */}
              {division !== me.division && !divisionActuallyChanged(me.division, division, DIVISIONS) && (
                <span className="report-note">
                  {(() => {
                    const q = <b>&quot;{me.division}&quot;</b>;
                    switch (divisionMismatchKind(me.division, division)) {
                      case 'spacing':
                        return <>The results scored you as {q}, with extra spaces around it. Selected below
                          as <b>{division}</b>. Change it if that is wrong.</>;
                      case 'spelling':
                        return <>The results scored you as {q}, spelled differently from the list. Selected below
                          as <b>{division}</b>. Change it if that is wrong.</>;
                      case 'spacing-and-spelling':
                        return <>The results scored you as {q}, with extra spaces and a different spelling. Selected below
                          as <b>{division}</b>. Change it if that is wrong.</>;
                      default:
                        return <>The results scored you as {q}, a short code. Selected below
                          as <b>{division}</b>. Change it if that is wrong.</>;
                    }
                  })()}
                </span>
              )}
              {/* When the user has picked a genuinely different division, warn that
                  the division placing will be cleared (spec §3.3). */}
              {divisionActuallyChanged(me.division, division, DIVISIONS) && (
                <span className="report-note">
                  The results scored you as "{me.division || 'no division'}". Your division finish
                  will be left blank, because it was worked out among the shooters in that division.
                </span>
              )}
            </label>
            <label className="field">Power factor
              <select value={powerFactor} onChange={(e) => setPowerFactor(e.target.value)}>
                {fieldOptions(POWER_FACTORS, me.powerFactor, powerFactor).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="field">Which gun did you shoot?
              <select value={firearmId} onChange={(e) => setFirearmId(e.target.value)}>
                <option value="">Pick one…</option>
                {firearms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            {firearmId && (
              <MatchMagPicker
                key={firearmId}
                firearmId={firearmId}
                totalRounds={null}
                initialMagIds={matchMagIds}
                initialMagOverrides={matchMagOverrides}
                initialMagConditions={matchMagConditions}
                sticky
                onChange={(next) => {
                  setMatchMagIds(next.magIds);
                  setMatchMagOverrides(next.magOverrides);
                  setMatchMagConditions(next.magConditions);
                }} />
            )}
            <label className="field">Entry fee (optional)
              <input inputMode="decimal" value={entryFee} onChange={(e) => setEntryFee(e.target.value)} placeholder="e.g. 35" />
            </label>
            <button className="button" disabled={saving} onClick={() => void save()}>Save match</button>
            <button className="button secondary" style={{ marginTop: 8 }} onClick={() => { if (saveGateRef.current) return; setChosenIdx(null); }}>‹ Pick a different shooter</button>
          </div>
        </>
      )}

      {/* DUPLICATE_IMPORT_DETECTION_SPEC.md §2-3 (22 Aug 2026, session
          129/130): the warn-then-confirm modal, rendered at component level
          so either save path can open it. A hint (same date + name) warns,
          never blocks; "Save Anyway" re-enters the SAME save function with
          the check suppressed for that one tap. Cancel first, the confirm
          in the danger style — the shipped ConfirmSheet pattern and the
          spec's own safe-first order (spec §2's "Audit #1" precedent); no
          styling changes. */}
      {confirmDupe && (
        <ConfirmSheet
          title="Looks like you already saved this match."
          message={`Your log already has ‘${confirmDupe.name}’ on ${confirmDupe.date}. Importing it again makes a second copy — and if magazines are picked on both, their round counts will count it twice.`}
          confirmLabel="Save Anyway"
          onConfirm={() => {
            const kind = confirmDupe.kind;
            setConfirmDupe(null);
            if (kind === 'uspsa') void save(true); else void saveSteel(true);
          }}
          onClose={() => setConfirmDupe(null)} />
      )}
    </div>
  );
}
