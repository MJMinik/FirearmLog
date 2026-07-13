// Magazines: the user's magazine list, fully editable.
import { useEffect, useState } from 'react';
import type { Firearm, Magazine } from '../lib/types.ts';
import { deleteOne, getAll, getOne, putOne } from '../lib/db.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { InfoTip } from './InfoTip.tsx';
import { FormProblem } from './FormProblem.tsx';
import { ConfirmSheet } from './Sheet.tsx';
import { ScreenError } from './ScreenState.tsx';
import { ListSearch, matchesQuery } from './ListSearch.tsx';
import { ownedGuns } from '../lib/gunStatus.ts';

export function MagazinesScreen({ refreshKey, onBack, openForm }: {
  refreshKey: number; onBack: () => void; openForm: (id?: string) => void;
}) {
  const [mags, setMags] = useState<Magazine[]>([]);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(false);
    void (async () => {
      try {
        const [m, f] = await Promise.all([getAll<Magazine>('magazines'), getAll<Firearm>('firearms')]);
        if (!alive) return;
        setMags(m.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })));
        setFirearms(f);
      } catch (e) {
        console.error('Magazines load failed', e);
        if (alive) setError(true);
      }
    })();
    return () => { alive = false; };
  }, [refreshKey, nonce]);

  if (error) return <ScreenError onRetry={() => setNonce((n) => n + 1)} />;

  const gunNames = (ids: string[]) =>
    ids.map((id) => firearms.find((f) => f.id === id)?.name ?? '—').join(', ');

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Magazines <InfoTip title="Magazines">Your magazines, grouped by the guns they fit.</InfoTip></h1>
      <button className="button" onClick={() => openForm()}>+ Add Magazine</button>
      {mags.length > 8 && <ListSearch value={q} onChange={setQ} placeholder="Search magazines" />}
      <div className="card" style={{ marginTop: 16 }}>
        <h2>All Magazines</h2>
        {mags.length === 0 && <p className="report-note">No magazines yet. Tap "+ Add Magazine" to add one.</p>}
        {mags.length > 0 && mags.filter((m) => matchesQuery(q, m.label, gunNames(m.firearmIds))).length === 0 &&
          <p className="report-note">No magazines match your search.</p>}
        {mags.filter((m) => matchesQuery(q, m.label, gunNames(m.firearmIds))).map((m) => (
          <button className="row-tap" key={m.id} onClick={() => openForm(m.id)}>
            <span className="label">
              {m.label}{m.active ? '' : ' (retired)'}
              <div className="row-sub">{gunNames(m.firearmIds) || 'No gun assigned'}</div>
            </span>
            <span className="value">{m.totalRounds.toLocaleString()} rds ›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function MagazineForm({ id, onSaved, onCancel }: {
  id?: string; onSaved: () => void; onCancel: () => void;
}) {
  const [original, setOriginal] = useState<Magazine | null>(null);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [label, setLabel] = useState('');
  const [gunIds, setGunIds] = useState<string[]>([]);
  const [active, setActive] = useState(true);
  const [totalRounds, setTotalRounds] = useState('0');
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState('');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let alive = true;
    void getAll<Firearm>('firearms').then((f) => {
      if (alive) setFirearms(f.sort((a, b) => a.name.localeCompare(b.name)));
    });
    if (id !== undefined) {
      void getOne<Magazine>('magazines', id).then((m) => {
        if (!alive || !m) return;
        setOriginal(m);
        setLabel(m.label); setGunIds(m.firearmIds); setActive(m.active);
        setTotalRounds(String(m.totalRounds)); setNotes(m.notes);
      });
    }
    return () => { alive = false; };
  }, [id]);

  async function save() {
    if (!label.trim()) { setProblem('Give the magazine a label (like A01).'); return; }
    const rounds = Number(totalRounds);
    if (!Number.isFinite(rounds) || rounds < 0) { setProblem('Rounds needs to be a plain number.'); return; }
    const fields = { label: label.trim(), firearmIds: gunIds, active, totalRounds: rounds, notes: notes.trim() };
    if (original) {
      await putOne('magazines', stampUpdate({ ...original, ...fields }, Date.now()));
    } else {
      await putOne('magazines', stampNew({ ...fields, springHistory: [] }, newId('mg'), Date.now()));
    }
    onSaved();
  }

  // Audit #10: magazines can be deleted (nothing else references them — sessions
  // don't link to magazines). "Retire" still exists for mags you want to keep on record.
  async function reallyDelete() {
    if (original) await deleteOne('magazines', original.id);
    onSaved();
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onCancel}>‹ Cancel</button>
        <button className="navbar-action" onClick={() => void save()}>Save</button>
      </div>
      <h1 className="large-title">{original ? 'Edit Magazine' : 'New Magazine'}</h1>
      <FormProblem problem={problem} />
      <div className="card">
        <label className="field">Label
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="A01" />
        </label>
        <h2>Used With</h2>
        {ownedGuns(firearms, gunIds).map((f) => {
          const on = gunIds.includes(f.id);
          return (
            <div className="row" key={f.id}>
              <button className={`gun-toggle ${on ? 'on' : ''}`} aria-pressed={on}
                onClick={() => setGunIds((prev) => on ? prev.filter((x) => x !== f.id) : [...prev, f.id])}>
                {f.name}
              </button>
            </div>
          );
        })}
        <label className="field" style={{ marginTop: 12 }}>Rounds through it
          <input type="number" inputMode="numeric" min="0" value={totalRounds}
            onChange={(e) => setTotalRounds(e.target.value)} />
        </label>
        <div className="row">
          <button className={`gun-toggle ${active ? 'on' : ''}`} aria-pressed={active}
            onClick={() => setActive(!active)}>
            In service (turn off to retire it)
          </button>
        </div>
        <label className="field">Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {/* Session 59 #1: completion buttons all speak "Save" (matches the
          navbar Save above and the "Save ammo"/"Save match" family). */}
      <button className="button" onClick={() => void save()}>{original ? 'Save changes' : 'Save magazine'}</button>
      {original && (
        <button className="button danger" style={{ marginTop: 8 }} onClick={() => setConfirming(true)}>
          Delete Magazine
        </button>
      )}
      {confirming && (
        <ConfirmSheet
          title="Delete this magazine?"
          message="It's removed from your gear. Prefer to keep it on record? Turn off &quot;In service&quot; to retire it instead. There's no undo."
          confirmLabel="Delete Magazine"
          onConfirm={() => void reallyDelete()}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
