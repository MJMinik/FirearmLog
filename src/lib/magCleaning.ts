// "Mags needing cleaning" derivation for Home's Needs Attention card (21 Aug
// 2026 spec). Pure and side-effect-free, same posture as lib/mags.ts: nothing
// here mutates a Magazine or a Match — this only reads Magazine.lastCleanedAt
// (stamped by the "Mark cleaned" action) and each match's magConditions to
// work out which mags are still dirty since that stamp. A match's condition
// tags are NEVER edited or cleared by cleaning — the match keeps its history
// regardless of what this derivation reports today.
import type { Magazine, Match } from './types.ts';

export interface MagCleaningItem {
  magId: string;
  magLabel: string;
  /** Most recent qualifying tagging match (undated matches sort last). */
  tag: string;
  matchId: string;
  matchName: string; // match.name, may be ''
  matchDate?: string; // match.date if present
  moreCount: number; // additional qualifying tagging matches beyond the most recent
  /** Detail line for display and dismissal keying, built here so Home and
   *  tests share one string (see formatDetail below for the exact shape). */
  detail: string;
}

/** A string date key that sorts a possibly-absent date correctly against a
 *  real ISO date via plain string comparison: '' is lexically less than any
 *  "YYYY-MM-DD" string, so an undated match always sorts before a dated one.
 *  Guards against corrupt/hand-edited records where `date` isn't really a
 *  string even though the type says it must be. */
function dateKey(date: unknown): string {
  return typeof date === 'string' ? date : '';
}

/** True when `candidate` should replace `current` as the most-recent pick:
 *  strictly-greater dates win outright; on an exact tie (including two
 *  undated matches, both keyed '') the LATER one in input array order wins,
 *  which this satisfies because callers only ever call this moving forward
 *  through the array (rule f). */
function isAtLeastAsRecent(candidate: unknown, current: unknown): boolean {
  return dateKey(candidate) >= dateKey(current);
}

/** Capitalises a tag's first letter for the detail line ("sand" -> "Sand"). */
function capitalize(tag: string): string {
  return tag.length === 0 ? tag : tag.charAt(0).toUpperCase() + tag.slice(1);
}

/** Builds the exact detail string both Home and the dismissal-key logic
 *  share (rule i) — keep this the ONLY place that formats it, so the two
 *  can never drift apart. */
function formatDetail(tag: string, matchName: string, matchDate: string | undefined, moreCount: number): string {
  let s = `${capitalize(tag)} — ${matchName || 'a match'}`;
  if (matchDate) s += `, ${matchDate}`;
  if (moreCount > 0) s += ` (+${moreCount} more)`;
  return s;
}

/**
 * Which mags need cleaning right now, most-recent-tag-first per mag, sorted
 * by label. A mag qualifies when at least one non-deleted match tagged it
 * (a non-empty condition tag) more recently than its last "Mark cleaned"
 * stamp — or it has never been marked cleaned at all, in which case ANY
 * tagging match qualifies.
 *
 * Guards, each independently testable (mutation-tested per the spec):
 *  (a) retired mags (active falsy, including a missing field) are excluded —
 *      only in-service mags
 *      can "need cleaning" here.
 *  (b) a soft-deleted match (truthy deletedAt) is never a source of a tag.
 *  (c) a match "tags" a mag via a magConditions entry {magId, tag} with a
 *      non-empty tag for THAT mag id.
 *  (d) qualifying = lastCleanedAt absent, OR match.date absent, OR
 *      match.date > lastCleanedAt (strict, same-day counts as cleaned —
 *      the accepted edge in the spec).
 *  (e) zero qualifying matches -> the mag is simply omitted.
 *  (g) orphan-safe: this is built by walking `mags` and searching matches
 *      FOR each mag id, so a magConditions entry referencing a magId with no
 *      Magazine record is structurally never visited — nothing to special-
 *      case.
 */
export function magsNeedingCleaning(mags: Magazine[], matches: Match[]): MagCleaningItem[] {
  const liveMatches = matches.filter((m) => !m.deletedAt);
  const items: MagCleaningItem[] = [];

  for (const mag of mags) {
    // (a) retired mags excluded — TRUTHY check, matching how every other
    // surface reads this flag (MagazinesScreen's "(retired)" suffix,
    // MatchMagPicker's filter): a restored/hand-edited record with the field
    // missing displays as retired everywhere else, so it must be retired
    // here too, not silently in-service (cold audit, 21 Aug 2026).
    if (!mag.active) continue;

    let best: { tag: string; match: Match } | null = null;
    let qualifyingCount = 0;

    for (const match of liveMatches) {
      const conditions = Array.isArray(match.magConditions) ? match.magConditions : [];
      for (const c of conditions) {
        if (c.magId !== mag.id) continue; // not this mag
        if (!c.tag) continue; // (c) empty tag never counts

        const neverCleaned = mag.lastCleanedAt === undefined;
        const matchUndated = typeof match.date !== 'string';
        // (d): absent lastCleanedAt, absent match.date, or a strictly later
        // match.date all qualify. Same-day is NOT strictly later, so it does
        // not qualify (the accepted edge).
        const qualifies = neverCleaned || matchUndated || match.date > (mag.lastCleanedAt ?? '');
        if (!qualifies) continue;

        qualifyingCount += 1;
        if (best === null || isAtLeastAsRecent(match.date, best.match.date)) {
          best = { tag: c.tag, match };
        }
      }
    }

    if (best === null) continue; // (e) nothing qualifies -> omitted

    const matchDate = typeof best.match.date === 'string' ? best.match.date : undefined;
    const moreCount = qualifyingCount - 1;
    items.push({
      magId: mag.id,
      // Defensive: label is required by the type, but a corrupt/hand-edited
      // restored record can miss it, and this feeds an unguarded
      // localeCompare on Home's render path — the one screen that must
      // never crash (cold audit, 21 Aug 2026).
      magLabel: typeof mag.label === 'string' ? mag.label : '',
      tag: best.tag,
      matchId: best.match.id,
      matchName: best.match.name,
      matchDate,
      moreCount,
      detail: formatDetail(best.tag, best.match.name, matchDate, moreCount),
    });
  }

  return items.sort((a, b) => a.magLabel.localeCompare(b.magLabel)); // (h)
}
