// Reading dates out of a column whose format nobody declared (design doc 3.3).
// Pure logic, no storage, no DOM.
//
// THE RULE THIS FILE EXISTS TO HOLD: collect every scrap of evidence from the
// WHOLE column first, then decide once. An earlier build of this engine
// returned early the moment it met a four-digit leading group, which threw away
// the evidence it had already gathered, so a column carrying proof of BOTH
// orders was read as a third thing entirely and every date landed wrong.
// Nothing below returns from the middle of the scan.
//
// How the deciding works: start with all three readings alive (year first, day
// first, month first) and let each value knock out the readings that cannot
// parse it. What survives is the answer. An empty survivor set is a genuine
// contradiction, which we report rather than resolve, and a value nothing can
// read knocks out nothing (it becomes one row's problem, not the file's).
//
// TWO TRAPS, both learned by measurement:
//  1. "25/06/14" is not proof of day first. A first group over 12 only proves
//     day first when the year is known to be somewhere else, which needs a
//     four-digit year in the value. All-two-digit values leave yy/mm/dd alive,
//     so we ask instead of guessing a decade wrong.
//  2. A four-digit leading group is self-describing and carries no order
//     information at all, so it must not narrow anything.
//
// NOTE ON PUNCTUATION: nothing in this file, comments included, uses an em
// dash. Every string here can reach a shooter's screen.

/** Year first, day first, month first. `ymd` covers ISO and two-digit years. */
export type DateFormat = 'ymd' | 'dmy' | 'mdy';

export const DATE_FORMATS: DateFormat[] = ['ymd', 'dmy', 'mdy'];

export type DateAmbiguityReason =
  /** Nothing in the column says whether the day or the month comes first. */
  | 'order'
  /** Two-digit years, so we cannot even tell which number is the year. */
  | 'twoDigitYear'
  /** Some rows prove one order and other rows prove the other. */
  | 'contradiction';

export type DateColumnAnalysis =
  | { ambiguous: false; format: DateFormat }
  | { ambiguous: true; reason: DateAmbiguityReason; options: DateFormat[]; sample: string | null };

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

const NUMERIC_DATE = /^(\d{1,4})[-/.](\d{1,4})[-/.](\d{1,4})$/;

/** Trim a trailing clock time so "2026-03-04 14:22" is a date, not a refusal. */
export function stripTime(value: string): string {
  return value
    .trim()
    .replace(/[T\s]+\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\s*(?:am|pm)?\s*(?:z|[+-]\d{2}:?\d{2})?$/i, '')
    .trim();
}

const daysInMonth = (year: number, month: number): number =>
  new Date(year, month, 0).getDate();

function isRealDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1000 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

/** Two-digit years: 00 to 69 read as this century, 70 to 99 as the last one. */
function expandYear(value: number, width: number): number {
  if (width >= 3) return value;
  return value <= 69 ? 2000 + value : 1900 + value;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const key = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`;

interface Groups {
  values: [number, number, number];
  widths: [number, number, number];
}

function numericGroups(text: string): Groups | null {
  const m = NUMERIC_DATE.exec(text);
  if (!m) return null;
  const values: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const widths: [number, number, number] = [m[1].length, m[2].length, m[3].length];
  if (values.some((v) => !Number.isFinite(v))) return null;
  return { values, widths };
}

/** "Jun 14, 2025", "14 June 2025", "June 14 2025". Order is never in doubt. */
function parseNamedMonth(text: string): string | null {
  const cleaned = text.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = cleaned.split(' ');
  if (parts.length < 3) return null;
  let month = 0;
  const numbers: number[] = [];
  for (const part of parts) {
    const lower = part.toLowerCase().replace(/\.$/, '');
    const found = MONTH_NAMES.findIndex((name) => name === lower || name.slice(0, 3) === lower);
    if (found >= 0 && month === 0) {
      month = found + 1;
      continue;
    }
    const stripped = part.replace(/(st|nd|rd|th)$/i, '');
    if (/^\d{1,4}$/.test(stripped)) numbers.push(Number(stripped));
    else return null;
  }
  if (month === 0 || numbers.length !== 2) return null;
  // The four-digit number is the year; otherwise the larger one is.
  const yearIndex = String(numbers[0]).length === 4 ? 0 : String(numbers[1]).length === 4 ? 1 : -1;
  if (yearIndex < 0) return null;
  const year = numbers[yearIndex];
  const day = numbers[1 - yearIndex];
  return isRealDate(year, month, day) ? key(year, month, day) : null;
}

function readGroups(g: Groups, format: DateFormat): string | null {
  const [a, b, c] = g.values;
  const [wa, , wc] = g.widths;
  let year: number;
  let month: number;
  let day: number;
  if (format === 'ymd') {
    year = expandYear(a, wa);
    month = b;
    day = c;
  } else if (format === 'dmy') {
    day = a;
    month = b;
    year = expandYear(c, wc);
  } else {
    month = a;
    day = b;
    year = expandYear(c, wc);
  }
  return isRealDate(year, month, day) ? key(year, month, day) : null;
}

/**
 * One value as a YYYY-MM-DD day-key, or null when this column's format cannot
 * read it (which becomes that row's problem, never a silent blank).
 *
 * Two shapes ignore the column's format because they say what they are:
 * a four-digit leading group is a year, and a named month is a month.
 */
export function convertDateValue(raw: string | null | undefined, format: DateFormat): string | null {
  const text = stripTime(String(raw ?? ''));
  if (text === '') return null;

  const named = parseNamedMonth(text);
  if (named) return named;

  const groups = numericGroups(text);
  if (!groups) return null;

  if (groups.widths[0] === 4) return readGroups(groups, 'ymd');
  return readGroups(groups, format);
}

/**
 * Which readings can parse this value, or null when the value carries no
 * information about the order (blank, a named month, or a four-digit leading
 * group). Null is not the same as an empty list: an empty list means every
 * reading failed, which is one row's problem and must narrow nothing.
 */
export function orderCandidates(raw: string): DateFormat[] | null {
  const text = stripTime(String(raw ?? ''));
  if (text === '') return null;
  if (parseNamedMonth(text)) return null;
  const groups = numericGroups(text);
  if (!groups) return null;
  if (groups.widths[0] === 4) return null;
  return DATE_FORMATS.filter((f) => readGroups(groups, f) !== null);
}

/**
 * A value to show when asking which reading a column uses.
 *
 * It has to satisfy both halves, and the second half is the one an earlier
 * build got wrong: EVERY offered reading must parse it, AND the readings must
 * disagree. A value only one reading can parse produces a choice where one
 * button shows the raw text back, and tapping that button picks the reading
 * that cannot read it. A value both readings agree on produces two identical
 * buttons. Returns null when the column holds no such value, which is the
 * screen's signal to say so in words instead of offering buttons.
 */
export function distinguishingDateSample(
  values: readonly string[],
  options: readonly DateFormat[],
): string | null {
  if (options.length < 2) return null;
  for (const raw of values) {
    const text = String(raw ?? '').trim();
    if (text === '') continue;
    const readings = options.map((format) => convertDateValue(text, format));
    if (readings.some((r) => r === null)) continue;
    if (new Set(readings).size < 2) continue;
    return text;
  }
  return null;
}

/**
 * Look at a whole column and decide once. Blank columns and columns where
 * every value says what it is come back settled; anything else comes back with
 * the question to ask and a value worth asking it about.
 */
export function analyseDateColumn(values: readonly string[]): DateColumnAnalysis {
  let candidates: DateFormat[] = [...DATE_FORMATS];
  let sawOrderEvidence = false;
  let contradiction = false;

  for (const raw of values) {
    const per = orderCandidates(String(raw ?? ''));
    if (per === null) continue;
    // A value NO reading can parse is one row's problem, not the file's, so it
    // is not evidence either. Counting it as evidence made a column of nothing
    // but unreadable numeric dates ("13/13/2026") come back ambiguous with all
    // three readings alive, which the reason below then explained as two-digit
    // years: advice to save the file again with four-digit years, shown about a
    // file that already has them. (Found while building the screen, session
    // 103; it is the same shape as the two-digit-year remedy LOW.)
    if (per.length === 0) continue;
    sawOrderEvidence = true;
    const next = candidates.filter((c) => per.includes(c));
    if (next.length === 0) {
      // Proof of one order earlier, proof of another here. Recorded and carried
      // to the end rather than resolved on the spot.
      contradiction = true;
      continue;
    }
    candidates = next;
  }

  if (contradiction) {
    const options: DateFormat[] = ['dmy', 'mdy'];
    return {
      ambiguous: true,
      reason: 'contradiction',
      options,
      sample: distinguishingDateSample(values, options),
    };
  }
  // No numeric value carried order information: blank columns, ISO columns and
  // named-month columns all land here, and none of them needs a question.
  if (!sawOrderEvidence) return { ambiguous: false, format: 'ymd' };
  if (candidates.length === 1) return { ambiguous: false, format: candidates[0] };

  // A surviving year-first reading can only mean two-digit years: any value
  // with a four-digit year at the end would have knocked it out.
  const reason: DateAmbiguityReason = candidates.includes('ymd') ? 'twoDigitYear' : 'order';
  return {
    ambiguous: true,
    reason,
    options: candidates,
    sample: distinguishingDateSample(values, candidates),
  };
}

/** How each reading is named to the shooter. */
export function dateFormatLabel(format: DateFormat): string {
  if (format === 'dmy') return 'Day first';
  if (format === 'mdy') return 'Month first';
  return 'Year first';
}

/**
 * What to say when the column has to be asked about.
 *
 * Each reason gets its own words, and the two-digit-year one is why: telling a
 * shooter to edit the file so the dates use one order is useless advice there,
 * because that file already uses one order. The fix is a four-digit year, so
 * that is what it says.
 */
export function dateAmbiguityMessage(reason: DateAmbiguityReason): string {
  if (reason === 'twoDigitYear') {
    return 'These dates use two-digit years, so we cannot tell which number is the year. Pick the reading that matches your file, or save the file again with four-digit years.';
  }
  if (reason === 'contradiction') {
    return 'Some rows in this column read as day first and others read as month first, so no single reading fits them all. Pick the one most of your file uses; rows that do not fit are listed as problems, and you can fix those in your file and import again.';
  }
  return 'We cannot tell how this column should be read. Pick the reading that matches your file, or edit the dates in your file so they clearly use one order.';
}
