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
import type { AppSettings, Firearm } from '../lib/types.ts';
import { getAll, getSettings, putMany, putOne, putSettings } from '../lib/db.ts';
import { stampNew } from '../lib/stamps.ts';
import { newId } from '../lib/id.ts';
import { todayKey } from '../lib/dates.ts';
import { MATCH_TYPES, DIVISIONS, STEEL_DIVISIONS, POWER_FACTORS, suggestDivision, divisionMismatchKind } from '../lib/competition.ts';
import { divisionActuallyChanged } from '../lib/divisionNormalise.ts';
import { fieldOptions } from '../lib/selectOptions.ts';
import { findOwnRows, normaliseStoredNames, type NameMatch } from '../lib/shooterMatch.ts';
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
import { looseNum } from '../lib/csv.ts';
import { textTooLongMessage, fileTooLargeMessage, MAX_IMPORT_FILE_BYTES } from '../lib/inputLimits.ts';

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
  const [psQuery, setPsQuery] = useState(''); // audit #18 — find yourself in a big field
  // The names the shooter told us are theirs (Settings -> Who you are). Used
  // ONLY to lift their own rows to the top of the field; nothing is selected on
  // their behalf, because a household can put two shooters in one match.
  const [ownNames, setOwnNames] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null); // audit #19 — styled file picker

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

  useEffect(() => {
    let alive = true;
    void (async () => {
      const st = await getSettings<AppSettings>();
      // ownerName is deliberately not read — see its note in AppSettings.
      if (alive) {
        setOwnNames(normaliseStoredNames(st?.shooterNames));
        setRememberedNumber((st?.scsaMemberNumber ?? '').trim());
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => { void (async () => setFirearms(await getAll<Firearm>('firearms')))(); }, []);

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
      } else {
        setProblem(e instanceof Error ? e.message : 'Could not read that.');
      }
    }
    setPsQuery(''); // a query from a previous field must not filter this one
  }

  function startOver() {
    // psQuery goes with it. A query left over from the previous paste survived
    // into the next one, where it filtered a shorter field down to nothing AND
    // switched off the suggestions — with the search box itself hidden, because
    // it only appears above eight shooters. An empty card with no way forward.
    setParsed(null); setChosenIdx(null); setProblem(''); setPsQuery('');
    // The Steel flow resets with it — same button, same promise: back to step 1.
    setSteelForm(null); setSteelConfirmed(false); setSteelFinishing(false);
    setSteelPicked([]); setSteelDetails({}); setSteelQuery('');
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

  async function saveSteel() {
    if (saving || steelForm == null || steelPicked.length === 0) return;
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
      // Decision 4: remember the member number so the next file opens with this
      // shooter's entries lifted to the top. Only a number the shooter just
      // imported as their own — never one guessed from the field.
      const mem = toWrite.map((w) => w.entry.membership).find((m) => m !== '');
      if (mem) {
        try { await putSettings<AppSettings>({ scsaMemberNumber: mem }); } catch { /* best-effort; the import already saved */ }
      }
      onSaved(firstId);
    } catch {
      setProblem("That match couldn't be saved. Nothing was written — try again.");
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (saving || parsed == null || chosenIdx == null) return;
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

  /** One shooter row. Shared so a suggested row and a row in the full field are
   *  the same button doing the same thing — a suggestion is a position, not a
   *  different kind of control. */
  function shooterRow(i: number, isSuggestion: boolean) {
    const c = parsed!.competitors[i];
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
        </span>
        <span className="value">{c.overallPlace != null ? `#${c.overallPlace}` : ''} ›</span>
      </button>
    );
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onCancel}>‹ Cancel</button>
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
        <div className="card">
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
            const ownSet = new Set(ownNames.map((n) => n.toLowerCase()));
            const isMine = (g: ScsaEntry[]): boolean => {
              const remembered = rememberedNumber.toUpperCase();
              if (remembered && g.some((e) => e.groupKey === remembered)) return true;
              return g.some((e) => ownSet.has(`${e.firstName} ${e.lastName}`.trim().toLowerCase()));
            };
            const fullNameOf = (e: ScsaEntry) => `${e.firstName} ${e.lastName}`.trim();
            const entryRow = (e: ScsaEntry, suggested: boolean) => {
              const picked = steelPicked.includes(e.competitorNumber);
              const sub = [
                e.storedDivision ?? (e.divisionName || e.divisionCode || null),
                steelForm.matches.size > 1 ? (e.matchName || null) : null,
                e.importable ? null : e.blockedReason,
              ].filter(Boolean).join(' · ');
              return (
                <button className="row-tap" key={`${suggested ? 'sug' : 'all'}-${e.competitorNumber}`}
                  aria-pressed={picked}
                  aria-disabled={!e.importable}
                  aria-label={suggested ? `${e.firstName} ${e.lastName} — suggested, this looks like you` : undefined}
                  style={e.importable ? undefined : { opacity: 0.5 }}
                  onClick={() => toggleSteelEntry(e)}>
                  <span className="label">{`${e.firstName} ${e.lastName}`.trim() || '(no name)'}
                    {sub && <div className="row-sub">{sub}</div>}
                  </span>
                  <span className="value">
                    {picked ? '✓ ' : ''}
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
          <button className="button" style={{ marginTop: 10 }} disabled={steelPicked.length === 0}
            onClick={() => setSteelFinishing(true)}>
            {steelPicked.length <= 1 ? 'Continue' : `Continue with ${steelPicked.length} entries`}
          </button>
          <button className="button secondary" style={{ marginTop: 8 }} onClick={startOver}>Start over</button>
        </div>
      )}

      {/* Steel step C — finish the details and save. Every field is visible and
          editable before anything is written; nothing is saved until the button. */}
      {steelForm && steelConfirmed && steelFinishing && (
        <div className="card">
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
          <button className="button" disabled={saving} onClick={() => void saveSteel()}>
            {steelPicked.length <= 1 ? 'Save match' : `Save ${steelPicked.length} matches`}
          </button>
          <button className="button secondary" style={{ marginTop: 8 }} onClick={() => setSteelFinishing(false)}>‹ Back to the shooter list</button>
        </div>
      )}

      {/* Step 1 — paste or load the export */}
      {!parsed && !steelForm && (
        <div className="card">
          <p className="report-note">
            <b>Shot a Steel Challenge match?</b> Load the match's results file with
            the button below, and the app recognises it and walks you through.
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
            <li>Paste it in the box below.</li>
          </ol>
          <p className="report-note">
            Reach the last shooter before you let go. Stop part-way and the field arrives
            short, and your finish then reads out of a smaller number than actually shot
            the match — the places still run 1, 2, 3 with no gap, so nothing here can tell
            it happened. The menus and adverts at the top of the page do no harm; nothing
            is read from them.
          </p>
          <p className="report-note">
            You pick your own row next. If you have a results file — a Steel Challenge
            download file, or a .csv or .txt someone sent you — load it with the button
            below. To see how it all works first, tap "Try the sample".
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
            <button className="button secondary" style={{ marginTop: 8 }} onClick={() => setChosenIdx(null)}>‹ Pick a different shooter</button>
          </div>
        </>
      )}
    </div>
  );
}
