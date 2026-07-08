// Server-side wire contract for benchmark contributions (build spec §5B).
//
// The Worker's half of the junk-data guard. Everything arriving over the wire
// is UNTRUSTED: this module turns unknown JSON / query strings into a verified
// `BenchmarkContribution` bracket or rejects it. The enum + plausibility rules
// are REUSED from `src/lib/benchmark.ts` (one source of truth — the server can
// never drift from what the app itself considers valid), and this module adds
// the server-only rules a hostile client makes necessary:
//
//   • strict shape: exactly the schema's seven fields, nothing extra — no
//     smuggling data alongside a contribution (no-batching rule, spec §5B)
//   • string caps + charset allow-lists on the free-string fields, so junk
//     can't mint unbounded bucket keys or stuff the store
//   • the `|` bucket-key separator is excluded from the allowed charset, so a
//     crafted division can never collide with another bracket's key
//
// Pure functions only — no I/O, no Cloudflare APIs — so the whole contract is
// unit-testable under the repo's plain-Node test runner.

import { isValidContribution, METRIC_BOUNDS } from '../src/lib/benchmark.ts';
import type { BenchmarkContribution, BenchmarkMetric } from '../src/lib/benchmark.ts';

/** A bracket = a contribution minus its value — the five fields that name a
 *  bucket. What the GET endpoint accepts as a query. */
export type BenchmarkBracket = Omit<BenchmarkContribution, 'value' | 'appVersion'>;

/** Histogram resolution per bucket. 50 bins over each metric's plausibility
 *  range is fine-grained enough for percentiles yet stores a fixed, tiny
 *  amount per bucket regardless of contribution volume. */
export const BIN_COUNT = 50;

/** Division / class arrive as app-canonical strings ("Carry Optics", "C") but
 *  a hostile client can send anything. Printable, bounded, and no `|` (the
 *  bucket-key separator) — see the module comment. */
const TEXT_RE = /^[A-Za-z0-9 .+/'()-]{1,40}$/;

/** appVersion: semver-ish, bounded. Never part of the bucket key. */
const VERSION_RE = /^[0-9A-Za-z.+-]{1,32}$/;

const CONTRIBUTION_FIELDS = [
  'scoringType',
  'division',
  'class',
  'gunCategory',
  'metric',
  'value',
  'appVersion',
] as const;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** The metric's plausibility bounds, or null for an unknown metric string. */
export function metricBounds(metric: string): { min: number; max: number } | null {
  if (!Object.prototype.hasOwnProperty.call(METRIC_BOUNDS, metric)) return null;
  return METRIC_BOUNDS[metric as BenchmarkMetric];
}

/** Parse one POSTed contribution. Returns the verified contribution, or null —
 *  callers never see a partially-valid object. */
export function parseContribution(raw: unknown): BenchmarkContribution | null {
  if (!isRecord(raw)) return null;
  // Exactly the schema's fields — reject extras outright (strict contract).
  const keys = Object.keys(raw);
  if (keys.length !== CONTRIBUTION_FIELDS.length) return null;
  for (const k of keys) {
    if (!(CONTRIBUTION_FIELDS as readonly string[]).includes(k)) return null;
  }
  const { scoringType, division, gunCategory, metric, value, appVersion } = raw;
  const cls = raw['class'];
  if (typeof scoringType !== 'string') return null;
  if (typeof division !== 'string' || !TEXT_RE.test(division)) return null;
  if (typeof cls !== 'string' || !TEXT_RE.test(cls)) return null;
  if (typeof gunCategory !== 'string') return null;
  if (typeof metric !== 'string' || metricBounds(metric) === null) return null;
  if (typeof value !== 'number') return null;
  if (typeof appVersion !== 'string' || !VERSION_RE.test(appVersion)) return null;
  // Primitive shape is now proven; the app's own validator enforces the enums
  // (scoringType, gunCategory) and the plausibility bounds on value.
  const candidate = {
    scoringType,
    division,
    class: cls,
    gunCategory,
    metric,
    value,
    appVersion,
  } as BenchmarkContribution;
  return isValidContribution(candidate) ? candidate : null;
}

/** Parse a GET query into a verified bracket. Same rules as a contribution —
 *  implemented BY building a probe contribution (value = the metric's own
 *  minimum, a version placeholder) and running it through parseContribution,
 *  so the two entry points can never accept different brackets. */
export function parseBracket(params: URLSearchParams): BenchmarkBracket | null {
  const metric = params.get('metric') ?? '';
  const bounds = metricBounds(metric);
  if (bounds === null) return null;
  const probe = parseContribution({
    scoringType: params.get('scoringType') ?? '',
    division: params.get('division') ?? '',
    class: params.get('class') ?? '',
    gunCategory: params.get('gunCategory') ?? '',
    metric,
    value: bounds.min,
    appVersion: '0.0.0',
  });
  if (probe === null) return null;
  return {
    scoringType: probe.scoringType,
    division: probe.division,
    class: probe.class,
    gunCategory: probe.gunCategory,
    metric: probe.metric,
  };
}

/** The storage key for a bracket. Safe to join with `|` because TEXT_RE
 *  excludes it and the other fields are closed enums. */
export function bucketKey(b: BenchmarkBracket): string {
  return [b.scoringType, b.division, b.class, b.gunCategory, b.metric].join('|');
}

/** Histogram geometry for a metric, derived from the shared bounds. */
export function binParams(metric: BenchmarkMetric): {
  start: number;
  width: number;
  count: number;
} {
  const bounds = METRIC_BOUNDS[metric];
  return { start: bounds.min, width: (bounds.max - bounds.min) / BIN_COUNT, count: BIN_COUNT };
}

/** Which histogram bin a (already bounds-checked) value falls in. The top of
 *  the range lands in the last bin, never out of array. */
export function valueToBin(metric: BenchmarkMetric, value: number): number {
  const { start, width } = binParams(metric);
  const i = Math.floor((value - start) / width);
  return Math.min(Math.max(i, 0), BIN_COUNT - 1);
}
