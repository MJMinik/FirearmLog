// S-2 / S-3 (M-11, M-5): sanity ceilings and plain-English refusals at the UI
// boundary, so a pathological paste or a mistakenly-huge file is turned away with
// clear words BEFORE the app reads the whole thing into memory (a multi-gigabyte
// read can hang or crash the tab). These are generous ceilings no real file hits
// — they are NOT feature limits. They live OUTSIDE the danger-zone parsers
// (rule 9): the guard sits at the boundary; the parsers stay untouched.
//
// Pure (no browser APIs) so every message is unit-tested. The storage helper
// takes a plain estimate object rather than calling navigator itself, for the
// same reason.

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Pasted/loaded results text (PractiScore / USPSA). A real export is a few KB;
 *  a whole club season is well under a megabyte of text. */
export const MAX_PASTE_CHARS = 5_000_000; // ~5 MB of text

/** A Pistol Tracker / CSV import file read whole via file.text(). Michael's real
 *  Pistol Tracker backup is ~80 MB (photos as base64), so the ceiling is high. */
export const MAX_IMPORT_FILE_BYTES = 300 * MB;

/** A .flog data file (the whole log, incl. photos/videos) read whole via
 *  file.arrayBuffer(). Legitimately large — this only catches the absurd. */
export const MAX_FLOG_BYTES = GB; // 1 GB

/** One attached photo/video. Full-resolution insurance photos run ~30 MB and a
 *  short range clip can be larger; this rejects only the truly outsized file. */
export const MAX_MEDIA_BYTES = 500 * MB;

/** A byte count in the roundest human words we show a shooter — MB, or GB once
 *  it's a gigabyte or more. */
export function humanBytes(bytes: number): string {
  if (bytes >= GB) {
    const gb = bytes / GB;
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  }
  if (bytes <= 0) return '0 MB';
  return `${Math.max(1, Math.round(bytes / MB))} MB`;
}

/** Plain-English refusal if a file is over `cap`, else null. `noun` names the
 *  thing to the user ("data file", "file", "photo or video"). */
export function fileTooLargeMessage(size: number, cap: number, noun: string): string | null {
  if (size <= cap) return null;
  return `That ${noun} is ${humanBytes(size)} — too large to read in one go (the limit is about ${humanBytes(cap)}). Nothing was read; pick a smaller ${noun} and try again.`;
}

/** Plain-English refusal if pasted text is longer than `cap`, else null. */
export function textTooLongMessage(len: number, cap = MAX_PASTE_CHARS): string | null {
  if (len <= cap) return null;
  return "That's more text than can be read at once — nothing was read. Paste a single export and try again.";
}

/**
 * S-3 preflight: given the space a restore needs and what the device reports as
 * total/used, a plain-English shortfall message — or null when there's room, or
 * when the device can't tell us (an unknown must never block a legitimate
 * restore; the write still guards itself). Kept pure so the decision is tested
 * without a browser.
 */
export function storageShortfallMessage(
  neededBytes: number,
  estimate: { quota?: number; usage?: number } | null | undefined,
): string | null {
  if (!estimate || estimate.quota == null || estimate.usage == null) return null;
  const free = estimate.quota - estimate.usage;
  if (neededBytes <= free) return null;
  return `This file needs about ${humanBytes(neededBytes)} of space, but only about ${humanBytes(free)} is free on this device. Free up some space, then try loading again — nothing on this device was changed.`;
}
