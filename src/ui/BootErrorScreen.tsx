// F1: the recovery screen shown when the database can't open at startup.
// Before this existed, a stuck open meant a loading spinner forever — no
// message, no way out. This screen replaces that dead end with plain language
// and a real retry (probeDb re-attempts a fresh open; see db.ts).
// Copy signed off by Michael, July 10 2026 (first-run fix batch, gate 1).

import { useState } from 'react';
import { probeDb } from '../lib/db.ts';

export function BootErrorScreen({ onRecovered }: { onRecovered: () => void }) {
  const [checking, setChecking] = useState(false);

  const retry = async () => {
    setChecking(true);
    try {
      await probeDb();
      onRecovered();
    } catch {
      // Still stuck — stay on this screen, re-enable the button.
      setChecking(false);
    }
  };

  return (
    <div className="screen" role="alert">
      <div className="card">
        <h1>FirearmLog couldn't open its storage</h1>
        <p className="report-note" style={{ marginBottom: 12 }}>
          This usually means the app is open in another tab or window. Close any
          other FirearmLog tabs, then try again.
        </p>
        <p className="report-note" style={{ marginBottom: 12 }}>
          Nothing has been deleted — your logbook stays on this device.
        </p>
        <button className="button" onClick={() => void retry()} disabled={checking}>
          {checking ? 'Checking…' : 'Try Again'}
        </button>
        <p className="report-note" style={{ marginTop: 12 }}>
          Still stuck? Restart your browser and reopen the app.
        </p>
      </div>
    </div>
  );
}
