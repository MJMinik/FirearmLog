// One-tap sync (spec §7.1): Push to File saves FirearmLog.flog; Pull from
// File replaces this device's data with the file — after a plain-language
// check of which copy is newer.
import { useRef, useState } from 'react';
import { buildFlog, parseFlog } from '../lib/flog.ts';
import type { Snapshot } from '../lib/flog.ts';
import { exportSnapshot, localLastModified, restoreSnapshot, putSettings } from '../lib/db.ts';
import type { AppSettings } from '../lib/types.ts';
import { ConfirmSheet, Sheet } from './Sheet.tsx';

function stampWords(ms: number): string {
  if (!ms) return 'never';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

type Stage =
  | { name: 'idle'; message?: string }
  | { name: 'push-ready'; url: string; summary: string }
  | { name: 'confirm'; snapshot: Snapshot; warning: string; label: string }
  | { name: 'working'; message: string };

export function SyncCard({ onPulled, onBackedUp }: { onPulled: () => void; onBackedUp?: () => void }) {
  const [stage, setStage] = useState<Stage>({ name: 'idle' });
  const fileRef = useRef<HTMLInputElement>(null);

  async function push() {
    setStage({ name: 'working', message: 'Packing your data…' });
    try {
      const snapshot = await exportSnapshot();
      const bytes = buildFlog(snapshot);
      const ab = new ArrayBuffer(bytes.length);
      new Uint8Array(ab).set(bytes);
      const blob = new Blob([ab], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const sessions = (snapshot.stores.sessions ?? []).length;
      setStage({
        name: 'push-ready',
        url,
        summary: `${sessions} sessions and ${snapshot.media.length} photos/videos, packed and ready.`
      });
    } catch (e) {
      setStage({ name: 'idle', message: e instanceof Error ? e.message : 'The push did not finish.' });
    }
  }

  function pushDone(url: string, saved = false) {
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    // Only stamp the backup time when the user actually tapped Save (not when
    // they just closed the sheet). Additive write — records are untouched.
    if (saved) {
      void putSettings<AppSettings>({ lastBackupAt: Date.now() });
      onBackedUp?.();
    }
    setStage({
      name: 'idle',
      message: 'File saved? Great — pull it on your other device and you\u2019re in sync.'
    });
  }

  async function filePicked(file: File) {
    setStage({ name: 'working', message: 'Reading the file…' });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const snapshot = parseFlog(bytes);
      const localStamp = await localLastModified();
      const sessions = (snapshot.stores.sessions ?? []).length;
      const guns = (snapshot.stores.firearms ?? []).length;
      const summary = `The file holds ${guns} guns, ${sessions} sessions, and ${snapshot.media.length} photos/videos (last changed ${stampWords(snapshot.lastModified)}; this device last changed ${stampWords(localStamp)}).`;
      const warning = snapshot.lastModified < localStamp
        ? `Heads up — this device has NEWER work than the file. Pulling replaces everything on this device with the older file. ${summary}`
        : `Pulling replaces everything on this device with the file. ${summary}`;
      setStage({ name: 'confirm', snapshot, warning, label: snapshot.lastModified < localStamp ? 'Pull the Older File Anyway' : 'Pull from File' });
    } catch (e) {
      setStage({ name: 'idle', message: e instanceof Error ? e.message : 'That file could not be read.' });
    }
  }

  async function reallyPull(snapshot: Snapshot) {
    setStage({ name: 'working', message: 'Bringing the file in…' });
    try {
      await restoreSnapshot(snapshot, (done, total) => {
        if (total > 0) setStage({ name: 'working', message: `Saving photos: ${done} of ${total}…` });
      });
      setStage({ name: 'idle', message: 'Done — this device now matches the file.' });
      onPulled();
    } catch (e) {
      setStage({ name: 'idle', message: e instanceof Error ? e.message : 'The pull did not finish.' });
    }
  }

  return (
    <div className="card">
      <h2>Phone ↔ Desktop Sync</h2>
      <p className="report-note" style={{ marginBottom: 12 }}>
        Push saves everything to one data file (FirearmLog.flog). Keep it in iCloud Drive,
        then Pull it on your other device so both match.
      </p>
      {stage.name === 'working' ? (
        <p className="report-note">{stage.message}</p>
      ) : (
        <>
          <button className="button" onClick={() => void push()}>Push to File</button>
          <div style={{ height: 8 }} />
          <button className="button secondary" onClick={() => fileRef.current?.click()}>Pull from File</button>
          <input ref={fileRef} type="file" accept=".flog,application/octet-stream,application/zip"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void filePicked(f);
              e.target.value = '';
            }} />
          {stage.name === 'idle' && stage.message && (
            <p className="report-note" style={{ marginTop: 10 }}>{stage.message}</p>
          )}
        </>
      )}
      {stage.name === 'push-ready' && (
        <Sheet title="Your Data File Is Ready" onClose={() => pushDone(stage.url)}>
          <p className="report-note" style={{ marginBottom: 10 }}>{stage.summary}</p>
          <p className="report-note" style={{ marginBottom: 10 }}>
            After you tap <strong>Save the File Now</strong> below, your iPhone shows a file preview screen.
            Here's what to do on it:
          </p>
          <ol className="sync-steps">
            <li>Tap <strong>"Open in…"</strong> in the middle of the screen.</li>
            <li>In the menu that slides up, tap <strong>Save to Files</strong>.</li>
            <li>Pick <strong>iCloud Drive</strong>, then tap <strong>Save</strong>.</li>
            <li>If it asks about an existing FirearmLog.flog, choose <strong>Replace</strong>.</li>
          </ol>
          <p className="report-note" style={{ marginBottom: 12 }}>
            (On a desktop computer the file simply lands in your Downloads folder — move it to iCloud Drive.)
          </p>
          <p className="report-note" style={{ marginBottom: 12 }}>
            Heads up: your "back up your data" reminder on the Home screen only clears once you've
            actually saved the file. If you back out without saving, the reminder stays — on purpose.
          </p>
          <a className="button" href={stage.url} download="FirearmLog.flog"
            onClick={() => pushDone(stage.url, true)}>
            Save the File Now
          </a>
        </Sheet>
      )}
      {stage.name === 'confirm' && (
        <ConfirmSheet
          title="Replace this device's data?"
          message={stage.warning}
          confirmLabel={stage.label}
          onConfirm={() => void reallyPull(stage.snapshot)}
          onClose={() => setStage({ name: 'idle' })}
        />
      )}
    </div>
  );
}
