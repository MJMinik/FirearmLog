// The drill library: see every drill, fix its dry/live setting, gun types,
// and descriptions, or add your own (reqs. 19–20).
import { useEffect, useState } from 'react';
import type { DrillDef, GunCategory } from '../lib/types.ts';
import { GUN_CATEGORIES } from '../lib/types.ts';
import { deleteOne, getAll, getOne, putOne } from '../lib/db.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { InfoTip } from './InfoTip.tsx';
import { FormProblem } from './FormProblem.tsx';
import { ConfirmSheet } from './Sheet.tsx';
import { ScreenError } from './ScreenState.tsx';
import { noAutofillProps } from './SuggestField.tsx';
import { ListSearch, matchesQuery } from './ListSearch.tsx';

const FIRE_LABEL: Record<DrillDef['fire'], string> = {
  live: 'Live fire', dry: 'Dry fire', both: 'Live & dry'
};

export function DrillsScreen({ refreshKey, onBack, openForm, openHistory }: {
  refreshKey: number; onBack: () => void; openForm: (id?: string) => void;
  openHistory: (name: string) => void;
}) {
  const [drills, setDrills] = useState<DrillDef[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(false);
    void (async () => {
      try {
        const d = await getAll<DrillDef>('drills');
        if (alive) setDrills(d.sort((a, b) => a.name.localeCompare(b.name)));
      } catch (e) {
        console.error('Drills load failed', e);
        if (alive) setError(true);
      }
    })();
    return () => { alive = false; };
  }, [refreshKey, nonce]);

  if (error) return <ScreenError onRetry={() => setNonce((n) => n + 1)} />;

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Drills <InfoTip title="Drills">Your drill library. Each drill is tagged by gun type and dry/live, so the session picker shows the right ones. Tap a drill to read how to run it and see your history on it, or "+ Add Drill" to create your own.</InfoTip></h1>
      <button className="button" onClick={() => openForm()}>+ Add Drill</button>
      {drills.length > 8 && <ListSearch value={q} onChange={setQ} placeholder="Search drills" />}
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Drill Library</h2>
        {/* Audit #15: tapping a drill expands to its full how-to (brief + full
            description + scoring), so you no longer have to open the edit form
            just to read what a drill is. Edit is a button inside the expansion. */}
        {drills.filter((d) => matchesQuery(q, d.name, d.briefDescription, d.gunCategories.join(' '))).map((d) => {
          const open = expanded === d.id;
          return (
            <div key={d.id}>
              <button className="row-tap" aria-expanded={open}
                onClick={() => setExpanded(open ? null : d.id)}>
                <span className="label">
                  {d.name}
                  <div className="row-sub">{FIRE_LABEL[d.fire]} · {d.gunCategories.join(', ') || 'Any gun'}</div>
                  {d.briefDescription && <div className="row-sub">{d.briefDescription}</div>}
                </span>
                <span className="value">{open ? '▾' : '›'}</span>
              </button>
              {open && (
                <div style={{ padding: '2px 2px 10px' }}>
                  {d.fullDescription && <p className="note-text">{d.fullDescription}</p>}
                  {d.scoring && <p className="report-note">Scoring: {d.scoring}</p>}
                  {d.requiresHolster && <p className="report-note">Needs a holster.</p>}
                  <div style={{ marginBottom: 8 }}>
                    <button className="link-btn" onClick={() => openHistory(d.name)}>View your history ›</button>
                  </div>
                  <button className="button secondary" onClick={() => openForm(d.id)}>Edit Drill</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DrillForm({ id, initialName, initialFire, initialCats, onSaved, onCancel }: {
  id?: string; initialName?: string; initialFire?: DrillDef['fire'];
  initialCats?: GunCategory[]; onSaved: () => void; onCancel: () => void;
}) {
  const [original, setOriginal] = useState<DrillDef | null>(null);
  // For a brand-new drill, seed from any values handed in (e.g. the name and
  // context the shooter already typed in the session quick-add) so nothing is lost
  // when they escalate to the full editor.
  const [name, setName] = useState(initialName ?? '');
  const [fire, setFire] = useState<DrillDef['fire']>(initialFire ?? 'live');
  const [cats, setCats] = useState<GunCategory[]>(initialCats && initialCats.length ? initialCats : ['Pistol']);
  const [brief, setBrief] = useState('');
  const [full, setFull] = useState('');
  const [scoring, setScoring] = useState('');
  const [holster, setHolster] = useState(false);
  const [problem, setProblem] = useState('');
  const [confirming, setConfirming] = useState(false);

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

  // Audit #10: only YOUR custom drills (drx- IDs) can be deleted — the built-in
  // library drills stay put (and would return on a re-import anyway). Deleting a
  // drill definition leaves past sessions untouched (they store the drill by name).
  const isCustom = !!original && original.id.startsWith('drx');
  async function reallyDelete() {
    if (original) await deleteOne('drills', original.id);
    onSaved();
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onCancel}>‹ Cancel</button>
        <button className="navbar-action" onClick={() => void save()}>Save</button>
      </div>
      <h1 className="large-title">{original ? 'Edit Drill' : 'New Drill'}</h1>
      <FormProblem problem={problem} />

      <div className="card">
        <label className="field">What this Drill is called
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bill Drill"
            {...noAutofillProps} name="drill-title" />
        </label>
        <h2 style={{ marginTop: 4 }}>Fire Type</h2>
        <div className="seg" role="group" aria-label="Fire type">
          {(['live', 'dry', 'both'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={fire === f}
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
      <button className="button" onClick={() => void save()}>{original ? 'Save changes' : 'Add Drill'}</button>
      {isCustom && (
        <button className="button danger" style={{ marginTop: 8 }} onClick={() => setConfirming(true)}>
          Delete drill
        </button>
      )}
      {confirming && (
        <ConfirmSheet
          title="Delete this drill?"
          message="It's removed from your drill library. Sessions that used it keep their record. There's no undo."
          confirmLabel="Delete drill"
          onConfirm={() => void reallyDelete()}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
