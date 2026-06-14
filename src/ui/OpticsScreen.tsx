// Optics (PT parity, Phase F). Each optic carries a battery log. Spare Parts
// moved to its own section (PartsScreen.tsx) per Michael's June 14 request.
import { useEffect, useState } from 'react';
import type { Firearm, Optic } from '../lib/types.ts';
import { deleteOne, getAll, getOne, putOne } from '../lib/db.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { formatDayKey, todayKey } from '../lib/dates.ts';
import { isBatteryDue, normalizeBatteryLog } from '../lib/optics.ts';
import { recentValues } from '../lib/suggest.ts';
import { ConfirmSheet, Sheet } from './Sheet.tsx';
import { SuggestField, noAutofillProps } from './SuggestField.tsx';

export function OpticsScreen({ refreshKey, onBack, openOpticForm }: {
  refreshKey: number; onBack: () => void;
  openOpticForm: (id?: string) => void;
}) {
  const [optics, setOptics] = useState<Optic[]>([]);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [loggingFor, setLoggingFor] = useState<Optic | null>(null);
  const [localBump, setLocalBump] = useState(0);

  useEffect(() => {
    let alive = true;
    void Promise.all([getAll<Optic>('optics'), getAll<Firearm>('firearms')])
      .then(([o, f]) => {
        if (!alive) return;
        setOptics(o.sort((a, b) => `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`)));
        setFirearms(f);
      });
    return () => { alive = false; };
  }, [refreshKey, localBump]);

  const gunName = (id: string) => firearms.find((f) => f.id === id)?.name;

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Optics</h1>

      <button className="button" onClick={() => openOpticForm()}>+ Add Optic</button>
      {optics.length === 0 && (
        <p className="report-note">
          No optics yet. Add a red dot, scope, or other sight to track its install date, zero, and battery.
        </p>
      )}
      {optics.map((op) => {
        const entries = normalizeBatteryLog(op.batteryLog);
        const due = isBatteryDue(op.batteryLog, new Date());
        return (
          <div className="card" key={op.id}>
            <h2>{[op.make, op.model].filter(Boolean).join(' ') || 'Unnamed optic'}</h2>
            <div className="row">
              <span className="label">Firearm</span>
              <span className="value">{gunName(op.firearmId) ?? 'Unassigned'}</span>
            </div>
            {op.installDate && (
              <div className="row">
                <span className="label">Installed</span>
                <span className="value">{formatDayKey(op.installDate)}</span>
              </div>
            )}
            <div className="row">
              <span className="label">Battery</span>
              <span className={`badge ${due ? 'warn-badge' : 'ok'}`}>{due ? 'Battery due' : 'Active'}</span>
            </div>
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
            {entries.slice(0, 3).map((e, i) => (
              <div className="row" key={i}>
                <span className="label">{e.notes || 'Battery changed'}</span>
                <span className="value">{formatDayKey(e.date)}</span>
              </div>
            ))}
            {entries.length > 3 && (
              <p className="report-note">{entries.length - 3} older entr{entries.length - 3 === 1 ? 'y' : 'ies'} hidden</p>
            )}
            <button className="button secondary" style={{ marginTop: 10 }} onClick={() => setLoggingFor(op)}>
              + Log Battery Change
            </button>

            {op.notes && <p className="note-text" style={{ marginTop: 10 }}>{op.notes}</p>}

            <button className="button secondary" style={{ marginTop: 10 }} onClick={() => openOpticForm(op.id)}>
              Edit
            </button>
          </div>
        );
      })}

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

  async function save() {
    const entry = { date, notes: notes.trim() };
    await putOne('optics', stampUpdate({ ...optic, batteryLog: [...optic.batteryLog, entry] }, Date.now()));
    onSaved();
  }

  return (
    <Sheet title="Log Battery Change" onClose={onClose}>
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

export function OpticForm({ id, firearmId, onSaved, onCancel }: {
  id?: string; firearmId?: string; onSaved: () => void; onCancel: () => void;
}) {
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
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState('');
  const [confirming, setConfirming] = useState(false);

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
        setSettingsSnapshot(o.settingsSnapshot); setNotes(o.notes);
      });
    } else if (firearmId) {
      setFirearmIdSel(firearmId);
    }
    return () => { alive = false; };
  }, [id, firearmId]);

  async function save() {
    if (!make.trim() && !model.trim()) { setProblem('Give the optic a make or model.'); return; }
    const fields = {
      firearmId: firearmIdSel, make: make.trim(), model: model.trim(),
      installDate, dotSize: dotSize.trim(), zeroDist: zeroDist.trim(),
      mountHeight: mountHeight.trim(), torqueSpec: torqueSpec.trim(),
      settingsSnapshot: settingsSnapshot.trim(), notes: notes.trim()
    };
    if (original) {
      await putOne('optics', stampUpdate({ ...original, ...fields }, Date.now()));
    } else {
      await putOne('optics', stampNew({ ...fields, batteryLog: [] }, newId('op'), Date.now()));
    }
    onSaved();
  }

  async function reallyDelete() {
    if (original) await deleteOne('optics', original.id);
    onSaved();
  }

  // Your own past makes/models, most-recent first — the creatable-combobox list.
  const makeSuggestions = recentValues(allOptics.map((o) => ({ date: String(o.updatedAt), value: o.make })));
  const modelSuggestions = recentValues(allOptics.map((o) => ({ date: String(o.updatedAt), value: o.model })));

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onCancel}>‹ Cancel</button>
        <button className="navbar-action" onClick={() => void save()}>Save</button>
      </div>
      <h1 className="large-title">{original ? 'Edit Optic' : 'New Optic'}</h1>
      {problem && <p className="form-problem">{problem}</p>}
      <div className="card">
        <label className="field">Firearm
          <select value={firearmIdSel} onChange={(e) => setFirearmIdSel(e.target.value)}>
            <option value="">Unassigned</option>
            {firearms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <SuggestField label="Make" value={make} onChange={setMake} name="fl-optic-make"
          suggestions={makeSuggestions} placeholder="Trijicon" />
        <SuggestField label="Model" value={model} onChange={setModel} name="fl-optic-model"
          suggestions={modelSuggestions} placeholder="RMR Type 2" />
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
        <label className="field">Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <button className="button" onClick={() => void save()}>{original ? 'Save Changes' : 'Add Optic'}</button>
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
