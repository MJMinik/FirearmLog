// App 3b — search & filter for the dedicated Malfunctions list screen.
// From/To dates, one gun, type, ammo, magazine, and a free-text query across
// the malfunction's own words. Pure functions — the screen just calls these,
// mirroring searchFilter.ts (the Log screen's filtering brain).
import type { MalfunctionEntry } from './types.ts';

export interface MalfFilter {
  from: string;        // YYYY-MM-DD, '' = no lower bound
  to: string;          // YYYY-MM-DD, '' = no upper bound
  firearmId: string;   // '' = all guns
  type: string;        // '' = all types (exact match on the stored type string)
  ammoId: string;      // '' = any ammo
  magazineId: string;  // '' = any magazine
  query: string;       // free text across type / how-cleared / notes
}

export function emptyMalfFilter(): MalfFilter {
  return { from: '', to: '', firearmId: '', type: '', ammoId: '', magazineId: '', query: '' };
}

/** How many criteria are narrowing things down (drives the badge on the button). */
export function malfFilterCount(f: MalfFilter): number {
  let n = 0;
  if (f.from || f.to) n += 1;
  if (f.firearmId) n += 1;
  if (f.type) n += 1;
  if (f.ammoId) n += 1;
  if (f.magazineId) n += 1;
  if (f.query.trim()) n += 1;
  return n;
}

function inDateRange(date: string, f: MalfFilter): boolean {
  if (!date) return !f.from && !f.to;
  if (f.from && date < f.from) return false;
  if (f.to && date > f.to) return false;
  return true;
}

/** Every typed word must appear somewhere in the malfunction's free text. */
function queryHits(haystack: (string | null | undefined)[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = haystack.filter(Boolean).join(' ').toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

export function malfunctionMatchesFilter(m: MalfunctionEntry, f: MalfFilter): boolean {
  if (!inDateRange(m.date, f)) return false;
  if (f.firearmId && m.firearmId !== f.firearmId) return false;
  if (f.type && (m.type || '') !== f.type) return false;
  if (f.ammoId && m.ammoId !== f.ammoId) return false;
  if (f.magazineId && m.magazineId !== f.magazineId) return false;
  return queryHits([m.type, m.resolution, m.notes], f.query);
}

/** Filter, then sort newest date first (ties keep input order). */
export function filterMalfunctions(malfs: MalfunctionEntry[], f: MalfFilter): MalfunctionEntry[] {
  return malfs
    .filter((m) => malfunctionMatchesFilter(m, f))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

/** The distinct malfunction types present in the data, for the Type dropdown. */
export function distinctTypes(malfs: MalfunctionEntry[]): string[] {
  return [...new Set(malfs.map((m) => m.type).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
