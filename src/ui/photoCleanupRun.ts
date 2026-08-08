// P-7: the Free Up Space run loop, lifted out of PhotoCleanupCard so it can be
// tested directly (audit finding 2, session 114). It used to live inside the
// component, where the only thing watching it was a source-level grep — and a
// grep cannot tell working code from a no-op. The image encoder it depends on
// needs a real canvas, so the encoder is passed IN: the card supplies the real
// one, a test supplies a stub, and the loop itself is exercised either way.
//
// Safety (working rule 9 — this rewrites the user's real stored photos):
//  - Each photo is updated IN PLACE (same record id) so references from guns
//    (photoIds) and drills (targetMediaIds) stay intact. Each putOne is its own
//    atomic IndexedDB write, so an interrupted run cannot corrupt or lose a
//    photo; photos not yet reached are untouched, and re-running is safe.
//  - Ids are scanned first, then each record is read back, read and released
//    one at a time, so only one photo is held at any point.
//  - A photo deleted between the scan and its turn, or one with no bytes at all,
//    is skipped — one damaged record cannot abort the pass for everything after it.
//  - A re-encode that is not smaller is discarded, so nothing is ever made worse.
import { getOne, putOne, scanMediaImageIds } from '../lib/db.ts';
import { stampUpdate } from '../lib/stamps.ts';
import type { Media } from '../lib/types.ts';

/** Re-encode one photo. Returns the new bytes; may return the same or larger. */
export type ShrinkFn = (data: ArrayBuffer, mime: string) => Promise<{ data: ArrayBuffer; mime: string }>;

export type CleanupResult = { shrunk: number; savedBytes: number };

export async function runPhotoCleanup(
  shrink: ShrinkFn,
  onProgress: (done: number, total: number) => void,
  now: () => number = Date.now
): Promise<CleanupResult> {
  const ids = await scanMediaImageIds();
  let shrunk = 0;
  let savedBytes = 0;
  for (let i = 0; i < ids.length; i++) {
    onProgress(i, ids.length);
    const m = await getOne<Media>('media', ids[i]);
    // Skip anything the run cannot act on rather than dying on it: a record
    // deleted between the scan and its turn, or one whose bytes are missing.
    // A damaged record used to abort the whole pass with raw programmer text on
    // screen, leaving every later photo untouched (audit observation, session 114).
    if (!m || !m.data) continue;
    const { data, mime } = await shrink(m.data, m.mime || 'image/jpeg');
    if (data.byteLength < m.data.byteLength) {
      savedBytes += m.data.byteLength - data.byteLength;
      await putOne('media', stampUpdate({ ...m, data, mime }, now()));
      shrunk += 1;
    }
  }
  return { shrunk, savedBytes };
}
