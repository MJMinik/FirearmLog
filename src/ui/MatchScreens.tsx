// Match logging (spec §11): the full match record with stage-by-stage entry,
// auto hit factors, stage videos, entry fee, and PractiScore link.
import { useEffect, useMemo, useState } from 'react';
import type { Firearm, Match, MatchStage, Media } from '../lib/types.ts';
import { deleteOne, getAll, getOne, putOne } from '../lib/db.ts';
import { formatDayKey, todayKey } from '../lib/dates.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { DIVISIONS, MATCH_TYPES, POWER_FACTORS, hitFactor, analyzeMatch, scoreStageHits, hasHitBreakdown,
  scoringTypeFor, scoreSteelStage, steelMatchTotal, steelStringsExpected, STEEL_STAGES } from '../lib/competition.ts';
import { MarkThumb } from './MarkThumb.tsx';
import { InfoTip } from './InfoTip.tsx';
import type { View } from './nav.ts';
import { ConfirmSheet } from './Sheet.tsx';
import { PhotoSheet } from './PhotoSheet.tsx';
import { MediaField, commitMedia } from './MediaField.tsx';
import type { StagedFile } from './MediaField.tsx';
import { noAutofillProps } from './SuggestField.tsx';
import { FormProblem } from './FormProblem.tsx';
import { pickableGuns } from '../lib/gunStatus.ts';

/** Format a stage's ranking metric for the debrief read-out. */
function fmtMetric(s: { percent: number | null; hitFactor: number | null }, by: 'percent' | 'hitFactor' | 'none'): string {
  if (by === 'percent' && s.percent !== null) return `${s.percent}%`;
  if (by === 'hitFactor' && s.hitFactor !== null) return `HF ${s.hitFactor}`;
  return '—';
}

export function MatchDetail({ id, onEdit, onBack, onDeleted, refreshKey, open }: {
  id: string; onEdit: () => void; onBack: () => void; onDeleted: () => void; refreshKey: number;
  open: (v: View) => void;
}) {
  const [match, setMatch] = useState<Match | null>(null);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [videos, setVideos] = useState<Media[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [viewing, setViewing] = useState<Media | null>(null);
  const [localBump, setLocalBump] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [m, f, media] = await Promise.all([
        getOne<Match>('matches', id), getAll<Firearm>('firearms'), getAll<Media>('media')
      ]);
      if (!alive || !m) return;
      setMatch(m);
      setFirearms(f);
      setVideos(media.filter((x) => x.ownerType === 'match' && x.ownerId === id));
    })();
    return () => { alive = false; };
  }, [id, refreshKey, localBump]);

  if (!match) return <div className="screen" />;
  const gunName = firearms.find((f) => f.id === match.firearmId)?.name ?? '—';
  const isSteel = match.scoringType === 'steel';
  const insights = analyzeMatch(match.stages, match.powerFactor);
  const steelRows = isSteel ? match.stages.map((st) => ({ st, score: scoreSteelStage(st) })) : [];
  const steelTotal = isSteel ? steelMatchTotal(match.stages) : null;

  async function reallyDelete() {
    for (const v of videos) await deleteOne('media', v.id);
    await deleteOne('matches', id);
    onDeleted();
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
        <button className="navbar-action" onClick={onEdit}>Edit</button>
      </div>
      <h1 className="large-title">{match.name || formatDayKey(match.date)}</h1>

      {(match.matchPercent != null || match.divisionPlace != null) && (
        <div className="card">
          <div className="stat-grid">
            {match.divisionPlace != null && (
              <div className="stat">
                <div className="num">{match.divisionPlace}{match.divisionOf != null ? ` of ${match.divisionOf}` : ''}</div>
                <div className="cap">{match.division || 'Division'} finish</div>
              </div>
            )}
            {match.matchPercent != null && (
              <div className="stat">
                <div className="num" style={{ color: 'var(--accent)' }}>{match.matchPercent}%</div>
                <div className="cap">Match percent</div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <h2>Match</h2>
        <div className="row"><span className="label">Date</span><span className="value">{formatDayKey(match.date)}</span></div>
        <div className="row"><span className="label">Type</span><span className="value">{match.matchType}</span></div>
        <div className="row"><span className="label">Division</span><span className="value">{match.division}{match.powerFactor ? ` · ${match.powerFactor}` : ''}</span></div>
        <div className="row"><span className="label">Gun</span><span className="value">{gunName}</span></div>
        {match.totalRounds != null && <div className="row"><span className="label">Rounds fired</span><span className="value">{match.totalRounds.toLocaleString()}</span></div>}
        {match.matchPercent != null && <div className="row"><span className="label">Match percent</span><span className="value">{match.matchPercent}%</span></div>}
        {match.divisionPlace != null && (
          <div className="row"><span className="label">Division finish</span>
            <span className="value">{match.divisionPlace}{match.divisionOf ? ` of ${match.divisionOf}` : ''}</span></div>
        )}
        {match.overallPlace != null && (
          <div className="row"><span className="label">Overall finish</span>
            <span className="value">{match.overallPlace}{match.overallOf ? ` of ${match.overallOf}` : ''}</span></div>
        )}
        {match.entryFee != null && <div className="row"><span className="label">Entry fee</span><span className="value">${match.entryFee.toFixed(2)}</span></div>}
        {match.practiScoreUrl && (
          <a className="row-tap" href={match.practiScoreUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            <span className="label" style={{ color: 'var(--accent)' }}>Results on PractiScore</span>
            <span className="value">↗</span>
          </a>
        )}
      </div>

      {match.stages.length > 0 && !isSteel && (
        <div className="card">
          <h2>Stage breakdown <InfoTip title="Stage breakdown">Hit factor is your points divided by your time (higher is better). Stage percent is your score against the stage winner. We flag your toughest stage — where you lost the most ground — and your strongest. Add a stage's A/C/D/miss breakdown (when you log or edit the match) and we'll show what it would have scored with all alphas, plus your % of available points.</InfoTip></h2>
          <button className="link-btn" style={{ marginTop: -2, marginBottom: 8 }} onClick={() => open({ kind: 'numbers' })}>How the numbers work ›</button>
          {insights.rankedBy !== 'none' && insights.strongest && insights.toughest.length > 0 && (
            <p className="report-note" style={{ marginTop: 0, marginBottom: 10 }}>
              Toughest: {insights.toughest.map((s) => `Stage ${s.number} (${fmtMetric(s, insights.rankedBy)})`).join(', ')}.{' '}
              Strongest: Stage {insights.strongest.number} ({fmtMetric(insights.strongest, insights.rankedBy)}).
            </p>
          )}
          {insights.stages.map((st, i) => (
            <div className="row" key={i}>
              <span className="label">
                Stage {st.number}
                {st.isToughest && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>Toughest</span>}
                {st.isStrongest && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>Strongest</span>}
                {st.notes && <div className="row-sub">{st.notes}</div>}
                {st.score && (
                  <div className="row-sub">
                    A {st.score.alphas} · C {st.score.charlies} · D {st.score.deltas} · M {st.score.misses}
                    {(st.score.noShoots > 0 || st.score.procedurals > 0) ? ` · NS ${st.score.noShoots} · P ${st.score.procedurals}` : ''}
                    {st.score.allAlphaDelta != null && st.score.allAlphaDelta > 0 ? ` — all A's ${st.score.allAlphaHitFactor} (+${st.score.allAlphaDelta})` : ''}
                    {st.score.pctAvailable != null ? ` — ${Math.round(st.score.pctAvailable * 100)}% of points` : ''}
                  </div>
                )}
              </span>
              <span className="value">
                {[(st.score ? st.score.stagePoints : st.points) !== null ? `${st.score ? st.score.stagePoints : st.points} pts` : null,
                  st.time !== null ? `${st.time}s` : null,
                  st.hitFactor !== null ? `HF ${st.hitFactor}` : null,
                  st.percent !== null ? `${st.percent}%` : null].filter(Boolean).join(' · ') || '—'}
              </span>
            </div>
          ))}
        </div>
      )}

      {match.stages.length > 0 && isSteel && (
        <div className="card">
          <h2>Stage times <InfoTip title="Steel Challenge scoring">Steel is scored on time — lowest wins. Each string is your raw time plus 3 seconds for every missed plate, capped at 30 seconds (a string whose stop plate you never hit scores the full 30). A stage keeps your best 4 of 5 strings — the single slowest is dropped — except Outer Limits, which is 4 strings with none dropped. Your match total is the sum of your stage times. Full details in "How the numbers work."</InfoTip></h2>
          <button className="link-btn" style={{ marginTop: -2, marginBottom: 8 }} onClick={() => open({ kind: 'numbers' })}>How the numbers work ›</button>
          {steelTotal != null && (
            <div className="row">
              <span className="label"><strong>Match total</strong><span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>lowest wins</span></span>
              <span className="value" style={{ color: 'var(--accent)' }}><strong>{steelTotal}s</strong></span>
            </div>
          )}
          {steelRows.map(({ st, score }, i) => (
            <div className="row" key={i}>
              <span className="label">
                Stage {st.number}{st.steelStage ? ` — ${st.steelStage}` : ''}
                {st.notes && <div className="row-sub">{st.notes}</div>}
                {score.stageTime != null && score.droppedIndex != null && (
                  <div className="row-sub">Dropped the slowest string (String {score.droppedIndex + 1})</div>
                )}
                {score.strings.some((s) => s.capped !== null) && (
                  <div className="row-sub">
                    {score.strings.map((s, n) => s.capped === null ? null :
                      `S${n + 1} ${s.stopMissed ? '30.00 (stop plate missed)' : (s.capped as number).toFixed(2) + (s.misses > 0 ? ` (+${s.misses} miss)` : '')}`
                    ).filter(Boolean).join(' · ')}
                  </div>
                )}
              </span>
              <span className="value">{score.stageTime != null ? `${score.stageTime}s` : '—'}</span>
            </div>
          ))}
        </div>
      )}

      {videos.length > 0 && (
        <div className="card">
          <h2>Stage Videos &amp; Photos</h2>
          <p className="report-note" style={{ marginBottom: 8 }}>Tap one to name it, jot notes, or remove it.</p>
          <div className="photo-grid">
            {videos.map((m) => (
              <div className="thumb-wrap" key={m.id}>
                <button className="thumb-tap" onClick={() => setViewing(m)} aria-label={m.name}>
                  <MarkThumb media={m} />
                </button>
                <span className="thumb-caption">{m.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {match.notes && (
        <div className="card">
          <h2>Notes</h2>
          <p className="note-text">{match.notes}</p>
        </div>
      )}

      <button className="button danger" onClick={() => setConfirming(true)}>Delete Match</button>

      {confirming && (
        <ConfirmSheet title="Delete this match?"
          message="The match, its stages, and its videos all go. There's no undo."
          confirmLabel="Delete Match"
          onConfirm={() => void reallyDelete()}
          onClose={() => setConfirming(false)} />
      )}
      {viewing && (
        <PhotoSheet media={viewing} onClose={() => setViewing(null)}
          onChanged={() => setLocalBump((b) => b + 1)} />
      )}
    </div>
  );
}

interface StageRow {
  points: string; time: string; percent: string; notes: string;
  showBreak: boolean;
  alphas: string; charlies: string; deltas: string;
  misses: string; noShoots: string; procedurals: string;
  // Steel Challenge input (used only when the match's scoring type is 'steel').
  // Arrays are always length STEEL_STRINGS_MAX; only the first `expected` (4 or 5)
  // are rendered and saved, so switching to/from Outer Limits never loses entries.
  steelStage: string;
  strings: string[];
  stringMisses: string[];
  stringStopMissed: boolean[];
  stringShowPenalty: boolean[]; // per-string reveal for the miss / stop-plate fields
}

/** The six hit-breakdown keys, with their on-screen labels. */
const BREAK_FIELDS = [
  ['alphas', 'Alphas (A)'], ['charlies', 'Charlies (C)'], ['deltas', 'Deltas (D)'],
  ['misses', 'Misses (M)'], ['noShoots', 'No-shoots'], ['procedurals', 'Procedurals'],
] as const;

const STEEL_STRINGS_MAX = 5;

/** Grow/trim an array to exactly `len`, filling new slots with `fill`. */
function padArr<T>(arr: T[], len: number, fill: T): T[] {
  const out = arr.slice(0, len);
  while (out.length < len) out.push(fill);
  return out;
}

/** A blank stage row carrying both USPSA and Steel input fields. */
function emptyStageRow(): StageRow {
  return {
    points: '', time: '', percent: '', notes: '', showBreak: false,
    alphas: '', charlies: '', deltas: '', misses: '', noShoots: '', procedurals: '',
    steelStage: '',
    strings: Array(STEEL_STRINGS_MAX).fill(''),
    stringMisses: Array(STEEL_STRINGS_MAX).fill(''),
    stringStopMissed: Array(STEEL_STRINGS_MAX).fill(false),
    stringShowPenalty: Array(STEEL_STRINGS_MAX).fill(false),
  };
}

export function MatchForm({ id, onSaved, onCancel }: {
  id?: string; onSaved: (matchId: string) => void; onCancel: () => void;
}) {
  const editing = id !== undefined;
  const [original, setOriginal] = useState<Match | null>(null);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [name, setName] = useState('');
  const [date, setDate] = useState(todayKey());
  const [matchType, setMatchType] = useState(MATCH_TYPES[0]);
  const [division, setDivision] = useState('Carry Optics');
  const [powerFactor, setPowerFactor] = useState('Minor');
  const [firearmId, setFirearmId] = useState('');
  const [totalRounds, setTotalRounds] = useState('');
  const [matchPercent, setMatchPercent] = useState('');
  const [divPlace, setDivPlace] = useState('');
  const [divOf, setDivOf] = useState('');
  const [overallPlace, setOverallPlace] = useState('');
  const [overallOf, setOverallOf] = useState('');
  const [stages, setStages] = useState<StageRow[]>([]);
  const [existingMedia, setExistingMedia] = useState<Media[]>([]);
  const [removedMedia, setRemovedMedia] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<StagedFile[]>([]);
  const [entryFee, setEntryFee] = useState('');
  const [psUrl, setPsUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      const f = await getAll<Firearm>('firearms');
      if (!alive) return;
      const sorted = f.sort((a, b) => a.name.localeCompare(b.name));
      setFirearms(sorted);
      const firstPick = pickableGuns(sorted);
      if (!editing && firstPick.length > 0) setFirearmId(firstPick[0].id);
      if (id !== undefined) {
        const [m, allMedia] = await Promise.all([getOne<Match>('matches', id), getAll<Media>('media')]);
        if (!alive || !m) return;
        setOriginal(m);
        setName(m.name); setDate(m.date); setMatchType(m.matchType);
        setDivision(m.division); setPowerFactor(m.powerFactor || 'Minor');
        setFirearmId(m.firearmId);
        setTotalRounds(m.totalRounds == null ? '' : String(m.totalRounds));
        setMatchPercent(m.matchPercent == null ? '' : String(m.matchPercent));
        setDivPlace(m.divisionPlace == null ? '' : String(m.divisionPlace));
        setDivOf(m.divisionOf == null ? '' : String(m.divisionOf));
        setOverallPlace(m.overallPlace == null ? '' : String(m.overallPlace));
        setOverallOf(m.overallOf == null ? '' : String(m.overallOf));
        setStages(m.stages.map((st) => {
          const strings = padArr((st.strings ?? []).map((v) => v == null ? '' : String(v)), STEEL_STRINGS_MAX, '');
          const stringMisses = padArr((st.stringMisses ?? []).map((v) => v == null ? '' : String(v)), STEEL_STRINGS_MAX, '');
          const stringStopMissed = padArr((st.stringStopMissed ?? []).slice(), STEEL_STRINGS_MAX, false);
          return {
            ...emptyStageRow(),
            points: st.points == null ? '' : String(st.points),
            time: st.time == null ? '' : String(st.time),
            percent: st.percent == null ? '' : String(st.percent),
            notes: st.notes,
            showBreak: hasHitBreakdown(st),
            alphas: st.alphas == null ? '' : String(st.alphas),
            charlies: st.charlies == null ? '' : String(st.charlies),
            deltas: st.deltas == null ? '' : String(st.deltas),
            misses: st.misses == null ? '' : String(st.misses),
            noShoots: st.noShoots == null ? '' : String(st.noShoots),
            procedurals: st.procedurals == null ? '' : String(st.procedurals),
            steelStage: st.steelStage ?? '',
            strings, stringMisses, stringStopMissed,
            stringShowPenalty: stringStopMissed.map((stop, n) => stop || (stringMisses[n] !== '' && Number(stringMisses[n]) > 0)),
          };
        }));
        setExistingMedia(allMedia.filter((x) => x.ownerType === 'match' && x.ownerId === id));
        setEntryFee(m.entryFee == null ? '' : String(m.entryFee));
        setPsUrl(m.practiScoreUrl); setNotes(m.notes);
      }
    })();
    return () => { alive = false; };
  }, [editing, id]);

  const num = (t: string): number | null => t.trim() === '' ? null : Number(t);
  const scoringType = scoringTypeFor(matchType);

  const stageObjs: MatchStage[] = useMemo(() => stages.map((st, i) => {
    if (scoringType === 'steel') {
      // Steel: source of truth is the raw strings; points/HF don't apply. Only the
      // first `expected` strings count (4 on Outer Limits, 5 elsewhere) so a stage
      // switched to Outer Limits never carries a phantom 5th string into scoring.
      const expected = steelStringsExpected(st.steelStage);
      return {
        number: i + 1,
        points: null, time: null, percent: null, notes: st.notes.trim(),
        steelStage: st.steelStage || '',
        strings: st.strings.slice(0, expected).map(num),
        stringMisses: st.stringMisses.slice(0, expected).map(num),
        stringStopMissed: st.stringStopMissed.slice(0, expected),
      };
    }
    const hb = {
      alphas: num(st.alphas), charlies: num(st.charlies), deltas: num(st.deltas),
      misses: num(st.misses), noShoots: num(st.noShoots), procedurals: num(st.procedurals),
    };
    // When a breakdown is entered, the stage's points are DERIVED from the hits
    // (and the field is read-only), so points can never disagree with the hits.
    const sc = scoreStageHits(hb, powerFactor, num(st.time));
    return {
      number: i + 1,
      points: sc ? sc.stagePoints : num(st.points),
      time: num(st.time), percent: num(st.percent), notes: st.notes.trim(),
      ...hb,
    };
  }), [stages, powerFactor, scoringType]);

  const steelTotal = useMemo(
    () => scoringType === 'steel' ? steelMatchTotal(stageObjs) : null,
    [stageObjs, scoringType]);


  async function save() {
    if (saving) return;
    if (!date) { setProblem('Pick a date.'); return; }
    if (!firearmId) { setProblem('Pick a gun.'); return; }
    const numbers = [num(totalRounds), num(matchPercent), num(divPlace), num(divOf),
      num(overallPlace), num(overallOf), num(entryFee),
      ...stageObjs.flatMap((st) => [st.points, st.time, st.percent,
        st.alphas ?? null, st.charlies ?? null, st.deltas ?? null,
        st.misses ?? null, st.noShoots ?? null, st.procedurals ?? null])];
    if (numbers.some((n) => n !== null && !Number.isFinite(n))) {
      setProblem('One of the numbers isn’t a plain number.'); return;
    }
    setSaving(true);
    try {
      const mid = original ? original.id : newId('mt');
      const now = Date.now();
      const fields = {
        date, name: name.trim(), matchType, division, powerFactor, firearmId, scoringType,
        totalRounds: num(totalRounds), matchPercent: num(matchPercent),
        divisionPlace: num(divPlace), divisionOf: num(divOf),
        overallPlace: num(overallPlace), overallOf: num(overallOf),
        stages: stageObjs, entryFee: num(entryFee),
        practiScoreUrl: psUrl.trim(), notes: notes.trim()
      };
      if (original) {
        await putOne('matches', stampUpdate({ ...original, ...fields }, now));
      } else {
        await putOne('matches', stampNew(fields, mid, now));
      }
      await commitMedia('match', mid, newFiles, removedMedia, existingMedia.length);
      onSaved(mid);
    } finally {
      setSaving(false);
    }
  }


  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onCancel}>‹ Cancel</button>
        <button className="navbar-action" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <h1 className="large-title">{editing ? 'Edit Match' : 'Log Match'}</h1>
      <FormProblem problem={problem} />

      <div className="card">
        <label className="field">What this Match is called
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="June Club Match"
            {...noAutofillProps} name="match-title" />
        </label>
        <label className="field">Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">Match type
          <select value={matchType} onChange={(e) => setMatchType(e.target.value)}>
            {MATCH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="field">Division
          <select value={division} onChange={(e) => setDivision(e.target.value)}>
            {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        {scoringType !== 'steel' && (
          <>
            <h2>Power Factor</h2>
            <div className="seg" role="radiogroup" aria-label="Power factor">
              {POWER_FACTORS.map((pf) => (
                <button key={pf} role="radio" aria-checked={powerFactor === pf}
                  className={powerFactor === pf ? 'on' : ''} onClick={() => setPowerFactor(pf)}>{pf}</button>
              ))}
            </div>
          </>
        )}
        <label className="field">Gun
          <select value={firearmId} onChange={(e) => setFirearmId(e.target.value)}>
            {pickableGuns(firearms, [firearmId]).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <label className="field">Rounds fired (adds to the gun's round count)
          <input type="number" inputMode="numeric" min="0" value={totalRounds} onChange={(e) => setTotalRounds(e.target.value)} />
        </label>
      </div>

      <div className="card">
        <h2>Results</h2>
        <label className="field">Match percent
          <input type="number" inputMode="decimal" value={matchPercent} onChange={(e) => setMatchPercent(e.target.value)} />
        </label>
        <div className="drill-edit-fields">
          <label className="field small">Division place
            <input type="number" inputMode="numeric" value={divPlace} onChange={(e) => setDivPlace(e.target.value)} />
          </label>
          <label className="field small">of
            <input type="number" inputMode="numeric" value={divOf} onChange={(e) => setDivOf(e.target.value)} />
          </label>
        </div>
        <div className="drill-edit-fields">
          <label className="field small">Overall place
            <input type="number" inputMode="numeric" value={overallPlace} onChange={(e) => setOverallPlace(e.target.value)} />
          </label>
          <label className="field small">of
            <input type="number" inputMode="numeric" value={overallOf} onChange={(e) => setOverallOf(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="card">
        <h2>{scoringType === 'steel' ? 'Stages & strings' : 'Stages'} <InfoTip title="How the numbers work">{scoringType === 'steel'
          ? <>Steel is scored on time — lowest wins. Enter each string's raw time; if a plate was missed or the stop plate was never hit, tap "+ miss / penalty" on that string. Each miss adds 3 seconds, a string is capped at 30 seconds, and a missed stop plate scores the full 30. A stage keeps your best 4 of 5 strings (the slowest is dropped) — except Outer Limits, which is 4 strings with none dropped. Full math and sources are in "How the numbers work."</>
          : <>Hit factor = points / time. Add a stage's A/C/D/miss breakdown and the points are computed from your hits — A is 5; C is 4 major / 3 minor; D is 2 major / 1 minor — minus 10 for each miss, no-shoot, and procedural, and never below zero (the Points field then becomes read-only). The full math and sources are in "How the numbers work," under More or from a saved match's debrief.</>}</InfoTip></h2>
        {scoringType === 'steel' ? stages.map((st, i) => {
          const expected = steelStringsExpected(st.steelStage);
          const ss = scoreSteelStage({
            steelStage: st.steelStage,
            strings: st.strings.slice(0, expected).map(num),
            stringMisses: st.stringMisses.slice(0, expected).map(num),
            stringStopMissed: st.stringStopMissed.slice(0, expected),
          });
          return (
            <div className="drill-edit" key={i}>
              <div className="drill-edit-head">
                <strong>Stage {i + 1}{ss.stageTime !== null ? ` — ${ss.stageTime}s` : ''}</strong>
                <button className="icon-btn" aria-label={`Remove stage ${i + 1}`}
                  onClick={() => setStages((p) => p.filter((_, x) => x !== i))}>✕</button>
              </div>
              <label className="field">Which Steel stage
                <select value={st.steelStage}
                  onChange={(e) => setStages((p) => p.map((x, n) => n === i ? { ...x, steelStage: e.target.value } : x))}>
                  <option value="">Generic (5 strings)</option>
                  {STEEL_STAGES.map((s) => <option key={s.name} value={s.name}>{s.name}{s.strings === 4 ? ' (4 strings)' : ''}</option>)}
                </select>
              </label>
              {Array.from({ length: expected }).map((_, n) => (
                <div key={n}>
                  <div className="drill-edit-fields">
                    <label className="field small">String {n + 1} time (s)
                      <input type="number" inputMode="decimal" value={st.strings[n] ?? ''}
                        onChange={(e) => setStages((p) => p.map((x, m) => m === i ? { ...x, strings: x.strings.map((v, k) => k === n ? e.target.value : v) } : x))} />
                    </label>
                  </div>
                  {!st.stringShowPenalty[n] && (
                    <button type="button" className="link-btn" style={{ marginTop: 2 }}
                      onClick={() => setStages((p) => p.map((x, m) => m === i ? { ...x, stringShowPenalty: x.stringShowPenalty.map((v, k) => k === n ? true : v) } : x))}>
                      + miss / penalty
                    </button>
                  )}
                  {st.stringShowPenalty[n] && (
                    <div className="drill-edit-fields break-fields">
                      <label className="field small">Plates missed
                        <input type="number" inputMode="numeric" min="0" value={st.stringMisses[n] ?? ''}
                          onChange={(e) => setStages((p) => p.map((x, m) => m === i ? { ...x, stringMisses: x.stringMisses.map((v, k) => k === n ? e.target.value : v) } : x))} />
                      </label>
                      <label className="field small" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <input type="checkbox" checked={st.stringStopMissed[n] ?? false} style={{ width: 18, height: 18 }}
                          onChange={(e) => setStages((p) => p.map((x, m) => m === i ? { ...x, stringStopMissed: x.stringStopMissed.map((v, k) => k === n ? e.target.checked : v) } : x))} />
                        Stop plate missed
                      </label>
                    </div>
                  )}
                </div>
              ))}
              {ss.stageTime !== null && (
                <p className="report-note" style={{ marginTop: 2 }}>
                  Stage time <InfoTip title="How this is derived">Each string = raw time + 3 seconds per missed plate, capped at 30s (a missed stop plate scores the full 30). The stage keeps the best 4 of 5 strings — the slowest is dropped — except Outer Limits (4 strings, none dropped). Lowest total wins.</InfoTip>: {ss.stageTime}s{ss.droppedIndex !== null ? ` · dropped String ${ss.droppedIndex + 1}` : ''}
                </p>
              )}
              <label className="field">Stage notes
                <input value={st.notes}
                  onChange={(e) => setStages((p) => p.map((x, n) => n === i ? { ...x, notes: e.target.value } : x))} />
              </label>
            </div>
          );
        }) : stages.map((st, i) => {
          const sc = scoreStageHits(
            { alphas: num(st.alphas), charlies: num(st.charlies), deltas: num(st.deltas),
              misses: num(st.misses), noShoots: num(st.noShoots), procedurals: num(st.procedurals) },
            powerFactor, num(st.time));
          const hf = sc ? sc.hitFactor : hitFactor(num(st.points), num(st.time));
          return (
            <div className="drill-edit" key={i}>
              <div className="drill-edit-head">
                <strong>Stage {i + 1}{hf !== null ? ` — HF ${hf}` : ''}</strong>
                <button className="icon-btn" aria-label={`Remove stage ${i + 1}`}
                  onClick={() => setStages((p) => p.filter((_, x) => x !== i))}>✕</button>
              </div>
              <div className="drill-edit-fields">
                <label className="field small">Points{sc ? ' (from hits)' : ''}
                  <input type="number" inputMode="decimal"
                    value={sc ? String(sc.stagePoints) : st.points}
                    readOnly={!!sc} aria-readonly={!!sc}
                    style={sc ? { color: 'var(--text-dim)' } : undefined}
                    onChange={(e) => setStages((p) => p.map((x, n) => n === i ? { ...x, points: e.target.value } : x))} />
                </label>
                <label className="field small">Time (s)
                  <input type="number" inputMode="decimal" value={st.time}
                    onChange={(e) => setStages((p) => p.map((x, n) => n === i ? { ...x, time: e.target.value } : x))} />
                </label>
                <label className="field small">Stage %
                  <input type="number" inputMode="decimal" value={st.percent}
                    onChange={(e) => setStages((p) => p.map((x, n) => n === i ? { ...x, percent: e.target.value } : x))} />
                </label>
              </div>
              {!st.showBreak && (
                <button type="button" className="link-btn" style={{ marginTop: 2 }}
                  onClick={() => setStages((p) => p.map((x, n) => n === i ? { ...x, showBreak: true } : x))}>
                  + Add hit breakdown (A/C/D/miss)
                </button>
              )}
              {st.showBreak && (
                <>
                  <div className="drill-edit-fields break-fields">
                    {BREAK_FIELDS.map(([key, label]) => (
                      <label className="field small" key={key}>{label}
                        <input type="number" inputMode="numeric" min="0" value={st[key]}
                          onChange={(e) => setStages((p) => p.map((x, n) => n === i ? ({ ...x, [key]: e.target.value }) as StageRow : x))} />
                      </label>
                    ))}
                  </div>
                  {sc && (
                    <p className="report-note" style={{ marginTop: 2 }}>
                      Derived <InfoTip title="How this is derived">Hit factor = points / time. Points come from your hits — A is 5; C is 4 major / 3 minor; D is 2 major / 1 minor — minus 10 for each miss, no-shoot, and procedural, and never below zero. "All A's" is what it would be if every hit were an alpha, at the same time. Full math and sources: "How the numbers work" (under More, or from any saved match).</InfoTip>: {sc.stagePoints} pts{sc.hitFactor != null ? ` · HF ${sc.hitFactor}` : ''}
                      {sc.allAlphaDelta != null && sc.allAlphaDelta > 0 ? ` · all A's ${sc.allAlphaHitFactor} (+${sc.allAlphaDelta})` : ''}
                      {sc.pctAvailable != null ? ` · ${Math.round(sc.pctAvailable * 100)}% of points` : ''}
                    </p>
                  )}
                </>
              )}
              <label className="field">Stage notes
                <input value={st.notes}
                  onChange={(e) => setStages((p) => p.map((x, n) => n === i ? { ...x, notes: e.target.value } : x))} />
              </label>
            </div>
          );
        })}
        {scoringType === 'steel' && stages.length > 0 && steelTotal !== null && (
          <p className="report-note" style={{ marginTop: 4 }}>
            Match total: <strong>{steelTotal}s</strong> — lowest wins.
          </p>
        )}
        <button className="button secondary"
          onClick={() => setStages((p) => [...p, emptyStageRow()])}>
          + Add Stage
        </button>
      </div>

      <MediaField heading="Stage Videos & Photos" addLabel="+ Add Videos or Photos"
        ownerType="match" ownerId={original?.id ?? ''}
        existingMedia={existingMedia} setExistingMedia={setExistingMedia}
        removedMedia={removedMedia} setRemovedMedia={setRemovedMedia}
        newFiles={newFiles} setNewFiles={setNewFiles} />

      <div className="card">
        <h2>Wrap-Up</h2>
        <label className="field">Entry fee ($) — feeds your Costs, never double-counted
          <input type="number" inputMode="decimal" min="0" value={entryFee} onChange={(e) => setEntryFee(e.target.value)} />
        </label>
        <label className="field">PractiScore link
          <input value={psUrl} onChange={(e) => setPsUrl(e.target.value)} placeholder="https://practiscore.com/results/…" />
        </label>
        <label className="field">Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>

      <button className="button" disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : editing ? 'Save Changes' : 'Save Match'}
      </button>

    </div>
  );
}
