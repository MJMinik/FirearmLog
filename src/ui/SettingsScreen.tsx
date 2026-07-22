// Settings (App & Data group). A lean preferences home: the coaching-remarks
// toggle, manage-lists entry, and a second entry to the guarded "Clear all data"
// wipe (also kept in Tour & Setup). Preferences read/write through the existing
// settings-save path (putSettings) — no new storage mechanism.
import { useEffect, useState } from 'react';
import { getSettings, putSettings } from '../lib/db.ts';
import type { AppSettings } from '../lib/types.ts';
import { ClearAllSheet } from './ClearAllSheet.tsx';
import type { View } from './nav.ts';

export function SettingsScreen({ onBack, open }: { onBack: () => void; open?: (v: View) => void }) {
  const [remarks, setRemarks] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const s = await getSettings<AppSettings>();
      if (alive) { setRemarks(s?.coachingRemarks !== false); setLoaded(true); }
    })();
    return () => { alive = false; };
  }, []);

  async function toggleRemarks() {
    const next = !remarks;
    setRemarks(next); // optimistic
    await putSettings<AppSettings>({ coachingRemarks: next });
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
