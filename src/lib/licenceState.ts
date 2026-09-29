// The licence at run time (ENTITLEMENT_SPEC_2026-09-18.md §5.5, §5.6, §6).
//
// licence.ts only checks a text. This file holds what the app does with one:
// the built-in key list the app checks against, the verdict on the licence
// stored on this device (read at app start and again whenever a screen asks),
// pasting one in, removing it, and taking one from the address bar's
// `#licence=` fragment. Everything here is arithmetic on text and reads and
// writes of this device's own settings. No network call of any kind.
//
// A stored licence that fails the check is treated as no licence. It is never
// deleted silently: the Settings card says it is not valid and lets the
// shooter remove it or paste another.

import { getSettings, putSettings } from './db.ts';
import { appLicenceKeys, verifyLicence } from './licence.ts';
import type { LicencePayload } from './licence.ts';
import type { AppSettings } from './types.ts';

/**
 * Where the "Get a license" buttons open in the browser (the website's buy
 * page). A plain link, never a network call from the app.
 * PLACEHOLDER until step 4 of ENTITLEMENT_SPEC_2026-09-18.md §11 (the success
 * page and the real buy page go live after Paddle approves): change this one
 * constant then, nothing else refers to the address.
 */
export const BUY_PAGE_URL = 'https://firearmlog.com/buy';

export { appLicenceKeys };

/** What the app knows about this device's licence. */
export type LicenceStatus =
  | { state: 'loading' }
  /** No licence stored. */
  | { state: 'none' }
  /** A licence is stored but does not verify. Counts as no licence. */
  | { state: 'invalid' }
  | { state: 'valid'; payload: LicencePayload };

let status: LicenceStatus = { state: 'loading' };
const listeners = new Set<() => void>();
/** Bumped on every refresh so a slow, older check can never overwrite a newer one. */
let checkSeq = 0;

/** True when two verdicts say the same thing (same state, same licence). */
function sameStatus(a: LicenceStatus, b: LicenceStatus): boolean {
  if (a.state !== b.state) return false;
  if (a.state === 'valid' && b.state === 'valid') return JSON.stringify(a.payload) === JSON.stringify(b.payload);
  return true;
}

function setStatus(next: LicenceStatus): void {
  // A refresh that finds nothing new must not wake every screen that shows the
  // status (the session form re-renders on each notice).
  if (sameStatus(status, next)) return;
  status = next;
  for (const l of [...listeners]) l();
}

export function getLicenceStatus(): LicenceStatus {
  return status;
}

export function subscribeLicence(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** True when the licence on this device verified. */
export function isLicensed(s: LicenceStatus): boolean {
  return s.state === 'valid';
}

/**
 * Read the stored licence and check it. Called at app start and whenever a
 * screen that depends on it opens (so a licence that arrived with a restore is
 * seen). Never throws: a settings read that fails leaves the status as "none",
 * which is the safe reading (the wall may show, nothing is lost).
 */
export async function refreshLicenceStatus(): Promise<LicenceStatus> {
  const mine = ++checkSeq;
  let next: LicenceStatus;
  try {
    const settings = await getSettings<AppSettings>();
    const text = typeof settings?.licence === 'string' ? settings.licence.trim() : '';
    if (text === '') {
      next = { state: 'none' };
    } else {
      const r = await verifyLicence(text, appLicenceKeys());
      next = r.ok ? { state: 'valid', payload: r.payload } : { state: 'invalid' };
    }
  } catch {
    next = { state: 'none' };
  }
  if (mine === checkSeq) setStatus(next);
  return mine === checkSeq ? next : status;
}

export type AddLicenceResult =
  | { ok: true; payload: LicencePayload }
  | { ok: false; reason: 'not-valid' | 'not-saved' };

/**
 * Check pasted text and, only if it verifies, store it. Whitespace and
 * newlines around the text are dropped first (an email or a text field adds
 * them). Invalid text changes nothing.
 */
export async function addLicenceText(raw: string): Promise<AddLicenceResult> {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const r = await verifyLicence(text, appLicenceKeys());
  if (!r.ok) return { ok: false, reason: 'not-valid' };
  try {
    await putSettings<AppSettings>({ licence: text });
  } catch {
    return { ok: false, reason: 'not-saved' };
  }
  ++checkSeq; // any older in-flight check is now stale
  setStatus({ state: 'valid', payload: r.payload });
  return { ok: true, payload: r.payload };
}

/** Remove the licence from this device (Settings, Remove). Reversible in
 *  practice: the shooter can paste it again from the email or receipt. */
export async function removeLicence(): Promise<boolean> {
  try {
    await putSettings<AppSettings>({ licence: undefined });
  } catch {
    return false;
  }
  ++checkSeq;
  setStatus({ state: 'none' });
  return true;
}

// --- the #licence= link (spec §6 item 2) ------------------------------------

const FRAGMENT_PREFIX = '#licence=';

/** What happened to a `#licence=` link, for the one message the shooter sees. */
export type FragmentOutcome =
  | { kind: 'added'; payload: LicencePayload }
  | { kind: 'invalid' }
  | { kind: 'not-saved' };

/**
 * If the address ends in `#licence=<text>`, check the text, store it when it
 * verifies, and ALWAYS remove the fragment from the address bar (the licence
 * is not a secret, but it need not sit in the address bar or in the history
 * entry the browser keeps). Returns null when there is no such fragment.
 * `loc` and `hist` are parameters only so a test can pass stand-ins.
 */
export async function applyLicenceFragment(
  loc: Pick<Location, 'hash' | 'pathname' | 'search'> = window.location,
  hist: Pick<History, 'replaceState' | 'state'> = window.history,
): Promise<FragmentOutcome | null> {
  const hash = loc.hash;
  if (!hash.startsWith(FRAGMENT_PREFIX)) return null;
  let text = hash.slice(FRAGMENT_PREFIX.length);
  try { text = decodeURIComponent(text); } catch { /* keep the raw text; it will fail the check */ }
  // Remove it first: whatever happens next, the address bar is clean.
  try { hist.replaceState(hist.state, '', loc.pathname + loc.search); } catch { /* a locked-down browser: nothing more to do */ }
  const r = await addLicenceText(text);
  if (r.ok) return { kind: 'added', payload: r.payload };
  return { kind: r.reason === 'not-saved' ? 'not-saved' : 'invalid' };
}
