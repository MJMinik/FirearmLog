import { useState } from 'react';
import { clearAllData } from '../lib/db.ts';
import { Sheet } from './Sheet.tsx';
import { FormProblem } from './FormProblem.tsx';

/** The guarded "Clear all data" wipe: a typed "erase" confirmation gates the
 *  destructive button. On confirm, clearAllData() wipes every store, then we
 *  reload to a guaranteed-clean app (empty log → the Setup Wizard reopens).
 *  Shared by Tour & Setup and Settings — ONE guarded component, two entry points,
 *  so the safety gate can never drift between them. */
export function ClearAllSheet({ onClose }: { onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ready = typed.trim().toLowerCase() === 'erase';
  async function erase() {
    if (!ready || busy) return;
    setBusy(true); setErr('');
    try {
      await clearAllData();
      // A full reload guarantees no stale in-memory state survives the wipe;
      // with an empty log the app returns to first-run on its own.
      window.location.reload();
    } catch {
      setBusy(false);
      setErr('Could not erase your data. Nothing was changed — please try again.');
    }
  }
  return (
    <Sheet title="Clear all data" onClose={onClose}>
      <p className="report-note" style={{ marginBottom: 12 }}>
        This permanently deletes everything on this device — every gun, session, match, classifier,
        photo, and setting. There's no undo.
      </p>
      <p className="report-note" style={{ marginBottom: 12 }}>
        Your saved backup files are not affected. If you're not sure, use Save to File to keep a
        backup first — then you can always get this back.
      </p>
      <FormProblem problem={err} />
      <label className="field">Type <strong>erase</strong> to confirm
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off"
          name="fl-erase-confirm" placeholder="erase" />
      </label>
      <button className="button" onClick={onClose} style={{ marginTop: 4 }}>Cancel</button>
      <div style={{ height: 8 }} />
      <button className="button danger" disabled={!ready || busy} onClick={() => void erase()}>
        {busy ? 'Erasing…' : 'Erase everything'}
      </button>
    </Sheet>
  );
}
