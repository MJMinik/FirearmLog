// Shared search/ranking/navigation helpers for the "Find a screen" box (the
// phone More tab, the desktop sidebar, and the Help screen's "Where do I
// find…" index — decision 75, 12 Sep 2026, build 2). Kept in a plain .ts
// file with no JSX so tests/findIndex.test.ts can import it directly under
// node:test's --experimental-strip-types runner, which cannot load a .tsx
// file at all (see matchQuery.ts's own comment for the confirmed reason).
//
// This file adds NOTHING to FIND_INDEX itself — src/ui/findIndex.ts (the
// signed table) is untouched. Everything here just reads it.
import { FIND_INDEX } from './findIndex.ts';
import type { FindEntry, FindGroupLabel, FindTarget, MainTab } from './findIndex.ts';
import type { View } from './nav.ts';
import type { IconName } from './Icon.tsx';
import { matchesQuery } from './matchQuery.ts';

/** Spec: "Show at most 8 results." */
const MAX_RESULTS = 8;

/** The composite label over the four main tabs (Home/Log/Compete/Progress)
 *  and everything inside them. It is never searched as text — see
 *  `groupTextFor` below — but TabBar and MoreScreen both need to recognize
 *  it (to lay the main tabs out separately from the four real groups, and to
 *  drop the noisy "Home, Log, Compete & Progress · " prefix from a result's
 *  sub-line), so it lives here once instead of as a copy in each file. */
export const MAIN_GROUP: FindGroupLabel = 'Home, Log, Compete & Progress';

/** Every `kind: 'screen'` row, in table order — the set `parent` ids resolve
 *  against (cold-audit fix, session 79, High: `parentIconFor` used to GUESS
 *  the right icon from `go`; now it just looks up the row FIND_INDEX itself
 *  already names). */
const SCREEN_ENTRIES: FindEntry[] = FIND_INDEX.filter((e) => e.kind === 'screen');

function screenById(id: string | undefined): FindEntry | undefined {
  return id ? SCREEN_ENTRIES.find((s) => s.id === id) : undefined;
}

/** The extra text (beyond name + words) a query is matched against.
 *  - The four real groups ('Your Gear', 'Training', 'Records', 'App & Data')
 *    contribute their own label, for every row in them.
 *  - The composite 'Home, Log, Compete & Progress' label is NEVER searched —
 *    "compete" typed against that literal string would match all twenty-odd
 *    rows sitting under Home/Log/Compete/Progress, not just Compete's own.
 *    Instead, an `inside` row under that group contributes its PARENT
 *    screen's name (e.g. "Compete" for compete-classification) — narrow
 *    enough that "compete" still finds Compete's own children without also
 *    finding Home's or Log's.
 *  - The four main tabs themselves (kind: 'screen', in the composite group)
 *    contribute nothing extra: their own name already covers it. */
function groupTextFor(entry: FindEntry): string {
  if (entry.group !== MAIN_GROUP) return entry.group;
  if (entry.kind === 'inside') return screenById(entry.parent)?.name ?? '';
  return '';
}

/** Does this entry match the typed query. */
export function matchesEntry(query: string, entry: FindEntry): boolean {
  return matchesQuery(query, entry.name, entry.words.join(' '), groupTextFor(entry));
}

/** Which of the three ranking tiers an already-matching entry falls in: a
 *  NAME match ranks first, a WORDS match (name + words together) second,
 *  and anything that only matched through the group/parent text last. */
function tierOf(query: string, entry: FindEntry): 0 | 1 | 2 {
  if (matchesQuery(query, entry.name)) return 0;
  if (matchesQuery(query, entry.name, entry.words.join(' '))) return 1;
  return 2;
}

/** Best-first search for the phone More screen's single results card (and
 *  the sidebar's own counting): rank by tier (name → words → group/parent),
 *  and within a tier a `kind: 'screen'` row ranks above a `kind: 'inside'`
 *  one; ties keep the table's own order throughout. Capped to 8. */
export function searchFindEntries(query: string, entries: FindEntry[]): FindEntry[] {
  const q = query.trim();
  if (!q) return [];
  const tiers: FindEntry[][] = [[], [], []];
  for (const e of entries) {
    if (!matchesEntry(q, e)) continue;
    tiers[tierOf(q, e)].push(e);
  }
  const ranked = tiers.flatMap((tier) => [
    ...tier.filter((e) => e.kind === 'screen'),
    ...tier.filter((e) => e.kind === 'inside'),
  ]);
  return ranked.slice(0, MAX_RESULTS);
}

/** Jump to a FindEntry's target through App's own guarded navigation: a tab
 *  target calls onGoTab (App's guarded setTab), a view target calls open
 *  (the screen's own push/openSection) — the same functions every other
 *  on-screen control already uses, so a dirty form still gets its discard
 *  question (spec: "Route through App's guarded open/setTab"). */
export function goToFindTarget(target: FindTarget, open: (v: View) => void, onGoTab: (t: MainTab) => void): void {
  if ('tab' in target) onGoTab(target.tab);
  else open(target.view);
}

/** The icon an "inside" entry borrows for its extra sidebar button: its own
 *  `parent` id names the screen entry it lives on, and that screen's icon is
 *  the one shown — one rule, no guessing from `go`. */
export function parentIconFor(entry: FindEntry): IconName | undefined {
  return screenById(entry.parent)?.icon;
}
