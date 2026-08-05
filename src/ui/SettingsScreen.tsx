// Settings (App & Data group). A lean preferences home: the coaching-remarks
// toggle, the shooter's own names, the manage-lists entry, and a second entry to
// the guarded "Clear all data" wipe (also kept in Tour & Setup). Preferences
// read/write through the existing settings-save path (putSettings) — no new
// storage mechanism.
import { useEffect, useState } from 'react';
import { getSettings, putSettings } from '../lib/db.ts';
import { normaliseName, normaliseStoredNames } from '../lib/shooterMatch.ts';
import type { AppSettings } from '../lib/types.ts';
import { ClearAllSheet } from './ClearAllSheet.tsx';
import type { View } from './nav.ts';

export function SettingsScreen({ onBack, open }: { onBack: () => void; open?: (v: View) => void }) {
  const [remarks, setRemarks] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [names, setNames] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [nameProblem, setNameProblem] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      const s = await getSettings<AppSettings>();
      // ownerName is deliberately NOT read here — see its note in AppSettings.
      if (alive) { setRemarks(s?.coachingRemarks !== false); setNames(normaliseStoredNames(s?.shooterNames)); setLoaded(true); }
    })();
    return () => { alive = false; };
  }, []);

  async function toggleRemarks() {
    const next = !remarks;
    setRemarks(next); // optimistic
    await putSettings<AppSettings>({ coachingRemarks: next });
  }

  // Optimistic, then put the list BACK if the write did not land. Showing a name
  // as saved when it was not is a charter §1 problem, not a cosmetic one: the
  // shooter walks away believing the import will find them, and it will not.
  // Same shape as the backup-stamp write in SyncCard.
  async function saveNames(next: string[]) {
    const before = names;
    setNames(next);
    setNameProblem('');
    try {
      await putSettings<AppSettings>({ shooterNames: next });
    } catch {
      setNames(before);
      setNameProblem('That could not be saved. Your list is unchanged — try again.');
    }
  }

  async function addName() {
    const n = draft.trim();
    if (!n) return;
    // A name that reduces to nothing — punctuation only — can never match a
    // shooter, so storing it would put a permanent no-op in the list.
    if (normaliseName(n) === '') { setNameProblem('That does not look like a name.'); return; }
    // Compare on the same normalised form the importer matches on, so the list
    // cannot hold two spellings of one person that both match the same row.
    if (names.some((x) => normaliseName(x) === normaliseName(n))) { setDraft(''); return; }
    setDraft('');
    await saveNames([...names, n]);
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn section-back" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Settings</h1>

      <div className="card">
        <h2>Coaching</h2>
        <button type="button" role="switch" aria-checked={remarks} disabled={!loaded}
          className="setting-row" onClick={() => void toggleRemarks()}>
          <span className="setting-label">
            Coaching remarks
            <span className="setting-sub">
              The short coaching read on your match debrief and its occasional questions — like
              whether there was room to push the pace. Turn off to just see the numbers.
            </span>
          </span>
          <span className={`switch${remarks ? ' on' : ''}`} aria-hidden="true"><span className="switch-thumb" /></span>
        </button>
      </div>

      <div className="card">
        <h2>Who you are</h2>
        <p className="report-note" style={{ marginBottom: 10 }}>
          The name you shoot under. When you import a match, anyone on this list is lifted to the
          top of the field so you are not scrolling past strangers to find yourself — you still
          tap the row yourself, and nothing is picked for you. Add a second name if someone else
          in the house shoots the same matches. These names stay on this device, and they travel
          inside your backup files.
        </p>
        {names.map((n) => (
          <div className="row" key={n}>
            <span className="label">{n}</span>
            <button className="button secondary" style={{ width: 'auto', padding: '6px 12px' }}
              aria-label={`Remove ${n}`}
              onClick={() => void saveNames(names.filter((x) => x !== n))}>Remove</button>
          </div>
        ))}
        <label className="field">Name as it appears in results
          <input value={draft} disabled={!loaded} placeholder="Minik, Michael"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addName(); } }} />
        </label>
        <button className="button secondary" disabled={!loaded || !draft.trim()}
          onClick={() => void addName()}>Add name</button>
        {nameProblem && <p className="report-note" role="alert" style={{ marginTop: 8 }}>{nameProblem}</p>}
      </div>

      <div className="card">
        <h2>Lists</h2>
        <button className="row-tap" onClick={() => open?.({ kind: 'manage-lists' })}>
          <span className="label">
            Manage lists
            <div className="row-sub">Rename or tidy the names your log suggests — locations, brands, vendors, and more.</div>
          </span>
          <span className="row-chev" aria-hidden="true">›</span>
        </button>
      </div>

      <div className="card">
        <h2>Clear all data / Start over</h2>
        <p className="report-note" style={{ marginBottom: 10 }}>
          Erase everything on this device and begin from an empty log — handy once you've explored the
          sample data and want to start your own. It can't be undone, and your saved backup files
          aren't affected.
        </p>
        <button className="button danger" onClick={() => setClearing(true)}>Clear all data…</button>
      </div>

      {clearing && <ClearAllSheet onClose={() => setClearing(false)} />}
    </div>
  );
}
