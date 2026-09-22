// FirearmLog signing Worker (ENTITLEMENT_SPEC_2026-09-18.md §4) -- a second,
// separate Cloudflare Worker from the benchmark Worker in App/worker/ (which
// has its own, unrelated design).
//
// INERT as written: not deployed, and nothing in the app calls it (spec §11,
// build-order step 2: "deployed but wired to nothing"). Three routes:
//
//   POST /v1/webhook       Paddle tells us a purchase completed (spec §4.1).
//   GET  /v1/licence?txn=  the buyer (or the success page, for them) asks
//                          for their licence text (spec §4.3).
//   GET  /healthz          liveness only.
//
// This file is not under src/, so the app's network-word guard
// (scripts/check-imports.mjs) does not apply to it and never will: a signing
// Worker's whole job is to talk to Paddle. The app itself still never calls
// this Worker in this build (that wiring is spec §11 step 3, later, and on
// a danger-zone branch).

import { D1FoundingStore } from './store.ts';
import type { D1Database, FoundingStore } from './store.ts';
import { PaddleMerchantLookup } from './merchant.ts';
import type { MerchantLookup } from './merchant.ts';
import { signLicence } from './sign.ts';
import { parseLicence } from '../src/lib/licence.ts';
import type { LicencePayload } from '../src/lib/licence.ts';

/** Cloudflare's Rate Limiting binding (the subset used), the same shape
 *  worker/index.ts declares for its own POST limiter. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  /** The Worker secret: the private signing key, as a JSON Web Key string
   *  (spec §4.5). Never logged, never returned in a response. */
  SIGNING_KEY_JWK: string;
  /** Which key SIGNING_KEY_JWK is, matching a `kid` in the app's
   *  src/lib/licence.ts LICENCE_KEYS once that key is added there at the
   *  key ceremony (spec §3.3). */
  KEY_ID: string;
  /** The shared secret Paddle signs webhooks with (spec §4.1, §9). */
  WEBHOOK_SECRET: string;
  /** A read-only Paddle API key: can read a transaction, never charge or
   *  refund (spec §4.3, §4.5). */
  MERCHANT_API_KEY: string;
  /** Optional per-IP rate limiter, exactly as worker/index.ts's RATE_LIMITER
   *  (R-8 there): a fail-safe in code even if an edge WAF rule is missed. */
  RATE_LIMITER?: RateLimiter;
  /** Comma-separated origin allow-list for CORS, overriding the default
   *  below. The same override worker/index.ts offers, for the same reason:
   *  a domain cut-over never needs a code change. */
  ALLOWED_ORIGINS?: string;
  /** Which top-level field of a webhook body names the event (spec §9, to be
   *  confirmed against Paddle's documentation on the day). Defaults to
   *  'event_type' below. */
  WEBHOOK_EVENT_FIELD?: string;
  /** The event value that means "payment completed" (spec §9, to be
   *  confirmed on the day). Defaults to 'transaction.completed' below. Only
   *  a webhook carrying this event ever claims a founding number: Paddle
   *  sends several transaction events per checkout, and claiming on any of
   *  them would burn a founding number on an abandoned checkout. */
  WEBHOOK_PAID_EVENT?: string;
  /** TEST-ONLY SEAM. Never set in wrangler.toml or in any real deployment.
   *  When present, the GET /v1/licence route uses this MerchantLookup
   *  instead of building a PaddleMerchantLookup from MERCHANT_API_KEY, so
   *  tests can exercise the route without a network call. */
  MERCHANT_LOOKUP?: MerchantLookup;
}

/** Same allow-list, and the same ALLOWED_ORIGINS env override, as
 *  worker/index.ts (spec §10: the new Worker reuses the app's origins, not a
 *  second list to keep in sync by hand). */
const DEFAULT_ALLOWED_ORIGINS = [
  'https://app.firearmlog.com',
  'https://mjminik.github.io',
  'https://firearmlog.com',
  'https://www.firearmlog.com',
  'https://firearmlog.app',
  'https://www.firearmlog.app',
];

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin');
  const allowed = (
    env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()) ?? DEFAULT_ALLOWED_ORIGINS
  ).filter((s) => s.length > 0);
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (origin !== null && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function json(body: unknown, status: number, extraHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function store(env: Env): FoundingStore {
  return new D1FoundingStore(env.DB);
}

function merchant(env: Env): MerchantLookup {
  return env.MERCHANT_LOOKUP ?? new PaddleMerchantLookup(env.MERCHANT_API_KEY);
}

// --- webhook signature (spec §4.1, §9) ---------------------------------------
//
// SECTION 9 OF THE SPEC, TO BE CONFIRMED: the header name and the exact
// string it hashes, from Paddle's documentation on the day. This follows
// Paddle Billing's documented shape as the audit read it: a header named
// Paddle-Signature carrying `ts=<unix>;h1=<hex>`, the hash being HMAC-SHA256
// over `${ts}:${rawBody}` with the shared webhook secret.

const SIGNATURE_HEADER = 'Paddle-Signature';

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time-ish comparison of two equal-length hex strings, so a
 *  signature check does not leak how many leading bytes matched through
 *  timing. Falls back to false on any length mismatch, before comparing. */
function hexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyWebhookSignature(
  header: string | null,
  rawBody: string,
  secret: string,
): Promise<boolean> {
  if (header === null) return false;
  // A missing or empty secret must read as "the signature does not check
  // out" (400), not crash importKey into an internal 500: the same failure
  // Paddle sees either way, but the correct status and a log line instead
  // of a leaked-looking server error.
  if (secret.length === 0) return false;
  const m = /ts=(\d+);h1=([0-9a-f]+)/.exec(header);
  if (m === null) return false;
  const [, ts, h1] = m;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}:${rawBody}`));
  return hexEqual(toHex(mac), h1.toLowerCase());
}

interface WebhookTransaction {
  id: string;
  product: 'founding' | 'standard' | 'other';
  at: string;
}

/** SECTION 9 OF THE SPEC, TO BE CONFIRMED: the real Paddle Billing webhook
 *  body shape and event name, from Paddle's documentation on the day. This
 *  reads a placeholder shape (`data.id`, `data.product`, `data.occurred_at`)
 *  so the route around it is real, tested code now; only the field names
 *  change later. */
function extractWebhookTransaction(body: unknown): WebhookTransaction | null {
  if (typeof body !== 'object' || body === null) return null;
  const data = (body as Record<string, unknown>).data;
  if (typeof data !== 'object' || data === null) return null;
  const id = (data as Record<string, unknown>).id;
  const product = (data as Record<string, unknown>).product;
  const at = (data as Record<string, unknown>).occurred_at;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (product !== 'founding' && product !== 'standard' && product !== 'other') return null;
  if (typeof at !== 'string' || at.length === 0) return null;
  return { id, product, at: at.slice(0, 10) };
}

const WEBHOOK_EVENT_FIELD_DEFAULT = 'event_type';
const WEBHOOK_PAID_EVENT_DEFAULT = 'transaction.completed';

/** SECTION 9 OF THE SPEC, TO BE CONFIRMED: reads the top-level field that
 *  names the webhook's event, under the field name env.WEBHOOK_EVENT_FIELD
 *  gives (default 'event_type'). Paddle sends several transaction events per
 *  checkout (created, updated, completed, and more); only the completed one
 *  (env.WEBHOOK_PAID_EVENT, default 'transaction.completed') may ever claim
 *  a founding number, or an abandoned checkout would burn one permanently
 *  (decision 12.9: a founding number, once spent, is spent). */
function webhookEventType(body: unknown, fieldName: string): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[fieldName];
  return typeof value === 'string' ? value : null;
}

async function handleWebhook(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  if (!env.WEBHOOK_SECRET) {
    // A misconfigured deploy, not an attack: worth a distinct log line so
    // Michael can tell the two apart, but the buyer-facing (well, Paddle-
    // facing) answer is the same plain 400 either way.
    console.log('licence-worker: WEBHOOK_SECRET is not set');
    return json({ error: 'bad_signature' }, 400, cors);
  }

  const rawBody = await request.text();
  const ok = await verifyWebhookSignature(
    request.headers.get(SIGNATURE_HEADER),
    rawBody,
    env.WEBHOOK_SECRET,
  );
  if (!ok) {
    // spec §4.1: "a message that fails the check is dropped with a log line
    // and nothing else." No body content is logged, only that it happened.
    console.log('licence-worker: webhook signature rejected');
    return json({ error: 'bad_signature' }, 400, cors);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = null;
  }
  const txn = extractWebhookTransaction(body);
  const eventField = env.WEBHOOK_EVENT_FIELD ?? WEBHOOK_EVENT_FIELD_DEFAULT;
  const paidEvent = env.WEBHOOK_PAID_EVENT ?? WEBHOOK_PAID_EVENT_DEFAULT;
  const eventType = webhookEventType(body, eventField);
  // spec §4.1: the webhook's whole job is taking the founding number when
  // the product is the founding one AND the event is the completed-payment
  // one (finding 5 of the cold audit: without the event check, an abandoned
  // founding checkout would also burn a number). A reply goes only to
  // Paddle, never to the buyer, so this always answers 200 once the
  // signature is valid, whether or not anything was claimed.
  if (txn !== null && txn.product === 'founding' && eventType === paidEvent) {
    await store(env).claim(txn.id, txn.at);
  }
  return new Response(null, { status: 200, headers: cors });
}

// --- GET /v1/licence (spec §4.3) ---------------------------------------------

async function handleGetLicence(
  url: URL,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  if (!env.KEY_ID || !env.SIGNING_KEY_JWK) {
    // No secrets in the log: only that the config is missing, never the
    // (would-be) key material itself (finding 6 of the cold audit: an
    // unset KEY_ID would otherwise sign licences the app can never accept).
    console.log('licence-worker: KEY_ID or SIGNING_KEY_JWK is not set');
    return json({ error: 'internal' }, 500, cors);
  }

  const txn = url.searchParams.get('txn');
  if (txn === null || txn.length === 0) return json({ error: 'not_found' }, 404, cors);

  const record = await merchant(env).transaction(txn);
  if (record === null || !record.paid) return json({ error: 'not_found' }, 404, cors);

  // From here on, use the merchant's own id for the transaction, not the
  // query string that was typed or pasted into the URL: if the lookup ever
  // tolerates a variant spelling (case, stray whitespace), two spellings of
  // one purchase must still claim and be claimed as the same transaction.
  const txnId = record.id;

  let plan: LicencePayload['plan'] = 'standard';
  let seq: number | undefined;
  if (record.product === 'founding') {
    const claimed = await store(env).claim(txnId, record.date);
    if ('refused' in claimed) {
      // Decision 12.8: a founding-price purchase that missed the 200 cap is
      // honoured at the standard product, and the transaction is logged so
      // Michael can see it. The Paddle founding price is switched off by
      // hand the day the counter reaches 200; this refusal is the guarantee.
      console.log(
        `licence-worker: founding cap reached, issuing standard licence for txn ${txnId}`,
      );
      plan = 'standard';
    } else {
      plan = 'founding';
      seq = claimed.seq;
    }
  }

  const payload: LicencePayload = {
    v: 1,
    kid: env.KEY_ID,
    iss: 'web',
    plan,
    ref: txnId,
    at: record.date,
  };
  if (seq !== undefined) payload.seq = seq;
  const buyerName = record.buyerName?.trim();
  if (buyerName) payload.to = buyerName;

  const licence = await signLicence(payload, JSON.parse(env.SIGNING_KEY_JWK) as JsonWebKey);

  // A licence this Worker signs must always be one the app itself would
  // accept (finding 6): run the same parseLicence check the app runs before
  // ever handing the text back. This cannot catch a wrong signature (that
  // needs the public key, which this route never holds), but it catches
  // every other way a bad KEY_ID, a bad date, or a bad payload could produce
  // a licence no buyer could ever use.
  const parsed = parseLicence(licence);
  if (!parsed.ok) {
    console.log(
      `licence-worker: signed licence failed its own parse check, reason ${parsed.reason}`,
    );
    return json({ error: 'internal' }, 500, cors);
  }

  return json({ licence }, 200, cors);
}

async function route(request: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(request, env);
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Paddle-Signature',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (url.pathname === '/healthz') {
    if (request.method !== 'GET')
      return json({ error: 'method_not_allowed' }, 405, { ...cors, Allow: 'GET' });
    return json({ status: 'ok' }, 200, cors);
  }

  if (url.pathname === '/v1/webhook') {
    if (request.method !== 'POST')
      return json({ error: 'method_not_allowed' }, 405, { ...cors, Allow: 'POST' });
    return handleWebhook(request, env, cors);
  }

  if (url.pathname === '/v1/licence') {
    if (request.method !== 'GET')
      return json({ error: 'method_not_allowed' }, 405, { ...cors, Allow: 'GET' });
    if (env.RATE_LIMITER) {
      const key = request.headers.get('CF-Connecting-IP') ?? 'anon';
      const { success } = await env.RATE_LIMITER.limit({ key });
      if (!success) return json({ error: 'rate_limited' }, 429, cors);
    }
    return handleGetLicence(url, env, cors);
  }

  return json({ error: 'not_found' }, 404, cors);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (e) {
      // Same zero-crash guarantee as worker/index.ts: no failure leaks
      // internals, including a merchant-API or signing-key problem. Logging
      // just the error's name (never its message, which could carry a
      // secret or a URL) is enough for Michael to see that something failed
      // without the failure being invisible (finding 15 of the cold audit).
      console.log(`licence-worker: internal error, ${e instanceof Error ? e.name : 'unknown'}`);
      return json({ error: 'internal' }, 500, corsHeaders(request, env));
    }
  },
};
