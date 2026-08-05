// The file-picking boundary for the CSV importer, kept out of the screen so it
// can be tested without a browser.
//
// THE ONE RULE THIS FILE EXISTS TO HOLD: the size cap is checked BEFORE the
// file is read. An earlier build called `file.text()` first and refused
// afterwards, which means a 300 MB file was pulled into memory in full before
// anything said no, on the device least able to afford it. The guard belongs at
// the boundary, exactly where inputLimits.ts says it does, and "at the
// boundary" includes being early enough to matter.
//
// NOTE ON PUNCTUATION: no string here uses an em dash. Every one of them can
// reach a shooter's screen. (The shared refusal from inputLimits.ts is an
// existing app-wide message and is used as it stands.)

import { MAX_IMPORT_FILE_BYTES, fileTooLargeMessage } from '../lib/inputLimits.ts';

/** Just enough of a File to read one, so a test can hand over a fake. */
export interface PickedFile {
  name: string;
  size: number;
  text: () => Promise<string>;
}

export type FileReadOutcome =
  | { ok: true; name: string; text: string }
  | { ok: false; problem: string };

/**
 * Read a picked file, or say plainly why we will not.
 *
 * Order matters and is the point: `file.size` is metadata the browser already
 * has, so an outsized file is turned away without a byte of it being read.
 */
export async function readCsvFile(
  file: PickedFile,
  cap: number = MAX_IMPORT_FILE_BYTES,
): Promise<FileReadOutcome> {
  const tooLarge = fileTooLargeMessage(file.size, cap, 'file');
  if (tooLarge) return { ok: false, problem: tooLarge };

  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, problem: 'That file could not be read. Nothing was changed. Try picking it again.' };
  }

  if (text.trim() === '') {
    return { ok: false, problem: 'That file has nothing in it. Nothing was changed.' };
  }
  return { ok: true, name: file.name, text };
}
