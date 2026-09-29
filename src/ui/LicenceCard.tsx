// The Settings "Your license" card (ENTITLEMENT_SPEC_2026-09-18.md §5.5).
// Three states: Free (count under ten), Licensed, and Trial over (count at ten
// or more, no valid license). A saved license that does not verify is treated
// as no license and says so; it is never deleted without the shooter asking.
import { useState } from 'react';
import { removeLicence } from '../lib/licenceState.ts';
import type { LicencePayload } from '../lib/licence.ts';
import { formatDayKey } from '../lib/dates.ts';
import { FREE_LIVE_FIRE_SESSIONS } from '../lib/trialGate.ts';
import { GetLicenceLink, LicencePaste } from './LicenceWall.tsx';
import { ConfirmSheet } from './Sheet.tsx';
import { useTrialStatus } from './useTrialStatus.ts';

/** "Licensed to Jane Shooter, Founding member #17, since Nov 3, 2026." */
export function licenceCardLine(p: LicencePayload): string {
  const who = p.to ? `Licensed to ${p.to}` : 'Licensed';
  const plan = p.plan === 'founding' ? `Founding member #${p.seq}` : 'Standard';
  return `${who}, ${plan}, since ${formatDayKey(p.at)}.`;
}

export function LicenceCard() {
  const trial = useTrialStatus();
  const [removing, setRemoving] = useState(false);
  const [problem, setProblem] = useState('');

  async function reallyRemove() {
    setRemoving(false);
    setProblem('');
    if (!(await removeLicence())) setProblem('That could not be removed. Your license is unchanged. Try again.');
  }

  const used = Math.min(trial.count, FREE_LIVE_FIRE_SESSIONS);
  const over = trial.count >= FREE_LIVE_FIRE_SESSIONS;

  return (
    <div className="card" data-testid="licence-card">
      <h2>Your license</h2>
      {trial.failed ? (
        <p className="report-note" role="status" data-testid="licence-unreadable">
          Your sessions could not be read, so the count is not shown.
        </p>
      ) : !trial.ready ? (
        <p className="report-note">Checking…</p>
      ) : trial.licence.state === 'valid' ? (
        <>
          <p className="report-note" data-testid="licence-line" style={{ marginBottom: 10 }}>
            {licenceCardLine(trial.licence.payload)}
          </p>
          <button className="button secondary" onClick={() => setRemoving(true)}>Remove license…</button>
          {problem && <p className="report-note" role="alert" style={{ marginTop: 8 }}>{problem}</p>}
        </>
      ) : (
        <>
          <p className="report-note" data-testid="licence-count" style={{ marginBottom: 6 }}>
            {used} of {FREE_LIVE_FIRE_SESSIONS} live-fire sessions used.
          </p>
          <p className="report-note" style={{ marginBottom: 10 }}>
            {over
              ? `You have used all ${FREE_LIVE_FIRE_SESSIONS} free live-fire sessions. `
              : `Live practice and Class sessions count, including any in Recently Deleted until you delete them forever. `}
            Dry fire, matches, viewing and exporting your log, and backups are free with or without a
            license.
          </p>
          {trial.licence.state === 'invalid' && (
            <>
              <p className="report-note" role="status" style={{ marginBottom: 10 }}>
                A license is saved on this device, but it is not valid, so it is not being used.
              </p>
              <button className="button secondary" onClick={() => setRemoving(true)}>Remove the saved license…</button>
              <div style={{ height: 10 }} />
              {problem && <p className="report-note" role="alert" style={{ marginBottom: 8 }}>{problem}</p>}
            </>
          )}
          <LicencePaste idPrefix="card" />
          {/* The buy link is for the trial-over state only (spec §5.5). */}
          {over && (
            <>
              <div style={{ height: 10 }} />
              <GetLicenceLink />
            </>
          )}
        </>
      )}
      {removing && (
        <ConfirmSheet title="Remove license?"
          message="This takes the license off this device. You can paste it again from your email or receipt."
          confirmLabel="Remove license" cancelLabel="Keep license"
          onConfirm={() => void reallyRemove()} onClose={() => setRemoving(false)} />
      )}
    </div>
  );
}
