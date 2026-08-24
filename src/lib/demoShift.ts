// Demo date shift (session 132, DEMO_SHIFT_SPEC_S132.md — signed decision:
// option 1). The sample log's dates are baked into public/demo-dataset.bin at
// generation time, so every install that ever loads it starts from the same
// fixed calendar (newest real session 2026-06-21 as of this writing). Once
// "today" walks far enough past that date, the maintenance forecast's 90-day
// evidence window — see forecast.ts's WINDOW_DAYS gate — no longer overlaps
// any demo session, and the forecast line the demo is supposed to show can
// never appear again. Regenerating the .bin on a schedule was rejected
// (session 132 notes): it would make the shipped artifact non-reproducible
// and put the story-arc tests (tests/demoStory.test.ts) at the mercy of
// whatever the generator rolls next time. Sliding every date forward AT LOAD
// TIME, by a whole number of weeks so weekday spacing survives, keeps the
// artifact byte-identical and makes the fix a property of loading, not of
// the file.
//
// Pure module by design (see the spec's import restriction): SetupWizard
// calls this between parseFlog and restoreSnapshot, so it never touches
// IndexedDB and stays trivially testable against the real shipped bytes.

import type { Snapshot } from './flog.ts';

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

// The ISO calendar-date shape used throughout the record types (types.ts:
// dateAcquired, statusDate, sessions/matches `date`, etc.) — always a bare
// YYYY-MM-DD string, never a full timestamp.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Keys that carry an epoch-ms NUMBER rather than an ISO date string. Listed
// explicitly (rather than "any number that looks like an epoch") because a
// gun's `startingRoundCount` or a session's rounds count both sit in
// plausible-looking numeric ranges too — matching by key name is the only
// way to shift timestamps without also mangling round counts. This is
// exactly the set the spec's completeness test (tests/demoShift.test.ts)
// checks against by re-deriving it independently, so a field that reaches
// the shipped demo dataset under a new epoch-ms key and is left out here is
// caught there, not silently missed here. (A model field the demo never
// carries is outside that guarantee — and also never needs shifting here.)
const EPOCH_KEYS = new Set([
  'createdAt', 'updatedAt', 'deletedAt', 'importedAt',
  'lastBackupAt', 'exportedAt', 'lastModified',
]);

// Floor below which a "plausible epoch ms" number is almost certainly
// something else (a count, an index) that happens to share the key name.
// 2020-01-01 predates every record this app has ever stored.
const EPOCH_FLOOR = Date.parse('2020-01-01T00:00:00Z');

/** Noon UTC on the given YYYY-MM-DD — the generator's own convention (see
 * scripts/make-demo.ts), so shifting and re-rendering a date can't cross a
 * day boundary differently than the file that produced it did. */
function noonUtcMs(isoDate: string): number {
  return Date.parse(`${isoDate}T12:00:00Z`);
}

// Deliberately built from UTC component getters rather than the ISO-string-
// then-cut spelling scripts/check-imports.mjs flags as the LOCAL day-key bug
// (F8 — a UTC-cut day is tomorrow's date west of Greenwich in the
// afternoon). This function is not computing "today" in the user's timezone
// at all; it is re-rendering a date that was already anchored to noon UTC by
// noonUtcMs above, the same fixed-offset arithmetic scripts/make-demo.ts
// used to write it, so there is no local-timezone question here to get
// wrong.
function shiftIsoDate(isoDate: string, shiftMs: number): string {
  const shifted = new Date(noonUtcMs(isoDate) + shiftMs);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Whole-week shift, in ms, that lands the newest dated session or match in
 *  [now-14d, now-7d]. 0 if the log is already that fresh (or newer). (The
 *  current demo has no planned sessions, but planned ones would count too —
 *  the anchor is simply the newest date either store carries.) */
export function demoDateShiftMs(snap: Snapshot, nowMs: number): number {
  // The true newest record governs, per the spec: sessions AND matches are
  // interleaved in the story, and considering only one store could still
  // leave a record from the other in the future once shifted.
  let newestMs = -Infinity;
  for (const storeName of ['sessions', 'matches']) {
    const records = snap.stores[storeName];
    if (!records) continue;
    for (const record of records) {
      const date = (record as { date?: unknown }).date;
      if (typeof date === 'string' && ISO_DATE_RE.test(date)) {
        const ms = noonUtcMs(date);
        if (ms > newestMs) newestMs = ms;
      }
    }
  }
  // No dated session or match at all — nothing to anchor a shift to, so
  // there is nothing to shift.
  if (newestMs === -Infinity) return 0;

  const rawDelta = (nowMs - WEEK) - newestMs;
  if (rawDelta < 0) return 0;
  // Whole weeks: every weekday is preserved (Saturday matches stay
  // Saturdays), and because the shift is uniform, the spacing between any
  // two records — the arc the demoStory tests pin — is exactly preserved.
  return Math.floor(rawDelta / WEEK) * WEEK;
}

function isPlainContainer(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !ArrayBuffer.isView(value)
    && !(value instanceof ArrayBuffer);
}

/** Recursively shifts every ISO date string and every EPOCH_KEYS number
 * found anywhere under `node`, mutating in place. ArrayBuffers and typed
 * arrays (media photo/video bytes) are left completely alone — they hold no
 * dates and walking their contents as if they were plain data would be
 * both wrong and needlessly slow on ~1 MB of photo bytes. */
function shiftInPlace(node: unknown, shiftMs: number): void {
  if (Array.isArray(node)) {
    for (const item of node) shiftInPlace(item, shiftMs);
    return;
  }
  if (!isPlainContainer(node)) return;

  for (const key of Object.keys(node)) {
    const value = node[key];
    if (typeof value === 'string') {
      if (ISO_DATE_RE.test(value)) node[key] = shiftIsoDate(value, shiftMs);
      continue;
    }
    if (typeof value === 'number') {
      if (EPOCH_KEYS.has(key) && Number.isFinite(value) && value >= EPOCH_FLOOR) {
        node[key] = value + shiftMs;
      }
      continue;
    }
    shiftInPlace(value, shiftMs);
  }
}

/** Applies the shift IN PLACE to a freshly parsed, private snapshot and
 *  returns it. In-place on purpose: the snapshot is a throwaway value parsed
 *  seconds earlier from the bundled file, and copying would clone ~1 MB of
 *  photo ArrayBuffers for no safety gain. Never call on a user's own data.
 *
 *  Known, deliberate quirk: the top-level `exportedAt` (stamped weeks after
 *  the newest session at generation time) shifts with everything else and so
 *  can land in the future. That is uniformity working as designed — the
 *  completeness test requires every epoch field to move by exactly the same
 *  amount — and it is harmless at the one call site, because restoreSnapshot
 *  drops both top-level stamps (db.ts's sourceFromSnapshot reads only
 *  stores/media). A future consumer of `exportedAt` on this path would
 *  inherit that future stamp; clamp it THERE, not here. */
export function shiftDemoDates(snap: Snapshot, nowMs: number): Snapshot {
  const shiftMs = demoDateShiftMs(snap, nowMs);
  if (shiftMs !== 0) shiftInPlace(snap, shiftMs);
  return snap;
}
