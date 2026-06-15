// Shared CSV helpers used by the importers (PractiScore, USPSA). Kept tiny and
// dependency-free; pure + unit-testable.

/** Split one CSV line, honouring double-quoted fields and "" escapes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Parse a number that may carry %, commas or spaces. Empty/garbage -> null. */
export function looseNum(s: string | undefined): number | null {
  if (s == null) return null;
  const t = s.replace(/[%,\s]/g, '');
  if (t === '') return null;
  const v = Number(t);
  if (!Number.isFinite(v)) return null;
  // Audit CR-10: reject implausible magnitudes (e.g. scientific-notation junk
  // like "1e308") that are finite but would poison percentages / hit factors /
  // round counts. Real values here are well under this bound.
  if (Math.abs(v) > 1e7) return null;
  return v;
}

/** Find the first unclaimed header column matching one of the patterns, in order. */
export function findCol(headers: string[], claimed: Set<number>, patterns: RegExp[]): number {
  for (const re of patterns) {
    for (let i = 0; i < headers.length; i++) {
      if (claimed.has(i)) continue;
      if (re.test(headers[i])) { claimed.add(i); return i; }
    }
  }
  return -1;
}
