// Match logging (spec §11): the full match record with stage-by-stage entry,
// auto hit factors, stage videos, entry fee, and PractiScore link.
import { useEffect, useMemo, useState } from 'react';
import type { Firearm, Match, MatchStage, Media } from '../lib/types.ts';
import { deleteOne, getAll, getOne, putOne } from '../lib/db.ts';
import { formatDayKey, todayKey } from '../lib/dates.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { DIVISIONS, MATCH_TYPES, POWER_FACTORS, hitFactor } from '../lib/competition.ts';
import { MarkThumb } from './MarkThumb.tsx';
import { ConfirmSheet } from './Sheet.tsx';
import { PhotoSheet } from './PhotoSheet.tsx';
import { MediaField, commitMedia } from './MediaField.tsx';
import type { StagedFile } from './MediaField.tsx';
import { noAutofillProps } from './SuggestField.tsx';
import { FormProblem } from './FormProblem.tsx';
import { pickableGuns } from '../lib/gunStatus.ts';

export function MatchDetail({ id, onEdit, onBack, onDeleted, refreshKey }: {
  id: string; onEdit: () => void; onBack: () => void; onDeleted: () => void; refreshKey: number;
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

      {match.stages.length > 0 && (
        <div className="card">
          <h2>Stages</h2>
          {match.stages.map((st, i) => {
            const hf = hitFactor(st.points, st.time);
            return (
              <div className="row" key={i}>
                <span className="label">
                  Stage {st.number}
                  {st.notes && <div className="row-sub">{st.notes}</div>}
                </span>
                <span className="value">
                  {[st.points !== null ? `${st.points} pts` : null,
                    st.time !== null ? `${st.time}s` : null,
                    hf !== null ? `HF ${hf}` : null,
                    st.percent !== null ? `${st.percent}%` : null].filter(Boolean).join(' · ') || '—'}
                </span>
              </div>
            );
          })}
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

interface StageRow { points: string; time: string; percent: string; notes: string; }

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
        setStages(m.stages.map((st) => ({
          points: st.points == null ? '' : String(st.points),
          time: st.time == null ? '' : String(st.time),
          percent: st.percent == null ? '' : String(st.percent),
          notes: st.notes
        })));
        setExistingMedia(allMedia.filter((x) => x.ownerType === 'match' && x.ownerId === id));
        setEntryFee(m.entryFee == null ? '' : String(m.entryFee));
        setPsUrl(m.practiScoreUrl); setNotes(m.notes);
      }
    })();
    return () => { alive = false; };
  }, [editing, id]);

  const num = (t: string): number | null => t.trim() === '' ? null : Number(t);

  const stageObjs: MatchStage[] = useMemo(() => stages.map((st, i) => ({
    number: i + 1, points: num(st.points), time: num(st.time),
    percent: num(st.percent), notes: st.notes.trim()
  })), [stages]);


  async function save() {
    if (saving) return;
    if (!date) { setProblem('Pick a date.'); return; }
    if (!firearmId) { setProblem('Pick a gun.'); return; }
    const numbers = [num(totalRounds), num(matchPercent), num(divPlace), num(divOf),
      num(overallPlace), num(overallOf), num(entryFee),
      ...stageObjs.flatMap((st) => [st.points, st.time, st.percent])];
    if (numbers.some((n) => n !== null && !Number.isFinite(n))) {
      setProblem('One of the numbers isn’t a plain number.'); return;
    }
    setSaving(true);
    try {
      const mid = original ? original.id : newId('mt');
      const now = Date.now();
      const fields = {
        date, name: name.trim(), matchType, division, powerFactor, firearmId,
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
        <label className="field">What to call it
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
        <h2>Power Factor</h2>
        <div className="seg" role="radiogroup" aria-label="Power factor">
          {POWER_FACTORS.map((pf) => (
            <button key={pf} role="radio" aria-checked={powerFactor === pf}
              className={powerFactor === pf ? 'on' : ''} onClick={() => setPowerFactor(pf)}>{pf}</button>
          ))}
        </div>
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
        <h2>Stages</h2>
        {stages.map((st, i) => {
          const hf = hitFactor(num(st.points), num(st.time));
          return (
            <div className="drill-edit" key={i}>
              <div className="drill-edit-head">
                <strong>Stage {i + 1}{hf !== null ? ` — HF ${hf}` : ''}</strong>
                <button className="icon-btn" aria-label={`Remove stage ${i + 1}`}
                  onClick={() => setStages((p) => p.filter((_, x) => x !== i))}>✕</button>
              </div>
              <div className="drill-edit-fields">
                <label className="field small">Points
                  <input type="number" inputMode="decimal" value={st.points}
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
              <label className="field">Stage notes
                <input value={st.notes}
                  onChange={(e) => setStages((p) => p.map((x, n) => n === i ? { ...x, notes: e.target.value } : x))} />
              </label>
            </div>
          );
        })}
        <button className="button secondary"
          onClick={() => setStages((p) => [...p, { points: '', time: '', percent: '', notes: '' }])}>
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
