// The drill library: see every drill, fix its dry/live setting, gun types,
// and descriptions, or add your own (reqs. 19–20).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DrillDef, DrillSkill, GunCategory } from '../lib/types.ts';
import { GUN_CATEGORIES } from '../lib/types.ts';
import { deleteOne, getAll, getOne, putOne } from '../lib/db.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { groupDrills, SKILL_ORDER, SKILL_GROUPS } from '../lib/drillGroups.ts';
import { InfoTip } from './InfoTip.tsx';
import { FieldProblem, type SaveProblem } from './FieldProblem.tsx';
import { ConfirmSheet, DiscardChangesSheet } from './Sheet.tsx';
import { useDirtyTracker } from './useDirtyTracker.ts';
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
        <button className="back-btn section-back" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Drills <InfoTip title="Drills">Your drill library, grouped by the skill each drill trains — draw, reloads, transitions, and so on, with the eight Steel Challenge stages kept together. Each drill is also tagged by gun type and dry/live, so the session picker shows the right ones. Tap a drill to read how to run it and see your history on it, or "+ Add Drill" to create your own.</InfoTip></h1>
      <button className="button" onClick={() => openForm()}>+ Add Drill</button>
      {drills.length > 8 && <ListSearch value={q} onChange={setQ} placeholder="Search drills" />}
      {/* F5: a real empty state. The stock library (F4) makes this rare, not
          impossible — a user can delete every drill. */}
      {drills.length === 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <p className="report-note">No drills yet. Tap <strong>+ Add Drill</strong> to create your own.</p>
        </div>
      )}
      {/* Board memo 10 Sep 2026 (DRILL_GROUPING_BOARD_MEMO), decisions 1-5 all
          (a): the flat list becomes seven skill-grouped sections (plus Custom,
          shown only when it holds a drill), the exact `menu-group-title` /
          `menu-group-sub` / card pattern the More tab already uses. Search
          filters BEFORE grouping, so a query that only matches one section
          shows only that section; a query that matches nothing shows one
          line rather than a page of empty section headers. */}
      {drills.length > 0 && (() => {
        const filtered = drills.filter((d) => matchesQuery(q, d.name, d.briefDescription, d.gunCategories.join(' ')));
        const sections = groupDrills(filtered);
        if (sections.length === 0) {
          return <p className="report-note" style={{ marginTop: 16 }}>No drills match.</p>;
        }
        return sections.map((section) => (
          <div key={section.key}>
            <h2 className="menu-group-title">{section.label}</h2>
            <p className="menu-group-sub">{section.sub}</p>
            <div className="card">
              {/* Audit #15: tapping a drill expands to its full how-to (brief +
                  full description + scoring), so you no longer have to open
                  the edit form just to read what a drill is. Edit is a button
                  inside the expansion. */}
              {section.drills.map((d) => {
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
        ));
      })()}
    </div>
  );
}

export function DrillForm({ id, initialName, initialFire, initialCats, onSaved, onCancel, onDirtyChange, onSaverChange }: {
  id?: string; initialName?: string; initialFire?: DrillDef['fire'];
  initialCats?: GunCategory[]; onSaved: () => void; onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSaverChange?: (fn: (() => Promise<boolean>) | null) => void;
}) {
  const editing = id !== undefined;
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
  // Board memo 10 Sep 2026, decisions 1-5 all (a): a shooter's own drill may
  // pick one of the seven skills; blank means Custom. Never shown or edited
  // for a built-in drill (see isBuiltIn below) — its section comes from its
  // fixed id in lib/drillGroups.ts, not from this field.
  const [skill, setSkill] = useState<DrillSkill | undefined>(undefined);
  const [problem, setProblem] = useState<SaveProblem>(null);
  const nameFieldRef = useRef<HTMLInputElement>(null);
  const gunTypeCardRef = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  // AUDIT FIX (July 20 2026): edit forms wait for the getOne load before
  // seeding the dirty baseline. On new (id undefined) we start ready.
  const [loaded, setLoaded] = useState<boolean>(!editing);
  const dirty = useDirtyTracker({ name, fire, cats, brief, full, scoring, holster, skill }, loaded);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useEffect(() => {
    if (id === undefined) return;
    let alive = true;
    void getOne<DrillDef>('drills', id).then((d) => {
      if (!alive || !d) return;
      setOriginal(d);
      setName(d.name); setFire(d.fire); setCats(d.gunCategories);
      setBrief(d.briefDescription); setFull(d.fullDescription);
      setScoring(d.scoring); setHolster(d.requiresHolster);
      setSkill(d.skill);
      setLoaded(true); // AUDIT FIX
    });
    return () => { alive = false; };
  }, [id]);

  function toggleCat(c: GunCategory) {
    setCats((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
    if (problem?.field === 'cats') setProblem(null);
  }

  // ONE source of validation truth.
  function saveProblem(): SaveProblem {
    if (!name.trim()) return { field: 'name', message: 'Give the drill a name.' };
    if (cats.length === 0) return { field: 'cats', message: 'Pick at least one gun type.' };
    return null;
  }

  async function persistForm(): Promise<boolean> {
    const p = saveProblem();
    if (p) {
      setProblem(p);
      const target = p.field === 'name' ? nameFieldRef.current : gunTypeCardRef.current;
      setTimeout(() => {
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (p.field === 'name') nameFieldRef.current?.focus();
      }, 0);
      return false;
    }
    const fields = {
      name: name.trim(), fire, gunCategories: cats,
      briefDescription: brief.trim(), fullDescription: full.trim(),
      scoring: scoring.trim(), requiresHolster: holster
    };
    if (original) {
      // `skill` is optional and additive (types.ts) — write it only when set,
      // and DELETE the key rather than write '' when the shooter clears it,
      // so an absent skill stays absent instead of becoming a stored blank.
      const merged: DrillDef = { ...original, ...fields };
      if (skill) merged.skill = skill; else delete merged.skill;
      await putOne('drills', stampUpdate(merged, Date.now()));
    } else {
      // Custom drills use a 'drx-' ID so a re-import never touches them.
      await putOne('drills', stampNew({ ...fields, tags: [], ...(skill ? { skill } : {}) }, newId('drx'), Date.now()));
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

  // Audit #10: only YOUR custom drills (drx- IDs) can be deleted — the built-in
  // library drills stay put (and would return on a re-import anyway). Deleting a
  // drill definition leaves past sessions untouched (they store the drill by name).
  const isCustom = !!original && original.id.startsWith('drx');
  // Board memo 10 Sep 2026, decisions 1-5 all (a): a built-in drill's section
  // is fixed in code (lib/drillGroups.ts), never chosen on this form — the
  // Skill chooser below is hidden for it. A brand-new drill (original is
  // null) is inherently custom, so it always gets the chooser.
  const isBuiltIn = !!original && original.id.startsWith('drs-');
  async function reallyDelete() {
    if (original) await deleteOne('drills', original.id);
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
      <h1 className="large-title">{original ? 'Edit Drill' : 'New Drill'}</h1>

      <div className="card">
        <label className={`field${problem?.field === 'name' ? ' invalid' : ''}`}>What this Drill is called <span className="field-required-marker">(required)</span>
          <input
            ref={nameFieldRef}
            id="drill-name-input"
            value={name}
            onChange={(e) => { setName(e.target.value); if (problem?.field === 'name') setProblem(null); }}
            placeholder="Bill Drill"
            aria-invalid={problem?.field === 'name' || undefined}
            aria-describedby={problem?.field === 'name' ? 'drill-name-err' : undefined}
            {...noAutofillProps} name="drill-title" />
          <FieldProblem id="drill-name-err" problem={problem} field="name" />
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
        <h2 ref={gunTypeCardRef}>Gun Types It Applies To <span className="field-required-marker">(required)</span></h2>
        <FieldProblem id="drill-cats-err" problem={problem} field="cats" />
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
        {!isBuiltIn && (
          <>
            <h2 style={{ marginTop: 12 }}>Skill trained (optional)</h2>
            <p className="report-note" style={{ marginTop: -2, marginBottom: 8 }}>
              Pick the skill this drill trains. Leave it blank and it&rsquo;s listed under Custom.
            </p>
            <div className="seg wrap" role="group" aria-label="Skill trained">
              <button type="button" aria-pressed={skill === undefined}
                className={skill === undefined ? 'on' : ''} onClick={() => setSkill(undefined)}>
                None
              </button>
              {SKILL_ORDER.map((k) => (
                <button key={k} type="button" aria-pressed={skill === k}
                  className={skill === k ? 'on' : ''} onClick={() => setSkill(k)}>
                  {SKILL_GROUPS[k].label}
                </button>
              ))}
            </div>
          </>
        )}
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
      {/* Session 59 #1: completion buttons all speak "Save" (matches the
          navbar Save above and the "Save ammo"/"Save match" family). */}
      <button className="button" onClick={() => void save()}>{original ? 'Save changes' : 'Save drill'}</button>
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
