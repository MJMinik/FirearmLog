// One-tap sync (spec §7.1): Save to File writes FirearmLog.flog; Load from
// File replaces this device's data with the file — after a plain-language
// check of which copy is newer. (Renamed from Push/Pull, July 8 2026 — Git
// words, not range words; Michael's wife supplied the usability test.)
import { useEffect, useRef, useState } from 'react';
import { buildFlogBlob, parseFlog } from '../lib/flog.ts';
import type { Snapshot } from '../lib/flog.ts';
import {
  exportSnapshotSources, getSettings, localLastModified, restoreSnapshot, putSettings, withExclusiveIo,
} from '../lib/db.ts';
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

  // Backup memory pass 2, session 118. This used to load every photo and video
  // into memory, build the whole archive as a second block the same size, and
  // wrap that in a third — roughly three copies of the library at once, against
  // an iPhone allowance in the low hundreds of megabytes. One minute of iPhone
  // video was enough to have the page killed mid-pack, twice, with no file saved.
  // buildFlogBlob holds one photo at a time and hands each finished piece to the
  // browser, which is free to spill it to disk. It also returns the Blob itself,
  // so the third copy (`new Blob([bytes])`) is gone rather than merely smaller.
  //
  // MEASURED — AND READ THE METRIC NAMES, BECAUSE THE FIRST TWO ATTEMPTS AT THIS
  // COMMENT BOTH QUOTED THE WRONG ONE. Chromium, eight runs across two machines,
  // on a library shaped like his: three ~57 MB clips plus 31 photos, 264 MB in
  // total. Both paths were hashed and proved to produce the identical archive
  // before any number was believed.
  //
  //   PEAK growth during a save (kernel high-water mark — the figure that
  //   decides whether a page gets killed):
  //                                   810-850 MB  ->  510-570 MB
  //   Above the 264 MB archive, which has to exist:
  //                                   ~550 MB     ->  ~280 MB
  //   What is still resident when the save FINISHES (proportional set size):
  //                                    818 MB     ->   282 MB
  //
  // SO THE PEAK IS ROUGHLY HALVED, NOT ELIMINATED. An earlier version of this
  // comment quoted the last row as the peak and concluded "the transient waste is
  // essentially gone". It is not: the end-state figure cannot see a transient at
  // all, which is precisely the blindness the previous instrument was rebuilt to
  // remove, reintroduced in a different metric. The transient above the archive
  // is about 280 MB, not 18 MB.
  //
  // WHAT THAT MEANS, STATED WITHOUT HOPE ATTACHED. A 264 MB library still peaks
  // somewhere around half a gigabyte. That is a great deal better than 850 MB and
  // it is not obviously under an iPhone's ceiling. The floor is set by what is IN
  // the log — a minute of 4K video is 170 MB and no writer makes it smaller — so
  // the next real lever is the size of what gets stored, not the way it is
  // written. His phone is the deciding test; no machine here can stand in for it.
  // scripts/measure-backup-memory.mjs reproduces all of this and carries the
  // post-mortem of two wrong instruments. Trust it over this comment.
  //
  // THE LOCK IS PART OF THE FIX, not housekeeping — but be exact about what it
  // covers, because the first version of this comment was not and a cold audit
  // caught it. Reading the library one photo at a time opens a window the old
  // single-transaction read did not have. withExclusiveIo is the same exclusion
  // restore, import, erase and Free Up Space take, and it holds ACROSS TABS. It
  // does NOT stop several ordinary things, and the enumeration matters because
  // the first version of it sent the reader to the wrong files. Unlocked media
  // deletes live in PhotoSheet, MediaField, MatchScreens (removing a match's
  // videos) and GunDetail — AND, the one nobody would guess, in the automatic
  // trash purge: opening the session list runs purgeExpiredSessions, which
  // deletes the media attached to any session past its 30-day window, and by
  // "Delete Forever" in the trash, which calls the same purge directly. So simply
  // LEAVING this screen can delete photos out from under a running pack.
  // (GunDetail was named here for one round and does not belong: it only ADDS
  // media. Deleting from a gun screen happens in the PhotoSheet it renders,
  // which is already on the list. Third correction to one sentence.)
  // db.ts openMediaBytes handles the rest of that window: an edited photo yields
  // a point-in-time backup, a deleted one fails the save and says so.
  //
  // KNOWN AND NOT FIXED HERE, recorded so it is a decision rather than a
  // discovery: leaving this screen mid-pack lets the save finish into nothing.
  // The finished file is dropped and no message is shown, because this
  // component's state went with the screen. AND — the half that turns a silent
  // no-op into a dead end — the orphaned pack still holds the lock while it
  // runs, so coming back and tapping Save is refused with "Another change to
  // your data is still finishing" against a card that shows nothing happening.
  // Fixing it means owning the save above the screen, which is more than this
  // pass signed up for.
  //
  // TWO PHASES, TWO MESSAGES. The library is walked twice — once for the
  // descriptions, once for the bytes — so a single frozen "Packing your data…"
  // would sit unchanged through the whole first half, which is the exact
  // cannot-tell-it-from-hung problem the counter exists to remove.
  async function saveToFile() {
    setStage({ name: 'working', message: 'Reading your photos…' });
    try {
      const packed = await withExclusiveIo('the backup', async () => {
        const parts = await exportSnapshotSources();
        const photos = parts.media.length;
        setStage({ name: 'working', message: 'Packing your data…' });
        const blob = await buildFlogBlob({
          ...parts,
          onProgress: (done, total) => {
            // Only once photos start: data.json is entry zero and reports (0, N)
            // twice, and "Packing photos: 0 of 31" reads like a failure rather
            // than a start.
            if (total > 0 && done > 0) {
              setStage({ name: 'working', message: `Packing photos: ${done} of ${total}…` });
            }
          },
        });
        return { blob, sessions: (parts.stores.sessions ?? []).length, photos };
      });
      setStage({
        name: 'save-ready',
        blob: packed.blob,
        summary: `${packed.sessions} sessions and ${packed.photos} photos/videos, packed and ready.`
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
                <li>If it offers to <strong>Replace</strong> the one already there, take it. Often it
                  does not ask: it keeps the old file and adds a number, so you end up with
                  FirearmLog 2, FirearmLog 3 and so on. The newest is your backup — delete the older
                  ones when they start taking up room.</li>
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
                <li>If it offers to <strong>Replace</strong> the one already there, take it. Often it
                  does not ask: it keeps the old file and adds a number, so you end up with
                  FirearmLog 2, FirearmLog 3 and so on. The newest is your backup — delete the older
                  ones when they start taking up room.</li>
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
