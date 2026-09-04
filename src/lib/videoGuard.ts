// Pure logic for the capture-time large-video choice (spec §3.1). No DOM, no
// browser APIs, so the boundaries and the exact signed copy are unit-tested
// without a browser. The actual still-frame capture is browser-only and lives
// in src/ui/videoStill.ts; the sheet that shows this copy lives in
// src/ui/MediaField.tsx.
import { humanBytes } from './inputLimits.ts';

/** What to do with a just-picked file, given the two size lines.
 *  - 'stage'  — add it exactly as today, no question asked.
 *  - 'ask'    — a video over the ask line and at or under the max: offer the
 *               keep-video / keep-a-still choice.
 *  - 'refuse' — over the hard max; refused exactly as today, for photos too. */
export type PickedFileVerdict = 'stage' | 'ask' | 'refuse';

/** Photos never ask — only a video between the two lines does. A photo (or a
 *  video) over `maxBytes` is refused, unchanged from today's behaviour.
 *  Boundaries are exact: exactly `askBytes` still stages, exactly `maxBytes`
 *  still asks (only strictly over `maxBytes` refuses). */
export function classifyPickedFile(
  file: { size: number; isVideo: boolean },
  limits: { askBytes: number; maxBytes: number }
): PickedFileVerdict {
  if (file.size > limits.maxBytes) return 'refuse';
  if (file.isVideo && file.size > limits.askBytes) return 'ask';
  return 'stage';
}

/** The name a captured still is staged under: the video's file name with its
 *  extension dropped and " (still)" added. A name with no extension (or one
 *  that starts with a dot, so there's nothing before it) is used as-is. */
export function stillName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  return `${base} (still)`;
}

/** THE SIGNED COPY (Large-video sheet body). Numbers are always derived from
 *  the constants via humanBytes — never hard-coded — so a future change to
 *  either line updates this sentence for free. */
export function largeVideoSentence(bytes: number, maxBytes: number): string {
  return `This video is ${humanBytes(bytes)}. Videos over ${humanBytes(maxBytes)} cannot be added: `
    + `a file that size can crash the app on a phone. This one will load, but videos this size make `
    + `backups large and slow. Keep it in the log, or keep a still frame and your notes instead?`;
}

/** THE SIGNED COPY (decode-failure variant): one added sentence, appended to
 *  largeVideoSentence, with only "Keep the video" left as a choice. */
export const DECODE_FAILURE_SENTENCE =
  "A still frame can't be made from this video on this device, so the choice is to keep the video or not add it.";
