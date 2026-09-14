// The plain-word matching rule shared by every search box in the app —
// pulled out of ListSearch.tsx (decision 75, 12 Sep 2026, build 2) into its
// own plain .ts file with no JSX, so it can be imported by both React
// components AND the node:test unit suite. node's --experimental-strip-types
// runner only strips TYPE syntax, not JSX, and in fact refuses to load a
// .tsx file at all ("Unknown file extension .tsx" — confirmed the same way
// tests/helpScreenCopy.test.ts's own comment confirms it for HelpScreen.tsx),
// so `tests/findIndex.test.ts` needs matchesQuery to live somewhere that
// isn't a .tsx file. ListSearch.tsx re-exports it, so every existing
// `import { matchesQuery } from './ListSearch.tsx'` keeps working unchanged.

/** Case-insensitive "do all typed words appear somewhere in the text?" match. */
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = fields.filter(Boolean).join(' ').toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}
