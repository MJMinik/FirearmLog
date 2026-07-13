import { useState } from 'react';
import { clearAllData } from '../lib/db.ts';
import { ConfirmSheet } from './Sheet.tsx';

// Session 59: the exit sign for the converted explorer. Session 60 (stranger-
// test F1): the text now GRANTS permission to touch things — the pilot tester's
// first words were that he didn't know he could do anything without "hurting"
// something; status alone doesn't invite the action (a signifier, not a sign). The sample log's whole
// job is to make someone say "I want this" — and before this banner existed,
// that was the exact moment the app abandoned them: no memory that the log was
// the sample, no visible way back, the only door buried in Settings under
// "Clear all data". While settings.sampleLogLoaded is true (baked into the
// demo dataset itself — see types.ts), this banner stays pinned on every
// screen, so the exit lives wherever the excitement happens.
//
// The exit REUSES the hardened Clear-All path (clearAllData() + full reload →
// empty log → the Setup Wizard's first-run welcome), never new wipe code. The
// confirm is honest about the edge case (DESIGN_DIRECTION §6): anything the
// user added while exploring goes with the sample, and the copy says so.
export function SampleLogBanner() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  async function startMyOwnLog() {
    if (busy) return;
    setBusy(true); setErr(false); setConfirming(false);
    try {
      await clearAllData();
      // Same as ClearAllSheet: a full reload guarantees no stale in-memory
      // state survives the wipe; an empty log lands on first-run on its own.
      window.location.reload();
    } catch {
      setBusy(false);
      setErr(true);
    }
  }

  return (
    <>
      <div className="sample-banner" role="status">
        <span className="sample-banner-text">
          {err ? 'Could not clear the sample — nothing was changed. Please try again.'
            : 'You’re exploring a sample log — add, change, or delete anything. It’s just sample data.'}
        </span>
        <button onClick={() => setConfirming(true)} disabled={busy}>
          {busy ? 'Clearing…' : 'Start my own log'}
        </button>
      </div>
      {confirming && (
        <ConfirmSheet
          title="Start your own log?"
          message="This clears the sample log — and anything you've added to it — so you can start yours from scratch."
          confirmLabel="Clear sample & start"
          cancelLabel="Keep exploring"
          onConfirm={() => void startMyOwnLog()}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}
