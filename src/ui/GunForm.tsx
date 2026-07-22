import { useCallback, useEffect, useRef, useState } from 'react';
import type { Firearm, GunCategory, Match, Reference, Session } from '../lib/types.ts';
import { GUN_CATEGORIES } from '../lib/types.ts';
import { countAll, getAll, getOne, putOne } from '../lib/db.ts';
import { roundsForFirearm } from '../lib/stats.ts';
import { activeOnly } from '../lib/softDelete.ts';
import { lifetimeFromStart, startFromLifetime } from '../lib/lifetimeRounds.ts';
import { CoachMark } from './CoachMark.tsx';
import { DiscardChangesSheet } from './Sheet.tsx';
import { useDirtyTracker } from './useDirtyTracker.ts';
import { coachMarkDismissals, dismissCoachMark } from '../lib/coachMarks.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { suggestReferenceMatch, type ReferenceEntry } from '../lib/referenceData.ts';
import { FieldProblem, type SaveProblem } from './FieldProblem.tsx';
import { noAutofillProps } from './SuggestField.tsx';
import { Reveal } from './Reveal.tsx';

export function GunForm({ id, onSaved, onCancel, onDirtyChange, onSaverChange }: {
  id?: string; onSaved: (gunId: string) => void; onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  // Save-from-guard (July 21 2026): App calls this with persistForm when the form
  // is valid, null when invalid or on unmount, so App's nav-guard sheet can offer
  // a "Save" button. Must be reference-stable (useCallback in App).
  onSaverChange?: (fn: (() => Promise<boolean>) | null) => void;
}) {
  const editing = id !== undefined;
  const [original, setOriginal] = useState<Firearm | null>(null);
  // F-Universal-Guard (July 20 2026): the ‹ Cancel button + browser Back / tab-bar
  // exit all show the shared Discard-changes? sheet if the form is dirty.
  const [discarding, setDiscarding] = useState(false);
  const [name, setName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [caliber, setCaliber] = useState('');
  const [category, setCategory] = useState<GunCategory>('Pistol');
  const [serial, setSerial] = useState('');
  const [acquired, setAcquired] = useState('');
  const [startCount, setStartCount] = useState('0');
  // A1: the shooter also sees and edits the LIFETIME total. loggedRounds is the
  // live-fire + match rounds already recorded against this gun (dry fire never
  // counts); it's 0 on a new gun. storedLifetime is the gun's lifetime as it
  // stands right now (from what's stored, not the in-progress edits) — shown as
  // a read-only reminder when editing. lifetime is the editable field, kept in
  // two-way sync with startCount through lib/lifetimeRounds.
  const [loggedRounds, setLoggedRounds] = useState(0);
  const [storedLifetime, setStoredLifetime] = useState<number | null>(null);
  const [lifetime, setLifetime] = useState('0');
  const [lifetimeClamped, setLifetimeClamped] = useState(false);
  const [deepClean, setDeepClean] = useState('');
  const [recoilSpring, setRecoilSpring] = useState('');
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<SaveProblem>(null);
  const nameFieldRef = useRef<HTMLInputElement>(null);
  const startCountFieldRef = useRef<HTMLInputElement>(null);
  const deepCleanFieldRef = useRef<HTMLInputElement>(null);
  const recoilSpringFieldRef = useRef<HTMLInputElement>(null);
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [customRefs, setCustomRefs] = useState<Reference[]>([]);
  const [refSuggestion, setRefSuggestion] = useState<ReferenceEntry | null>(null);
  const [dismissedSuggestionId, setDismissedSuggestionId] = useState<string | null>(null);
  // F9: shows the inline "Care guide linked ✓" note after the Link tap this
  // visit (never on a form that merely loaded with a link already set).
  const [justLinked, setJustLinked] = useState(false);

  useEffect(() => {
    void getAll<Reference>('references').then(setCustomRefs);
  }, []);

  // F-Universal-Guard: dirty = fields moved off their initial values. Report
  // the flag up so App's own guard fires on browser Back / tab-bar exits
  // (F3 parity), matching what SessionForm / MatchForm / ClassifierForm do.
  //
  // AUDIT FIX (July 20 2026): baseline seeding is GATED on `loaded` — see the
  // useState below. On edit, the record is fetched asynchronously (getOne(...)
  // .then), so if we seeded on first render the baseline would be empty
  // strings and the form would look dirty untouched — closing a clean edit
  // would fire "Discard changes?". The load effect flips `loaded` to true
  // once state is populated; useDirtyTracker holds off until then. On a NEW
  // gun `loaded` starts true (nothing to load) so tracking begins immediately.
  const [loaded, setLoaded] = useState<boolean>(!editing);
  // AUDIT FIX follow-up (July 20 2026): `lifetime` is populated by a SECOND
  // async effect (the A1 lifetime math below reads the gun plus every session
  // and match), which usually resolves AFTER the record load above flips
  // `loaded`. Seeding the baseline on `loaded` alone let lifetime jump from
  // its initial '0' to the real total after the baseline latched — so a clean
  // edit read dirty and Cancel fired "Discard changes?" (the exact HIGH the
  // gate exists to prevent; it was a race, which is why CI sometimes passed).
  // The tracker now waits for BOTH loads. New gun: both start true.
  const [lifetimeLoaded, setLifetimeLoaded] = useState<boolean>(!editing);
  const dirty = useDirtyTracker({
    name, manufacturer, model, caliber, category, serial, acquired,
    startCount, lifetime, deepClean, recoilSpring, notes, referenceId,
  }, loaded && lifetimeLoaded);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // Session 59: the very first gun form a newcomer sees points at Save — the
  // tap-test showed the completion affordance wasn't obvious. Only on a NEW
  // gun while the log has none (after the first save the condition retires
  // itself — earned, not dismissed), or gone for good on an explicit ✕.
  const [saveMark, setSaveMark] = useState(false);
  useEffect(() => {
    if (editing) return;
    let alive = true;
    void (async () => {
      try {
        const [guns, dismissed] = await Promise.all([countAll('firearms'), coachMarkDismissals()]);
        if (alive) setSaveMark(guns === 0 && dismissed.gunSave !== true);
      } catch { /* fail quiet: no mark beats a broken form */ }
    })();
    return () => { alive = false; };
  }, [editing]);
  const closeSaveMark = () => { setSaveMark(false); void dismissCoachMark('gunSave'); };

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
      // AUDIT FIX: flip the dirty-tracker's baseline gate ONLY after fields
      // are populated — the useDirtyTracker call above waits for this flag.
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [editing, id]);

  // A1: when editing, work out how many rounds are already LOGGED against this
  // gun (live fire + matches; dry fire never counts) by reading the same
  // roundsForFirearm math every screen uses, then subtracting the ORIGINAL
  // stored starting count. That gives the fixed "logged" floor the two-way sync
  // needs, and the gun's lifetime as it stands right now for the read-only line.
  // Read-only: this effect never writes sessions or matches.
  useEffect(() => {
    if (id === undefined) return;
    let alive = true;
    void (async () => {
      const [g, sessions, matches] = await Promise.all([
        getOne<Firearm>('firearms', id),
        getAll<Session>('sessions'),
        getAll<Match>('matches')
      ]);
      if (!alive || !g) return;
      // Mirror the gun-detail stat exactly: trashed sessions don't count toward
      // lifetime rounds there (activeOnly), so they must not count here either —
      // otherwise the read-only "right now" line would disagree with the gun's
      // own page.
      const total = roundsForFirearm(g.id, [g], activeOnly(sessions), matches);
      const logged = total - g.startingRoundCount;
      setLoggedRounds(logged);
      setStoredLifetime(total);
      setLifetime(String(total));
      // AUDIT FIX follow-up: only now is the full signature at its true
      // loaded values — release the dirty-tracker's baseline gate.
      setLifetimeLoaded(true);
    })();
    return () => { alive = false; };
  }, [id]);

  // Suggest a maintenance guide that matches the manufacturer, scoped to
  // type — but only while nothing is linked and that exact suggestion
  // hasn't already been waved off. Never links automatically.
  useEffect(() => {
    if (referenceId) { setRefSuggestion(null); return; }
    const match = suggestReferenceMatch(manufacturer, category, customRefs);
    setRefSuggestion(match && match.id !== dismissedSuggestionId ? match : null);
  }, [manufacturer, category, customRefs, referenceId, dismissedSuggestionId]);

  // A1: the two fields are two views of one number (lifetime = start + logged).
  // Editing either updates the other through the pure helpers. An empty box is
  // left mid-typing (the shooter is between digits); only a real number syncs.
  function onStartChange(v: string) {
    setStartCount(v);
    setLifetimeClamped(false);
    if (v.trim() === '') return;
    const n = Number(v);
    if (Number.isFinite(n)) setLifetime(String(lifetimeFromStart(n, loggedRounds)));
  }
  function onLifetimeChange(v: string) {
    setLifetime(v);
    // Clear any stale clamp note while the shooter is actively typing — the
    // value is in flux, so don't accuse it of being too low yet.
    setLifetimeClamped(false);
    if (v.trim() === '') return;
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    // Keep the starting-count box in LIVE two-way sync (floored at 0 by the
    // helper so it never shows a negative), but DON'T snap the lifetime box or
    // raise the note here. Snapping on every keystroke corrupts select-all-and-
    // retype: with 3,000 logged, typing "8000" would clamp on the leading "8",
    // snap the box to "3000", then append the rest → "30000…". The clamp + snap
    // happens once, on blur (below) or at save.
    const { start } = startFromLifetime(n, loggedRounds);
    setStartCount(String(start));
  }
  // A1: reconcile once the shooter leaves the field. A lifetime below what's
  // already logged is impossible, so snap the box down to the logged floor and
  // explain it — now both boxes show EXACTLY what a save would store (lifetime =
  // logged, starting count = 0). Save is the backstop: startCount is already
  // floored at 0 by the live sync above, so a save without an intervening blur
  // still stores the correct clamped value.
  function onLifetimeBlur() {
    if (lifetime.trim() === '') return;
    const n = Number(lifetime);
    if (!Number.isFinite(n)) return;
    const { start, clamped } = startFromLifetime(n, loggedRounds);
    setStartCount(String(start));
    setLifetimeClamped(clamped);
    if (clamped) setLifetime(String(loggedRounds));
  }

  // ONE source of validation truth: both the Save button and the
  // unsaved-changes sheet's Save option consult this.
  // Derived name: when name is blank but Made by and/or Model have text,
  // propose "[Made by] [Model]" trimmed. Committed as the real name on save.
  const derivedName = [manufacturer.trim(), model.trim()].filter(Boolean).join(' ');

  function saveProblem(): SaveProblem {
    if (!name.trim() && !derivedName) {
      return { field: 'name', message: 'Give the gun a name — or fill in Made by and Model and we\'ll name it for you.' };
    }
    const start = Number(startCount);
    if (!Number.isFinite(start) || start < 0) return { field: 'startCount', message: 'Rounds fired before FirearmLog needs to be a number.' };
    const dcNum = deepClean.trim() === '' ? null : Number(deepClean);
    const rsNum = recoilSpring.trim() === '' ? null : Number(recoilSpring);
    if (dcNum !== null && !(dcNum > 0)) {
      return { field: 'deepClean', message: 'Schedule intervals need to be plain round counts (or left blank).' };
    }
    if (rsNum !== null && !(rsNum > 0)) {
      return { field: 'recoilSpring', message: 'Schedule intervals need to be plain round counts (or left blank).' };
    }
    return null;
  }

  // Persist the form's current state. Returns the saved gun id on success, null
  // on validation failure (which also sets the problem message). Used by both the
  // Save button (which then navigates via onSaved) and the nav-guard sheet's Save.
  async function persistForm(): Promise<string | null> {
    const p = saveProblem();
    if (p) {
      setProblem(p);
      const fieldRef =
        p.field === 'startCount' ? startCountFieldRef :
        p.field === 'deepClean' ? deepCleanFieldRef :
        p.field === 'recoilSpring' ? recoilSpringFieldRef :
        nameFieldRef;
      setTimeout(() => {
        fieldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        fieldRef.current?.focus();
      }, 0);
      return null;
    }
    // Commit derived name if name field was blank
    const effectiveName = name.trim() || derivedName;
    const start = Number(startCount);
    const dcNum = deepClean.trim() === '' ? null : Number(deepClean);
    const rsNum = recoilSpring.trim() === '' ? null : Number(recoilSpring);
    const fields = {
      name: effectiveName, manufacturer: manufacturer.trim(), model: model.trim(),
      caliber: caliber.trim(), category, serialNumber: serial.trim() || null,
      dateAcquired: acquired, startingRoundCount: start, notes: notes.trim(),
      deepCleanInterval: dcNum, recoilSpringInterval: rsNum, referenceId
    };
    if (editing && original) {
      const updated = stampUpdate({ ...original, ...fields }, Date.now());
      await putOne('firearms', updated);
      // F-Universal-Guard: clear before navigating so App's guard doesn't
      // stop the onSaved replace() with a second discard sheet.
      onDirtyChange?.(false);
      return updated.id;
    } else {
      const created: Firearm = stampNew({
        ...fields,
        recoilSpringWeight: null,
        barrelName: null, barrelInstallDate: null, barrelStartRounds: null,
        photoIds: []
      }, newId('fa'), Date.now());
      await putOne('firearms', created);
      onDirtyChange?.(false);
      return created.id;
    }
  }

  async function save() {
    const gid = await persistForm();
    if (gid) onSaved(gid);
  }

  // Always-fresh saver: the ref holds the LATEST persistForm (re-pointed after
  // every render), and the reported wrapper is reference-stable so App's ref
  // write never churns. This replaces a hand-maintained dep list that could — and
  // did — go stale and save old values.
  const persistRef = useRef(persistForm);
  useEffect(() => { persistRef.current = persistForm; });
  const stablePersist = useCallback(async (): Promise<boolean> => {
    const gid = await persistRef.current();
    return gid !== null;
  }, []);

  // Report after every render (cheap: App just writes a ref) so the reported
  // validity can never lag the form state. Saver present ⟺ dirty AND valid.
  useEffect(() => {
    onSaverChange?.(dirty && saveProblem() === null ? stablePersist : null);
  });
  useEffect(() => () => onSaverChange?.(null), [onSaverChange]);

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
          // Local ‹ Cancel sheet uses full save() so post-save navigation runs.
          onSave={saveProblem() === null ? () => void save() : undefined} />
      )}
      {/* Session 59: anchored right under the navbar, arrow up at Save. */}
      {saveMark && (
        <CoachMark arrow="up-right" onDismiss={closeSaveMark}>
          Fill in what you know — you can add more later. When you&rsquo;re done, tap Save.
        </CoachMark>
      )}
      <h1 className="large-title">{editing ? 'Edit Gun' : 'New Gun'}</h1>


      <div className="card">
        <label className={`field${problem?.field === 'name' ? ' invalid' : ''}`}>What this Gun is called
          <input
            ref={nameFieldRef}
            id="gun-name-input"
            value={name}
            onChange={(e) => { setName(e.target.value); if (problem?.field === 'name') setProblem(null); }}
            placeholder={name.trim() === '' && derivedName ? derivedName : 'Atlas Erebus'}
            aria-invalid={problem?.field === 'name' || undefined}
            aria-describedby={problem?.field === 'name' ? 'gun-name-err' : undefined}
            {...noAutofillProps} name="gun-title" />
          <FieldProblem id="gun-name-err" problem={problem} field="name" />
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
        <label className="field">Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {/* Progressive disclosure: a newcomer's first gun needs name/make/model/type/
            caliber (+ a note). Serial, dates, the starting count, and the maintenance
            intervals (all with safe defaults) live behind a reveal. Values stay in form
            state, so an unopened block saves the same defaults as leaving them blank. */}
        <Reveal label="More details">
          <label className="field">Serial number
            <input value={serial} onChange={(e) => setSerial(e.target.value)} />
          </label>
          <label className="field">Date acquired
            <input type="date" value={acquired} onChange={(e) => setAcquired(e.target.value)} />
          </label>
          {/* A1: while editing, show the gun's lifetime as it stands now, so the
              shooter knows what the two boxes below add up to. Skipped on a new
              gun — nothing is logged yet, so the two fields are simply equal. */}
          {editing && storedLifetime !== null && (
            <p className="report-note">
              Lifetime rounds right now: {storedLifetime.toLocaleString()} — live fire and matches; dry fire never counts.
            </p>
          )}
          {/* A1: the stored field is still startingRoundCount only. "Rounds fired
              before FirearmLog" edits it directly; "Lifetime rounds (total)" edits
              the same number the other way (lifetime = this + rounds logged here). */}
          <label className={`field${problem?.field === 'startCount' ? ' invalid' : ''}`}>Rounds fired before FirearmLog
            <input
              ref={startCountFieldRef}
              id="gun-startcount-input"
              type="number" inputMode="numeric" min="0"
              value={startCount}
              onChange={(e) => { onStartChange(e.target.value); if (problem?.field === 'startCount') setProblem(null); }}
              aria-invalid={problem?.field === 'startCount' || undefined}
              aria-describedby={problem?.field === 'startCount' ? 'gun-startcount-err' : undefined} />
            <FieldProblem id="gun-startcount-err" problem={problem} field="startCount" />
          </label>
          {/* A1: gate the lifetime view to editing (like the read-only line above).
              On a new gun loggedRounds is always 0, so lifetime = starting count —
              a second box for the same number would only confuse. */}
          {editing && (
            <label className="field">Lifetime rounds (total)
              <input type="number" inputMode="numeric" min="0" value={lifetime} onChange={(e) => onLifetimeChange(e.target.value)} onBlur={onLifetimeBlur} />
            </label>
          )}
          {lifetimeClamped && (
            <p className="report-note">
              You've already logged {loggedRounds.toLocaleString()} rounds with this gun, so its lifetime can't be lower than that. Rounds fired before FirearmLog is set to 0.
            </p>
          )}
          <label className={`field${problem?.field === 'deepClean' ? ' invalid' : ''}`}>Deep clean every … rounds (blank = use the linked Maintenance Guide or 10,000)
            <input
              ref={deepCleanFieldRef}
              id="gun-deepclean-input"
              type="number" inputMode="numeric" min="1"
              value={deepClean}
              onChange={(e) => { setDeepClean(e.target.value); if (problem?.field === 'deepClean') setProblem(null); }}
              aria-invalid={problem?.field === 'deepClean' || undefined}
              aria-describedby={problem?.field === 'deepClean' ? 'gun-deepclean-err' : undefined} />
            <FieldProblem id="gun-deepclean-err" problem={problem} field="deepClean" />
          </label>
          <label className={`field${problem?.field === 'recoilSpring' ? ' invalid' : ''}`}>Recoil spring every … rounds (blank = use the linked Maintenance Guide)
            <input
              ref={recoilSpringFieldRef}
              id="gun-recoilspring-input"
              type="number" inputMode="numeric" min="1"
              value={recoilSpring}
              onChange={(e) => { setRecoilSpring(e.target.value); if (problem?.field === 'recoilSpring') setProblem(null); }}
              aria-invalid={problem?.field === 'recoilSpring' || undefined}
              aria-describedby={problem?.field === 'recoilSpring' ? 'gun-recoilspring-err' : undefined} />
            <FieldProblem id="gun-recoilspring-err" problem={problem} field="recoilSpring" />
          </label>
        </Reveal>
      </div>

      {/* Session 59 #1 (Michael): the form's two completion buttons say the
          same word now — navbar "Save" + bottom "Save gun" — one action, one
          vocabulary. Both stay: the bottom is the thumb-reach finish on a
          long phone form (rule 4), the navbar is the app-wide convention. */}
      <button className="button" onClick={() => void save()}>{editing ? 'Save changes' : 'Save gun'}</button>

      {/* F7: the prompt lives BELOW the save button, so its appearing
          mid-typing can never shove the save button out from under a tap. */}
      {refSuggestion && (
        <div className="card" style={{ marginTop: 16 }}>
          <p className="report-note" style={{ marginBottom: 8 }}>
            {/* F8: when the maker IS the guide's name, say it once. */}
            {manufacturer.trim().toLowerCase() === refSuggestion.name.toLowerCase() ? (
              <>We found a maintenance guide for <strong>{refSuggestion.name}</strong>.{' '}</>
            ) : (
              <>We found a maintenance guide for <strong>{manufacturer.trim()}</strong>: <strong>{refSuggestion.name}</strong>.{' '}</>
            )}
            Want to link it so its care schedule fills in this gun's upkeep?
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button secondary" style={{ flex: 1 }}
              onClick={() => { setReferenceId(refSuggestion.id); setRefSuggestion(null); setJustLinked(true); }}>
              Link {refSuggestion.name}
            </button>
            <button className="button secondary" style={{ flex: 1 }}
              onClick={() => setDismissedSuggestionId(refSuggestion.id)}>
              No Thanks
            </button>
          </div>
        </div>
      )}

      {/* F9: linking used to just vanish the prompt — confirm it plainly. */}
      {justLinked && referenceId && (
        <p className="report-note" style={{ marginTop: 12, textAlign: 'center' }}>Care guide linked ✓</p>
      )}
    </div>
  );
}
