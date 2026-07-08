// Bucket storage for the benchmark Worker — Cloudflare D1 (SQLite).
//
// What is stored is the WHOLE privacy design (build spec §5B): one row per
// bucket holding a count and a fixed-size histogram. No contribution row, no
// timestamp, no IP, no ID — a stored bucket physically cannot be walked back
// to a person, because nothing per-person was ever written. "Raw POSTs not
// retained beyond processing" is enforced by this schema having nowhere to
// put them.
//
// The D1 types below are minimal LOCAL declarations of just the members this
// module touches, instead of adding the @cloudflare/workers-types package —
// deliberate (dependency policy, project rule 43): one fewer dependency to
// age, and the shapes are stable, documented Cloudflare API.

import type { BenchmarkContribution } from '../src/lib/benchmark.ts';
import type { BenchmarkBracket } from './contract.ts';
import { BIN_COUNT, bucketKey, valueToBin } from './contract.ts';

export interface D1PreparedStatement {
  bind(...values: (string | number | null)[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}

export interface BucketDistribution {
  count: number;
  bins: number[];
}

/** The storage seam. The Worker talks to this interface only, so tests run
 *  the identical handler against a real-SQLite fake (see tests/worker.test.ts)
 *  and a different backend could replace D1 without touching the handler. */
export interface BenchmarkStore {
  record(c: BenchmarkContribution): Promise<void>;
  distribution(b: BenchmarkBracket): Promise<BucketDistribution | null>;
}

/** One atomic statement: first contribution creates the bucket with this bin
 *  set to 1; every later one increments the count and the right bin in place.
 *  Single-statement UPSERT = no read-modify-write race between requests.
 *  The JSON path ('$[29]') is built in code and bound as a STRING — composing
 *  it in SQL from a bound number renders engine-dependently (SQLite binds JS
 *  numbers as floats → '$[29.0]', a bad path; caught by the real-SQLite test). */
export const UPSERT_SQL = `
INSERT INTO buckets (key, scoring_type, division, class, gun_category, metric, count, bins)
VALUES (?, ?, ?, ?, ?, ?, 1, json_set(?, ?, 1))
ON CONFLICT(key) DO UPDATE SET
  count = count + 1,
  bins = json_set(bins, ?, COALESCE(json_extract(bins, ?), 0) + 1)
`.trim();

export const SELECT_SQL = 'SELECT count, bins FROM buckets WHERE key = ?';

const ZERO_BINS = JSON.stringify(new Array(BIN_COUNT).fill(0));

export class D1BenchmarkStore implements BenchmarkStore {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async record(c: BenchmarkContribution): Promise<void> {
    const path = `$[${valueToBin(c.metric, c.value)}]`;
    await this.db
      .prepare(UPSERT_SQL)
      .bind(
        bucketKey(c),
        c.scoringType,
        c.division,
        c.class,
        c.gunCategory,
        c.metric,
        ZERO_BINS,
        path,
        path,
        path,
      )
      .run();
  }

  async distribution(b: BenchmarkBracket): Promise<BucketDistribution | null> {
    const row = await this.db
      .prepare(SELECT_SQL)
      .bind(bucketKey(b))
      .first<{ count: number; bins: string }>();
    if (row === null) return null;
    let bins: unknown;
    try {
      bins = JSON.parse(row.bins);
    } catch {
      return null; // a corrupt row reads as "no data", never as an error
    }
    if (!Array.isArray(bins) || bins.length !== BIN_COUNT) return null;
    if (!bins.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0)) return null;
    return { count: row.count, bins: bins as number[] };
  }
}
