// The drill library: see every drill, fix its dry/live setting, gun types,
// and descriptions, or add your own (reqs. 19–20).
import { useEffect, useState } from 'react';
import type { DrillDef, GunCategory } from '../lib/types.ts';
import { GUN_CATEGORIES } from '../lib/types.ts';
import { getAll, getOne, putOne } from '../lib/db.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';

const FIRE_LABEL: Record<DrillDef['fire'], string> = {
  live: 'Live fire', dry: 'Dry fire', both: 'Live & dry'
};

export function DrillsScreen({ refreshKey, onBack, openForm }: {
  refreshKey: number; onBack: () => void; openForm: (id?: string) => void;
}) {
  const [drills, setDrills] = useState<DrillDef[]>([]);
  useEffect(() => {
    let alive = true;
    void getAll<DrillDef>('drills').then((d) => {
      if (alive) setDrills(d.sort((a, b) => a.name.localeCompare(b.name)));
    });
    return () => { alive = false; };
  }, [refreshKey]);

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Drills</h1>
      <button className="button" onClick={() => openForm()}>+ Add Drill</button>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Drill Library</h2>
        {drills.map((d) => (
          <button className="row-tap" key={d.id} onClick={() => openForm(d.id)}>
            <span className="label">
              {d.name}
              <div className="row-sub">{FIRE_LABEL[d.fire]} · {d.gunCategories.join(', ') || 'Any gun'}</div>
            </span>
            <span className="value">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function DrillForm({ id, onSaved, onCancel }: {
  id?: string; onSaved: () => void; onCancel: () => void;
}) {
  const [original, setOriginal] = useState<DrillDef | null>(null);
  const [name, setName] = useState('');
  const [fire, setFire] = useState<DrillDef['fire']>('live');
  const [cats, setCats] = useState<GunCategory[]>(['Pistol']);
  const [brief, setBrief] = useState('');
  const [full, setFull] = useState('');
  const [scoring, setScoring] = useState('');
  const [holster, setHolster] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    if (id === undefined) return;
    let alive = true;
    void getOne<DrillDef>('drills', id).then((d) => {
      if (!alive || !d) return;
      setOriginal(d);
      setName(d.name); setFire(d.fire); setCats(d.gunCategories);
      setBrief(d.briefDescription); setFull(d.fullDescription);
      setScoring(d.scoring); setHolster(d.requiresHolster);
    });
    return () => { alive = false; };
  }, [id]);

  function toggleCat(c: GunCategory) {
    setCats((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  }

  async function save() {
    if (!name.trim()) { setProblem('Give the drill a name.'); return; }
    if (cats.length === 0) { setProblem('Pick at least one gun type.'); return; }
    const fields = {
      name: name.trim(), fire, gunCategories: cats,
      briefDescription: brief.trim(), fullDescription: full.trim(),
      scoring: scoring.trim(), requiresHolster: holster
    };
    if (original) {
      await putOne('drills', stampUpdate({ ...original, ...fields }, Date.now()));
    } else {
      // Custom drills use a 'drx-' ID so a re-import never touches them.
      await putOne('drills', stampNew({ ...fields, tags: [] }, newId('drx'), Date.now()));
    }
    onSaved();
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onCancel}>‹ Cancel</button>
        <button className="navbar-action" onClick={() => void save()}>Save</button>
      </div>
      <h1 className="large-title">{original ? 'Edit Drill' : 'New Drill'}</h1>
      {problem && <p className="form-problem">{problem}</p>}

      <div className="card">
        <label className="field">Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bill Drill" />
        </label>
        <h2 style={{ marginTop: 4 }}>Fire Type</h2>
        <div className="seg" role="radiogroup" aria-label="Fire type">
          {(['live', 'dry', 'both'] as const).map((f) => (
            <button key={f} role="radio" aria-checked={fire === f}
              className={fire === f ? 'on' : ''} onClick={() => setFire(f)}>
              {FIRE_LABEL[f]}
            </button>
          ))}
        </div>
        <h2>Gun Types It Applies To</h2>
        {GUN_CATEGORIES.map((c) => {
          const on = cats.includes(c);
          return (
            <div className="row" key={c}>
              <button className={`gun-toggle ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggleCat(c)}>
                {c}
              </button>
            </div>
          );
        })}
        <label className="field" style={{ marginTop: 12 }}>Short description
          <input value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="6 shots from holster at 7 yards." />
        </label>
        <label className="field">Full description (shown when expanded)
          <textarea rows={4} value={full} onChange={(e) => setFull(e.target.value)} />
        </label>
        <label className="field">Scoring (time, points, pass/fail…)
          <input value={scoring} onChange={(e) => setScoring(e.target.value)} />
        </label>
        <div className="row">
          <button className={`gun-toggle ${holster ? 'on' : ''}`} aria-pressed={holster}
            onClick={() => setHolster(!holster)}>
            Needs a holster
          </button>
        </div>
      </div>
      <button className="button" onClick={() => void save()}>{original ? 'Save Changes' : 'Add Drill'}</button>
    </div>
  );
}
