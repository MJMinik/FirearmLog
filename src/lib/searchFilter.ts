// Log search & filter (feedback B6, spec §10.1, Michael's "Searchable" rule):
// From/To dates, gun category OR individual gun, what-kind toggles, planned
// handling, and a global search box. Pure functions — the UI just calls these.
// This module is THE filtering brain the C4 standard search component reuses.
import type { Firearm, GunCategory, Match, Session } from './types.ts';

export type LogKind = 'practice' | 'dry' | 'class' | 'match';

export const LOG_KINDS: { kind: LogKind; label: string }[] = [
  { kind: 'practice', label: 'Practice' },
  { kind: 'dry', label: 'Dry fire' },
  { kind: 'class', label: 'Class' },
  { kind: 'match', label: 'Matches' }
];

export interface LogFilter {
  from: string;               // YYYY-MM-DD, '' = no lower bound
  to: string;                 // YYYY-MM-DD, '' = no upper bound
  category: GunCategory | ''; // '' = all categories
  firearmId: string;          // '' = all guns (wins over category when set)
  kinds: LogKind[];           // [] = everything
  planned: 'show' | 'only' | 'hide';
  query: string;              // global search text
}

export function emptyLogFilter(): LogFilter {
  return { from: '', to: '', category: '', firearmId: '', kinds: [], planned: 'show', query: '' };
}

// Session-persistent by design, relaunch clears (owner decision + board
// conferral, session 75, July 23 2026 — extension of the Compete filter
// conferral, approved "1"; see competeFilter.ts's getSessionCompeteFilter /
// setSessionCompeteFilter for the identical pattern). The Log filter used to
// live in LogScreen's own useState, so it was lost the moment the screen
// unmounted — opening a session/match detail and coming Back, or leaving the
// tab and returning, both reset it to empty. Both round trips must now
// preserve it, so the value lives here at MODULE scope instead — LogScreen
// initializes its state from this holder and writes every change back to it.
// Deliberately NOT IndexedDB/localStorage/sessionStorage: a fresh app launch
// (this module re-evaluating from scratch) must always start unfiltered.
let sessionLogFilter: LogFilter = emptyLogFilter();

export function getSessionLogFilter(): LogFilter {
  return sessionLogFilter;
}

export function setSessionLogFilter(f: LogFilter): void {
  sessionLogFilter = f;
}

/** How many criteria are narrowing things down (drives the badge on the button). */
export function filterCount(f: LogFilter): number {
  let n = 0;
  if (f.from || f.to) n += 1;
  if (f.firearmId) n += 1;
  else if (f.category) n += 1;
  if (f.kinds.length > 0 && f.kinds.length < LOG_KINDS.length) n += 1;
  if (f.planned !== 'show') n += 1;
  if (f.query.trim()) n += 1;
  return n;
}

/** Which calendar/list bucket a session falls into. */
export function sessionKind(type: string): LogKind {
  if (type === 'dry_fire') return 'dry';
  if (type === 'class') return 'class';
  return 'practice';
}

function inDateRange(date: string, f: LogFilter): boolean {
  if (!date) return !f.from && !f.to;
  if (f.from && date < f.from) return false;
  if (f.to && date > f.to) return false;
  return true;
}

function kindAllowed(kind: LogKind, f: LogFilter): boolean {
  return f.kinds.length === 0 || f.kinds.includes(kind);
}

function queryHits(haystack: (string | null | undefined)[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystack.some((h) => (h ?? '').toLowerCase().includes(q));
}

function gunName(id: string, firearms: Firearm[]): string {
  return firearms.find((g) => g.id === id)?.name ?? '';
}

export function sessionMatchesFilter(s: Session, f: LogFilter, firearms: Firearm[]): boolean {
  if (!inDateRange(s.date, f)) return false;
  if (!kindAllowed(sessionKind(s.type), f)) return false;
  if (f.planned === 'only' && !s.planned) return false;
  if (f.planned === 'hide' && s.planned) return false;
  if (f.firearmId) {
    if (!s.guns.some((g) => g.firearmId === f.firearmId)) return false;
  } else if (f.category) {
    const cats = s.guns.map((g) => firearms.find((x) => x.id === g.firearmId)?.category);
    if (!cats.includes(f.category)) return false;
  }
  return queryHits(
    [
      s.location, s.notes, s.instructor, s.distances,
      ...s.guns.map((g) => gunName(g.firearmId, firearms)),
      ...s.drills.map((d) => d.name),
      ...s.drills.map((d) => d.notes)
    ],
    f.query
  );
}

export function matchMatchesFilter(m: Match, f: LogFilter, firearms: Firearm[]): boolean {
  if (!inDateRange(m.date, f)) return false;
  if (!kindAllowed('match', f)) return false;
  if (f.planned === 'only') return false; // matches are never "planned sessions"
  if (f.firearmId) {
    if (m.firearmId !== f.firearmId) return false;
  } else if (f.category) {
    const cat = firearms.find((x) => x.id === m.firearmId)?.category;
    if (cat !== f.category) return false;
  }
  return queryHits(
    [m.name, m.matchType, m.division, m.powerFactor, m.notes, gunName(m.firearmId, firearms)],
    f.query
  );
}
