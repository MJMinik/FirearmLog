# FirearmLog benchmark endpoint (Cloudflare Worker)

**Status: INERT.** This folder is Rung-1 **step 3**: the server half of the
aggregate-benchmark flywheel, written, tested, and reviewed — but **not
deployed, and not called by the app**. Wiring it up (deployment, the on-device
contribution queue, real sending) is **step 4**, on a danger-zone branch.

Design source of truth: `DATA_MOAT_SPEC.md` and the Rung-1 build spec
(vault → `Reviews & Analyses/Rung-1 analytics + benchmark flywheel — build
spec 2026-07-06.md`), decision 4 option 1.

## What it is

A deliberately tiny API — three routes, one table:

| Route                    | Does                                                                                                                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/contributions` | Accepts ONE anonymous benchmark sample (the fixed 6-field schema), validates it hard, folds it into its bucket's histogram in a single atomic statement. Returns `204` — nothing echoed.                                    |
| `GET /v1/benchmarks?…`   | Returns a bucket's count + histogram **only once at least k (default 50) shooters have contributed**. Below-k and non-existent buckets return the _identical_ `not_enough_data` body, so thin buckets can't even be probed. |
| `GET /healthz`           | Liveness only; never touches the database.                                                                                                                                                                                  |

The app computes its own percentile locally from the pulled-back histogram —
the server never knows which shooter asked.

## The privacy properties (each enforced by code, not policy)

- **No IDs of any kind.** No cookies, no auth, no device/install ID. There is
  no column to store one (`schema.sql`).
- **Nothing per-request is retained.** A contribution becomes `count + 1` and
  one histogram bin `+ 1`, then exists nowhere.
- **Same bounds AND the same enum allow-list as the app.** The server imports
  the app's own `isValidContribution` + `METRIC_BOUNDS` (`src/lib/benchmark.ts`),
  so `division` and `class` must be real, canonical values (R-B) — a free-text or
  junk bracket is refused, and client and server guards cannot drift apart.
- **Strict wire contract.** Exactly six fields, charset/length caps on the free
  strings, one sample per POST (no batching that could fingerprint). `appVersion`
  was removed (R-11) — it was never stored and would only have been a
  re-identification slicing dimension.
- **k-anonymity means SHOOTERS, not samples.** Each install contributes at most
  one current-standing sample per bucket (client-side, `summarizeContributions`),
  so k (default 50) honestly counts ~50 different shooters. Small-cell suppression
  is unprobeable (see table above).
- **IPs**: a code-level per-IP rate limit runs when the `RATE_LIMITER` binding is
  configured (fail-safe even if the edge WAF rule is missed); either way the IP is
  only a transient rate key and is never read into a response or stored (no IP
  column exists).

## Files

- `contract.ts` — wire validation, bucket keys, histogram geometry (pure)
- `store.ts` — the `BenchmarkStore` seam + the D1 implementation
- `index.ts` — routing, CORS, error containment
- `schema.sql` — the one-table D1 schema (applied in step 4)
- `wrangler.toml` — deploy config with the step-4 checklist inline

## Tests

`tests/worker.test.ts` runs in the repo's normal suite (`npm test`). The D1
adapter is exercised against **real SQLite** (`node:sqlite`, same engine D1
runs on), so the UPSERT and `json_set` histogram arithmetic are executed, not
assumed. Handler tests cover the k-threshold gate, the identical thin/absent
response, CORS allow/deny, junk payloads, oversized bodies, wrong methods, and
the clean-500 guarantee.
