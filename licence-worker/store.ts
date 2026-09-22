// The founding counter (ENTITLEMENT_SPEC_2026-09-18.md §4.2).
//
// What makes this safe is the schema's two uniqueness rules, not the wording
// of the insert: seq is the table's primary key (a number can never be
// handed out twice) and txn is unique (a purchase can never take two
// numbers). The insert below takes seq as one more than the current
// highest, in the SAME statement refusing to run at all once 200 rows
// exist, so the cap is enforced in one step the database cannot be
// interrupted part-way through.
//
// The D1 types below are minimal LOCAL declarations of just the members this
// module touches, the same choice worker/store.ts makes and for the same
// reason (project rule 43): one fewer dependency to age, against a stable,
// documented Cloudflare API.

export const FOUNDING_CAP = 200;

export interface D1PreparedStatement {
  bind(...values: (string | number | null)[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}

export type ClaimResult = { seq: number } | { refused: 'cap' } | { seq: number; existing: true };

/** The storage seam, so the handler and its tests run against a real-SQLite
 *  fake exactly as worker/'s tests do (see tests/licence-worker.test.ts). */
export interface FoundingStore {
  /** Takes the next founding number for `txn`, or returns the number it
   *  already holds if `txn` has claimed one before (spec §4.1: "safe to
   *  repeat" -- Paddle may deliver the same webhook more than once), or
   *  refuses once 200 numbers are out. */
  claim(txn: string, at: string): Promise<ClaimResult>;
}

/**
 * One statement: SELECT COALESCE(MAX(seq),0)+1 as the candidate row, but
 * only produces that row at all when HAVING COALESCE(MAX(seq),0) < the cap.
 * The cap is checked against the HIGHEST NUMBER EVER ISSUED, not the row
 * count, so a row deleted by hand later can never open a phantom gap: if
 * seq 200 was issued and some other row is later removed, the count drops
 * below 200 but the highest number issued is still 200, and this correctly
 * keeps refusing (a count-based check would instead try to insert seq 201,
 * which the app itself would then reject as an invalid payload, since it
 * only accepts seq up to 200).
 *
 * HAVING (not WHERE) is what makes the refusal atomic and correct: an
 * aggregate query with no GROUP BY always returns exactly one row, so a
 * WHERE clause that does not reference the aggregated rows themselves
 * cannot suppress it; a HAVING clause filters the AGGREGATE result itself,
 * so once the cap is reached this SELECT produces zero rows and the INSERT
 * inserts nothing, in the same statement, with no separate read-then-write
 * race window. (HAVING without GROUP BY needs SQLite 3.39 or later; D1 and
 * Node 22's node:sqlite both satisfy that.) A same-txn retry is absorbed by
 * ON CONFLICT(txn) DO NOTHING, and RETURNING reports only a row that was
 * actually inserted, never one skipped by the conflict clause.
 */
const CLAIM_SQL = `
INSERT INTO founding (seq, txn, at)
SELECT COALESCE(MAX(seq), 0) + 1, ?, ?
FROM founding
HAVING COALESCE(MAX(seq), 0) < ?
ON CONFLICT(txn) DO NOTHING
RETURNING seq
`.trim();

const SELECT_BY_TXN_SQL = 'SELECT seq FROM founding WHERE txn = ?';

export class D1FoundingStore implements FoundingStore {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async claim(txn: string, at: string): Promise<ClaimResult> {
    const inserted = await this.db
      .prepare(CLAIM_SQL)
      .bind(txn, at, FOUNDING_CAP)
      .first<{ seq: number }>();
    if (inserted !== null) return { seq: inserted.seq };

    // Nothing was inserted: either txn already had a row (the ON CONFLICT
    // branch, spec §4.1's "safe to repeat"), or the cap refused the insert
    // outright. Telling those apart is one more read, never a write.
    const existing = await this.db.prepare(SELECT_BY_TXN_SQL).bind(txn).first<{ seq: number }>();
    if (existing !== null) return { seq: existing.seq, existing: true };
    return { refused: 'cap' };
  }
}

/**
 * In-memory FoundingStore for tests, reproducing the same semantics as the
 * D1 store: the cap checked against the highest seq ever issued (not the row
 * count), and same-txn idempotency. This proves only that MemoryFoundingStore
 * itself cannot double-issue a seq under concurrent calls; it says nothing
 * about CLAIM_SQL. D1's own atomicity rests on two different things: the
 * single INSERT...SELECT...HAVING...RETURNING statement being one
 * indivisible unit of work, and D1 serialising every write to one SQLite
 * database, so two real concurrent claims can never interleave inside it.
 * The store.ts tests exercise CLAIM_SQL directly, against real SQLite.
 *
 * Every check-then-write here happens with no `await` in between, so two
 * claims run inside a `Promise.all` cannot interleave either (the
 * synchronous body of an async function with no `await` in it runs to
 * completion the moment it is called), which is why this fake reproduces
 * the same non-interruptible guarantee without a database.
 */
export class MemoryFoundingStore implements FoundingStore {
  private readonly rows: { seq: number; txn: string; at: string }[] = [];

  async claim(txn: string, at: string): Promise<ClaimResult> {
    const existing = this.rows.find((r) => r.txn === txn);
    if (existing !== undefined) return { seq: existing.seq, existing: true };
    let maxSeq = 0;
    for (const r of this.rows) if (r.seq > maxSeq) maxSeq = r.seq;
    if (maxSeq >= FOUNDING_CAP) return { refused: 'cap' };
    const seq = maxSeq + 1;
    this.rows.push({ seq, txn, at });
    return { seq };
  }
}
