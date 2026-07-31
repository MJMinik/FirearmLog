// A3 (batch 2): Search & Filter for the Compete tab's match list. The app-wide
// FilterBar (Sheet + count line, see src/ui/FilterBar.tsx) was built as the
// standard, but the Compete matches never got it. This is the filtering brain
// the Compete FilterBar reuses — match type, division, gun, and a date range,
// read-only over the matches already stored. Pure functions only; the UI calls
// these. Mirrors searchFilter.ts so the two filters are one system.
import { canonicalDivision } from './competition.ts';
import type { Match } from './types.ts';

export interface CompeteFilter {
  from: string;      // YYYY-MM-DD, '' = no lower bound
  to: string;        // YYYY-MM-DD, '' = no upper bound
  matchType: string; // '' = all match types
  division: string;  // '' = all divisions
  firearmId: string; // '' = all guns
}

export function emptyCompeteFilter(): CompeteFilter {
  return { from: '', to: '', matchType: '', division: '', firearmId: '' };
}

// Session-persistent by design, relaunch clears (owner decision + board
// conferral, session 75, July 23 2026): the Compete match filter used to live
// in CompeteScreen's own useState, so it was lost the moment the screen
// unmounted — opening a match's detail and coming Back, or leaving the tab and
// returning, both reset it to empty. Both round trips must now preserve it, so
// the value lives here at MODULE scope instead — CompeteScreen initializes its
// state from this holder and writes every change back to it. Deliberately NOT
// IndexedDB/localStorage/sessionStorage: a fresh app launch (this module
// re-evaluating from scratch) must always start unfiltered.
let sessionCompeteFilter: CompeteFilter = emptyCompeteFilter();

export function getSessionCompeteFilter(): CompeteFilter {
  return sessionCompeteFilter;
}

export function setSessionCompeteFilter(f: CompeteFilter): void {
  sessionCompeteFilter = f;
}

/** How many criteria are narrowing things down (drives the badge on the button). */
export function competeFilterCount(f: CompeteFilter): number {
  let n = 0;
  if (f.from || f.to) n += 1;
  if (f.matchType) n += 1;
  if (f.division) n += 1;
  if (f.firearmId) n += 1;
  return n;
}

function inDateRange(date: string, f: CompeteFilter): boolean {
  if (f.from && date < f.from) return false;
  if (f.to && date > f.to) return false;
  return true;
}

export function matchMatchesCompeteFilter(m: Match, f: CompeteFilter): boolean {
  if (!inDateRange(m.date, f)) return false;
  if (f.matchType && m.matchType !== f.matchType) return false;
  // Compare CANONICAL names. A logbook holding both a pre-rename and a
  // post-rename rimfire match otherwise filters them as two divisions.
  if (f.division && canonicalDivision(m.division) !== canonicalDivision(f.division)) return false;
  if (f.firearmId && m.firearmId !== f.firearmId) return false;
  return true;
}

/**
 * Distinct match types and divisions actually present in the matches, sorted —
 * so the filter's dropdowns offer only relevant options (no empty categories to
 * wade through). Read-only; derived at render.
 */
export function competeFilterOptions(matches: Match[]): { matchTypes: string[]; divisions: string[] } {
  const matchTypes = [...new Set(matches.map((m) => m.matchType).filter(Boolean))].sort();
  // Canonical, so a retired name never appears as its own dropdown entry
  // beside the real one, each matching a disjoint half of the same division.
  const divisions = [...new Set(matches.map((m) => canonicalDivision(m.division)).filter(Boolean))].sort();
  return { matchTypes, divisions };
}
