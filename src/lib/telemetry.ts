// Rung-1 telemetry chokepoint.
//
// This module is the ONE place data is meant to leave the device — a single,
// auditable send point, so the privacy promises are enforced in one spot and
// PROVEN by a static scan: both scripts/check-imports.mjs and
// tests/privacy.test.ts fail the build if any network call appears in src/
// outside this file. Two doors: track() for a Layer-A usage event,
// sendContribution() for a Layer-B benchmark sample.
//
// Wiring status — honest (R-12): NOTHING is sent yet. No provider is registered
// (provider === null), so every call is a no-op; the real Aptabase / Sentry /
// benchmark providers are registered in the step-4 wiring branch. `enabled`
// mirrors the stored opt-out; the app keeps it fresh by calling
// syncTelemetryEnabled() at start and after any settings-changing op (the
// opt-out toggle, Load-from-File, an import, Clear All) — so the cached gate can
// never go stale after a restore replaces settings (R-4).
//
// Safe by construction: both doors guard on `enabled` AND a registered provider,
// are synchronous, and never throw — telemetry must never break the app.

import type { BenchmarkContribution } from './benchmark.ts';

/** The closed set of Layer-A usage events and the prop shape each may carry
 *  (build spec §5). track() refuses anything not listed here — no free-text
 *  event names, no arbitrary props (R-6). Props are typed and, for strings,
 *  length-capped, so nothing unbounded or unexpected can ride along. */
export const EVENT_SCHEMA = {
  app_opened: {},
  screen_view: { screen: 'string' },
  session_logged: { gunCount: 'number', drillCount: 'number', hasPhotos: 'boolean' },
  match_logged: { scoringType: 'string' },
  import_run: { kind: 'string', ok: 'boolean' },
  backup_pushed: {},
  backup_pulled: {},
  tour_completed: { tour: 'string' },
  wiki_opened: { section: 'string' },
  benchmark_viewed: { metric: 'string' },
  optout_toggled: { on: 'boolean' },
} as const satisfies Record<string, Record<string, 'string' | 'number' | 'boolean'>>;

export type TelemetryEvent = keyof typeof EVENT_SCHEMA;
export type TelemetryProps = Record<string, string | number | boolean>;
type PropType = 'string' | 'number' | 'boolean';

/** Max length for any string prop — caps payload size and stops a long string
 *  from smuggling data through an otherwise-allowed key. */
export const MAX_PROP_STRING = 64;

export interface TelemetryProvider {
  track(event: TelemetryEvent, props?: TelemetryProps): void;
  /** Layer-B door: send one anonymous benchmark sample. Optional, so a
   *  usage-only provider need not implement it. */
  sendContribution?(contribution: BenchmarkContribution): void;
}

let provider: TelemetryProvider | null = null;
let enabled = false;

/** Pure helper: given the stored settings, is the user participating?
 *  Opt-OUT model — participating unless `analyticsOptOut === true`. */
export function analyticsEnabled(settings: { analyticsOptOut?: boolean } | undefined): boolean {
  return settings?.analyticsOptOut !== true;
}

/** Set the live on/off state directly (used by tests and the opt-out toggle). */
export function setTelemetryEnabled(next: boolean): void {
  enabled = next;
}

/** Re-sync the live gate from the stored settings. The app calls this at start
 *  and after any settings-changing op, so a Load-from-File / import / Clear All
 *  can never leave `enabled` stale against what's on disk (R-4). */
export function syncTelemetryEnabled(settings: { analyticsOptOut?: boolean } | undefined): void {
  enabled = analyticsEnabled(settings);
}

/** Register the real send provider (step 4). null unregisters — pure no-op. */
export function registerTelemetryProvider(next: TelemetryProvider | null): void {
  provider = next;
}

/** Keep only schema-declared props, correctly typed, strings capped; unknown
 *  keys and mistyped values are dropped (R-6). */
function sanitizeProps(
  schema: Record<string, PropType>,
  props: TelemetryProps | undefined,
): TelemetryProps {
  const clean: TelemetryProps = {};
  if (!props) return clean;
  for (const [key, type] of Object.entries(schema)) {
    const v = props[key];
    if (type === 'string' && typeof v === 'string') clean[key] = v.slice(0, MAX_PROP_STRING);
    else if (type === 'number' && typeof v === 'number' && Number.isFinite(v)) clean[key] = v;
    else if (type === 'boolean' && typeof v === 'boolean') clean[key] = v;
  }
  return clean;
}

/** The Layer-A send chokepoint. No-op unless a provider is registered AND
 *  analytics is enabled. An unknown event name is refused; props are sanitized
 *  to the event's schema. Never throws. */
export function track(event: TelemetryEvent, props?: TelemetryProps): void {
  if (!enabled || provider === null) return;
  const schema = (EVENT_SCHEMA as Record<string, Record<string, PropType>>)[event];
  if (!schema) return; // unknown event — never send an arbitrary name
  try {
    provider.track(event, sanitizeProps(schema, props));
  } catch {
    // Swallow: a telemetry failure must never surface to the user.
  }
}

/** The Layer-B send chokepoint — one anonymous benchmark sample, through the
 *  SAME gate as track(). The contribution is already shape-validated by
 *  isValidContribution before it reaches here. Never throws. */
export function sendContribution(contribution: BenchmarkContribution): void {
  if (!enabled || provider === null) return;
  try {
    provider.sendContribution?.(contribution);
  } catch {
    // Swallow: a telemetry failure must never surface to the user.
  }
}

/** Crash-report scrubber SPEC, made executable (R-D). A thrown Error's `message`
 *  routinely interpolates user data (a gun name, a location), so a crash report
 *  must carry only the error's NAME and its stack FRAMES with the message header
 *  stripped — never the raw message. The step-4 crash provider (Sentry, PII
 *  scrubbing on) formats from exactly this shape. */
export interface ScrubbedError {
  name: string;
  frames: string[];
}
export function scrubError(err: unknown, maxFrames = 20): ScrubbedError {
  const e = err instanceof Error ? err : new Error(String(err));
  const name = typeof e.name === 'string' && e.name ? e.name.slice(0, MAX_PROP_STRING) : 'Error';
  const frames: string[] = [];
  const lines = typeof e.stack === 'string' ? e.stack.split('\n') : [];
  for (const line of lines) {
    const t = line.trim();
    // Only real frames ("at fn (file:line:col)"). The header line is
    // "Name: message" — never starts with "at ", so the message is never sent,
    // even if the message itself contains the word "at".
    if (!t.startsWith('at ')) continue;
    frames.push(t.slice(3).slice(0, 160));
    if (frames.length >= maxFrames) break;
  }
  return { name, frames };
}

/** Inspection hook for tests and diagnostics — reports the current wiring state
 *  without exposing the provider itself. */
export function telemetryState(): { enabled: boolean; wired: boolean } {
  return { enabled, wired: provider !== null };
}
