// What the free-limit wall and the Settings license card both need: the
// shooter's live-fire count (derived from his sessions, never stored), his
// rounds across those sessions, and whether this device holds a valid license.
// Reads the sessions and settings when the screen opens and re-checks the
// stored license, so a license that arrived with Load from File is seen.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getAll, getSettings } from '../lib/db.ts';
import {
  getLicenceStatus, isLicensed, refreshLicenceStatus, subscribeLicence,
} from '../lib/licenceState.ts';
import type { LicenceStatus } from '../lib/licenceState.ts';
import { loadTrialFigures, wallBlocksNewLiveSession } from '../lib/trialGate.ts';
import type { AppSettings, Session } from '../lib/types.ts';

/** The license verdict, live: re-renders when a license is added or removed. */
export function useLicenceStatus(): LicenceStatus {
  return useSyncExternalStore(subscribeLicence, getLicenceStatus, getLicenceStatus);
}

export interface TrialStatus {
  /** False until the sessions, the settings and the license check have all answered. */
  ready: boolean;
  /** Live-fire sessions the free limit counts (trialGate.ts). */
  count: number;
  /** Rounds across those same sessions. */
  rounds: number;
  licence: LicenceStatus;
  licensed: boolean;
  /** True when the sessions could not be read, so no count exists (never blocks). */
  failed: boolean;
  /** True when starting one more live-fire session is blocked (the wall applies). */
  blocked: boolean;
}

/**
 * `enabled` false skips every read (and reports not-blocked): the session form
 * uses it while editing an already-logged session, which can never be gated, so
 * that form's own load is not made to wait behind these reads.
 */
export function useTrialStatus(refreshKey?: number, enabled = true): TrialStatus {
  const licence = useLicenceStatus();
  const [figures, setFigures] = useState<{ count: number; rounds: number } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void refreshLicenceStatus();
    void (async () => {
      // If the COUNT cannot be made the status stays "not ready" (never "0
      // used", never blocked) and `failed` lets the card say so in a sentence.
      const r = await loadTrialFigures(async () => {
        const [sessions, settings] = await Promise.all([
          getAll<Session>('sessions'), getSettings<AppSettings>(),
        ]);
        return [sessions, settings] as const;
      });
      if (!alive) return;
      if (r.ok) { setFailed(false); setFigures({ count: r.count, rounds: r.rounds }); }
      else setFailed(true);
    })();
    return () => { alive = false; };
  }, [refreshKey, enabled]);
  const ready = enabled && !failed && figures !== null && licence.state !== 'loading';
  const count = figures?.count ?? 0;
  const licensed = isLicensed(licence);
  return {
    ready, failed: enabled && failed, count, rounds: figures?.rounds ?? 0, licence, licensed,
    blocked: ready && wallBlocksNewLiveSession(count, licensed),
  };
}
