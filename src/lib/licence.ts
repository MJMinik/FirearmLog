// FirearmLog licence verification (ENTITLEMENT_SPEC_2026-09-18.md §3 and §10).
//
// This file only checks a licence someone already has. It signs nothing (the
// private key never appears in src/; signing lives in licence-worker/sign.ts,
// a separate Cloudflare Worker folder that ships to no device). Checking a
// licence is arithmetic on the text the shooter pastes in: no network call of
// any kind, ever (spec §1, "the entitlement check must therefore be
// arithmetic on the device, never a request"; scripts/check-imports.mjs fails
// the build if this file ever names one of the five disallowed words).
//
// The app reaches this file through src/lib/licenceState.ts, which holds the
// runtime state (the stored licence, its verdict, paste and remove).
//
// A licence's identity is its payload, never the full text: ECDSA allows more
// than one valid signature for the same payload, so never compare or dedupe
// licences on the whole string.

/** The format tag on every licence (spec §3.1). A later format can change the
 *  tag without breaking a licence already issued under this one. */
const LICENCE_TAG = 'FL1';

export type LicenceIssuer = 'web' | 'apple' | 'google';
export type LicencePlan = 'founding' | 'standard';

/** The readable part of a licence (spec §3.1's field table). Every field
 *  comes from the merchant's record of the purchase, never from a clock, so
 *  the same purchase always produces the same payload. */
export interface LicencePayload {
  v: 1;
  kid: string;
  iss: LicenceIssuer;
  plan: LicencePlan;
  /** Present only when `plan` is 'founding': the founding number, 1 to 200. */
  seq?: number;
  ref: string;
  /** The purchase date as the merchant recorded it, YYYY-MM-DD. */
  at: string;
  to?: string;
}

/** What `parseLicence` can say: it only checks shape (spec §3.2 steps 1-2),
 *  so it can answer instantly, without the asynchronous signature check. */
export type LicenceParseResult =
  { ok: true; payload: LicencePayload } | { ok: false; reason: 'format' | 'payload' };

/** What `verifyLicence` can say, covering every step of spec §3.2. */
export type LicenceResult =
  | { ok: true; payload: LicencePayload }
  | { ok: false; reason: 'format' | 'payload' | 'unknown-key' | 'bad-signature' };

/**
 * The app's built-in public key list (spec §3.3). Keys are only ever ADDED
 * to this object, never removed or replaced: removing one would silently
 * break every honest buyer whose licence it signed, which is exactly the
 * promise (spec §1, "verified once, offline for life") this file exists to
 * keep.
 *
 * EMPTY until the key ceremony (spec §3.3 and §4.5). No private key of any
 * kind is committed to this repository, not even a throwaway one for
 * development: a committed private key lives in git history forever, and
 * its public half in this list would mean the shipped app trusts it. Every
 * test in tests/licence.test.ts and tests/licence-worker.test.ts generates
 * its own throwaway key pair and passes the public half to verifyLicence's
 * own `keys` argument, never depending on this list. The production key is
 * generated at the key ceremony with licence-worker/scripts/generate-key.mjs
 * (see licence-worker/README.md, "The key ceremony"), and its public half is
 * added here under its own `kid` once the signing Worker is deployed and
 * Michael holds the private half in Cloudflare's secret store and in Apple
 * Passwords.
 */
export const LICENCE_KEYS: Readonly<Record<string, JsonWebKey>> = {};

/**
 * The keys the app checks a licence against: the built-in list, plus ONE
 * test-only key when this build was made with FL_E2E_LICENCE_PUBKEY set (a
 * public key generated at run time by playwright.config.ts so the browser
 * tests can sign licences without any key being committed). In every real
 * build the constant is null and this returns LICENCE_KEYS unchanged (the very
 * same object); the production bundle carries no test key (proved by grep in
 * the build report). Lives here, not in licenceState.ts, so db.ts (which checks
 * a restored file's licence) can use it without importing the run-time store.
 */
export function appLicenceKeys(): Readonly<Record<string, JsonWebKey>> {
  const e2e = typeof __FL_E2E_LICENCE_KEY__ === 'undefined' ? null : __FL_E2E_LICENCE_KEY__;
  if (!e2e) return LICENCE_KEYS;
  return { ...LICENCE_KEYS, [e2e.kid]: e2e.jwk };
}

// --- base64url (RFC 4648 §5) -------------------------------------------------
//
// The payload and the signature are both written in base64url so a licence
// is safe to put in a web address (spec §3.1). No dependency (project rule
// 43): this remaps the browser's own atob/btoa to the URL-safe alphabet and
// strips padding. Exported so licence-worker/sign.ts, which builds the same
// text on the other end, uses this exact encoding rather than a second copy
// of it (the same reasoning worker/contract.ts gives for reusing app code).

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// --- shape checking -----------------------------------------------------------

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** The base64url alphabet only (spec §3.1): no padding, no `+`, no `/`, no
 *  internal whitespace or newline. atob is lenient about all of those (it
 *  strips whitespace and accepts the standard alphabet too), which without
 *  this check let a licence with a stray space or `=` verify while a licence
 *  with a trailing newline, a common side effect of copying from an email or
 *  a text field, failed. This check makes both outcomes match the format the
 *  Worker actually produces. */
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/** True for a real YYYY-MM-DD calendar date (spec §3.1's `at` field). Built
 *  from UTC date parts, not from parsing a local date, because this only
 *  ever checks a date string someone else already wrote down; it never
 *  derives "today" (the local-day-key rule in scripts/check-imports.mjs is
 *  about the other direction, computing today's date, which this file never
 *  does). */
function isValidDateString(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const asDate = new Date(Date.UTC(year, month - 1, day));
  return (
    asDate.getUTCFullYear() === year &&
    asDate.getUTCMonth() === month - 1 &&
    asDate.getUTCDate() === day
  );
}

/** Spec §3.2 step 2: decode the payload, refuse if any required field is
 *  missing or has the wrong shape. Returns a clean LicencePayload (only the
 *  fields the type declares) or null. */
function checkPayloadShape(raw: unknown): LicencePayload | null {
  if (!isPlainObject(raw)) return null;
  if (raw.v !== 1) return null;
  if (typeof raw.kid !== 'string' || raw.kid.length === 0) return null;
  if (raw.iss !== 'web' && raw.iss !== 'apple' && raw.iss !== 'google') return null;
  if (raw.plan !== 'founding' && raw.plan !== 'standard') return null;

  const hasSeq = Object.prototype.hasOwnProperty.call(raw, 'seq');
  if (raw.plan === 'founding') {
    // spec §3.1: seq is the founding number, 1 to 200, and only founding
    // licences carry it.
    if (!hasSeq) return null;
    const seq = raw.seq;
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1 || seq > 200) return null;
  } else if (hasSeq) {
    return null;
  }

  if (typeof raw.ref !== 'string' || raw.ref.length === 0) return null;
  if (typeof raw.at !== 'string' || !isValidDateString(raw.at)) return null;

  if (Object.prototype.hasOwnProperty.call(raw, 'to')) {
    // A whitespace-only name is not a name (it would show as "Licensed to
    // , ..." in the Settings card); the Worker itself never produces one
    // (licence-worker/index.ts trims and drops an empty buyer name before
    // signing), but a hand-typed or tampered licence could still carry one.
    if (typeof raw.to !== 'string' || raw.to.trim().length === 0) return null;
  }

  const payload: LicencePayload = {
    v: 1,
    kid: raw.kid,
    iss: raw.iss,
    plan: raw.plan,
    ref: raw.ref,
    at: raw.at,
  };
  if (raw.plan === 'founding') payload.seq = raw.seq as number;
  if (typeof raw.to === 'string') payload.to = raw.to;
  return payload;
}

interface SplitOk {
  payloadB64: string;
  sigB64: string;
  payload: LicencePayload;
}

/** Spec §3.2 steps 1-2, shared by `parseLicence` and `verifyLicence` so the
 *  two never disagree about what counts as a well-formed licence. */
function splitAndParse(
  text: string,
): { ok: true; value: SplitOk } | { ok: false; reason: 'format' | 'payload' } {
  if (typeof text !== 'string') return { ok: false, reason: 'format' };
  // A trailing newline or a leading/trailing space, both common side effects
  // of copying a licence out of an email or a text field, are not part of
  // the licence and must not cost an honest buyer a "not valid" (spec §10).
  const trimmed = text.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3 || parts[0] !== LICENCE_TAG) return { ok: false, reason: 'format' };
  const [, payloadB64, sigB64] = parts;
  if (!BASE64URL_RE.test(payloadB64) || !BASE64URL_RE.test(sigB64))
    return { ok: false, reason: 'format' };

  let json: string;
  try {
    json = new TextDecoder().decode(base64UrlDecode(payloadB64));
  } catch {
    return { ok: false, reason: 'payload' };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'payload' };
  }

  const payload = checkPayloadShape(raw);
  if (payload === null) return { ok: false, reason: 'payload' };
  return { ok: true, value: { payloadB64, sigB64, payload } };
}

/**
 * Spec §3.2 steps 1-2 only: split the text and check the payload's shape.
 * Synchronous, so a screen can show an instant reason before the (async)
 * signature check runs.
 */
export function parseLicence(text: string): LicenceParseResult {
  const r = splitAndParse(text);
  if (!r.ok) return r;
  return { ok: true, payload: r.value.payload };
}

/**
 * The full check, spec §3.2 steps 1-4: format, payload shape, the key named
 * by `kid`, then the signature itself. Pass a key list to test against a
 * throwaway key rather than the app's shipped `LICENCE_KEYS`.
 */
export async function verifyLicence(
  text: string,
  keys: Readonly<Record<string, JsonWebKey>> = LICENCE_KEYS,
): Promise<LicenceResult> {
  const r = splitAndParse(text);
  if (!r.ok) return r;
  const { payloadB64, sigB64, payload } = r.value;

  // Own properties only: a `kid` such as "constructor" or "__proto__" must
  // read as an unknown key, not pick up something inherited from Object.
  if (!Object.prototype.hasOwnProperty.call(keys, payload.kid)) {
    return { ok: false, reason: 'unknown-key' };
  }
  const jwk = keys[payload.kid];

  try {
    const key = await globalThis.crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const sigBytes = base64UrlDecode(sigB64);
    const data = new TextEncoder().encode(payloadB64);
    const verified = await globalThis.crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      sigBytes,
      data,
    );
    if (!verified) return { ok: false, reason: 'bad-signature' };
    return { ok: true, payload };
  } catch {
    // A key that will not import, or a signature that will not verify
    // (wrong length, wrong curve, signed by a different key): all read the
    // same to a buyer, that this text is not a valid licence.
    return { ok: false, reason: 'bad-signature' };
  }
}

/**
 * The words the Settings "Your licence" card shows once a licence has
 * verified (spec §5.5). Takes an already-verified payload; it does not check
 * a signature itself.
 */
export function licenceSummary(payload: LicencePayload): string {
  const who = payload.to ? `Licensed to ${payload.to}` : 'Licensed';
  const plan = payload.plan === 'founding' ? `Founding member #${payload.seq}` : 'Standard';
  return `${who}, ${plan}, since ${payload.at}`;
}
