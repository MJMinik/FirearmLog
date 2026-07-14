// Rung-1 consent region check (decision note 2026-07-12: geo-gated hybrid).
//
// The consent posture is geo-gated: analytics/crash ship OPT-OUT everywhere
// except the EU/EEA, where first-run asks a one-tap OPT-IN instead (the EU's
// device rule — ePrivacy — requires consent for off-device transmission derived
// from device data, even anonymous; see the decision note and the July-11
// research in the vault). The benchmark layer is opt-in-by-feature EVERYWHERE,
// so it never depends on this check.
//
// HOW we detect region: the device's IANA timezone (Intl API) — entirely
// on-device, no geolocation permission, no network lookup, nothing sent. It is
// deliberately coarse; where it cannot tell, it errs toward the CONSENT side
// (asking permission we didn't strictly need costs a little data density —
// assuming permission we didn't have costs trust).
//
// Scope choices, recorded honestly:
// - EU-27 plus the EEA states (Norway, Iceland, Liechtenstein — GDPR applies
//   there) are consent-side.
// - The UK is opt-out-side by name: statutory opt-out is lawful there since
//   Feb 2026 (the decision note's research).
// - Any OTHER 'Europe/…' zone we don't recognize defaults to consent-side
//   (fail-safe). Switzerland and the microstates land here on purpose: not
//   EU/EEA, but consent costs us almost nothing at their size and the default
//   stays privacy-safe.

export type ConsentRegion = 'eu' | 'row'; // row = rest of world

/** IANA zones that resolve to EU/EEA territory — including the members whose
 *  zones don't start with 'Europe/' (Canaries, Madeira/Azores, Cyprus, the
 *  French overseas departments, Åland). */
const EU_EEA_ZONES = new Set<string>([
  // EU-27 mainland zones
  'Europe/Vienna', 'Europe/Brussels', 'Europe/Sofia', 'Europe/Zagreb',
  'Europe/Prague', 'Europe/Copenhagen', 'Europe/Tallinn', 'Europe/Helsinki',
  'Europe/Paris', 'Europe/Berlin', 'Europe/Busingen', 'Europe/Athens',
  'Europe/Budapest', 'Europe/Dublin', 'Europe/Rome', 'Europe/Riga',
  'Europe/Vilnius', 'Europe/Luxembourg', 'Europe/Malta', 'Europe/Amsterdam',
  'Europe/Warsaw', 'Europe/Lisbon', 'Europe/Bucharest', 'Europe/Bratislava',
  'Europe/Ljubljana', 'Europe/Madrid', 'Europe/Stockholm',
  // EU territory outside 'Europe/'
  'Atlantic/Canary', 'Atlantic/Madeira', 'Atlantic/Azores', // Spain / Portugal
  'Africa/Ceuta', // Spain
  'Asia/Nicosia', 'Asia/Famagusta', // Cyprus
  'Europe/Mariehamn', // Åland (Finland)
  // French overseas departments (GDPR applies)
  'America/Martinique', 'America/Guadeloupe', 'America/Cayenne',
  'America/Marigot', 'America/St_Barthelemy',
  'Indian/Reunion', 'Indian/Mayotte',
  // EEA (GDPR applies): Norway, Iceland, Liechtenstein
  'Europe/Oslo', 'Atlantic/Reykjavik', 'Europe/Vaduz',
]);

/** 'Europe/…' zones that are DELIBERATELY rest-of-world: the UK and its crown
 *  dependencies (statutory opt-out lawful since Feb 2026 — decision note). Any
 *  other unlisted 'Europe/…' zone still defaults to consent-side below. */
const EUROPE_PREFIX_ROW = new Set<string>([
  'Europe/London', 'Europe/Isle_of_Man', 'Europe/Jersey', 'Europe/Guernsey',
  'Europe/Gibraltar',
]);

/** Classify one IANA timezone string. Pure — the testable core. A missing or
 *  empty zone is "cannot tell" and lands consent-side, per the fail-safe rule
 *  above: the cost of over-asking is one polite question; the cost of
 *  over-assuming is trust. */
export function regionForTimezone(tz: string | undefined | null): ConsentRegion {
  if (!tz) return 'eu';
  if (EU_EEA_ZONES.has(tz)) return 'eu';
  if (EUROPE_PREFIX_ROW.has(tz)) return 'row';
  // Unrecognized European zone → consent-side, on purpose (fail-safe).
  if (tz.startsWith('Europe/')) return 'eu';
  return 'row';
}

/** The device's consent region, read from its timezone. Never throws — an
 *  environment where Intl itself fails is "cannot tell," so it lands
 *  consent-side too (same fail-safe as regionForTimezone; in practice every
 *  browser that can run the app resolves a timezone). */
export function detectRegion(): ConsentRegion {
  try {
    return regionForTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return 'eu';
  }
}
