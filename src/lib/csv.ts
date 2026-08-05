// Shared CSV helpers used by the importers (PractiScore, USPSA). Kept tiny and
// dependency-free; pure + unit-testable.

/**
 * Split one delimited line, honouring double-quoted fields and "" escapes.
 *
 * The delimiter defaults to a comma, so every existing caller is unchanged.
 *
 * Quoting is honoured for comma and semicolon files and NOT for tabs, because
 * the two carry different conventions and mixing them corrupts data. A machine
 * CSV quotes a field that contains the delimiter. Tab-separated text copied out
 * of a browser has no quoting convention at all, so a bare double quote in it
 * is just a character: a barrel length written 5" bbl, or a nickname. Treating
 * that as an opening quote swallowed the rest of the row, and the shooter it
 * happened to lost their score while everyone around them kept theirs.
 */
export function splitCsvLine(
  line: string,
  delimiter = ',',
  honourQuotes = delimiter !== '\t',
): string[] {
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
    } else if (ch === '"' && honourQuotes) {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/**
 * The separators a pasted or loaded results table might use, in preference
 * order. A comma is first so that a genuine machine export always wins a tie.
 */
export const DELIMITER_CANDIDATES = [',', '\t', ';'];

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
