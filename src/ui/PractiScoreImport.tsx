// Import a match from PractiScore (spec §7.3, M8). Three steps on one screen:
//   1) paste or load the exported results (or try the built-in sample),
//   2) tap which competitor is you,
//   3) preview the Match, pick the gun you shot, and confirm.
// Nothing is written until the final "Save match" — it creates one ordinary
// Match record (editable/deletable like any other). The parser is pure + tested
// in src/lib/practiscore.ts; this file is just the screen around it.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, Firearm } from '../lib/types.ts';
import { getAll, getSettings, putOne } from '../lib/db.ts';
import { stampNew } from '../lib/stamps.ts';
import { newId } from '../lib/id.ts';
import { todayKey } from '../lib/dates.ts';
import { MATCH_TYPES, DIVISIONS, POWER_FACTORS } from '../lib/competition.ts';
import { fieldOptions } from '../lib/selectOptions.ts';
import { findOwnRows, normaliseStoredNames, type NameMatch } from '../lib/shooterMatch.ts';
import {
  parsePractiScore, countInDivision, SAMPLE_PRACTISCORE_CSV, type PsMatch
} from '../lib/practiscore.ts';
import { FormProblem } from './FormProblem.tsx';
import { ListSearch, matchesQuery } from './ListSearch.tsx';
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
  const [saving, setSaving] = useState(false);
  const [psQuery, setPsQuery] = useState(''); // audit #18 — find yourself in a big field
  // The names the shooter told us are theirs (Settings -> Who you are). Used
  // ONLY to lift their own rows to the top of the field; nothing is selected on
  // their behalf, because a household can put two shooters in one match.
  const [ownNames, setOwnNames] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null); // audit #19 — styled file picker

  useEffect(() => {
    let alive = true;
    void (async () => {
      const st = await getSettings<AppSettings>();
      // ownerName is deliberately not read — see its note in AppSettings.
      if (alive) setOwnNames(normaliseStoredNames(st?.shooterNames));
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => { void (async () => setFirearms(await getAll<Firearm>('firearms')))(); }, []);

  function readResults() {
    setProblem('');
    // S-2: cap the pasted text before the parser walks it (guard at the boundary).
    const tooLong = textTooLongMessage(text.length);
    if (tooLong) { setProblem(tooLong); return; }
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
      setProblem(e instanceof Error ? e.message : 'Could not read that.');
    }
    setPsQuery(''); // a query from a previous field must not filter this one
  }

  function startOver() {
    // psQuery goes with it. A query left over from the previous paste survived
    // into the next one, where it filtered a shorter field down to nothing AND
    // switched off the suggestions — with the search box itself hidden, because
    // it only appears above eight shooters. An empty card with no way forward.
    setParsed(null); setChosenIdx(null); setProblem(''); setPsQuery('');
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
    const divisionEdited = division !== me.division;
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
        divisionPlace: divisionEdited ? null : me.divisionPlace,
        // A blank division is not a division: counting everyone whose Div cell
        // was empty produced "N in your division" on a match that recorded none.
        divisionOf: divisionEdited || me.division === '' ? null : (countInDivision(parsed.competitors, me.division) || null),
        overallPlace: me.overallPlace,
        overallOf: parsed.competitors.length,
        stages: me.stages.map((s) => ({ number: s.number, points: null, time: null, percent: s.percent, notes: '' })),
        // looseNum, not bare Number(): a typo like "35a" must store null, never
        // NaN — stored NaN poisons cost math and any future aggregate (L-7).
        entryFee: looseNum(entryFee),
        practiScoreUrl: '',
        notes: me.memberNumber ? `Imported from PractiScore (USPSA# ${me.memberNumber}).` : 'Imported from PractiScore.',
        legacy: { source: 'practiscore', memberNumber: me.memberNumber, classLetter: me.classLetter, matchPoints: me.matchPoints },
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
        // sitting in the form.
        setDivision(c.division);
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

      {/* Step 1 — paste or load the export */}
      {!parsed && (
        <div className="card">
          <p className="report-note">
            PractiScore has no download button. Copying the results page is the only
            way to get your scores out, so here is the whole path:
          </p>
          <ol className="report-note" style={{ paddingLeft: 20, margin: '6px 0 12px' }}>
            <li>Open your match on practiscore.com.</li>
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
            You pick your own row next. If someone has sent you a results file instead,
            load it here: .csv or .txt. To see how it all works first, tap "Try the sample".
          </p>
          <label className="field">Results text
            <textarea rows={8} value={text} placeholder="Paste PractiScore results here…"
              onChange={(e) => setText(e.target.value)} />
          </label>
          <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                const tooBig = fileTooLargeMessage(f.size, MAX_IMPORT_FILE_BYTES, 'file');
                if (tooBig) setProblem(tooBig);
                else void f.text().then((t) => { setText(t); setProblem(''); }).catch(() => setProblem('That file could not be read. Try loading it again.'));
              }
              e.target.value = '';
            }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="button" style={{ flex: 1 }} disabled={!text.trim()} onClick={readResults}>Read results</button>
            <button className="button secondary" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>Load a file (.csv, .txt)</button>
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
              <h3 className="report-note" style={{ marginTop: 10, marginBottom: 2, fontWeight: 600 }}>
                {suggested.length === 1 ? 'This looks like you' : 'These look like you'}
              </h3>
              {suggested.map((m) => shooterRow(m.index, true))}
              <h3 className="report-note" style={{ marginTop: 8, marginBottom: 2 }}>
                Everyone who shot the match
              </h3>
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
              {division !== me.division && (
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
