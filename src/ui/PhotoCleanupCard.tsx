// RR-3 (one-time pass): shrink the photos already stored in the log. New photos
// are shrunk automatically on the way in (see shrinkImage.ts); this handles the
// back-catalog of full-resolution photos that were saved before that existed.
//
// RENAMED AND RELOCATED (Michael's decision, 25 Aug 2026, built 27 Aug). It was
// "Free Up Space" on its own always-visible menu row. It is now "Compress
// Photos" and lives inside Sync & Backup as a card that shows itself only when
// there is actually something to compress. Two reasons that is better than it
// sounds. A row that is present every time and usually leads to "nothing to do"
// teaches the shooter to ignore it, so it is worst exactly when it finally
// matters. And this card's own copy has always told him to "use Save to File
// above" first -- which was untrue on a screen of its own, and is true here,
// because Save to File is now genuinely the card above it.
//
// The `standalone` prop went with the screen. It existed only to keep the card
// visible with a "nothing to free up" message when it had no work; that state
// has no home now, and keeping a prop nothing passes is how dead branches
// survive long enough to be mistaken for behaviour.
//
// Safety (working rule 9 — this rewrites the user's real stored photos):
//  - Each photo is updated IN PLACE (same record id) so references from guns
//    (photoIds) and drills (targetMediaIds) stay intact. Each putOne is its own
//    atomic IndexedDB write — an interrupted run can't corrupt or lose a photo;
//    photos not yet reached are simply untouched, and re-running is safe (an
//    already-small photo is skipped because the re-encode isn't smaller).
//  - Processed one at a time so a phone never holds many decoded images at once.
//    The loop itself lives in photoCleanupRun.ts so it can be tested directly.
//  - The user is told to Save to File (back up) first, and must confirm.
import { useEffect, useState } from 'react';
import { hasOversizedMedia, withExclusiveIo } from '../lib/db.ts';
import { runPhotoCleanup } from './photoCleanupRun.ts';
import { prepareUploadBytes } from './shrinkImage.ts';
import { ConfirmSheet } from './Sheet.tsx';

// Photos this big almost certainly haven't been shrunk yet (a 1600px JPEG is
// well under this). Used to decide whether there's anything to free up — so the
// card only appears when it has a job to do (e.g. after importing old data).
const OVERSIZE_BYTES = 1_200_000;

type Stage =
  | { name: 'idle'; message?: string }
  | { name: 'confirm' }
  | { name: 'working'; done: number; total: number }
  | { name: 'done'; shrunk: number; savedMB: string };

export function PhotoCleanupCard() {
  const [stage, setStage] = useState<Stage>({ name: 'idle' });
  const [hasOversized, setHasOversized] = useState(false);

  // On open, check whether any stored photo is still full-size. If none, the
  // card hides itself — there is nothing to compress, so there is nothing to
  // say. P-7 probe: the cursor stops at the first oversize hit so the photo
  // library never lands in memory at once — only one record is live at a time.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const oversized = await hasOversizedMedia(OVERSIZE_BYTES);
      if (alive) setHasOversized(oversized);
    })();
    return () => { alive = false; };
  }, []);

  async function run() {
    setStage({ name: 'working', done: 0, total: 0 });
    try {
      // B6/M-3: the whole rewrite pass runs under the same exclusion as
      // restore/import — in this tab and across tabs — so a cleanup can never
      // interleave with a Load from File rewriting the same photos.
      await withExclusiveIo('the photo cleanup', () => runInner());
    } catch (e) {
      setStage({
        name: 'idle',
        message: e instanceof Error ? e.message : 'Could not finish — your photos are unchanged.'
      });
    }
  }

  async function runInner() {
    const { shrunk, savedBytes } = await runPhotoCleanup(
      async (data, mime) => prepareUploadBytes(new Blob([data], { type: mime })),
      (done, total) => setStage({ name: 'working', done, total })
    );
    setStage({ name: 'done', shrunk, savedMB: (savedBytes / (1024 * 1024)).toFixed(1) });
  }

  // Nothing to free up (and not mid-run / not showing a result). Inline on the
  // More screen the card hides itself; on its own screen it stays and says so.
  if (stage.name === 'idle' && !hasOversized) return null;

  return (
    <div className="card">
      <h2>Compress Photos</h2>
      <p className="report-note" style={{ marginBottom: 12 }}>
        Some photos in your log are still full size. Making smaller copies of them frees up room
        and makes syncing faster, and they'll still look good on screen and in reports (videos are
        left alone).{' '}
        <strong>Back up first:</strong> use Save to File above before running this — it rewrites your
        stored photos and can only be undone by pulling a backup.
      </p>
      {stage.name === 'working' ? (
        <p className="report-note" aria-live="polite">
          Shrinking photos… {stage.done} of {stage.total}
        </p>
      ) : stage.name === 'done' ? (
        <p className="report-note">
          Done — shrank {stage.shrunk} photo{stage.shrunk === 1 ? '' : 's'} and saved about{' '}
          {stage.savedMB} MB. Save to File again to carry the smaller copies to your other device.
        </p>
      ) : (
        <>
          <button className="button" onClick={() => setStage({ name: 'confirm' })}>
            Compress Photos
          </button>
          {stage.name === 'idle' && stage.message && (
            <p className="report-note" style={{ marginTop: 10 }}>{stage.message}</p>
          )}
        </>
      )}
      {stage.name === 'confirm' && (
        <ConfirmSheet
          title="Compress the photos in your log?"
          message="This makes smaller copies of every full-size photo in your log. Make sure you've backed up first with Save to File. Continue?"
          confirmLabel="Compress Photos"
          onConfirm={() => void run()}
          onClose={() => setStage({ name: 'idle' })}
        />
      )}
    </div>
  );
}
