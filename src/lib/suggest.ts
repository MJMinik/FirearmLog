// Type-ahead suggestions (pure, unit-tested). Used by the session form's
// "Where" field; built generically so any text field can reuse it.

/**
 * Distinct past values, most recently used first. `rows` should already be
 * whatever order the caller wants broken ties by; we sort by `date` descending
 * and keep the casing of the most recent use.
 */
export function recentValues(rows: { date: string; value: string }[]): string[] {
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of sorted) {
    const v = r.value.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/**
 * Filter suggestions as the user types: a value matches when the typed text is a
 * prefix of the whole value (type "S", get the S locations) OR the start of any
 * WORD inside it (type "univ", get "Shoot Straight: University"). It deliberately
 * does NOT match a letter buried mid-word — so a lone "h" gives you "Home", not
 * everything with an "h" in it ("Echo", "night"). Whole-string prefixes rank
 * first. An exact match is hidden — nothing to suggest once it's fully typed.
 * Case doesn't matter. Capped at `limit`.
 */
export function rankSuggestions(values: string[], query: string, limit = 6): string[] {
  const q = query.trim().toLowerCase();
  if (q === '') return values.slice(0, limit);
  const whole: string[] = [];
  const word: string[] = [];
  for (const v of values) {
    const lower = v.toLowerCase();
    if (lower === q) continue;
    if (lower.startsWith(q)) { whole.push(v); continue; }
    // Split on spaces and common separators; the first chunk is already covered
    // by the whole-string prefix above, so only later words need checking.
    const laterWords = lower.split(/[\s:,\-]+/).filter(Boolean).slice(1);
    if (laterWords.some((w) => w.startsWith(q))) word.push(v);
  }
  return [...whole, ...word].slice(0, limit);
}
