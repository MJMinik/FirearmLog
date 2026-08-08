// One-tap sync (spec §7.1): Save to File writes FirearmLog.flog; Load from
// File replaces this device's data with the file — after a plain-language
// check of which copy is newer. (Renamed from Push/Pull, July 8 2026 — Git
// words, not range words; Michael's wife supplied the usability test.)
import { useEffect, useRef, useState } from 'react';
import { buildFlog, parseFlog } from '../lib/flog.ts';
import type { Snapshot } from '../lib/flog.ts';
import { exportSnapshot, getSettings, localLastModified, restoreSnapshot, putSettings } from '../lib/db.ts';
import type { AppSettings } from '../lib/types.ts';
import { fileTooLargeMessage, storageShortfallMessage, MAX_FLOG_BYTES } from '../lib/inputLimits.ts';
import { ConfirmSheet, Sheet } from './Sheet.tsx';
import { deliverFile, isIOS, isStandalone } from './deliverFile.ts';
import type { DeliveryOutcome } from './deliverFile.ts';

// iOS/iPadOS is the one platform where a saved file goes through the Files
// picker (the user chooses the spot, and the app never learns it). Everywhere
// else — Mac, Windows, Android — the browser drops the file in Downloads. The
// instructions and the after-save message fork on THIS, not on window width:
// a narrow desktop window is still a desktop. (iPadOS reports itself as
// "MacIntel" with touch, hence the second clause.)
function isIOSDevice(): boolean {
  return isIOS();
}

/** Installed-to-home-screen iPhone/iPad: the standalone-PWA delivery path. */
function isStandaloneIOS(): boolean {
  return isIOS() && isStandalone();
}

function stampWords(ms: number): string {
  if (!ms) return 'never';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

type Stage =
  | { name: 'idle'; message?: string }
  | { name: 'save-ready'; blob: Blob; summary: string }
  | { name: 'confirm'; snapshot: Snapshot; warning: string; label: string }
  | { name: 'working'; message: string };

export function SyncCard({ onPulled, onBackedUp }: { onPulled: () => void; onBackedUp?: () => void }) {
  const [stage, setStage] = useState<Stage>({ name: 'idle' });
  // The card says out loud when this device last saved the file — the save IS
  // the backup, so its freshness deserves to be visible (Michael, July 8 2026;
  // Nielsen: visibility of system status). Reads the same lastBackupAt stamp
  // the Home reminder uses; 0 = never saved on this device, show nothing.
  const [lastSavedAt, setLastSavedAt] = useState(0);
  useEffect(() => {
    let alive = true;
    void getSettings<AppSettings>().then((st) => {
      if (alive && st?.lastBackupAt) setLastSavedAt(st.lastBackupAt);
    }).catch(() => { /* the line is informational — never block the card */ });
    return () => { alive = false; };
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);

  async function saveToFile() {
    setStage({ name: 'working', message: 'Packing your data…' });
    try {
      const snapshot = await exportSnapshot();
      const bytes = buildFlog(snapshot);
      // P-5: bytes is a Uint8Array that owns its whole backing buffer (writeZip
      // allocates `new Uint8Array(total)`), so Blob can use it directly.
      // The previous copy — `new ArrayBuffer(bytes.length); new Uint8Array(ab).set(bytes)` —
      // allocated a second buffer the same size and copied every byte for no reason.
      // Cast to Uint8Array<ArrayBuffer>: writeZip's `new Uint8Array(total)` always
      // allocates a plain ArrayBuffer (not SharedArrayBuffer), so this is safe.
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' });
      const sessions = (snapshot.stores.sessions ?? []).length;
      setStage({
        name: 'save-ready',
        blob,
        summary: `${sessions} sessions and ${snapshot.media.length} photos/videos, packed and ready.`
      });
    } catch (e) {
      setStage({ name: 'idle', message: e instanceof Error ? e.message : 'The save did not finish.' });
    }
  }

  function afterDelivery(outcome: DeliveryOutcome) {
    // The user cancelled the Share sheet on iOS — treat as "backed out without
    // saving." The Home reminder stays up (honest); no time stamped.
    if (outcome.kind === 'share' && !outcome.shared) {
      setStage({ name: 'idle' });
      return;
    }
    const now = Date.now();
    // S-6: stamp the backup time and clear the Home reminder only AFTER the
    // write succeeds. It was fire-and-forget before, so a failed settings write
    // still moved the "last saved" line and cleared the reminder — claiming a
    // backup we couldn't record (a charter §1 honesty bug). On failure the
    // reminder stays up (honest) and the card says so; the file itself has
    // already reached the user either way.
    void putSettings<AppSettings>({ lastBackupAt: now })
      .then(() => {
        setLastSavedAt(now);
        onBackedUp?.();
      })
      .catch(() => setStage({
        name: 'idle',
        message: 'File handed off — but I couldn’t record the backup time on this device, so your Home reminder will stay up until the next successful save.',
      }));
    setStage({
      name: 'idle',
      message: doneMessage(outcome),
    });
  }

  function doneMessage(outcome: DeliveryOutcome): string {
    if (outcome.kind === 'share') {
      return 'File handed to the iPhone Share sheet — pick Save to Files (or AirDrop, Mail, etc.) to keep it. Load it on your other device and you’re in sync.';
    }
    if (outcome.kind === 'window') {
      return 'File opened in a new window — use your browser’s Save to keep it, then put it where your other device can see it.';
    }
    return isIOSDevice()
      ? 'File saved — FirearmLog.flog is in the spot you picked in Save to Files. Load it on your other device and you’re in sync.'
      : 'File saved — FirearmLog.flog is in your Downloads folder, unless you chose another spot. Put it where your other device can see it, then load it there.';
  }

  async function handleSaveNow(blob: Blob) {
    try {
      const outcome = await deliverFile(blob, 'FirearmLog.flog', 'application/octet-stream');
      afterDelivery(outcome);
    } catch (e) {
      setStage({
        name: 'idle',
        message: e instanceof Error ? `The save did not finish: ${e.message}` : 'The save did not finish.',
      });
    }
  }

  async function filePicked(file: File) {
    // S-2: refuse an absurdly large file before reading the whole thing into
    // memory (a multi-gigabyte arrayBuffer read can crash the tab). Generous —
    // a real .flog never approaches it.
    const tooBig = fileTooLargeMessage(file.size, MAX_FLOG_BYTES, 'data file');
    if (tooBig) { setStage({ name: 'idle', message: tooBig }); return; }
    setStage({ name: 'working', message: 'Reading the file…' });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const snapshot = parseFlog(bytes);
      const localStamp = await localLastModified();
      const sessions = (snapshot.stores.sessions ?? []).length;
      const guns = (snapshot.stores.firearms ?? []).length;
      const summary = `The file holds ${guns} guns, ${sessions} sessions, and ${snapshot.media.length} photos/videos (last changed ${stampWords(snapshot.lastModified)}; this device last changed ${stampWords(localStamp)}).`;
      const warning = snapshot.lastModified < localStamp
        ? `Heads up — this device has NEWER work than the file. Loading it replaces everything on this device with the older file. ${summary}`
        : `Loading the file replaces everything on this device with it. ${summary}`;
      setStage({ name: 'confirm', snapshot, warning, label: snapshot.lastModified < localStamp ? 'Load the Older File Anyway' : 'Load from File' });
    } catch (e) {
      setStage({ name: 'idle', message: e instanceof Error ? e.message : 'That file could not be read.' });
    }
  }

  async function reallyLoad(snapshot: Snapshot) {
    // S-3: preflight free space before a whole-log restore. Media is written
    // add-before-delete (never loses photos), so peak storage briefly holds BOTH
    // the old and new photos — if the device can't fit that, say so up front in
    // plain words instead of dying on a raw QuotaExceededError mid-write. An
    // unknown estimate never blocks (storageShortfallMessage returns null).
    const mediaBytes = snapshot.media.reduce(
      (n, m) => n + ((m as { data?: ArrayBuffer }).data?.byteLength ?? 0), 0);
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    const estimate = storage && typeof storage.estimate === 'function'
      ? await storage.estimate().catch(() => null)
      : null;
    const spaceMsg = storageShortfallMessage(mediaBytes, estimate);
    if (spaceMsg) { setStage({ name: 'idle', message: spaceMsg }); return; }
    setStage({ name: 'working', message: 'Bringing the file in…' });
    try {
      await restoreSnapshot(snapshot, (done, total) => {
        if (total > 0) setStage({ name: 'working', message: `Saving photos: ${done} of ${total}…` });
      });
      setStage({ name: 'idle', message: 'Done — this device now matches the file.' });
      onPulled();
    } catch (e) {
      setStage({ name: 'idle', message: e instanceof Error ? e.message : 'The load did not finish.' });
    }
  }

  return (
    <div className="card">
      <h2>Phone ↔ Desktop Sync</h2>
      <p className="report-note" style={{ marginBottom: 12 }}>
        Save to File writes everything — your whole log — to one data file (FirearmLog.flog).
        That file is your backup. Keep it anywhere both devices can see — iCloud Drive,
        Google Drive, any folder — then Load it on the other device so both match.
      </p>
      {stage.name === 'working' ? (
        <p className="report-note">{stage.message}</p>
      ) : (
        <>
          <button className="button" onClick={() => void saveToFile()}>Save to File</button>
          <div style={{ height: 8 }} />
          <button className="button secondary" onClick={() => fileRef.current?.click()}>Load from File</button>
          <input ref={fileRef} type="file" accept=".flog,application/octet-stream,application/zip"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void filePicked(f);
              e.target.value = '';
            }} />
          {lastSavedAt > 0 && (
            <p className="report-note" style={{ marginTop: 10 }}>
              Last saved to the file from this device: {stampWords(lastSavedAt)}.
            </p>
          )}
          {stage.name === 'idle' && stage.message && (
            <p className="report-note" style={{ marginTop: 10 }}>{stage.message}</p>
          )}
        </>
      )}
      {stage.name === 'save-ready' && (
        <Sheet title="Your Data File Is Ready" onClose={() => setStage({ name: 'idle' })}>
          <p className="report-note" style={{ marginBottom: 10 }}>{stage.summary}</p>
          {isStandaloneIOS() ? (
            <>
              <p className="report-note" style={{ marginBottom: 10 }}>
                After you tap <strong>Save the File Now</strong> below, your iPhone slides up the
                Share sheet. Here's what to do on it:
              </p>
              <ol className="sync-steps">
                <li>Tap <strong>Save to Files</strong>.</li>
                <li>Pick where to keep it — <strong>iCloud Drive</strong> works well, and Google Drive
                  or any folder works too. Then tap <strong>Save</strong>.</li>
                <li>If it asks about an existing FirearmLog.flog, choose <strong>Replace</strong>.</li>
              </ol>
              <p className="report-note" style={{ marginBottom: 12 }}>
                From the Share sheet you can also AirDrop the file straight to your Mac or another
                iPhone, or send it to yourself in Mail.
              </p>
            </>
          ) : isIOSDevice() ? (
            <>
              <p className="report-note" style={{ marginBottom: 10 }}>
                After you tap <strong>Save the File Now</strong> below, your iPhone shows a file preview screen.
                Here's what to do on it:
              </p>
              <ol className="sync-steps">
                <li>Tap <strong>"Open in…"</strong> in the middle of the screen.</li>
                <li>In the menu that slides up, tap <strong>Save to Files</strong>.</li>
                <li>Pick where to keep it — <strong>iCloud Drive</strong> works well, and Google Drive or
                  any folder works too. Then tap <strong>Save</strong>.</li>
                <li>If it asks about an existing FirearmLog.flog, choose <strong>Replace</strong>.</li>
              </ol>
              <p className="report-note" style={{ marginBottom: 12 }}>
                Whatever spot you pick, that's where your backup lives — you can also save it on this
                phone and move it later (AirDrop, a cable, however you like).
              </p>
            </>
          ) : (
            <p className="report-note" style={{ marginBottom: 12 }}>
              After you tap <strong>Save the File Now</strong> below, the file lands in your{' '}
              <strong>Downloads folder</strong>. Move it anywhere your other device can see it —
              iCloud Drive, Google Drive, any shared folder — or carry it over however you like.
            </p>
          )}
          <p className="report-note" style={{ marginBottom: 12 }}>
            Heads up: your "back up your data" reminder on the Home screen only clears once you've
            actually saved the file. If you back out without saving, the reminder stays — on purpose.
          </p>
          <button className="button" onClick={() => void handleSaveNow(stage.blob)}>
            Save the File Now
          </button>
        </Sheet>
      )}
      {stage.name === 'confirm' && (
        <ConfirmSheet
          title="Replace this device's data?"
          message={stage.warning}
          confirmLabel={stage.label}
          onConfirm={() => void reallyLoad(stage.snapshot)}
          onClose={() => setStage({ name: 'idle' })}
        />
      )}
    </div>
  );
}
