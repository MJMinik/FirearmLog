// Pure helper for the count stepper (−/+ buttons on match hit-entry).
// Kept separate from the React component so it can be unit-tested without a DOM.

/**
 * Step an integer count field by `delta`, flooring at 0 (you can't shoot a
 * negative count). An empty or non-numeric current value is treated as 0, so the
 * first "+" makes it "1". Returns the new value as a string, matching the
 * controlled-input string values the match form already uses.
 */
export function stepValue(current: string, delta: number): string {
  const n = parseInt(current, 10);
  const base = Number.isNaN(n) ? 0 : n;
  return String(Math.max(0, base + delta));
}
