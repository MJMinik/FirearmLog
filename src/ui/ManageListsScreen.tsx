// Manage Lists: rename, combine, and hide the names your log suggests.
// Accessed via Settings → Manage lists. Data is derived from existing records
// (Option A from the spec) — no new stores, no schema change. All writes use
// existing putOne / putSettings.
import { useEffect, useState } from 'react';
import type { AppSettings, Ammunition, Firearm, Goal, Optic, Part, Purchase, Session } from '../lib/types.ts';
import { getAll, getSettings, putOne, putSettings } from '../lib/db.ts';
import {
  LIST_DEFS, collectValues, countMatches, applyRename, filterHidden,
} from '../lib/listEdits.ts';
import type { ListDef, RecordsByStore } from '../lib/listEdits.ts';
import { ScreenLoading } from './ScreenState.tsx';
import { Sheet } from './Sheet.tsx';
import { FormProblem } from './FormProblem.tsx';
import { useDirtyTracker } from './useDirtyTracker.ts';

// Extended settings type for hiddenSuggestions
interface SettingsWithHidden extends AppSettings {
  hiddenSuggestions?: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Top-level Manage Lists screen
// ---------------------------------------------------------------------------

export function ManageListsScreen({ onBack, onOpen }: {
  onBack: () => void;
  onOpen: (listId: string) => void;
}) {
  const [recordsByStore, setRecordsByStore] = useState<RecordsByStore | null>(null);
  const [hiddenSuggestions, setHiddenSuggestions] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [sessions, ammunition, firearms, purchases, parts, optics, goals, settings] =
          await Promise.all([
            getAll<Session>('sessions'),
            getAll<Ammunition>('ammunition'),
            getAll<Firearm>('firearms'),
            getAll<Purchase>('purchases'),
            getAll<Part>('parts'),
            getAll<Optic>('optics'),
            getAll<Goal>('goals'),
            getSettings<SettingsWithHidden>(),
          ]);
        if (!alive) return;
        setRecordsByStore({ sessions, ammunition, firearms, purchases, parts, optics, goals });
        setHiddenSuggestions(settings?.hiddenSuggestions ?? {});
      } catch (e) {
        if (alive) setError(String(e));
      }
    })();
    return () => { alive = false; };
  }, []);

  if (error) return <div className="screen"><div className="card"><p className="report-note">{error}</p></div></div>;
  if (!recordsByStore) return <ScreenLoading />;

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn section-back" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Manage lists</h1>

      <p className="report-note" style={{ marginBottom: 12 }}>
        Before a big cleanup, Sync &amp; Backup → Save to File gives you a restore point.
      </p>

      <p className="report-note" style={{ marginBottom: 16 }}>
        These lists come from your own log. Rename a name and your past entries follow.
      </p>

      {/* Sessions group */}
      <div className="card">
        <h2>Sessions</h2>
        {LIST_DEFS.filter((d) => d.id === 'locations' || d.id === 'instructors').map((def) => (
          <ListRow
            key={def.id}
            def={def}
            recordsByStore={recordsByStore}
            hiddenSuggestions={hiddenSuggestions}
            onOpen={() => onOpen(def.id)}
          />
        ))}
      </div>

      {/* Ammo group */}
      <div className="card">
        <h2>Ammo</h2>
        {LIST_DEFS.filter((d) => d.id === 'ammo-brands' || d.id === 'calibers').map((def) => (
          <ListRow
            key={def.id}
            def={def}
            recordsByStore={recordsByStore}
            hiddenSuggestions={hiddenSuggestions}
            onOpen={() => onOpen(def.id)}
          />
        ))}
      </div>

      {/* Money group */}
      <div className="card">
        <h2>Money</h2>
        {LIST_DEFS.filter((d) => d.id === 'vendors' || d.id === 'purchase-items').map((def) => (
          <ListRow
            key={def.id}
            def={def}
            recordsByStore={recordsByStore}
            hiddenSuggestions={hiddenSuggestions}
            onOpen={() => onOpen(def.id)}
          />
        ))}
      </div>

      {/* Gear group */}
      <div className="card">
        <h2>Gear</h2>
        {LIST_DEFS.filter((d) =>
          d.id === 'part-names' || d.id === 'optic-makes' || d.id === 'optic-models'
        ).map((def) => (
          <ListRow
            key={def.id}
            def={def}
            recordsByStore={recordsByStore}
            hiddenSuggestions={hiddenSuggestions}
            onOpen={() => onOpen(def.id)}
          />
        ))}
      </div>

      {/* Goals group */}
      <div className="card">
        <h2>Goals</h2>
        {LIST_DEFS.filter((d) => d.id === 'goal-categories').map((def) => (
          <ListRow
            key={def.id}
            def={def}
            recordsByStore={recordsByStore}
            hiddenSuggestions={hiddenSuggestions}
            onOpen={() => onOpen(def.id)}
          />
        ))}
      </div>

      <p className="report-note" style={{ margin: '4px 0 24px' }}>
        Bullet types, divisions, cost categories, and other standard lists are the same for every shooter and update with the app.
      </p>
    </div>
  );
}

function ListRow({ def, recordsByStore, hiddenSuggestions, onOpen }: {
  def: ListDef;
  recordsByStore: RecordsByStore;
  hiddenSuggestions: Record<string, string[]>;
  onOpen: () => void;
}) {
  const hiddenSet = new Set(hiddenSuggestions[def.id]?.map((v) => v.toLowerCase()) ?? []);
  const { visible, hidden } = collectValues(recordsByStore, def, hiddenSet);
  const total = visible.length + hidden.length;
  const sub = total === 0 ? 'Nothing here yet' : `${total} ${total === 1 ? 'value' : 'values'}`;
  return (
    <button className="row-tap" onClick={onOpen}>
      <span className="label">
        {def.uiName}
        <div className="row-sub">{sub}</div>
      </span>
      <span className="row-chev" aria-hidden="true">›</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// List Detail Screen
// ---------------------------------------------------------------------------

export function ListDetailScreen({ listId, onBack }: {
  listId: string;
  onBack: () => void;
}) {
  const def = LIST_DEFS.find((d) => d.id === listId);
  const [recordsByStore, setRecordsByStore] = useState<RecordsByStore | null>(null);
  const [hiddenSuggestions, setHiddenSuggestions] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Which value is currently being renamed / hidden-confirmed
  const [renaming, setRenaming] = useState<string | null>(null);
  const [hidingValue, setHidingValue] = useState<string | null>(null);

  useEffect(() => {
    if (!def) return;
    let alive = true;
    void (async () => {
      try {
        const [sessions, ammunition, firearms, purchases, parts, optics, goals, settings] =
          await Promise.all([
            getAll<Session>('sessions'),
            getAll<Ammunition>('ammunition'),
            getAll<Firearm>('firearms'),
            getAll<Purchase>('purchases'),
            getAll<Part>('parts'),
            getAll<Optic>('optics'),
            getAll<Goal>('goals'),
            getSettings<SettingsWithHidden>(),
          ]);
        if (!alive) return;
        setRecordsByStore({ sessions, ammunition, firearms, purchases, parts, optics, goals });
        setHiddenSuggestions(settings?.hiddenSuggestions ?? {});
      } catch (e) {
        if (alive) setError(String(e));
      }
    })();
    return () => { alive = false; };
  }, [def, reloadKey]);

  if (!def) return <div className="screen"><div className="card"><p className="report-note">Unknown list: {listId}</p></div></div>;
  if (error) return <div className="screen"><div className="card"><p className="report-note">{error}</p></div></div>;
  if (!recordsByStore) return <ScreenLoading />;

  const hiddenSet = new Set(hiddenSuggestions[listId]?.map((v) => v.toLowerCase()) ?? []);
  const { visible, hidden } = collectValues(recordsByStore, def, hiddenSet);

  async function doHide(value: string) {
    const current = hiddenSuggestions[listId] ?? [];
    const norm = value.toLowerCase();
    if (!current.some((v) => v.toLowerCase() === norm)) {
      const next = { ...hiddenSuggestions, [listId]: [...current, norm] };
      await putSettings<SettingsWithHidden>({ hiddenSuggestions: next });
    }
    setHidingValue(null);
    setReloadKey((k) => k + 1);
  }

  async function doUnhide(value: string) {
    const current = hiddenSuggestions[listId] ?? [];
    const norm = value.toLowerCase();
    const next = { ...hiddenSuggestions, [listId]: current.filter((v) => v.toLowerCase() !== norm) };
    await putSettings<SettingsWithHidden>({ hiddenSuggestions: next });
    setReloadKey((k) => k + 1);
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn section-back" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">{def.uiName}</h1>

      {visible.length === 0 && hidden.length === 0 && (
        <div className="card">
          <p className="report-note">Nothing here yet — names show up as you log.</p>
        </div>
      )}

      {visible.length > 0 && (
        <div className="card">
          {visible.map((value) => (
            <ValueRow
              key={value}
              value={value}
              isHidden={false}
              onRename={() => setRenaming(value)}
              onHideToggle={() => setHidingValue(value)}
              onUnhide={undefined}
            />
          ))}
        </div>
      )}

      {hidden.length > 0 && (
        <div className="card">
          <h2>Hidden</h2>
          {hidden.map((value) => (
            <ValueRow
              key={value}
              value={value}
              isHidden={true}
              onRename={() => setRenaming(value)}
              onHideToggle={undefined}
              onUnhide={() => void doUnhide(value)}
            />
          ))}
        </div>
      )}

      {renaming !== null && (
        <RenameSheet
          def={def}
          oldValue={renaming}
          recordsByStore={recordsByStore}
          hiddenSuggestions={hiddenSuggestions}
          onClose={() => setRenaming(null)}
          onDone={() => { setRenaming(null); setReloadKey((k) => k + 1); }}
        />
      )}

      {hidingValue !== null && (
        <HideConfirmSheet
          value={hidingValue}
          onConfirm={() => void doHide(hidingValue)}
          onClose={() => setHidingValue(null)}
        />
      )}
    </div>
  );
}

function ValueRow({ value, isHidden, onRename, onHideToggle, onUnhide }: {
  value: string;
  isHidden: boolean;
  onRename: () => void;
  onHideToggle?: () => void;
  onUnhide?: () => void;
}) {
  return (
    <div className="setting-row" style={{ alignItems: 'center' }}>
      <span className="setting-label" style={{ opacity: isHidden ? 0.5 : 1 }}>{value}</span>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button className="button secondary" style={{ padding: '4px 10px', fontSize: '0.85em' }}
          onClick={onRename}>
          Rename
        </button>
        {!isHidden && onHideToggle && (
          <button className="button secondary" style={{ padding: '4px 10px', fontSize: '0.85em' }}
            onClick={onHideToggle}>
            Hide
          </button>
        )}
        {isHidden && onUnhide && (
          <button className="button secondary" style={{ padding: '4px 10px', fontSize: '0.85em' }}
            onClick={onUnhide}>
            Unhide
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hide Confirm Sheet
// ---------------------------------------------------------------------------

function HideConfirmSheet({ value, onConfirm, onClose }: {
  value: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Hide from suggestions" onClose={onClose} dirty={false}>
      <p className="report-note" style={{ marginBottom: 14 }}>
        Hide '{value}' from suggestions? Your past entries keep it — it just won't be suggested.
      </p>
      <button className="button" onClick={onClose}>Cancel</button>
      <div style={{ height: 8 }} />
      <button className="button danger" onClick={onConfirm}>Hide</button>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Rename Sheet
// ---------------------------------------------------------------------------

type RenameStep =
  | { kind: 'editing' }
  | { kind: 'confirming-rename'; newValue: string; counts: Array<{ store: string; count: number; word: string }> }
  | { kind: 'confirming-combine'; newValue: string; counts: Array<{ store: string; count: number; word: string }> };

function RenameSheet({ def, oldValue, recordsByStore, hiddenSuggestions, onClose, onDone }: {
  def: ListDef;
  oldValue: string;
  recordsByStore: RecordsByStore;
  hiddenSuggestions: Record<string, string[]>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [newValue, setNewValue] = useState(oldValue);
  const [step, setStep] = useState<RenameStep>({ kind: 'editing' });
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);

  // Dirty = field has been changed from the pre-filled value
  const dirty = useDirtyTracker({ newValue }, true);
  // Only "editing" step is dirty-guarded; confirm dialogs dismiss cleanly
  const isEditing = step.kind === 'editing';

  // Is there a collision? (an existing visible value that matches newValue case-insensitively,
  // excluding the old value itself)
  function existingCollision(candidate: string): string | undefined {
    const hiddenSet = new Set(hiddenSuggestions[def.id]?.map((v) => v.toLowerCase()) ?? []);
    const { visible } = collectValues(recordsByStore, def, hiddenSet);
    const norm = candidate.trim().toLowerCase();
    return visible.find((v) =>
      v.toLowerCase() === norm && v.toLowerCase() !== oldValue.trim().toLowerCase()
    );
  }

  function buildCountRows() {
    const storeCounts = countMatches(recordsByStore, def, oldValue);
    return storeCounts
      .filter((sc) => sc.count > 0)
      .map((sc) => ({
        store: sc.store,
        count: sc.count,
        word: def.recordsWord(sc.store as Parameters<ListDef['recordsWord']>[0]),
      }));
  }

  function handleSubmit() {
    const trimmed = newValue.trim();
    if (!trimmed) { setProblem('Enter a name.'); return; }
    if (trimmed.toLowerCase() === oldValue.trim().toLowerCase() && trimmed === oldValue.trim()) {
      setProblem('The name is the same — try a different one.'); return;
    }
    // A case-change alone IS a valid rename — only block if trim+lowercase both match
    // AND it's not actually a casing change
    const collision = existingCollision(trimmed);
    const counts = buildCountRows();
    if (collision) {
      setStep({ kind: 'confirming-combine', newValue: trimmed, counts });
    } else {
      setStep({ kind: 'confirming-rename', newValue: trimmed, counts });
    }
  }

  async function doRename(targetValue: string) {
    setSaving(true);
    try {
      const now = Date.now();
      // If the old value was hidden, remove the hidden entry for it
      const currentHidden = hiddenSuggestions[def.id] ?? [];
      const oldNorm = oldValue.trim().toLowerCase();
      const newHidden = currentHidden.filter((v) => v.toLowerCase() !== oldNorm);
      if (newHidden.length !== currentHidden.length) {
        const nextHidden = { ...hiddenSuggestions, [def.id]: newHidden };
        await putSettings<SettingsWithHidden>({ hiddenSuggestions: nextHidden });
      }
      const renamed = applyRename(recordsByStore, def, oldValue, targetValue, now);
      for (const { store, record } of renamed) {
        await putOne(store, record);
      }
      onDone();
    } catch (e) {
      setProblem(String(e));
      setSaving(false);
      setStep({ kind: 'editing' });
    }
  }

  // Build the confirm message for the rename dialog
  function renameMessage(targetValue: string, counts: Array<{ store: string; count: number; word: string }>): { main: string; second?: string } {
    const isMultiStore = def.sources.length > 1;
    if (!isMultiStore) {
      const countRow = counts[0];
      const n = countRow?.count ?? 0;
      const word = countRow?.word ?? 'records';
      return {
        main: `Rename '${oldValue}' to '${targetValue}'? This updates ${n} past ${word}.`,
      };
    }

    // Multi-store: calibers or vendors — "everywhere in your log" wording
    // Build the count description from nonzero stores
    const parts: string[] = counts.map((c) => `${c.count} ${c.word}`);
    const countDesc = parts.join(' and ');
    return {
      main: `Rename '${oldValue}' to '${targetValue}'? This renames it everywhere in your log — ${countDesc}.`,
      second: 'To change just one can or gun, edit it directly instead.',
    };
  }

  function combineMessage(targetValue: string, counts: Array<{ store: string; count: number; word: string }>): { main: string; second?: string } {
    const isMultiStore = def.sources.length > 1;
    if (!isMultiStore) {
      const countRow = counts[0];
      const n = countRow?.count ?? 0;
      const word = countRow?.word ?? 'records';
      return {
        main: `'${targetValue}' already exists. Combine them? ${n} ${word} will change to '${targetValue}'.`,
      };
    }

    // Multi-store combine
    const parts: string[] = counts.map((c) => `${c.count} ${c.word}`);
    const countDesc = parts.join(' and ');
    return {
      main: `'${targetValue}' already exists. Combine them? This renames it everywhere in your log — ${countDesc}.`,
      second: 'To change just one can or gun, edit it directly instead.',
    };
  }

  // In combine mode, the surviving casing is the EXISTING value's casing
  function survivingCasing(candidateValue: string): string {
    const hiddenSet = new Set(hiddenSuggestions[def.id]?.map((v) => v.toLowerCase()) ?? []);
    const { visible } = collectValues(recordsByStore, def, hiddenSet);
    const match = visible.find(
      (v) => v.toLowerCase() === candidateValue.trim().toLowerCase()
        && v.toLowerCase() !== oldValue.trim().toLowerCase()
    );
    return match ?? candidateValue;
  }

  const sheetDirty = isEditing && dirty;

  return (
    <Sheet title="Rename" onClose={onClose} dirty={sheetDirty}>
      {isEditing && (
        <>
          <label className="field">
            New name
            <input
              autoFocus
              value={newValue}
              onChange={(e) => { setNewValue(e.target.value); setProblem(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); } }}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <FormProblem problem={problem} />
          <div style={{ height: 8 }} />
          <button className="button" onClick={handleSubmit}>Save</button>
          <div style={{ height: 8 }} />
          <button className="button secondary" onClick={onClose}>Cancel</button>
        </>
      )}

      {step.kind === 'confirming-rename' && (() => {
        const msg = renameMessage(step.newValue, step.counts);
        return (
          <>
            <p className="report-note" style={{ marginBottom: msg.second ? 8 : 14 }}>{msg.main}</p>
            {msg.second && <p className="report-note" style={{ marginBottom: 14 }}>{msg.second}</p>}
            <button className="button secondary" onClick={() => setStep({ kind: 'editing' })} disabled={saving}>
              Back
            </button>
            <div style={{ height: 8 }} />
            <button className="button" onClick={() => void doRename(step.newValue)} disabled={saving}>
              {saving ? 'Saving…' : 'Rename'}
            </button>
          </>
        );
      })()}

      {step.kind === 'confirming-combine' && (() => {
        const existing = survivingCasing(step.newValue);
        const msg = combineMessage(existing, step.counts);
        return (
          <>
            <p className="report-note" style={{ marginBottom: msg.second ? 8 : 14 }}>{msg.main}</p>
            {msg.second && <p className="report-note" style={{ marginBottom: 14 }}>{msg.second}</p>}
            <button className="button secondary" onClick={() => setStep({ kind: 'editing' })} disabled={saving}>
              Back
            </button>
            <div style={{ height: 8 }} />
            <button className="button" onClick={() => void doRename(existing)} disabled={saving}>
              {saving ? 'Saving…' : 'Combine'}
            </button>
          </>
        );
      })()}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Re-export filterHidden so suggestion sites can import from here
// ---------------------------------------------------------------------------
export { filterHidden };
