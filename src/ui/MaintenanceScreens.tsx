// Maintenance: the all-guns overview (More → Maintenance) and the log form.
import { useEffect, useState } from 'react';
import type { Firearm, MaintenanceEntry, Reference, Session } from '../lib/types.ts';
import { getAll, getOne, putOne } from '../lib/db.ts';
import { todayKey } from '../lib/dates.ts';
import { newId } from '../lib/id.ts';
import { stampNew } from '../lib/stamps.ts';
import { MAINT_TYPES, maintLabel, maintenanceStatus } from '../lib/maintenance.ts';
import { buildRefLookup } from '../lib/referenceData.ts';
import { InfoTip } from './InfoTip.tsx';

export function MaintenanceOverview({ refreshKey, onBack, openGun, logFor }: {
  refreshKey: number; onBack: () => void;
  openGun: (id: string) => void; logFor: (gunId: string) => void;
}) {
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceEntry[]>([]);
  const [references, setReferences] = useState<Reference[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      getAll<Firearm>('firearms'), getAll<Session>('sessions'),
      getAll<MaintenanceEntry>('maintenance'), getAll<Reference>('references')
    ]).then(([f, s, m, r]) => {
      if (!alive) return;
      setFirearms(f.sort((a, b) => a.name.localeCompare(b.name)));
      setSessions(s);
      setMaintenance(m);
      setReferences(r);
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [refreshKey]);

  if (!loaded) return <div className="screen" />;
  const now = new Date();
  const lookup = buildRefLookup(references);

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Maintenance <InfoTip title="Maintenance">Cleaning and parts work per gun, against each gun's schedule. Home warns you when something's due.</InfoTip></h1>
      {firearms.map((gun) => {
        const items = maintenanceStatus(gun, lookup(gun.referenceId), sessions, maintenance, firearms, now);
        return (
          <div className="card" key={gun.id}>
            <h2>{gun.name}</h2>
            {items.map((it) => (
              <div className="row" key={it.type}>
                <span className="label">
                  {it.label}
                  <div className="row-sub">{it.detail}</div>
                </span>
                <span className={`badge ${it.level === 'due' ? 'bad' : it.level === 'warn' ? 'warn-badge' : 'ok'}`}>
                  {it.level === 'due' ? 'Due' : it.level === 'warn' ? 'Soon' : it.level === 'info' ? 'Note' : 'OK'}
                </span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="button secondary" style={{ flex: 1 }} onClick={() => logFor(gun.id)}>+ Log Work</button>
              <button className="button secondary" style={{ flex: 1 }} onClick={() => openGun(gun.id)}>Open Gun</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MaintenanceForm({ gunId, onSaved, onCancel }: {
  gunId: string; onSaved: () => void; onCancel: () => void;
}) {
  const [gunName, setGunName] = useState('');
  const [type, setType] = useState('field_strip');
  const [date, setDate] = useState(todayKey());
  const [performedBy, setPerformedBy] = useState('Self');
  const [parts, setParts] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    void getOne<Firearm>('firearms', gunId).then((g) => { if (g) setGunName(g.name); });
  }, [gunId]);

  async function save() {
    await putOne('maintenance', stampNew({
      date, firearmId: gunId, type,
      performedBy: performedBy.trim(), partsReplaced: parts.trim(), notes: notes.trim()
    }, newId('ma'), Date.now()));
    onSaved();
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onCancel}>‹ Cancel</button>
        <button className="navbar-action" onClick={() => void save()}>Save</button>
      </div>
      <h1 className="large-title">Log Work{gunName ? ` — ${gunName}` : ''}</h1>
      <div className="card">
        <label className="field">What was done
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {MAINT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="field">Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">Done by
          <input value={performedBy} onChange={(e) => setPerformedBy(e.target.value)} />
        </label>
        <label className="field">Parts replaced
          <input value={parts} onChange={(e) => setParts(e.target.value)} placeholder="Recoil spring, 10 lb" />
        </label>
        <label className="field">Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <button className="button" onClick={() => void save()}>Save {maintLabel(type)}</button>
    </div>
  );
}
