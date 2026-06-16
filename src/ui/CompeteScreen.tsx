// The Compete tab (spec §11): matches, classifiers, classification progress,
// and the season at a glance.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Classifier, Match, Media } from '../lib/types.ts';
import { deleteOne, getAll, getOne, putOne } from '../lib/db.ts';
import { formatDayKey, todayKey } from '../lib/dates.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { DIVISIONS, classificationProgress } from '../lib/competition.ts';
import { matchFee } from '../lib/costing.ts';
import type { View } from './nav.ts';
import { ConfirmSheet, Sheet } from './Sheet.tsx';
import { InfoTip } from './InfoTip.tsx';
import { FormProblem } from './FormProblem.tsx';
import { PhotoSheet } from './PhotoSheet.tsx';
import { NewPhotoSheet } from './NewPhotoSheet.tsx';
import { mediaUrl } from './media.ts';
import { prepareUploadBytes } from './shrinkImage.ts';

interface ClassifierFile { file: File; url: string; kind: 'image' | 'video'; name?: string; notes?: string; }

export function CompeteScreen({ refreshKey, open }: {
  refreshKey: number; open: (v: View) => void;
}) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [classifiers, setClassifiers] = useState<Classifier[]>([]);
  const [division, setDivision] = useState('');
  const [loaded, setLoaded] = useState(false);
  // Audit #17: the two importers live behind one "Import…" choice so the
  // classification/season status shows sooner instead of under four buttons.
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([getAll<Match>('matches'), getAll<Classifier>('classifiers')]).then(([m, c]) => {
      if (!alive) return;
      setMatches(m.sort((a, b) => b.date.localeCompare(a.date)));
      const sorted = c.sort((a, b) => b.date.localeCompare(a.date));
      setClassifiers(sorted);
      setDivision((prev) => prev || sorted[0]?.division || 'Carry Optics');
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [refreshKey]);

  const progress = useMemo(
    () => classificationProgress(classifiers.filter((c) => c.division === division)),
    [classifiers, division]
  );

  const thisYear = todayKey().slice(0, 4);
  const seasonMatches = matches.filter((m) => m.date.startsWith(thisYear));
  const seasonPercents = seasonMatches.map((m) => m.matchPercent).filter((p): p is number => p != null);
  // Same single-source fee math the Costs screen uses (handles old imported matches too).
  const seasonFees = seasonMatches.reduce((s, m) => s + matchFee(m), 0);

  if (!loaded) return <div className="screen" />;

  return (
    <div className="screen">
      <h1 className="large-title">Compete</h1>
      <button className="button" onClick={() => open({ kind: 'match-form' })}>+ Log Match</button>
      <div style={{ height: 8 }} />
      <button className="button secondary" onClick={() => open({ kind: 'classifier-form' })}>+ Log Classifier</button>
      <div style={{ height: 8 }} />
      <button className="button secondary" onClick={() => setShowImport(true)}>Import…</button>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Classification <InfoTip title="Classification">Your class comes from the average of your best 6 of your last 8 classifier scores in a division. When that average crosses the next band, you move up — C to B and so on.</InfoTip></h2>
        <div className="row">
          <span className="label">Division</span>
          <select className="category-pick" aria-label="Division" value={division}
            onChange={(e) => setDivision(e.target.value)}>
            {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        {progress.average === null ? (
          <p className="report-note" style={{ marginTop: 8 }}>
            No classifier scores in {division} yet. Log them as you shoot them and your
            class average builds here.
          </p>
        ) : (
          <>
            <div className="stat-grid" style={{ marginTop: 10 }}>
              <div className="stat"><div className="num">{progress.average}%</div><div className="cap">Average (best 6 of last 8)</div></div>
              <div className="stat"><div className="num">{progress.currentClass}</div><div className="cap">Class</div></div>
            </div>
            {progress.next && (
              <p className="report-note" style={{ marginTop: 10 }}>
                {progress.next.name} class starts at {progress.next.threshold}% — you need{' '}
                {(progress.next.threshold - progress.average).toFixed(2)} more points of average.
                {progress.scoresOnRecord < 4 ? ' (Fewer than 4 scores on record so far — early days.)' : ''}
              </p>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2>{thisYear} Season</h2>
        <div className="row"><span className="label">Matches shot</span><span className="value">{seasonMatches.length}</span></div>
        {seasonPercents.length > 0 && (
          <div className="row"><span className="label">Average match percent</span>
            <span className="value">{(seasonPercents.reduce((s, p) => s + p, 0) / seasonPercents.length).toFixed(1)}%</span></div>
        )}
        {seasonFees > 0 && (
          <div className="row"><span className="label">Entry fees</span><span className="value">${seasonFees.toFixed(2)}</span></div>
        )}
      </div>

      <div className="card">
        <h2>Matches</h2>
        {matches.length === 0 && <p className="report-note">No matches logged yet.</p>}
        {matches.map((m) => (
          <button className="row-tap" key={m.id} onClick={() => open({ kind: 'match-detail', id: m.id })}>
            <span className="label">
              {m.name || m.matchType}
              <div className="row-sub">{formatDayKey(m.date)} · {m.division}</div>
            </span>
            <span className="value">
              {m.matchPercent != null ? `${m.matchPercent}%` : m.divisionPlace != null ? `#${m.divisionPlace}` : '›'}
            </span>
          </button>
        ))}
      </div>

      <div className="card">
        <h2>Classifiers</h2>
        {classifiers.length === 0 && <p className="report-note">No classifiers logged yet.</p>}
        {classifiers.map((c) => (
          <button className="row-tap" key={c.id} onClick={() => open({ kind: 'classifier-form', id: c.id })}>
            <span className="label">
              {c.code}{c.name ? ` — ${c.name}` : ''}
              <div className="row-sub">{formatDayKey(c.date)} · {c.division}</div>
            </span>
            <span className="value">{c.percent !== null ? `${c.percent}%` : '›'}</span>
          </button>
        ))}
      </div>

      {showImport && (
        <Sheet title="Import" onClose={() => setShowImport(false)}>
          <button className="drill-pick-row" onClick={() => { setShowImport(false); open({ kind: 'practiscore-import' }); }}>
            <strong>Import from PractiScore</strong>
            <span>Pull a match's results from a PractiScore export.</span>
          </button>
          <button className="drill-pick-row" onClick={() => { setShowImport(false); open({ kind: 'uspsa-import' }); }}>
            <strong>Import USPSA Classifiers</strong>
            <span>Bring in your classifier scores from USPSA.</span>
          </button>
        </Sheet>
      )}
    </div>
  );
}

export function ClassifierForm({ id, onSaved, onCancel }: {
  id?: string; onSaved: () => void; onCancel: () => void;
}) {
  const [original, setOriginal] = useState<Classifier | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [date, setDate] = useState(todayKey());
  const [division, setDivision] = useState('Carry Optics');
  const [hf, setHf] = useState('');
  const [percent, setPercent] = useState('');
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState('');
  const [existingMedia, setExistingMedia] = useState<Media[]>([]);
  const [removedMedia, setRemovedMedia] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<ClassifierFile[]>([]);
  const [editingNew, setEditingNew] = useState<number | null>(null);
  const [viewing, setViewing] = useState<Media | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (id === undefined) return;
    let alive = true;
    void getOne<Classifier>('classifiers', id).then((c) => {
      if (!alive || !c) return;
      setOriginal(c);
      setCode(c.code); setName(c.name); setDate(c.date); setDivision(c.division);
      setHf(c.hitFactor === null ? '' : String(c.hitFactor));
      setPercent(c.percent === null ? '' : String(c.percent));
      setNotes(c.notes);
    });
    void getAll<Media>('media').then((all) => {
      if (alive) setExistingMedia(all.filter((m) => m.ownerType === 'classifier' && m.ownerId === id));
    });
    return () => { alive = false; };
  }, [id]);

  function filesPicked(list: FileList | null) {
    if (!list) return;
    setNewFiles((prev) => [...prev, ...Array.from(list).map((file) => ({
      file, url: URL.createObjectURL(file),
      kind: file.type.startsWith('video') ? 'video' as const : 'image' as const
    }))]);
  }

  async function save() {
    if (!code.trim()) { setProblem('Enter the classifier code (like 23-01).'); return; }
    const pct = percent.trim() === '' ? null : Number(percent);
    const hfNum = hf.trim() === '' ? null : Number(hf);
    if ((pct !== null && !Number.isFinite(pct)) || (hfNum !== null && !Number.isFinite(hfNum))) {
      setProblem('Percent and hit factor need to be plain numbers.'); return;
    }
    const fields = {
      code: code.trim(), name: name.trim(), date, division,
      hitFactor: hfNum, percent: pct, notes: notes.trim()
    };
    const cid = original ? original.id : newId('cl');
    const now = Date.now();
    if (original) {
      await putOne('classifiers', stampUpdate({ ...original, ...fields }, now));
    } else {
      await putOne('classifiers', stampNew(fields, cid, now));
    }
    // Photos/videos (staged until Save, like sessions and matches).
    for (const mid of removedMedia) await deleteOne('media', mid);
    let seq = existingMedia.length;
    for (const nf of newFiles) {
      seq += 1;
      const { data: buf, mime } = await prepareUploadBytes(nf.file);
      await putOne('media', stampNew({
        ownerType: 'classifier' as const, ownerId: cid, kind: nf.kind,
        name: nf.name?.trim() || `${nf.kind === 'video' ? 'Video' : 'Photo'} ${seq}`,
        annotations: nf.notes ? nf.notes.split('\n').map((s) => s.trim()).filter(Boolean) : [],
        mime, data: buf
      }, newId('md'), now));
    }
    onSaved();
  }

  async function reallyDelete() {
    if (original) await deleteOne('classifiers', original.id);
    onSaved();
  }

  const visibleExisting = existingMedia.filter((m) => !removedMedia.includes(m.id));

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onCancel}>‹ Cancel</button>
        <button className="navbar-action" onClick={() => void save()}>Save</button>
      </div>
      <h1 className="large-title">{original ? 'Edit Classifier' : 'Log Classifier'}</h1>
      <FormProblem problem={problem} />
      <div className="card">
        <label className="field">Classifier code
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="23-01" />
        </label>
        <label className="field">Name (optional)
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Down the Middle" />
        </label>
        <label className="field">Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">Division
          <select value={division} onChange={(e) => setDivision(e.target.value)}>
            {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="field">Hit factor
          <input type="number" inputMode="decimal" value={hf} onChange={(e) => setHf(e.target.value)} />
        </label>
        <label className="field">Percent
          <input type="number" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
        </label>
        <label className="field">Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <div className="card">
        <h2>Photos &amp; Videos</h2>
        {(visibleExisting.length > 0 || newFiles.length > 0) && (
          <div className="photo-grid" style={{ marginBottom: 12 }}>
            {visibleExisting.map((m) => (
              <div className="thumb-wrap" key={m.id}>
                <button className="thumb-tap" onClick={() => setViewing(m)} aria-label={`Open ${m.name}`}>
                  {m.kind === 'video'
                    ? <video src={mediaUrl(m)} preload="metadata" muted playsInline />
                    : <img src={mediaUrl(m)} alt={m.name} loading="lazy" />}
                </button>
                <button className="thumb-x" aria-label={`Remove ${m.name}`}
                  onClick={() => setRemovedMedia((p) => [...p, m.id])}>✕</button>
                <span className="thumb-caption">{m.name}</span>
              </div>
            ))}
            {newFiles.map((nf, i) => (
              <div className="thumb-wrap" key={nf.url}>
                <button className="thumb-tap" onClick={() => setEditingNew(i)} aria-label="Name this new file">
                  {nf.kind === 'video'
                    ? <video src={nf.url} preload="metadata" muted playsInline />
                    : <img src={nf.url} alt="New file" />}
                </button>
                <button className="thumb-x" aria-label="Remove new file"
                  onClick={() => setNewFiles((p) => p.filter((_, x) => x !== i))}>✕</button>
                <span className="thumb-caption">{nf.name || 'Tap to name'}</span>
              </div>
            ))}
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
          onChange={(e) => { filesPicked(e.target.files); e.target.value = ''; }} />
        <button className="button secondary" onClick={() => fileRef.current?.click()}>+ Add Photos or Videos</button>
        <p className="report-note">Removals only happen when you Save — Cancel really cancels.</p>
      </div>
      <button className="button" onClick={() => void save()}>{original ? 'Save Changes' : 'Save Classifier'}</button>
      {original && (
        <>
          <div style={{ height: 8 }} />
          <button className="button danger" onClick={() => setConfirming(true)}>Delete Classifier</button>
        </>
      )}
      {confirming && (
        <ConfirmSheet title="Delete this classifier?"
          message="It comes out of your classification math. There's no undo."
          confirmLabel="Delete Classifier"
          onConfirm={() => void reallyDelete()}
          onClose={() => setConfirming(false)} />
      )}
      {viewing && (
        <PhotoSheet media={viewing} onClose={() => setViewing(null)}
          onChanged={async () => {
            const all = await getAll<Media>('media');
            setExistingMedia(all.filter((m) => m.ownerType === 'classifier' && m.ownerId === (original?.id ?? '')));
          }} />
      )}
      {editingNew !== null && newFiles[editingNew] && (
        <NewPhotoSheet
          file={newFiles[editingNew]}
          onSave={(nm, nt) => setNewFiles((p) => p.map((f, x) => (x === editingNew ? { ...f, name: nm, notes: nt } : f)))}
          onClose={() => setEditingNew(null)}
        />
      )}
    </div>
  );
}
