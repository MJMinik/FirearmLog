// Optics (PT parity, Phase F). Each optic carries a battery log. Spare Parts
// moved to its own section (PartsScreen.tsx) per Michael's June 14 request.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Firearm, Optic } from '../lib/types.ts';
import { deleteOne, getAll, getOne, getSettings, putOne } from '../lib/db.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { formatDayKey, todayKey } from '../lib/dates.ts';
import { isBatteryDue, normalizeBatteryLog } from '../lib/optics.ts';
import { recentValues } from '../lib/suggest.ts';
import { filterHidden } from '../lib/listEdits.ts';
import { ConfirmSheet, DiscardChangesSheet, Sheet } from './Sheet.tsx';
import { useDirtyTracker } from './useDirtyTracker.ts';
import { ScreenError } from './ScreenState.tsx';
import { InfoTip } from './InfoTip.tsx';
import { SuggestField, noAutofillProps } from './SuggestField.tsx';
import { FormProblem } from './FormProblem.tsx';
import { ownedGuns } from '../lib/gunStatus.ts';

export function OpticsScreen({ refreshKey, onBack, openOpticForm }: {
  refreshKey: number; onBack: () => void;
  openOpticForm: (id?: string) => void;
}) {
  const [optics, setOptics] = useState<Optic[]>([]);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [loggingFor, setLoggingFor] = useState<Optic | null>(null);
  const [localBump, setLocalBump] = useState(0);
  const [error, setError] = useState(false);
  // Audit #11: optics collapse to compact rows and expand on tap, instead of
  // every optic rendering fully expanded into a long wall.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(false);
    void (async () => {
      try {
        const [o, f] = await Promise.all([getAll<Optic>('optics'), getAll<Firearm>('firearms')]);
        if (!alive) return;
        setOptics(o.sort((a, b) => `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`)));
        setFirearms(f);
      } catch (e) {
        console.error('Optics load failed', e);
        if (alive) setError(true);
      }
    })();
    return () => { alive = false; };
  }, [refreshKey, localBump]);

  if (error) return <ScreenError onRetry={() => setLocalBump((n) => n + 1)} />;

  const gunName = (id: string) => firearms.find((f) => f.id === id)?.name;

  const renderOptic = (op: Optic) => {
    const entries = normalizeBatteryLog(op.batteryLog);
    const due = isBatteryDue(op.batteryLog, new Date());
    const open = expandedId === op.id;
    const title = [op.make, op.model].filter(Boolean).join(' ') || 'Unnamed optic';
    return (
      <div className="card" key={op.id}>
        <button className="row-tap" aria-expanded={open}
          onClick={() => setExpandedId(open ? null : op.id)}>
          <span className="label">
            {title}
            <div className="row-sub">{gunName(op.firearmId) ?? 'Unassigned'}</div>
          </span>
          <span className="value">
            <span className={`badge ${due ? 'warn-badge' : 'ok'}`}>{due ? 'Battery due' : 'Active'}</span>
            {' '}{open ? '▾' : '›'}
          </span>
        </button>

        {open && (
          <>
            {op.installDate && (
              <div className="row"><span className="label">Installed</span><span className="value">{formatDayKey(op.installDate)}</span></div>
            )}
            {op.dotSize && (
              <div className="row"><span className="label">Dot / reticle size</span><span className="value">{op.dotSize}</span></div>
            )}
            {op.zeroDist && (
              <div className="row"><span className="label">Zero distance</span><span className="value">{op.zeroDist}</span></div>
            )}
            {op.mountHeight && (
              <div className="row"><span className="label">Mount / co-witness height</span><span className="value">{op.mountHeight}</span></div>
            )}
            {op.torqueSpec && (
              <div className="row"><span className="label">Torque spec</span><span className="value">{op.torqueSpec}</span></div>
            )}
            {op.settingsSnapshot && <p className="report-note">{op.settingsSnapshot}</p>}

            <h2 style={{ marginTop: 12 }}>Battery Log</h2>
            {entries.length === 0 && <p className="report-note">No battery changes logged yet.</p>}
            {/* Audit #12: the full history shows here now — no more unreachable "older entries hidden". */}
            {entries.map((e, i) => (
              <div className="row" key={i}>
                <span className="label">{e.notes || 'Battery changed'}</span>
                <span className="value">{formatDayKey(e.date)}</span>
              </div>
            ))}
            <button className="button secondary" style={{ marginTop: 10 }} onClick={() => setLoggingFor(op)}>
              + Log Battery Change
            </button>

            {op.notes && <p className="note-text" style={{ marginTop: 10 }}>{op.notes}</p>}

            <button className="button secondary" style={{ marginTop: 10 }} onClick={() => openOpticForm(op.id)}>
              Edit
            </button>
          </>
        )}
      </div>
    );
  };

  // Optics on a gun first; the ones not mounted on anything cluster together
  // at the bottom under their own heading (Michael's June 14 ask).
  const assigned = optics.filter((op) => !!gunName(op.firearmId));
  const unassigned = optics.filter((op) => !gunName(op.firearmId));

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn section-back" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Optics <InfoTip title="Optics">Red dots and scopes. Track each optic, attach it to a gun, and its cost feeds Costs &amp; Purchases.</InfoTip></h1>

      <button className="button" onClick={() => openOpticForm()}>+ Add Optic</button>
      {optics.length === 0 && (
        <p className="report-note">
          No optics yet. Add a red dot, scope, or other sight to track its install date, zero, and battery.
        </p>
      )}
      {assigned.map(renderOptic)}

      {unassigned.length > 0 && (
        <h2 className="large-title" style={{ fontSize: '1.1rem', marginTop: 20 }}>Unassigned Optics</h2>
      )}
      {unassigned.map(renderOptic)}

      {loggingFor && (
        <BatteryLogSheet optic={loggingFor} onClose={() => setLoggingFor(null)}
          onSaved={() => { setLoggingFor(null); setLocalBump((b) => b + 1); }} />
      )}
    </div>
  );
}

function BatteryLogSheet({ optic, onClose, onSaved }: {
  optic: Optic; onClose: () => void; onSaved: () => void;
}) {
  const [date, setDate] = useState(todayKey());
  const [notes, setNotes] = useState('');
  // F-Universal-Guard: notes typed or date moved off today → discard confirm.
  const dirty = useDirtyTracker({ date, notes });

  async function save() {
    const entry = { date, notes: notes.trim() };
    await putOne('optics', stampUpdate({ ...optic, batteryLog: [...optic.batteryLog, entry] }, Date.now()));
    onSaved();
  }

  // Save-from-guard: date always has a value (today by default) and notes are
  // optional — any dirty state is valid to save. Pass onSaveRequest when dirty.
  const onSaveRequest = dirty ? () => void save() : undefined;

  return (
    <Sheet title="Log Battery Change" onClose={onClose} dirty={dirty} onSaveRequest={onSaveRequest}>
      <label className="field">Date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="field">Notes (optional)
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="CR2032, etc."
          {...noAutofillProps} name="fl-battery-notes" />
      </label>
      <button className="button" onClick={() => void save()}>Save</button>
    </Sheet>
  );
}

export function OpticForm({ id, firearmId, onSaved, onCancel, onDirtyChange, onSaverChange }: {
  id?: string; firearmId?: string; onSaved: () => void; onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSaverChange?: (fn: (() => Promise<boolean>) | null) => void;
}) {
  const editing = id !== undefined;
  const [original, setOriginal] = useState<Optic | null>(null);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [allOptics, setAllOptics] = useState<Optic[]>([]);
  const [firearmIdSel, setFirearmIdSel] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [installDate, setInstallDate] = useState('');
  const [dotSize, setDotSize] = useState('');
  const [zeroDist, setZeroDist] = useState('');
  const [mountHeight, setMountHeight] = useState('');
  const [torqueSpec, setTorqueSpec] = useState('');
  const [settingsSnapshot, setSettingsSnapshot] = useState('');
  // What you paid for the optic (Aug 2026, "gun & gear cost" feature). Blank
  // stays blank (stored null) — same not-recorded-vs-free semantics as the
  // gun form's field.
  const [pricePaid, setPricePaid] = useState('');
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  // AUDIT FIX (July 20 2026): gate the dirty baseline on the async load so
  // an untouched edit doesn't fire "Discard changes?".
  const [loaded, setLoaded] = useState<boolean>(!editing);
  const [hiddenSuggestions, setHiddenSuggestions] = useState<Record<string, string[]>>({});
  const dirty = useDirtyTracker({ firearmIdSel, make, model, installDate, dotSize, zeroDist, mountHeight, torqueSpec, settingsSnapshot, pricePaid, notes }, loaded);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useEffect(() => {
    let alive = true;
    void getAll<Firearm>('firearms').then((f) => {
      if (alive) setFirearms(f.sort((a, b) => a.name.localeCompare(b.name)));
    });
    void getAll<Optic>('optics').then((o) => { if (alive) setAllOptics(o); });
    if (id !== undefined) {
      void getOne<Optic>('optics', id).then((o) => {
        if (!alive || !o) return;
        setOriginal(o);
        setFirearmIdSel(o.firearmId);
        setMake(o.make); setModel(o.model);
        setInstallDate(o.installDate);
        setDotSize(o.dotSize); setZeroDist(o.zeroDist);
        setMountHeight(o.mountHeight); setTorqueSpec(o.torqueSpec);
        setSettingsSnapshot(o.settingsSnapshot);
        setPricePaid(o.pricePaid != null ? String(o.pricePaid) : '');
        setNotes(o.notes);
        setLoaded(true); // AUDIT FIX
      });
    } else if (firearmId) {
      setFirearmIdSel(firearmId);
    }
    void getSettings<{ hiddenSuggestions?: Record<string, string[]> }>().then((s) => {
      if (alive) setHiddenSuggestions(s?.hiddenSuggestions ?? {});
    });
    return () => { alive = false; };
  }, [id, firearmId]);

  function saveProblem(): string | null {
    if (!make.trim() && !model.trim()) return 'Give the optic a make or model.';
    // 0 is a legitimate answer (a gift, a trade, a giveaway) — only reject
    // negative or non-numeric, not zero.
    const pp = pricePaid.trim() === '' ? null : Number(pricePaid);
    if (pp !== null && (!Number.isFinite(pp) || pp < 0)) return 'What you paid needs to be a plain number (or left blank).';
    return null;
  }

  async function persistForm(): Promise<boolean> {
    const p = saveProblem();
    if (p) { setProblem(p); return false; }
    const pp = pricePaid.trim() === '' ? null : Number(pricePaid);
    const fields = {
      firearmId: firearmIdSel, make: make.trim(), model: model.trim(),
      installDate, dotSize: dotSize.trim(), zeroDist: zeroDist.trim(),
      mountHeight: mountHeight.trim(), torqueSpec: torqueSpec.trim(),
      settingsSnapshot: settingsSnapshot.trim(), pricePaid: pp, notes: notes.trim()
    };
    if (original) {
      await putOne('optics', stampUpdate({ ...original, ...fields }, Date.now()));
    } else {
      await putOne('optics', stampNew({ ...fields, batteryLog: [] }, newId('op'), Date.now()));
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

  async function reallyDelete() {
    if (original) await deleteOne('optics', original.id);
    onDirtyChange?.(false);
    onSaved();
  }

  // Your own past makes/models, most-recent first — the creatable-combobox list.
  // Models are filtered to the make you've entered, so picking Trijicon only
  // suggests Trijicon models (and a new maker suggests nothing until you add one).
  const makeKey = make.trim().toLowerCase();
  const makeSuggestions = recentValues(allOptics.map((o) => ({ date: String(o.updatedAt), value: o.make })));
  const modelSuggestions = recentValues(
    allOptics
      .filter((o) => makeKey === '' || o.make.trim().toLowerCase() === makeKey)
      .map((o) => ({ date: String(o.updatedAt), value: o.model }))
  );

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
      <h1 className="large-title">{original ? 'Edit Optic' : 'New Optic'}</h1>
      <FormProblem problem={problem} />
      <div className="card">
        <label className="field">Firearm
          <select value={firearmIdSel} onChange={(e) => setFirearmIdSel(e.target.value)}>
            <option value="">Unassigned</option>
            {ownedGuns(firearms, [firearmIdSel]).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <SuggestField label="Make" value={make} onChange={setMake} name="fl-optic-make"
          suggestions={filterHidden(makeSuggestions, hiddenSuggestions, 'optic-makes')} placeholder="Trijicon" />
        <SuggestField label="Model" value={model} onChange={setModel} name="fl-optic-model"
          suggestions={filterHidden(modelSuggestions, hiddenSuggestions, 'optic-models')} placeholder="RMR Type 2" />
        <label className="field">Install date
          <input type="date" value={installDate} onChange={(e) => setInstallDate(e.target.value)} />
        </label>
        <label className="field">Dot / reticle size
          <input value={dotSize} onChange={(e) => setDotSize(e.target.value)} placeholder="3.25 MOA"
            {...noAutofillProps} name="fl-optic-dot" />
        </label>
        <label className="field">Zero distance
          <input value={zeroDist} onChange={(e) => setZeroDist(e.target.value)} placeholder="25 yards"
            {...noAutofillProps} name="fl-optic-zero" />
        </label>
        <label className="field">Mount / co-witness height
          <input value={mountHeight} onChange={(e) => setMountHeight(e.target.value)} placeholder="Lower 1/3"
            {...noAutofillProps} name="fl-optic-mount" />
        </label>
        <label className="field">Torque spec
          <input value={torqueSpec} onChange={(e) => setTorqueSpec(e.target.value)} placeholder="15 in-lbs"
            {...noAutofillProps} name="fl-optic-torque" />
        </label>
        <label className="field">Settings snapshot
          <textarea rows={3} value={settingsSnapshot} onChange={(e) => setSettingsSnapshot(e.target.value)}
            placeholder="Brightness setting, mode, etc." />
        </label>
        <label className="field">What you paid
          <input type="number" inputMode="decimal" min="0" step="0.01" value={pricePaid}
            onChange={(e) => setPricePaid(e.target.value)} placeholder="0.00" />
        </label>
        <label className="field">Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {/* Session 59 #1: completion buttons all speak "Save" (matches the
          navbar Save above and the "Save ammo"/"Save match" family). */}
      <button className="button" onClick={() => void save()}>{original ? 'Save changes' : 'Save optic'}</button>
      {original && (
        <button className="button danger" style={{ marginTop: 8 }} onClick={() => setConfirming(true)}>
          Delete Optic
        </button>
      )}
      {confirming && (
        <ConfirmSheet
          title="Delete this optic?"
          message="Its battery log goes with it. There's no undo."
          confirmLabel="Delete Optic"
          onConfirm={() => void reallyDelete()}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
