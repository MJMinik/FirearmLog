import { useEffect, useState } from 'react';
import type { Firearm, GunCategory, Reference } from '../lib/types.ts';
import { GUN_CATEGORIES } from '../lib/types.ts';
import { getAll, getOne, putOne } from '../lib/db.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { suggestReferenceMatch, type ReferenceEntry } from '../lib/referenceData.ts';
import { FormProblem } from './FormProblem.tsx';
import { noAutofillProps } from './SuggestField.tsx';

export function GunForm({ id, onSaved, onCancel }: {
  id?: string; onSaved: (gunId: string) => void; onCancel: () => void;
}) {
  const editing = id !== undefined;
  const [original, setOriginal] = useState<Firearm | null>(null);
  const [name, setName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [caliber, setCaliber] = useState('');
  const [category, setCategory] = useState<GunCategory>('Pistol');
  const [serial, setSerial] = useState('');
  const [acquired, setAcquired] = useState('');
  const [startCount, setStartCount] = useState('0');
  const [deepClean, setDeepClean] = useState('');
  const [recoilSpring, setRecoilSpring] = useState('');
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState('');
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [customRefs, setCustomRefs] = useState<Reference[]>([]);
  const [refSuggestion, setRefSuggestion] = useState<ReferenceEntry | null>(null);
  const [dismissedSuggestionId, setDismissedSuggestionId] = useState<string | null>(null);

  useEffect(() => {
    void getAll<Reference>('references').then(setCustomRefs);
  }, []);

  useEffect(() => {
    if (id === undefined) return;
    let alive = true;
    void getOne<Firearm>('firearms', id).then((g) => {
      if (!alive || !g) return;
      setOriginal(g);
      setName(g.name); setManufacturer(g.manufacturer); setModel(g.model);
      setCaliber(g.caliber); setCategory(g.category); setSerial(g.serialNumber ?? '');
      setAcquired(g.dateAcquired); setStartCount(String(g.startingRoundCount));
      setDeepClean(g.deepCleanInterval ? String(g.deepCleanInterval) : '');
      setRecoilSpring(g.recoilSpringInterval ? String(g.recoilSpringInterval) : '');
      setNotes(g.notes);
      setReferenceId(g.referenceId);
    });
    return () => { alive = false; };
  }, [editing, id]);

  // Suggest a maintenance guide that matches the manufacturer, scoped to
  // type — but only while nothing is linked and that exact suggestion
  // hasn't already been waved off. Never links automatically.
  useEffect(() => {
    if (referenceId) { setRefSuggestion(null); return; }
    const match = suggestReferenceMatch(manufacturer, category, customRefs);
    setRefSuggestion(match && match.id !== dismissedSuggestionId ? match : null);
  }, [manufacturer, category, customRefs, referenceId, dismissedSuggestionId]);

  async function save() {
    if (!name.trim()) { setProblem('Give the gun a name.'); return; }
    const start = Number(startCount);
    if (!Number.isFinite(start) || start < 0) { setProblem('Starting round count needs to be a number.'); return; }
    const dcNum = deepClean.trim() === '' ? null : Number(deepClean);
    const rsNum = recoilSpring.trim() === '' ? null : Number(recoilSpring);
    if ((dcNum !== null && !(dcNum > 0)) || (rsNum !== null && !(rsNum > 0))) {
      setProblem('Schedule intervals need to be plain round counts (or left blank).'); return;
    }
    const fields = {
      name: name.trim(), manufacturer: manufacturer.trim(), model: model.trim(),
      caliber: caliber.trim(), category, serialNumber: serial.trim() || null,
      dateAcquired: acquired, startingRoundCount: start, notes: notes.trim(),
      deepCleanInterval: dcNum, recoilSpringInterval: rsNum, referenceId
    };
    if (editing && original) {
      const updated = stampUpdate({ ...original, ...fields }, Date.now());
      await putOne('firearms', updated);
      onSaved(updated.id);
    } else {
      const created: Firearm = stampNew({
        ...fields,
        recoilSpringWeight: null,
        barrelName: null, barrelInstallDate: null, barrelStartRounds: null,
        photoIds: []
      }, newId('fa'), Date.now());
      await putOne('firearms', created);
      onSaved(created.id);
    }
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onCancel}>‹ Cancel</button>
        <button className="navbar-action" onClick={() => void save()}>Save</button>
      </div>
      <h1 className="large-title">{editing ? 'Edit Gun' : 'New Gun'}</h1>
      <FormProblem problem={problem} />

      <div className="card">
        <label className="field">What this Gun is called
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Atlas Erebus"
            {...noAutofillProps} name="gun-title" />
        </label>
        <label className="field">Made by
          <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="Atlas Gunworks" />
        </label>
        <label className="field">Model
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Erebus" />
        </label>
        <label className="field">Type
          <select value={category} onChange={(e) => setCategory(e.target.value as GunCategory)}>
            {GUN_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="field">Caliber
          <input value={caliber} onChange={(e) => setCaliber(e.target.value)} placeholder="9mm" />
        </label>
        <label className="field">Serial number
          <input value={serial} onChange={(e) => setSerial(e.target.value)} />
        </label>
        <label className="field">Date acquired
          <input type="date" value={acquired} onChange={(e) => setAcquired(e.target.value)} />
        </label>
        <label className="field">Starting round count
          <input type="number" inputMode="numeric" min="0" value={startCount} onChange={(e) => setStartCount(e.target.value)} />
        </label>
        <label className="field">Deep clean every … rounds (blank = use the linked Maintenance Guide or 10,000)
          <input type="number" inputMode="numeric" min="1" value={deepClean} onChange={(e) => setDeepClean(e.target.value)} />
        </label>
        <label className="field">Recoil spring every … rounds (blank = use the linked Maintenance Guide)
          <input type="number" inputMode="numeric" min="1" value={recoilSpring} onChange={(e) => setRecoilSpring(e.target.value)} />
        </label>
        <label className="field">Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>

      {refSuggestion && (
        <div className="card">
          <p className="report-note" style={{ marginBottom: 8 }}>
            We found a maintenance guide for <strong>{manufacturer.trim()}</strong>: <strong>{refSuggestion.name}</strong>.
            Want to link it so its care schedule fills in this gun's upkeep?
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button secondary" style={{ flex: 1 }}
              onClick={() => { setReferenceId(refSuggestion.id); setRefSuggestion(null); }}>
              Link {refSuggestion.name}
            </button>
            <button className="button secondary" style={{ flex: 1 }}
              onClick={() => setDismissedSuggestionId(refSuggestion.id)}>
              No Thanks
            </button>
          </div>
        </div>
      )}

      <button className="button" onClick={() => void save()}>{editing ? 'Save Changes' : 'Add Gun'}</button>
    </div>
  );
}
