// Magazines: the user's magazine list, fully editable. Round counts shown
// here are DERIVED (starting count + logged-session attributions — lib/mags.ts);
// the form edits only the starting count.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Firearm, Magazine, Session } from '../lib/types.ts';
import { magLifetimeRounds } from '../lib/mags.ts';
import { deleteOne, getAll, getOne, putOne } from '../lib/db.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { InfoTip } from './InfoTip.tsx';
import { FormProblem } from './FormProblem.tsx';
import { ConfirmSheet, DiscardChangesSheet } from './Sheet.tsx';
import { useDirtyTracker } from './useDirtyTracker.ts';
import { ScreenError } from './ScreenState.tsx';
import { ListSearch, matchesQuery } from './ListSearch.tsx';
import { ownedGuns } from '../lib/gunStatus.ts';

export function MagazinesScreen({ refreshKey, onBack, openForm }: {
  refreshKey: number; onBack: () => void; openForm: (id?: string) => void;
}) {
  const [mags, setMags] = useState<Magazine[]>([]);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(false);
    void (async () => {
      try {
        const [m, f, s] = await Promise.all([
          getAll<Magazine>('magazines'), getAll<Firearm>('firearms'), getAll<Session>('sessions')
        ]);
        if (!alive) return;
        setMags(m.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })));
        setFirearms(f);
        setSessions(s);
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
        <button className="back-btn section-back" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Magazines <InfoTip title="Magazines">Your magazines, grouped by the guns they fit. The round count is each mag&rsquo;s starting count plus every round your logged sessions attribute to it — pick the mags you ran when logging a session and the counts keep themselves.</InfoTip></h1>
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
            <span className="value">{magLifetimeRounds(m, sessions).toLocaleString()} rds ›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function MagazineForm({ id, onSaved, onCancel, onDirtyChange, onSaverChange }: {
  id?: string; onSaved: () => void; onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSaverChange?: (fn: (() => Promise<boolean>) | null) => void;
}) {
  const editing = id !== undefined;
  const [original, setOriginal] = useState<Magazine | null>(null);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [label, setLabel] = useState('');
  const [gunIds, setGunIds] = useState<string[]>([]);
  const [active, setActive] = useState(true);
  const [totalRounds, setTotalRounds] = useState('0');
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState('');
  const [confirming, setConfirming] = useState(false);
  // F-Universal-Guard: guard the ‹ Cancel exit + report dirty upstream for the
  // browser Back / tab-bar exits (App owns the shared discard sheet there).
  const [discarding, setDiscarding] = useState(false);
  // AUDIT FIX (July 20 2026): wait for the getOne load before seeding the
  // dirty baseline on edit.
  const [loaded, setLoaded] = useState<boolean>(!editing);
  const dirty = useDirtyTracker({ label, gunIds, active, totalRounds, notes }, loaded);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useEffect(() => {
    let alive = true;
    void getAll<Firearm>('firearms').then((f) => {
      if (alive) setFirearms(f.sort((a, b) => a.name.localeCompare(b.name)));
    });
    void getAll<Session>('sessions').then((s) => { if (alive) setSessions(s); });
    if (id !== undefined) {
      void getOne<Magazine>('magazines', id).then((m) => {
        if (!alive || !m) return;
        setOriginal(m);
        setLabel(m.label); setGunIds(m.firearmIds); setActive(m.active);
        setTotalRounds(String(m.totalRounds)); setNotes(m.notes);
        setLoaded(true); // AUDIT FIX
      });
    }
    return () => { alive = false; };
  }, [id]);

  function saveProblem(): string | null {
    if (!label.trim()) return 'Give the magazine a label (like A01).';
    const rounds = Number(totalRounds);
    if (!Number.isFinite(rounds) || rounds < 0) return 'Rounds needs to be a plain number.';
    return null;
  }

  async function persistForm(): Promise<boolean> {
    const p = saveProblem();
    if (p) { setProblem(p); return false; }
    const rounds = Number(totalRounds);
    const fields = { label: label.trim(), firearmIds: gunIds, active, totalRounds: rounds, notes: notes.trim() };
    if (original) {
      await putOne('magazines', stampUpdate({ ...original, ...fields }, Date.now()));
    } else {
      await putOne('magazines', stampNew({ ...fields, springHistory: [] }, newId('mg'), Date.now()));
    }
    onDirtyChange?.(false);
    return true;
  }

  async function save() { if (await persistForm()) onSaved(); }

  // Always-fresh saver: the ref holds the LATEST persistForm (re-pointed after
  // every render), and the reported wrapper is reference-stable so App's ref
  // write never churns. This replaces a hand-maintained dep list that could — and
  // did — go stale and save old values.
  const persistRef = useRef(persistForm);
  useEffect(() => { persistRef.current = persistForm; });
  const stablePersist = useCallback(() => persistRef.current(), []);

  // Report after every render (cheap: App just writes a ref) so the reported
  // validity can never lag the form state. Saver present ⟺ dirty AND valid.
  useEffect(() => {
    onSaverChange?.(dirty && saveProblem() === null ? stablePersist : null);
  });
  useEffect(() => () => onSaverChange?.(null), [onSaverChange]);

  // Audit #10: magazines can be deleted. Sessions (magIds) and malfunctions
  // (magazineId) MAY reference one, but every reader skips unknown ids, so a
  // deleted mag just stops appearing — no dangling-reference breakage.
  // "Retire" still exists for mags you want to keep on record.
  async function reallyDelete() {
    if (original) await deleteOne('magazines', original.id);
    onDirtyChange?.(false);
    onSaved();
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={() => (dirty ? setDiscarding(true) : onCancel())}>‹ Cancel</button>
        <button className="navbar-action" onClick={() => void save()}>Save</button>
      </div>
      {discarding && (
        <DiscardChangesSheet
          onConfirm={() => { onDirtyChange?.(false); onCancel(); }}
          onClose={() => setDiscarding(false)}
          onSave={saveProblem() === null ? () => void save() : undefined} />
      )}
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
        <label className="field" style={{ marginTop: 12 }}>Rounds through it before FirearmLog
          <input type="number" inputMode="numeric" min="0" value={totalRounds}
            onChange={(e) => setTotalRounds(e.target.value)} />
        </label>
        {(() => {
          // Derived lifetime, live as the starting count is typed: sessions
          // that logged this mag add on top of the number above.
          const logged = original
            ? magLifetimeRounds({ id: original.id, totalRounds: 0 }, sessions) : 0;
          if (!logged) return (
            <p className="report-note">New rounds add on automatically — pick this mag when logging a session.</p>
          );
          const start = Number(totalRounds) || 0;
          return (
            <p className="report-note">
              Lifetime: {(start + logged).toLocaleString()} rds — the starting count above plus{' '}
              {logged.toLocaleString()} from your logged sessions.
            </p>
          );
        })()}
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
