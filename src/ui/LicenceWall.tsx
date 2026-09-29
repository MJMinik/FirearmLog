// The free-limit wall, and the paste-a-license field it shares with the
// Settings card (ENTITLEMENT_SPEC_2026-09-18.md §5.3 to §5.5).
//
// The wall is a sheet shown OVER the session form: the form underneath is
// never touched, so closing the sheet returns to it exactly as it was. It shows
// the shooter's own figures (only sessions he logged in the app: not the sample log, not imported ones), says what stays free, and offers one button that
// opens the buy page in the browser. No price appears anywhere in the app.
import { useState } from 'react';
import { addLicenceText, BUY_PAGE_URL } from '../lib/licenceState.ts';
import type { LicencePayload } from '../lib/licence.ts';
import { FREE_LIVE_FIRE_SESSIONS } from '../lib/trialGate.ts';
import { Sheet } from './Sheet.tsx';

/** The one "Get a license" control: a plain link that opens the buy page in a
 *  new browser tab. `secondary` gives the quieter style for repeat placements. */
export function GetLicenceLink({ secondary = false }: { secondary?: boolean }) {
  return (
    <a className={secondary ? 'button secondary' : 'button'} href={BUY_PAGE_URL}
      target="_blank" rel="noopener" style={{ textDecoration: 'none' }}>
      Get a license
    </a>
  );
}

/** Paste a license, check it, keep it. Invalid text changes nothing. */
export function LicencePaste({ onAdded, idPrefix }: {
  onAdded?: (payload: LicencePayload) => void;
  /** Distinguishes the field when the wall sheet and the Settings card are both on screen. */
  idPrefix: string;
}) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  async function add() {
    if (busy || text.trim() === '') return;
    setBusy(true); setProblem('');
    const r = await addLicenceText(text);
    setBusy(false);
    if (r.ok) { setText(''); onAdded?.(r.payload); return; }
    setProblem(r.reason === 'not-saved'
      ? 'That license is valid, but it could not be saved on this device. Try again.'
      : 'That is not a valid FirearmLog license. Nothing was changed.');
  }
  const errId = `${idPrefix}-licence-problem`;
  return (
    <>
      <label className="field">Paste your license
        <textarea id={`${idPrefix}-licence-text`} value={text} rows={3} placeholder="FL1.…"
          autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          aria-invalid={problem !== '' || undefined}
          aria-describedby={problem !== '' ? errId : undefined}
          onChange={(e) => { setText(e.target.value); if (problem) setProblem(''); }} />
      </label>
      {problem && <p id={errId} className="report-note" role="alert" style={{ marginBottom: 8 }}>{problem}</p>}
      <button type="button" className="button secondary" disabled={busy || text.trim() === ''}
        onClick={() => void add()}>
        {busy ? 'Checking…' : 'Add license'}
      </button>
    </>
  );
}

/** The wall itself, as a sheet over the session form. */
export function LicenceWall({ count, rounds, onClose }: {
  count: number; rounds: number; onClose: () => void;
}) {
  return (
    <Sheet title="Unlock live-fire logging" onClose={onClose}>
      <p className="report-note" style={{ marginBottom: 10 }}>
        You have logged {count} live-fire {count === 1 ? 'session' : 'sessions'} and{' '}
        {rounds.toLocaleString()} {rounds === 1 ? 'round' : 'rounds'} in FirearmLog.
      </p>
      <p className="report-note" style={{ marginBottom: 10 }}>
        The first {FREE_LIVE_FIRE_SESSIONS} live-fire sessions are free. Logging more Live practice
        or Class sessions takes a license. You can still log today as Dry fire or as a match.
      </p>
      <p className="report-note" style={{ marginBottom: 6 }}>Free with or without a license:</p>
      <ul className="report-note" style={{ margin: '0 0 12px', paddingLeft: 20 }}>
        <li>Dry fire sessions</li>
        <li>Matches</li>
        <li>Viewing and exporting your whole log</li>
        <li>Backups: Save to File and Load from File</li>
      </ul>
      <GetLicenceLink />
      <div style={{ height: 14 }} />
      <p className="report-note" style={{ marginBottom: 6 }}>Already have a license?</p>
      <LicencePaste idPrefix="wall" onAdded={onClose} />
      <div style={{ height: 8 }} />
      <button type="button" className="button secondary" onClick={onClose}>Back to the form</button>
    </Sheet>
  );
}
