// Import a match from PractiScore (spec §7.3, M8). Three steps on one screen:
//   1) paste or load the exported results (or try the built-in sample),
//   2) tap which competitor is you,
//   3) preview the Match, pick the gun you shot, and confirm.
// Nothing is written until the final "Save match" — it creates one ordinary
// Match record (editable/deletable like any other). The parser is pure + tested
// in src/lib/practiscore.ts; this file is just the screen around it.
import { useEffect, useRef, useState } from 'react';
import type { Firearm } from '../lib/types.ts';
import { getAll, putOne } from '../lib/db.ts';
import { stampNew } from '../lib/stamps.ts';
import { newId } from '../lib/id.ts';
import { todayKey } from '../lib/dates.ts';
import { MATCH_TYPES } from '../lib/competition.ts';
import {
  parsePractiScore, countInDivision, SAMPLE_PRACTISCORE_CSV, type PsMatch
} from '../lib/practiscore.ts';
import { FormProblem } from './FormProblem.tsx';
import { ListSearch, matchesQuery } from './ListSearch.tsx';
import { noAutofillProps } from './SuggestField.tsx';

const toNum = (t: string): number | null => (t.trim() === '' ? null : Number(t));

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
  const [firearmId, setFirearmId] = useState('');
  const [entryFee, setEntryFee] = useState('');
  const [saving, setSaving] = useState(false);
  const [psQuery, setPsQuery] = useState(''); // audit #18 — find yourself in a big field
  const fileRef = useRef<HTMLInputElement>(null); // audit #19 — styled file picker

  useEffect(() => { void (async () => setFirearms(await getAll<Firearm>('firearms')))(); }, []);

  function readResults() {
    setProblem('');
    try {
      const m = parsePractiScore(text);
      setParsed(m);
      setChosenIdx(null);
      setMatchName(m.name);
      setMatchDate(m.date || todayKey());
    } catch (e) {
      setParsed(null);
      setProblem(e instanceof Error ? e.message : 'Could not read that.');
    }
  }

  function startOver() {
    setParsed(null); setChosenIdx(null); setProblem('');
  }

  async function save() {
    if (saving || parsed == null || chosenIdx == null) return;
    if (!matchDate) { setProblem('Pick the match date.'); return; }
    if (!firearmId) { setProblem('Pick which gun you shot.'); return; }
    const me = parsed.competitors[chosenIdx];
    setSaving(true);
    try {
      const mid = newId('mt');
      const fields = {
        date: matchDate,
        name: matchName.trim() || 'PractiScore Match',
        matchType,
        division: me.division,
        powerFactor: me.powerFactor || 'Minor',
        firearmId,
        totalRounds: null,
        matchPercent: me.matchPercent,
        divisionPlace: me.divisionPlace,
        divisionOf: countInDivision(parsed.competitors, me.division) || null,
        overallPlace: me.overallPlace,
        overallOf: parsed.competitors.length,
        stages: me.stages.map((s) => ({ number: s.number, points: null, time: null, percent: s.percent, notes: '' })),
        entryFee: toNum(entryFee),
        practiScoreUrl: '',
        notes: me.memberNumber ? `Imported from PractiScore (USPSA# ${me.memberNumber}).` : 'Imported from PractiScore.',
        legacy: { source: 'practiscore', memberNumber: me.memberNumber, classLetter: me.classLetter, matchPoints: me.matchPoints },
      };
      await putOne('matches', stampNew(fields, mid, Date.now()));
      onSaved(mid);
    } finally {
      setSaving(false);
    }
  }

  const me = parsed != null && chosenIdx != null ? parsed.competitors[chosenIdx] : null;

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
            Open your match on PractiScore, export or copy the results, and paste them below.
            One file holds the whole match — you'll pick your own row next. No real export handy?
            Tap "Try the sample" to see how it works.
          </p>
          <label className="field">Results text
            <textarea rows={8} value={text} placeholder="Paste PractiScore results here…"
              onChange={(e) => setText(e.target.value)} />
          </label>
          <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then((t) => { setText(t); setProblem(''); }); e.target.value = ''; }} />
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
          {parsed.competitors.map((c, i) =>
            matchesQuery(psQuery, c.name) ? (
              <button className="row-tap" key={i} onClick={() => setChosenIdx(i)}>
                <span className="label">{c.name || '(no name)'}
                  <div className="row-sub">
                    {[c.division, c.classLetter && `Class ${c.classLetter}`, c.matchPercent != null ? `${c.matchPercent.toFixed(2)}%` : null]
                      .filter(Boolean).join(' · ')}
                  </div>
                </span>
                <span className="value">{c.overallPlace != null ? `#${c.overallPlace}` : ''} ›</span>
              </button>
            ) : null
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
            <label className="field">What to call it
              <input value={matchName} onChange={(e) => setMatchName(e.target.value)} placeholder="Spring Classic"
                {...noAutofillProps} name="match-title" />
            </label>
            <label className="field">Date
              <input type="date" value={matchDate} onChange={(e) => setMatchDate(e.target.value)} />
            </label>
            <label className="field">Type
              <select value={matchType} onChange={(e) => setMatchType(e.target.value)}>
                {MATCH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
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
