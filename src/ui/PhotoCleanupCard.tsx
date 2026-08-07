// RR-3 (one-time pass): shrink the photos already stored in the log. New photos
// are shrunk automatically on the way in (see shrinkImage.ts); this handles the
// back-catalog of full-resolution photos that were saved before that existed.
//
// Safety (working rule 9 — this rewrites the user's real stored photos):
//  - Each photo is updated IN PLACE (same record id) so references from guns
//    (photoIds) and drills (targetMediaIds) stay intact. Each putOne is its own
//    atomic IndexedDB write — an interrupted run can't corrupt or lose a photo;
//    photos not yet reached are simply untouched, and re-running is safe (an
//    already-small photo is skipped because the re-encode isn't smaller).
//  - Processed one at a time so a phone never holds many decoded images at once.
//  - The user is told to Save to File (back up) first, and must confirm.
import { useEffect, useState } from 'react';
import { getAllMediaWholeStore, putOne, withExclusiveIo } from '../lib/db.ts';
import { stampUpdate } from '../lib/stamps.ts';
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

export function PhotoCleanupCard({ standalone = false }: { standalone?: boolean } = {}) {
  const [stage, setStage] = useState<Stage>({ name: 'idle' });
  const [hasOversized, setHasOversized] = useState(false);
  const [checked, setChecked] = useState(false);

  // On open, check whether any stored photo is still full-size. If none, the
  // card hides itself — there's nothing to free up. On its own screen
  // (standalone) it stays and shows a plain "nothing to free up" state instead.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const all = await getAllMediaWholeStore();
      const oversized = all.some((m) => m.kind === 'image' && m.data.byteLength > OVERSIZE_BYTES);
      if (alive) { setHasOversized(oversized); setChecked(true); }
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
    const all = await getAllMediaWholeStore();
    const images = all.filter((m) => m.kind === 'image');
    let shrunk = 0;
    let saved = 0;
    for (let i = 0; i < images.length; i++) {
      const m = images[i];
      setStage({ name: 'working', done: i, total: images.length });
      const blob = new Blob([m.data], { type: m.mime || 'image/jpeg' });
      const { data, mime } = await prepareUploadBytes(blob);
      if (data.byteLength < m.data.byteLength) {
        saved += m.data.byteLength - data.byteLength;
        await putOne('media', stampUpdate({ ...m, data, mime }, Date.now()));
        shrunk += 1;
      }
    }
    setStage({ name: 'done', shrunk, savedMB: (saved / (1024 * 1024)).toFixed(1) });
  }

  // Nothing to free up (and not mid-run / not showing a result). Inline on the
  // More screen the card hides itself; on its own screen it stays and says so.
  if (stage.name === 'idle' && !hasOversized) {
    if (!standalone) return null;
    if (!checked) return <div className="card" aria-hidden="true" style={{ minHeight: 88 }} />;
    return (
      <div className="card">
        <h2>Free Up Space</h2>
        <p className="report-note">
          Your photos are already optimized — there's nothing to free up right now. New photos are
          shrunk automatically as you add them.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Free Up Space</h2>
      <p className="report-note" style={{ marginBottom: 12 }}>
        Make smaller copies of the photos already in your log. They'll still look good on screen
        and in reports, but take far less space and sync faster (videos are left alone).{' '}
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
            Shrink Stored Photos
          </button>
          {stage.name === 'idle' && stage.message && (
            <p className="report-note" style={{ marginTop: 10 }}>{stage.message}</p>
          )}
        </>
      )}
      {stage.name === 'confirm' && (
        <ConfirmSheet
          title="Shrink stored photos?"
          message="This makes smaller copies of every photo in your log to free up space. Make sure you've backed up first with Save to File. Continue?"
          confirmLabel="Shrink Photos"
          onConfirm={() => void run()}
          onClose={() => setStage({ name: 'idle' })}
        />
      )}
    </div>
  );
}
