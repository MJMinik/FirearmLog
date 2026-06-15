// First-run Setup Wizard (M9 — Help & Tour, chunk 2; spec §14.3).
// Shown automatically the first time the app opens with an empty log, and
// re-runnable any time from More → Help & Tour. It only composes pieces that
// already exist — the tested Pistol Tracker importer (ImportFlow) and a "start
// fresh" that writes nothing — so there's no new data-handling code here.
// (CSV / other-app import is deferred with the rest of the importers.)
import { useState } from 'react';
import { ImportFlow } from './ImportFlow.tsx';

export function SetupWizard({ onFinish, onCancel }: {
  onFinish: () => void; // mark setup done + return to Home
  onCancel: () => void; // leave without choosing (re-run case)
}) {
  const [mode, setMode] = useState<'choose' | 'import'>('choose');

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={mode === 'import' ? () => setMode('choose') : onCancel}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Set up FirearmLog</h1>

      {mode === 'choose' && (
        <>
          <p className="report-note" style={{ marginBottom: 12 }}>
            Welcome! How would you like to start?
          </p>

          <div className="card">
            <h2>Bring in my Pistol Tracker data</h2>
            <p className="report-note" style={{ marginBottom: 12 }}>
              Import your Pistol Tracker backup or sync file — guns, sessions, photos, the lot.
              Nothing is lost, and you can re-run this any time without doubling anything up.
            </p>
            <button className="button" onClick={() => setMode('import')}>Choose my file</button>
          </div>

          <div className="card">
            <h2>Start fresh</h2>
            <p className="report-note" style={{ marginBottom: 12 }}>
              Begin with an empty log and add your guns and sessions as you go. You can always
              import later from More → Help &amp; Tour, or the Gear &amp; Data screen.
            </p>
            <button className="button secondary" onClick={onFinish}>Start fresh</button>
          </div>

          <p className="report-note">Coming soon: bring in data from a CSV or other apps.</p>
        </>
      )}

      {mode === 'import' && (
        <div className="card">
          <h2>Import your Pistol Tracker file</h2>
          <p className="report-note" style={{ marginBottom: 12 }}>
            Pick your backup or sync file. You'll confirm each gun's type, then see a report
            checking every record came across.
          </p>
          <ImportFlow onImported={onFinish} />
        </div>
      )}
    </div>
  );
}
