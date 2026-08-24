// The one-tap sample-log loader, extracted from SetupWizard (session 132,
// 24 Aug 2026) so the same offer can live on the Tour & Setup screen —
// Michael's design from that day's tap test: the sample log "should be on
// the previous screen", not only inside the wizard. ONE state machine, two
// surfaces: extraction instead of duplication so the fresh-read hardening
// and the confirm gate can never drift apart between them.
//
// Loads the bundled demo file straight from the app, so there's nothing to
// download, save, or pick. Uses the same validated restore path as a normal
// Load from File, with the load-time date shift (demoShift.ts) so the sample
// always ends about a week ago.
import { useState } from 'react';
import { localLastModified, restoreSnapshot } from '../lib/db.ts';
import { parseFlog } from '../lib/flog.ts';
import { shiftDemoDates } from '../lib/demoShift.ts';
import { ConfirmSheet } from './Sheet.tsx';
import { FormProblem } from './FormProblem.tsx';

export function SampleLogButton({ probablyHasData, onLoaded }: {
  /** Cached hint that data exists (skips the fresh read's wait for the
   *  common case). The tap-time fresh read below still decides — cached
   *  state can lag, and the confirm must never be skipped on stale info. */
  probablyHasData?: boolean;
  /** Called after a successful load — the caller lands the user on Home
   *  (the wizard's stated contract, kept identical on every surface). */
  onLoaded: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirming, setConfirming] = useState(false);

  // Decide from a FRESH read at tap time (the wizard's original hardening,
  // kept verbatim in behavior): the cached hint short-circuits the common
  // case instantly; if the read itself fails, fail SAFE and ask anyway — an
  // unnecessary confirm is a shrug, a skipped one is someone's log.
  async function tapped() {
    let any = probablyHasData === true;
    if (!any) {
      try { any = (await localLastModified()) > 0; } catch { any = true; }
    }
    if (any) setConfirming(true);
    else await load();
  }

  async function load() {
    setConfirming(false); setErr(''); setBusy(true);
    try {
      const res = await fetch(new URL('demo-dataset.bin', document.baseURI));
      if (!res.ok) throw new Error('not ok');
      const snap = parseFlog(new Uint8Array(await res.arrayBuffer()));
      await restoreSnapshot(shiftDemoDates(snap, Date.now()));
      onLoaded();
    } catch {
      setBusy(false);
      setErr('Could not load the sample data — check your connection and try again.');
    }
  }

  return (
    <>
      <FormProblem problem={err} />
      <button className="button secondary" disabled={busy}
        onClick={() => void tapped()}>
        {busy ? 'Loading sample data…' : 'See a log 18 months in'}
      </button>
      {confirming && (
        <ConfirmSheet
          title="Load sample data?"
          message="This replaces what's on this device with a sample log. There's no undo."
          confirmLabel="Load sample data"
          onConfirm={() => void load()}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}
