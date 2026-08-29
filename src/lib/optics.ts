// Optics helpers — pure logic for the battery-log / "battery due" status
// (PT parity). Fully unit tested.

export interface BatteryEntry {
  date: string; // YYYY-MM-DD
  notes: string;
}

/** A normalized entry that also remembers where it lived in the RAW,
 *  unsorted `batteryLog` array it came from — the only way to identify one
 *  entry for deletion, since an entry carries no id of its own and this list
 *  is both filtered (garbage skipped) and re-sorted (newest first). */
export interface IndexedBatteryEntry extends BatteryEntry {
  /** Index into the array PASSED IN, before any filtering or sorting. */
  rawIndex: number;
}

/** PT's threshold: flag the battery as due after this many days. */
export const BATTERY_DUE_DAYS = 330;

/**
 * Pull well-formed { date, notes, rawIndex } entries out of an Optic's
 * batteryLog, newest first — same as `normalizeBatteryLog` (indeed,
 * `normalizeBatteryLog` is defined IN TERMS OF this, below), plus each
 * entry's index into the raw array. Written once, here, so a caller that
 * needs to delete "the entry the shooter tapped" out of the real stored
 * array and a caller that only needs the readable list can never disagree
 * about what counts as a readable entry — the exact drift this module's
 * bigger sibling (lib/opticBattery.ts) exists to prevent from happening
 * again between the badge and the reminder.
 */
export function normalizeBatteryLogWithIndex(batteryLog: unknown): IndexedBatteryEntry[] {
  if (!Array.isArray(batteryLog)) return [];
  return batteryLog
    .map((e, rawIndex) => ({ e, rawIndex }))
    .filter((x): x is { e: Record<string, unknown>; rawIndex: number } =>
      typeof x.e === 'object' && x.e !== null)
    .map(({ e, rawIndex }) => ({
      date: typeof e.date === 'string' ? e.date : '',
      notes: typeof e.notes === 'string' ? e.notes : '',
      rawIndex
    }))
    .filter((e) => e.date !== '')
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Pull well-formed { date, notes } entries out of an Optic's batteryLog, newest first. */
export function normalizeBatteryLog(batteryLog: unknown): BatteryEntry[] {
  return normalizeBatteryLogWithIndex(batteryLog).map(({ date, notes }) => ({ date, notes }));
}

/** `batteryLog` widened to a definite array, for a WRITE path that needs to
 *  spread the existing log and append/remove one entry (finding 2, audit
 *  round 2). Deliberately NOT routed through `normalizeBatteryLog` — that
 *  function also filters garbage and re-sorts, and a write path must never
 *  write back a filtered-and-resorted log: that would silently drop or
 *  reorder whatever was already stored, for a caller that only wanted to add
 *  one entry. This guards only the one thing a spread needs: that spreading
 *  it doesn't throw. */
export function safeBatteryLog(batteryLog: unknown): unknown[] {
  return Array.isArray(batteryLog) ? batteryLog : [];
}

/**
 * True when `batteryLog` already contains an entry matching `date` AND
 * `notes` exactly (audit round 3, F-4) — the idempotency check for a
 * provenance write that can be retried: markDone's optic write can succeed
 * and then have the FOLLOWING reminder write fail, and the visible advice
 * is to tap Mark done again. Without this, retrying appends a SECOND,
 * byte-identical entry for the same day — the one realistic producer of the
 * duplicate entries `entryStillAt` can't tell apart from each other. Never
 * throws — storage garbage just fails the check like it fails every other
 * read in this file.
 */
export function hasBatteryLogEntry(batteryLog: unknown, date: string, notes: string): boolean {
  return safeBatteryLog(batteryLog).some((e) => {
    if (typeof e !== 'object' || e === null) return false;
    const rec = e as Record<string, unknown>;
    return rec.date === date && rec.notes === notes;
  });
}

/**
 * True only when the entry sitting at `rawIndex` in `rawBatteryLog` right
 * now is still the SAME entry (same date, same notes) an earlier read
 * expected there (finding 4, audit round 2). An irreversible per-entry
 * delete captures `rawIndex` whenever a screen last loaded; between then and
 * a confirmed delete, another tab/window can append or edit the same
 * optic's log without changing this array's length, silently making
 * `rawIndex` name a different entry than the one actually confirmed. Used as
 * a freshness check right before the delete, against a freshly re-read
 * record — never throws, so storage garbage just fails the check (no delete)
 * rather than crashing the screen.
 */
export function entryStillAt(
  rawBatteryLog: unknown,
  rawIndex: number,
  expected: { date: string; notes: string },
): boolean {
  if (!Array.isArray(rawBatteryLog)) return false;
  const candidate: unknown = rawBatteryLog[rawIndex];
  if (typeof candidate !== 'object' || candidate === null) return false;
  const c = candidate as Record<string, unknown>;
  const date = typeof c.date === 'string' ? c.date : '';
  const notes = typeof c.notes === 'string' ? c.notes : '';
  return date === expected.date && notes === expected.notes;
}

/** Most recent battery-change entry, or null if none logged. */
export function lastBatteryEntry(batteryLog: unknown): BatteryEntry | null {
  const entries = normalizeBatteryLog(batteryLog);
  return entries.length > 0 ? entries[0] : null;
}

/** Whole days elapsed between a YYYY-MM-DD day-key and `now` (local). */
export function daysSince(date: string, now: Date): number {
  const then = new Date(date + 'T12:00:00').getTime();
  return Math.floor((now.getTime() - then) / (1000 * 60 * 60 * 24));
}

/** True once it's been more than BATTERY_DUE_DAYS since the last logged
 *  change. Superseded by lib/opticBattery.ts's opticBatteryStatus (audit
 *  round 3, closing review, item 3) — this function and its two helpers
 *  above (lastBatteryEntry, daysSince) have no app callers left, only
 *  tests. Do NOT add a screen caller here: this still uses the old lenient,
 *  engine-dependent date parser opticBatteryStatus was rewritten to stop
 *  using, and reviving it as a UI judge of "is the battery due" silently
 *  reintroduces the exact second-judge collision this feature exists to
 *  end. */
export function isBatteryDue(batteryLog: unknown, now: Date): boolean {
  const last = lastBatteryEntry(batteryLog);
  if (!last) return false;
  return daysSince(last.date, now) > BATTERY_DUE_DAYS;
}
