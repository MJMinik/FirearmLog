// Shared CSV helpers used by the importers (PractiScore, USPSA). Kept tiny and
// dependency-free; pure + unit-testable.

/**
 * Split one delimited line, honouring double-quoted fields and "" escapes.
 * The delimiter defaults to a comma, so every existing caller is unchanged.
 */
export function splitCsvLine(line: string, delimiter = ','): string[] {
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
 * Work out which character separates the columns of a pasted or loaded table.
 *
 * Why this exists: a results table copied out of a web page arrives TAB
 * separated, because that is what a browser puts on the clipboard. Splitting
 * it on commas yields one giant column, every row is discarded for having no
 * name and no place, and the reader is told the file has no competitor rows —
 * which is true of what the parser saw and useless to the person holding a
 * perfectly good table. Verified against real PractiScore Html Results pages,
 * 5 August 2026.
 *
 * The method: split every sampled line with each candidate, find the field
 * count that the most lines AGREE on (a table's rows all have the same number
 * of columns; page furniture does not), and score that block by how much table
 * it actually accounts for — lines agreeing multiplied by fields per line.
 *
 * Scoring by agreement rather than by an average matters, and a median is
 * measurably wrong here: a whole-page copy carries more navigation lines than
 * table rows, so the median field count is 1 for every candidate and the real
 * table never gets a vote. Multiplying by the field count is what separates a
 * genuine nine-column table from the two fragments a comma makes of the eight
 * names that happen to contain one.
 *
 * Commas are tried first and are only displaced by a strictly better score, so
 * a genuine comma-separated export can never change behaviour.
 */
const DELIMITER_CANDIDATES = [',', '\t', ';'];

export function sniffDelimiter(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
    .filter((l) => l.trim() !== '')
    .slice(0, 200);
  if (lines.length === 0) return ',';

  let best = ',';
  let bestScore = 0;
  for (const d of DELIMITER_CANDIDATES) {
    const tally = new Map<number, number>();
    for (const l of lines) {
      const n = splitCsvLine(l, d).length;
      if (n >= 2) tally.set(n, (tally.get(n) ?? 0) + 1);
    }
    let score = 0;
    for (const [fields, agreeing] of tally) {
      // At least two rows must agree before a shape counts as a table, so one
      // stray line with many separators cannot decide the whole file.
      if (agreeing < 2) continue;
      score = Math.max(score, agreeing * fields);
    }
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
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
