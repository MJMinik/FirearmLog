// F4 (stranger-test finding, session 62): the shared chart-furniture brain.
// Axes are the contract between the data and the reader — every hand-rolled
// SVG chart pulls its tick math, date thinning, and date labels from HERE so
// the furniture reads as one system and future charts inherit it for free.
// Pure functions only; the UI just calls these.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Which indices of an n-point series get an x-axis label: always the first
 * and last (the anchors), with up to `maxLabels` total, evenly spaced.
 * When everything fits, everything is labeled.
 */
export function thinIndices(n: number, maxLabels: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];
  const want = Math.max(2, maxLabels);
  if (n <= want) return Array.from({ length: n }, (_, i) => i);
  const idxs = new Set<number>();
  const steps = want - 1;
  for (let k = 0; k <= steps; k++) idxs.add(Math.round((k * (n - 1)) / steps));
  return [...idxs].sort((a, b) => a - b);
}

/**
 * Y gridline values for a domain, top to bottom: [hi, mid, lo].
 * A flat domain (hi === lo) collapses to a single line rather than three
 * identical ones stacked on top of each other.
 */
export function midTicks(lo: number, hi: number): number[] {
  if (hi === lo) return [hi];
  return [hi, (hi + lo) / 2, lo];
}

/** Days between two YYYY-MM-DD day-keys (local, order-independent). */
export function daySpan(a: string, b: string): number {
  const parse = (k: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : NaN;
  };
  const ms = Math.abs(parse(a) - parse(b));
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : 0;
}

/**
 * A short x-axis date label (Michael's 3a, session 62): "Mar 14" in day mode,
 * "Mar '26" in year mode — the year, not the day, is what disambiguates
 * points that far apart. Pick the mode once per chart with dateMode().
 */
export function chartDateLabel(dayKey: string, mode: 'day' | 'year'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return dayKey;
  const mon = MONTHS[Number(m[2]) - 1] ?? m[2];
  if (mode === 'year') return `${mon} '${m[1].slice(2)}`;
  return `${mon} ${Number(m[3])}`;
}

/**
 * Which label form a chart's x-axis uses, from its first and last dates:
 * year form once the span passes a year — and also when two DIFFERENT anchor
 * dates would otherwise print identically (e.g. "Jul 14" a year apart at a
 * 365-day span), because two same-looking anchors are worse than none.
 */
export function dateMode(firstKey: string, lastKey: string): 'day' | 'year' {
  if (daySpan(firstKey, lastKey) > 366) return 'year';
  if (firstKey !== lastKey
    && chartDateLabel(firstKey, 'day') === chartDateLabel(lastKey, 'day')) return 'year';
  return 'day';
}

export interface LabeledTick { value: number; label: string }

/**
 * Gridline ticks WITH their formatted labels, deduped by label — a near-flat
 * domain (2.001s vs 2.002s) would otherwise print the same label three times,
 * implying a scale that isn't there.
 */
export function labeledTicks(lo: number, hi: number, fmt: (v: number) => string): LabeledTick[] {
  const out: LabeledTick[] = [];
  for (const value of midTicks(lo, hi)) {
    const label = fmt(value);
    if (!out.some((t) => t.label === label)) out.push({ value, label });
  }
  return out;
}

/**
 * A drill metric as a short tick/readout label, unit-aware by scoring style:
 * time → "1.85s", score → "42", time_score (hit-factor metric) → "HF 6.51".
 */
export function formatMetricTick(v: number, scoring: string): string {
  if (scoring === 'time') return `${v.toFixed(2)}s`;
  if (scoring === 'time_score') return `HF ${v.toFixed(2)}`;
  return `${Math.round(v * 10) / 10}`;
}
