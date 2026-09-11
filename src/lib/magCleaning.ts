// "Mags needing cleaning" derivation for Home's Needs Attention card (21 Aug
// 2026 spec; sessions added 11 Sep 2026,
// "SESSION_MAG_CONDITIONS_SPEC_2026-09-11" §4). Pure and side-effect-free,
// same posture as lib/mags.ts: nothing here mutates a Magazine, a Match, or a
// Session -- this only reads Magazine.lastCleanedAt (stamped by the "Mark
// cleaned" action) and each match's/session's condition tags to work out
// which mags are still dirty since that stamp. A tag is NEVER edited or
// cleared by cleaning -- the match or session keeps its history regardless
// of what this derivation reports today.
import type { Magazine, Match, Session } from './types.ts';

export interface MagCleaningItem {
  magId: string;
  magLabel: string;
  /** Most recent qualifying tag, from a match or a session (undated ones
   *  sort last). */
  tag: string;
  /** Which record type the pick came from -- decides which of the fields
   *  below are populated and how `detail` reads. */
  source: 'match' | 'session';
  /** Set only when `source` is 'match'. */
  matchId?: string;
  matchName?: string; // match.name, may be ''
  matchDate?: string; // match.date if present
  /** Set only when `source` is 'session'. */
  sessionId?: string;
  moreCount: number; // additional qualifying taggings (either source) beyond the most recent
  /** Detail line for display and dismissal keying, built here so Home and
   *  tests share one string (see formatDetail below for the exact shape). */
  detail: string;
}

/** A string date key that sorts a possibly-absent date correctly against a
 *  real ISO date via plain string comparison: '' is lexically less than any
 *  "YYYY-MM-DD" string, so an undated record always sorts before a dated one.
 *  Guards against corrupt/hand-edited records where `date` isn't really a
 *  string even though the type says it must be. */
function dateKey(date: unknown): string {
  return typeof date === 'string' ? date : '';
}

/** True when `candidate` should replace `current` as the most-recent pick:
 *  strictly-greater dates win outright; on an exact tie (including two
 *  undated records, both keyed '') the LATER one in walk order wins, which
 *  this satisfies because the walk below only ever moves forward -- matches
 *  first, then sessions (rule f). */
function isAtLeastAsRecent(candidate: unknown, current: unknown): boolean {
  return dateKey(candidate) >= dateKey(current);
}

/** Capitalises a tag's first letter for the detail line ("sand" -> "Sand"). */
function capitalize(tag: string): string {
  return tag.length === 0 ? tag : tag.charAt(0).toUpperCase() + tag.slice(1);
}

/** Where a pick's detail line draws its naming from -- a match's name, or a
 *  session's location. Kept separate from MagCleaningItem's own optional
 *  fields so formatDetail's signature says exactly what it needs. */
type DetailSource =
  | { kind: 'match'; matchName: string; matchDate?: string }
  | { kind: 'session'; location: string; date?: string };

/** Builds the exact detail string both Home and the dismissal-key logic
 *  share (rule i) -- keep this the ONLY place that formats it, so the two can
 *  never drift apart. Extended 11 Sep 2026 to take either a match or a
 *  session as the pick's source, rather than gaining a second formatter. */
function formatDetail(tag: string, moreCount: number, source: DetailSource): string {
  let s: string;
  if (source.kind === 'match') {
    s = `${capitalize(tag)} — ${source.matchName || 'a match'}`;
    if (source.matchDate) s += `, ${source.matchDate}`;
  } else {
    // Session spec §4: "Mud — Session at <location>, <date>" with a
    // location, "Mud — Session, <date>" without one.
    s = source.location ? `${capitalize(tag)} — Session at ${source.location}` : `${capitalize(tag)} — Session`;
    if (source.date) s += `, ${source.date}`;
  }
  if (moreCount > 0) s += ` (+${moreCount} more)`;
  return s;
}

/** One qualifying tagging occurrence, from either source, carrying just
 *  enough to compare dates and (if it wins) build the item. */
type Tagging =
  | { source: 'match'; tag: string; match: Match }
  | { source: 'session'; tag: string; session: Session };

function dateOf(t: Tagging): unknown {
  return t.source === 'match' ? t.match.date : t.session.date;
}

/**
 * Which mags need cleaning right now, most-recent-tag-first per mag, sorted
 * by label. A mag qualifies when at least one non-deleted match OR
 * non-deleted, non-planned session tagged it (a non-empty condition tag)
 * more recently than its last "Mark cleaned" stamp -- or it has never been
 * marked cleaned at all, in which case ANY tagging qualifies. The most-recent
 * pick and the "+N more" count are combined across both sources.
 *
 * Guards, each independently testable (mutation-tested per the spec):
 *  (a) retired mags (active falsy, including a missing field) are excluded —
 *      only in-service mags
 *      can "need cleaning" here.
 *  (b) a soft-deleted match (truthy deletedAt) is never a source of a tag.
 *  (b2) a soft-deleted session (truthy deletedAt), or a PLANNED session
 *      (planned true — nothing has happened to the mag yet), is never a
 *      source of a tag.
 *  (c) a match/session "tags" a mag via a magConditions entry {magId, tag}
 *      with a non-empty tag for THAT mag id (for a session, on any of its
 *      guns).
 *  (d) qualifying = lastCleanedAt absent, OR the record's date absent, OR
 *      the record's date > lastCleanedAt (strict, same-day counts as
 *      cleaned — the accepted edge in the spec).
 *  (e) zero qualifying matches/sessions -> the mag is simply omitted.
 *  (f) an exact date tie is broken by walk order — matches are walked before
 *      sessions, and within a source, forward through its array — so the
 *      LATER one in that order wins.
 *  (g) orphan-safe: this is built by walking `mags` and searching matches
 *      and sessions FOR each mag id, so a magConditions entry referencing a
 *      magId with no Magazine record is structurally never visited —
 *      nothing to special-case.
 */
export function magsNeedingCleaning(mags: Magazine[], matches: Match[], sessions: Session[] = []): MagCleaningItem[] {
  const liveMatches = matches.filter((m) => !m.deletedAt);
  // (b2): a soft-deleted or planned session is never a source of a tag —
  // nothing has happened to the mag yet on a plan, and a trashed session's
  // history is hidden everywhere else too.
  const liveSessions = sessions.filter((s) => !s.deletedAt && !s.planned);
  const items: MagCleaningItem[] = [];

  for (const mag of mags) {
    // (a) retired mags excluded — TRUTHY check, matching how every other
    // surface reads this flag (MagazinesScreen's "(retired)" suffix,
    // MatchMagPicker's filter): a restored/hand-edited record with the field
    // missing displays as retired everywhere else, so it must be retired
    // here too, not silently in-service (cold audit, 21 Aug 2026).
    if (!mag.active) continue;

    let best: Tagging | null = null;
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
        const candidate: Tagging = { source: 'match', tag: c.tag, match };
        if (best === null || isAtLeastAsRecent(dateOf(candidate), dateOf(best))) best = candidate;
      }
    }

    for (const session of liveSessions) {
      for (const gun of Array.isArray(session.guns) ? session.guns : []) {
        const conditions = Array.isArray(gun.magConditions) ? gun.magConditions : [];
        for (const c of conditions) {
          if (c.magId !== mag.id) continue; // not this mag
          if (!c.tag) continue; // (c) empty tag never counts

          const neverCleaned = mag.lastCleanedAt === undefined;
          const sessionUndated = typeof session.date !== 'string';
          // (d), same rule as matches: absent lastCleanedAt, absent
          // session.date, or a strictly later session.date all qualify.
          const qualifies = neverCleaned || sessionUndated || session.date > (mag.lastCleanedAt ?? '');
          if (!qualifies) continue;

          qualifyingCount += 1;
          const candidate: Tagging = { source: 'session', tag: c.tag, session };
          if (best === null || isAtLeastAsRecent(dateOf(candidate), dateOf(best))) best = candidate;
        }
      }
    }

    if (best === null) continue; // (e) nothing qualifies -> omitted

    const moreCount = qualifyingCount - 1;
    // Defensive: label/location are required by the type, but a
    // corrupt/hand-edited restored record can miss them, and label feeds an
    // unguarded localeCompare on Home's render path — the one screen that
    // must never crash (cold audit, 21 Aug 2026).
    const magLabel = typeof mag.label === 'string' ? mag.label : '';

    let matchId: string | undefined;
    let matchName: string | undefined;
    let matchDate: string | undefined;
    let sessionId: string | undefined;
    let detail: string;

    if (best.source === 'match') {
      matchId = best.match.id;
      matchName = best.match.name;
      matchDate = typeof best.match.date === 'string' ? best.match.date : undefined;
      detail = formatDetail(best.tag, moreCount, { kind: 'match', matchName, matchDate });
    } else {
      sessionId = best.session.id;
      const sessionDate = typeof best.session.date === 'string' ? best.session.date : undefined;
      const location = typeof best.session.location === 'string' ? best.session.location : '';
      detail = formatDetail(best.tag, moreCount, { kind: 'session', location, date: sessionDate });
    }

    items.push({
      magId: mag.id,
      magLabel,
      tag: best.tag,
      source: best.source,
      matchId,
      matchName,
      matchDate,
      sessionId,
      moreCount,
      detail,
    });
  }

  return items.sort((a, b) => a.magLabel.localeCompare(b.magLabel)); // (h)
}
