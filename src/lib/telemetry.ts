// Rung-1 telemetry chokepoint.
//
// EVERY piece of data that ever leaves the device passes through this one
// module. That is deliberate: a single, auditable send point is what lets us
// guarantee the privacy promises (opt-out honoured, nothing sent before the
// user has been told, never a crash from a dead endpoint).
//
// Safe by construction:
//   • No provider is registered by default, so every call is a NO-OP until we
//     explicitly wire Aptabase/Sentry/the benchmark endpoint in a later step.
//   • `enabled` starts false; it is set from AppSettings at app start and
//     whenever the opt-out toggle changes. Opt-OUT model: enabled unless the
//     user has opted out.
//   • `track()` is synchronous, guards on both flags, and never throws —
//     telemetry must never break the app.

export type TelemetryEvent = string;
export type TelemetryProps = Record<string, string | number | boolean>;

export interface TelemetryProvider {
  track(event: TelemetryEvent, props?: TelemetryProps): void;
}

let provider: TelemetryProvider | null = null;
let enabled = false;

/** Pure helper: given the stored settings, is the user participating?
 *  Opt-OUT model — participating unless `analyticsOptOut === true`. */
export function analyticsEnabled(
  settings: { analyticsOptOut?: boolean } | undefined,
): boolean {
  return settings?.analyticsOptOut !== true;
}

/** Set the live on/off state. Called once at app start from AppSettings, and
 *  again whenever the user flips the opt-out toggle. */
export function setTelemetryEnabled(next: boolean): void {
  enabled = next;
}

/** Register the real send provider (Aptabase, later). Passing null unregisters
 *  it, returning the chokepoint to a pure no-op. */
export function registerTelemetryProvider(next: TelemetryProvider | null): void {
  provider = next;
}

/** The single send chokepoint. Does nothing unless a provider is registered
 *  AND analytics is enabled. Never throws. */
export function track(event: TelemetryEvent, props?: TelemetryProps): void {
  if (!enabled || provider === null) return;
  try {
    provider.track(event, props);
  } catch {
    // Swallow: a telemetry failure must never surface to the user.
  }
}

/** Inspection hook for tests and diagnostics — reports the current wiring
 *  state without exposing the provider itself. */
export function telemetryState(): { enabled: boolean; wired: boolean } {
  return { enabled, wired: provider !== null };
}
