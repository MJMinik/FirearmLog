// App & Data section screens (July 2026). Each gets its own screen so the
// "App & Data" menu group reads as clean chevron rows (the iOS Settings
// pattern) instead of a stack of unlike cards. These are thin shells around the
// existing components — no behavior change, only where they live.
//
// 27 Aug 2026 (Michael's decision of the 25th): "Free Up Space" no longer has a
// screen or a menu row. Compress Photos is a card inside Sync & Backup that
// shows itself only when some photo is still full size. The two belong together
// — the card tells you to Save to File before running it, and Save to File is
// now the card directly above. (F11, session 55: the orphaned
// ImportScreen was removed — the migration importer library in lib/import/
// stays forever, per rules 5/46, but it has no user-facing surface.)
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { SyncCard } from './SyncCard.tsx';
import { clearMediaUrlCache } from './media.ts';
import { PhotoCleanupCard } from './PhotoCleanupCard.tsx';
import { getSettings, putSettings } from '../lib/db.ts';
import type { AppSettings } from '../lib/types.ts';
import {
  analyticsEnabled, benchmarkEnabled, syncTelemetryEnabled, telemetryState, track,
} from '../lib/telemetry.ts';
import { detectRegion } from '../lib/region.ts';

function ScreenShell({ title, onBack, children }: {
  title: string; onBack: () => void; children: ReactNode;
}) {
  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn section-back" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">{title}</h1>
      {children}
    </div>
  );
}

export function SyncScreen({ onBack, onImported }: { onBack: () => void; onImported: () => void }) {
  return (
    <ScreenShell title="Sync & Backup" onBack={onBack}>
      <SyncCard
        /* Session 138: a restore replaces every record without a page load, so
           a cached photo URL could keep showing PRE-restore bytes for a reused
           id. Clearing here (the safe-zone caller) frees the old URLs; screens
           rebuild them on demand from the restored records. */
        onPulled={() => { clearMediaUrlCache(); onImported(); }}
        onBackedUp={onImported} />
      {/* Below Save to File on purpose: the card's own copy says to back up
          first, and this is the order that makes that sentence true. It renders
          nothing at all unless a photo is still full size. */}
      <PhotoCleanupCard />
    </ScreenShell>
  );
}

// "Your Data" — the Rung-1 transparency surface (DATA_MOAT_SPEC §6a; consent
// posture per the 2026-07-12 decision: usage/crash opt-out everywhere except
// the EU/EEA, where it needs a first-run YES; benchmark opt-in-by-feature
// everywhere — "share to compare"). STATE-AWARE so every sentence stays
// literally true (charter §1): while no send provider is wired, the screen says
// plainly that nothing is sent — and the More-menu row is hidden entirely (see
// screens.tsx) — so users never meet controls for a pipe that doesn't exist;
// the activation step lights up the full surface from the same `wired` state.
// The two toggles are INDEPENDENT: each governs exactly what its label says.
export function YourDataScreen({ onBack, onChanged }: {
  onBack: () => void; onChanged: () => void;
}) {
  const region = detectRegion();
  const wired = telemetryState().wired;
  const [settings, setSettings] = useState<AppSettings | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const s = await getSettings<AppSettings>();
      if (alive) { setSettings(s); setLoaded(true); }
    })();
    return () => { alive = false; };
  }, []);

  const usageOn = analyticsEnabled(settings, region);
  const compareOn = benchmarkEnabled(settings);

  // Toggle writers. The usage pair is written symmetrically (refusal + consent
  // together) so ONE mental model covers both regions; flipping OFF is honored
  // synchronously — the live gate re-syncs before this function returns, so
  // nothing more can be sent even while the DB write settles.
  async function setUsage(on: boolean) {
    const patch: Partial<AppSettings> = on
      ? { analyticsOptOut: false, analyticsConsent: true }
      : { analyticsOptOut: true, analyticsConsent: false };
    const next = { ...(settings ?? {}), ...patch } as AppSettings;
    setSettings(next); // optimistic
    syncTelemetryEnabled(next, region); // immediate, before the write settles
    if (on) track('optout_toggled', { on: false }); // re-enabling is observable; a refusal is not (gate closes first, by design)
    await putSettings<AppSettings>(patch);
    onChanged();
  }
  async function setCompare(on: boolean) {
    const patch: Partial<AppSettings> = { benchmarkOptIn: on };
    const next = { ...(settings ?? {}), ...patch } as AppSettings;
    setSettings(next);
    syncTelemetryEnabled(next, region);
    if (on) track('benchmark_optin_toggled', { on: true });
    await putSettings<AppSettings>(patch);
    onChanged();
  }

  return (
    <ScreenShell title="Your Data" onBack={onBack}>
      <div className="card">
        <h2>Your log stays on your device</h2>
        <p className="report-note">
          Every session, gun, match, photo, and note you enter lives on your own
          devices. There's no account and no cloud copy — nobody else can read
          your log.
        </p>
        {!wired && (
          <p className="report-note">
            Right now the app sends nothing anywhere — no usage stats, no crash
            reports, no numbers. When anonymous sharing arrives, this screen is
            where you'll see exactly what it sends, and where you can turn it
            off.
          </p>
        )}
      </div>

      {wired && (
        <>
          <div className="card">
            <h2>Anonymous usage stats &amp; crash reports</h2>
            <p className="report-note">
              Which screens and features get used, so the ones shooters rely on
              get the attention — and if the app hits a bug, a technical report
              helps get it fixed. No names, no identity, nothing you've entered;
              crash reports are scrubbed of anything personal.
            </p>
            <button type="button" role="switch" aria-checked={usageOn} disabled={!loaded}
              className="setting-row" onClick={() => void setUsage(!usageOn)}>
              <span className="setting-label">
                Share anonymous usage stats
                <span className="setting-sub">
                  {usageOn
                    ? 'Turn off anytime — nothing more is sent, immediately.'
                    : region === 'eu'
                      ? 'Off until you turn it on. Nothing is sent.'
                      : 'Off. Nothing is sent.'}
                </span>
              </span>
              <span className={`switch${usageOn ? ' on' : ''}`} aria-hidden="true"><span className="switch-thumb" /></span>
            </button>
          </div>

          <div className="card">
            <h2>Compare with shooters like you</h2>
            <p className="report-note">
              Turn this on and your phone sends anonymous benchmark numbers — a
              single figure, like one B-class Carry Optics accuracy — never the
              match it came from. In return you see how your numbers stack up
              against shooters in your division and class. Comparisons only
              appear once at least ~50 shooters are in a bracket, so no one can
              be picked out; nothing sent carries your name, your guns, or any
              ID that could tie a number back to you.
            </p>
            <button type="button" role="switch" aria-checked={compareOn} disabled={!loaded}
              className="setting-row" onClick={() => void setCompare(!compareOn)}>
              <span className="setting-label">
                Share to compare
                <span className="setting-sub">
                  {compareOn
                    ? 'Contributing — and comparing. Turn off anytime; nothing more is sent.'
                    : 'Off. Your numbers stay on this device, and comparisons stay hidden.'}
                </span>
              </span>
              <span className={`switch${compareOn ? ' on' : ''}`} aria-hidden="true"><span className="switch-thumb" /></span>
            </button>
          </div>
        </>
      )}
    </ScreenShell>
  );
}
