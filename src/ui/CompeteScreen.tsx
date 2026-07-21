// The Compete tab (spec §11): matches, classifiers, classification progress,
// and the season at a glance.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScreenLoading } from './ScreenState.tsx';
import type { Classifier, Firearm, Match, Media } from '../lib/types.ts';
import { deleteOne, getAll, getOne, putOne } from '../lib/db.ts';
import { formatDayKey, todayKey } from '../lib/dates.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { DIVISIONS, MIN_SCORES_FOR_CLASSIFICATION, classificationProgress } from '../lib/competition.ts';
import { allClassifications } from '../lib/dashboard.ts';
import { matchFee } from '../lib/costing.ts';
import { competeFilterCount, competeFilterOptions, emptyCompeteFilter, matchMatchesCompeteFilter } from '../lib/competeFilter.ts';
import type { CompeteFilter } from '../lib/competeFilter.ts';
import { CompeteFilterBar } from './FilterBar.tsx';
import { MatchRow } from './MatchRow.tsx';
import { ClassificationGrid } from './ClassificationGrid.tsx';
import type { View } from './nav.ts';
import { ConfirmSheet, DiscardChangesSheet, Sheet } from './Sheet.tsx';
import { InfoTip } from './InfoTip.tsx';
import { FormProblem } from './FormProblem.tsx';
import { MediaField, commitMedia } from './MediaField.tsx';
import type { StagedFile } from './MediaField.tsx';
import { noAutofillProps } from './SuggestField.tsx';
import { ScreenError } from './ScreenState.tsx';

export function CompeteScreen({ refreshKey, open }: {
  refreshKey: number; open: (v: View) => void;
}) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [classifiers, setClassifiers] = useState<Classifier[]>([]);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [division, setDivision] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  // Audit #17: the two importers live behind one "Import…" choice so the
  // classification/season status shows sooner instead of under four buttons.
  const [showImport, setShowImport] = useState(false);
  // A3 (batch 2): the Compete match list gets the app-wide Search & Filter.
  const [filter, setFilter] = useState<CompeteFilter>(emptyCompeteFilter());

  useEffect(() => {
    let alive = true;
    setError(false);
    void Promise.all([getAll<Match>('matches'), getAll<Classifier>('classifiers'), getAll<Firearm>('firearms')]).then(([m, c, f]) => {
      if (!alive) return;
      setMatches(m.sort((a, b) => b.date.localeCompare(a.date)));
      const sorted = c.sort((a, b) => b.date.localeCompare(a.date));
      setClassifiers(sorted);
      setFirearms(f);
      setDivision((prev) => prev || sorted[0]?.division || 'Carry Optics');
      setLoaded(true);
    }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [refreshKey, reloadNonce]);

  const progress = useMemo(
    () => classificationProgress(classifiers.filter((c) => c.division === division)),
    [classifiers, division]
  );
  // Every division you hold a class in — the at-a-glance grid (shared with Home).
  const divClasses = useMemo(() => allClassifications(classifiers), [classifiers]);
  // A3 (batch 2): the match list, narrowed by the Compete filter (matches are
  // already newest-first). Options come from the matches themselves, so the
  // dropdowns only offer types/divisions you've actually shot.
  const filterOpts = useMemo(() => competeFilterOptions(matches), [matches]);
  const shownMatches = useMemo(
    () => matches.filter((m) => matchMatchesCompeteFilter(m, filter)),
    [matches, filter]
  );
  const narrowingMatches = competeFilterCount(filter) > 0;

  const thisYear = todayKey().slice(0, 4);
  const seasonMatches = matches.filter((m) => m.date.startsWith(thisYear));
  const seasonPercents = seasonMatches.map((m) => m.matchPercent).filter((p): p is number => p != null);
  // Same single-source fee math the Costs screen uses (handles old imported matches too).
  const seasonFees = seasonMatches.reduce((s, m) => s + matchFee(m), 0);

  if (error) return <ScreenError onRetry={() => setReloadNonce((n) => n + 1)} />;
  if (!loaded) return <ScreenLoading />;

  return (
    <div className="screen">
      <h1 className="large-title">Compete</h1>
      <button className="button" onClick={() => open({ kind: 'match-form' })}>+ Log Match</button>
      <div style={{ height: 8 }} />
      <button className="button secondary" onClick={() => open({ kind: 'classifier-form' })}>+ Log Classifier</button>
      <div style={{ height: 8 }} />
      <button className="button secondary" onClick={() => setShowImport(true)}>Import…</button>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Classification <InfoTip title="Classification">A classifier is a standard stage you shoot; your classification is the rank — your class — you earn from your classifier scores. Your class comes from the average of your best 6 of your last 8 classifier scores in a division. USPSA grants your first class once 4 scores are on record — until then you're unclassified. Each division is classified on its own, so any division you've logged scores in is shown here — tap one to see its progress. When that average crosses the next band, you move up — C to B and so on.</InfoTip></h2>
        <button className="link-btn" style={{ marginTop: -2, marginBottom: 8 }} onClick={() => open({ kind: 'numbers', section: 'classification' })}>How the numbers work ›</button>
        {divClasses.length === 0 ? (
          <p className="report-note" style={{ marginTop: 8 }}>
            No classifier scores yet. Log them as you shoot them and your class builds
            here, division by division.
          </p>
        ) : (
          <>
            <ClassificationGrid divisions={divClasses} selected={division} onSelect={setDivision} />
            {progress.average !== null && (
              progress.currentClass === null ? (
                <p className="report-note" style={{ marginTop: 10 }}>
                  {division}: unclassified so far — {progress.scoresOnRecord} of the {MIN_SCORES_FOR_CLASSIFICATION} scores USPSA
                  needs to grant a class. Your best-6 average so far is {progress.average}%.
                </p>
              ) : progress.next ? (
                <p className="report-note" style={{ marginTop: 10 }}>
                  {division}: {progress.next.name} class starts at {progress.next.threshold}% — you need{' '}
                  {(progress.next.threshold - progress.average).toFixed(2)} more points of average.
                </p>
              ) : (
                <p className="report-note" style={{ marginTop: 10 }}>
                  {division}: {progress.currentClass} class at {progress.average}% — top of the ladder.
                </p>
              )
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2>{thisYear} Season</h2>
        <div className="row"><span className="label">Matches shot</span><span className="value">{seasonMatches.length}</span></div>
        {seasonPercents.length > 0 && (
          <div className="row"><span className="label">Average match percent</span>
            <span className="value">{(seasonPercents.reduce((s, p) => s + p, 0) / seasonPercents.length).toFixed(1)}%</span></div>
        )}
        {seasonFees > 0 && (
          <div className="row"><span className="label">Entry fees</span><span className="value">${seasonFees.toFixed(2)}</span></div>
        )}
      </div>

      <div className="card">
        <h2>Matches</h2>
        {matches.length === 0 && <p className="report-note">No matches logged yet.</p>}
        {matches.length > 0 && (
          <CompeteFilterBar value={filter} onChange={setFilter} firearms={firearms}
            matchTypes={filterOpts.matchTypes} divisions={filterOpts.divisions}
            shown={shownMatches.length} total={matches.length} />
        )}
        {matches.length > 0 && narrowingMatches && shownMatches.length === 0 && (
          <p className="report-note">Nothing matches your search. Tap Clear to see everything again.</p>
        )}
        {shownMatches.map((m) => (
          <MatchRow key={m.id} match={m} onTap={() => open({ kind: 'match-detail', id: m.id })} />
        ))}
      </div>

      <div className="card">
        <h2>Classifiers</h2>
        {classifiers.length === 0 && <p className="report-note">No classifiers logged yet.</p>}
        {classifiers.map((c) => (
          <button className="row-tap" key={c.id} onClick={() => open({ kind: 'classifier-form', id: c.id })}>
            <span className="label">
              {c.code}{c.name ? ` — ${c.name}` : ''}
              <div className="row-sub">{formatDayKey(c.date)} · {c.division}</div>
            </span>
            <span className="value">{c.percent !== null ? `${c.percent}%` : '›'}</span>
          </button>
        ))}
      </div>

      {showImport && (
        <Sheet title="Import" onClose={() => setShowImport(false)}>
          <button className="drill-pick-row" onClick={() => { setShowImport(false); open({ kind: 'practiscore-import' }); }}>
            <strong>Import from PractiScore</strong>
            <span>Pull a match's results from a PractiScore export.</span>
          </button>
          <button className="drill-pick-row" onClick={() => { setShowImport(false); open({ kind: 'uspsa-import' }); }}>
            <strong>Import USPSA Classifiers</strong>
            <span>Bring in your classifier scores from USPSA.</span>
          </button>
        </Sheet>
      )}
    </div>
  );
}

export function ClassifierForm({ id, onSaved, onCancel, onDirtyChange, onSaverChange }: {
  id?: string; onSaved: () => void; onCancel: () => void;
  // F3 parity: reports unsaved-edits state up to App, so the exits App owns
  // (tab bar, sidebar, browser Back) show the same Discard-changes? guard this
  // form's own ‹ Cancel uses. Must be reference-stable (useCallback in App).
  onDirtyChange?: (dirty: boolean) => void;
  // Save-from-discard: reports a persist function when the form is valid, null
  // when invalid or unmounted, so App's DiscardChangesSheet can show Save.
  onSaverChange?: (fn: (() => Promise<boolean>) | null) => void;
}) {
  const [original, setOriginal] = useState<Classifier | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [date, setDate] = useState(todayKey());
  const [division, setDivision] = useState('Carry Optics');
  const [hf, setHf] = useState('');
  const [percent, setPercent] = useState('');
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState('');
  const [discarding, setDiscarding] = useState(false);
  const [touched, setTouched] = useState(false); // M4: any real user edit (bubbled change)
  const [existingMedia, setExistingMedia] = useState<Media[]>([]);
  const [removedMedia, setRemovedMedia] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<StagedFile[]>([]);

  // F3 parity: keep App's dirty flag in step with `touched`, and clear it on
  // unmount so a stale flag can never guard a navigation after this form is gone.
  useEffect(() => {
    onDirtyChange?.(touched);
    return () => onDirtyChange?.(false);
  }, [touched, onDirtyChange]);

  // F3 parity: last-resort guard for exits the app can't intercept — closing the
  // tab, a reload, typing a new URL. Best-effort on iOS Safari/PWA (often skipped);
  // the in-app exits are the real fix.
  useEffect(() => {
    if (!touched) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [touched]);

  useEffect(() => {
    if (id === undefined) return;
    let alive = true;
    void getOne<Classifier>('classifiers', id).then((c) => {
      if (!alive || !c) return;
      setOriginal(c);
      setCode(c.code); setName(c.name); setDate(c.date); setDivision(c.division);
      setHf(c.hitFactor === null ? '' : String(c.hitFactor));
      setPercent(c.percent === null ? '' : String(c.percent));
      setNotes(c.notes);
    });
    void getAll<Media>('media').then((all) => {
      if (alive) setExistingMedia(all.filter((m) => m.ownerType === 'classifier' && m.ownerId === id));
    });
    return () => { alive = false; };
  }, [id]);


  function saveProblem(): string | null {
    if (!code.trim()) return 'Enter the classifier code (like 23-01).';
    const pct = percent.trim() === '' ? null : Number(percent);
    const hfNum = hf.trim() === '' ? null : Number(hf);
    if ((pct !== null && !Number.isFinite(pct)) || (hfNum !== null && !Number.isFinite(hfNum))) {
      return 'Percent and hit factor need to be plain numbers.';
    }
    return null;
  }

  async function persistForm(): Promise<boolean> {
    const p = saveProblem();
    if (p) { setProblem(p); return false; }
    const pct = percent.trim() === '' ? null : Number(percent);
    const hfNum = hf.trim() === '' ? null : Number(hf);
    const fields = {
      code: code.trim(), name: name.trim(), date, division,
      hitFactor: hfNum, percent: pct, notes: notes.trim()
    };
    const cid = original ? original.id : newId('cl');
    const now = Date.now();
    if (original) {
      await putOne('classifiers', stampUpdate({ ...original, ...fields }, now));
    } else {
      await putOne('classifiers', stampNew(fields, cid, now));
    }
    // Photos/videos (staged until Save, like sessions and matches).
    await commitMedia('classifier', cid, newFiles, removedMedia, existingMedia.length);
    // F3 parity: the edits are saved — nothing left to guard. Clear the dirty
    // flag before onSaved navigates (its replace would otherwise hit App's guard).
    onDirtyChange?.(false);
    return true;
  }

  async function save() {
    const ok = await persistForm();
    if (ok) onSaved();
  }

  // Always-fresh saver: the ref holds the LATEST persistForm (re-pointed after
  // every render), and the reported wrapper is reference-stable so App's ref
  // write never churns. This replaces a hand-maintained dep list that could — and
  // did — go stale and save old values.
  const persistRef = useRef(persistForm);
  useEffect(() => { persistRef.current = persistForm; });
  const stablePersist = useCallback(() => persistRef.current(), []);

  // Report after every render (cheap: App just writes a ref) so the reported
  // validity can never lag the form state. Saver present ⟺ touched AND valid.
  useEffect(() => {
    onSaverChange?.(touched && saveProblem() === null ? stablePersist : null);
  });
  useEffect(() => () => onSaverChange?.(null), [onSaverChange]);

  async function reallyDelete() {
    if (original) await deleteOne('classifiers', original.id);
    // F3 parity: deleting makes any unsaved edits moot — clear the dirty flag
    // so onSaved's navigation isn't stopped by App's guard.
    onDirtyChange?.(false);
    onSaved();
  }


  return (
    <div className="screen" onChange={() => setTouched(true)}>
      <div className="navbar">
        <button className="back-btn" onClick={() => (touched ? setDiscarding(true) : onCancel())}>‹ Cancel</button>
        <button className="navbar-action" onClick={() => void save()}>Save</button>
      </div>
      <h1 className="large-title">{original ? 'Edit Classifier' : 'Log Classifier'}</h1>
      <FormProblem problem={problem} />
      {discarding && (
        <DiscardChangesSheet
          // Clear App's dirty flag BEFORE leaving: onCancel is history.back(),
          // which fires popstate — without this, App's own F3 guard would see a
          // still-dirty form and show a SECOND sheet on top of this one.
          onConfirm={() => { onDirtyChange?.(false); onCancel(); }}
          onClose={() => setDiscarding(false)}
          // Local ‹ Cancel sheet uses full save() so post-save navigation runs.
          onSave={saveProblem() === null ? () => void save() : undefined} />
      )}
      <div className="card">
        <label className="field">Classifier code
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="23-01" />
        </label>
        <label className="field">Name (optional)
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Down the Middle"
            {...noAutofillProps} name="classifier-title" />
        </label>
        <label className="field">Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">Division
          <select value={division} onChange={(e) => setDivision(e.target.value)}>
            {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="field">Hit factor
          <input type="number" inputMode="decimal" value={hf} onChange={(e) => setHf(e.target.value)} />
        </label>
        <label className="field">Percent
          <input type="number" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
        </label>
        <label className="field">Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {/* F3 parity: MediaField's remove buttons mutate staged state by click alone,
          so the setter wrappers mark the form dirty explicitly. */}
      <MediaField heading="Photos & Videos" addLabel="+ Add Photos or Videos"
        ownerType="classifier" ownerId={original?.id ?? ''}
        existingMedia={existingMedia} setExistingMedia={setExistingMedia}
        removedMedia={removedMedia} setRemovedMedia={(fn) => { setTouched(true); setRemovedMedia(fn); }}
        newFiles={newFiles} setNewFiles={(fn) => { setTouched(true); setNewFiles(fn); }} />
      <button className="button" onClick={() => void save()}>{original ? 'Save changes' : 'Save classifier'}</button>
      {original && (
        <>
          <div style={{ height: 8 }} />
          <button className="button danger" onClick={() => setConfirming(true)}>Delete Classifier</button>
        </>
      )}
      {confirming && (
        <ConfirmSheet title="Delete this classifier?"
          message="It comes out of your classification math. There's no undo."
          confirmLabel="Delete Classifier"
          onConfirm={() => void reallyDelete()}
          onClose={() => setConfirming(false)} />
      )}
    </div>
  );
}
