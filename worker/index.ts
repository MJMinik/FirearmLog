// FirearmLog benchmark endpoint — a Cloudflare Worker (Rung-1 Layer B).
//
// Build spec §5B / decision 4, option 1: our own deliberately tiny endpoint.
// One POST route accepting the fixed contribution schema, one GET serving
// only buckets past the k-anonymity threshold, one health check. No cookies,
// no auth tokens, no IDs — the SERVER design enforces unlinkability, not just
// the client's promise.
//
// INERT as shipped (Rung-1 step 3): nothing in the app calls this, and it is
// not deployed. Deployment + wiring happen in step 4 on a danger-zone branch.
//
// Privacy / resilience properties, each load-bearing:
//   • Contributions are validated hard (contract.ts) and folded into a bucket
//     histogram in ONE atomic statement; nothing per-request is stored.
//   • The GET never reveals whether a thin bucket exists: below-k and
//     non-existent buckets return the IDENTICAL "not_enough_data" body, so
//     small-cell suppression can't be probed (spec §4.3).
//   • The k-threshold (default 50) is read per-request from the environment —
//     tunable without a code change.
//   • Every unexpected failure returns a clean 500 with no internals leaked;
//     the app-side queue treats any non-2xx as "keep it queued, try later."
//   • Per-IP rate limiting runs at the Cloudflare edge (configured with the
//     deployment, step 4) — the Worker itself never sees a need to store IPs.

import { parseBracket, parseContribution, binParams } from './contract.ts';
import type { BenchmarkStore, D1Database } from './store.ts';
import { D1BenchmarkStore } from './store.ts';

export interface Env {
  DB: D1Database;
  /** Minimum contributors before a bucket is served (k-anonymity). */
  K_THRESHOLD?: string;
  /** Comma-separated origin allow-list for CORS. */
  ALLOWED_ORIGINS?: string;
}

/** Origins that may call this API from a browser. Overridable via env so the
 *  domain cut-over never needs a code change. */
const DEFAULT_ALLOWED_ORIGINS = [
  'https://mjminik.github.io',
  'https://firearmlog.com',
  'https://www.firearmlog.com',
  'https://firearmlog.app',
  'https://www.firearmlog.app',
];

const DEFAULT_K = 50;

/** A contribution is ~150 bytes; anything past this is not a contribution. */
const MAX_BODY_BYTES = 2048;

function kThreshold(env: Env): number {
  const k = Number(env.K_THRESHOLD);
  return Number.isInteger(k) && k >= 1 ? k : DEFAULT_K;
}

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

async function handleContribution(
  request: Request,
  store: BenchmarkStore,
  cors: Record<string, string>,
): Promise<Response> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413, cors);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ error: 'bad_json' }, 400, cors);
  }
  const contribution = parseContribution(raw);
  if (contribution === null) return json({ error: 'invalid_contribution' }, 400, cors);
  await store.record(contribution);
  // 204: accepted, nothing echoed back — there is nothing to say about an
  // anonymous sample, and no body means no accidental information leak.
  return new Response(null, { status: 204, headers: cors });
}

async function handleBenchmarkQuery(
  url: URL,
  store: BenchmarkStore,
  k: number,
  cors: Record<string, string>,
): Promise<Response> {
  const bracket = parseBracket(url.searchParams);
  if (bracket === null) return json({ error: 'invalid_query' }, 400, cors);
  // Aggregates move slowly; a short shared cache keeps a popular bracket from
  // hammering the database without serving stale data for long.
  const cacheable = { 'Cache-Control': 'public, max-age=300', ...cors };
  const dist = await store.distribution(bracket);
  if (dist === null || dist.count < k) {
    // Identical body for "thin" and "absent" — see the header comment.
    return json({ status: 'not_enough_data' }, 200, cacheable);
  }
  const geometry = binParams(bracket.metric);
  return json(
    {
      status: 'ok',
      ...bracket,
      count: dist.count,
      binStart: geometry.start,
      binWidth: geometry.width,
      binCount: geometry.count,
      bins: dist.bins,
    },
    200,
    cacheable,
  );
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
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (url.pathname === '/healthz') {
    if (request.method !== 'GET') {
      return json({ error: 'method_not_allowed' }, 405, { ...cors, Allow: 'GET' });
    }
    // Deliberately does not touch the database: health means "the Worker is
    // up." If D1 is down, POSTs fail and the app-side queue simply retries.
    return json({ status: 'ok' }, 200, cors);
  }

  if (url.pathname === '/v1/contributions') {
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, { ...cors, Allow: 'POST' });
    }
    return handleContribution(request, new D1BenchmarkStore(env.DB), cors);
  }

  if (url.pathname === '/v1/benchmarks') {
    if (request.method !== 'GET') {
      return json({ error: 'method_not_allowed' }, 405, { ...cors, Allow: 'GET' });
    }
    return handleBenchmarkQuery(url, new D1BenchmarkStore(env.DB), kThreshold(env), cors);
  }

  return json({ error: 'not_found' }, 404, cors);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch {
      // Zero-crash, server edition: no failure ever leaks internals, and the
      // client treats any non-2xx as "queue and retry later."
      return json({ error: 'internal' }, 500, corsHeaders(request, env));
    }
  },
};
