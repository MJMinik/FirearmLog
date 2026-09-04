// One shared "photos & videos" field for every form that attaches media
// (sessions, matches, classifiers). It owns the whole UI — the thumbnail grid
// (existing + just-picked), the add button, picking files, naming/annotating,
// and markup — so a photo feature is built ONCE here, not copied per form (DRY;
// this is the CR-11/CR-12 consolidation). The form keeps the draft state
// (existing/removed/new) because only the form knows when its record is saved,
// and calls commitMedia() at save time.
import { useEffect, useRef, useState } from 'react';
import type { Media } from '../lib/types.ts';
import { getMediaForOwner, putOne, deleteOne } from '../lib/db.ts';
import { MAX_MEDIA_BYTES, VIDEO_ASK_BYTES, humanBytes } from '../lib/inputLimits.ts';
import { classifyPickedFile, largeVideoSentence, stillName, DECODE_FAILURE_SENTENCE } from '../lib/videoGuard.ts';
import { stampNew } from '../lib/stamps.ts';
import { newId } from '../lib/id.ts';
import { prepareUploadBytes } from './shrinkImage.ts';
import { captureStill } from './videoStill.ts';
import { Icon } from './Icon.tsx';
import { MarkThumb } from './MarkThumb.tsx';
import { VideoFrame } from './VideoFrame.tsx';
import { mediaLabel } from './media.ts';
import { PhotoSheet } from './PhotoSheet.tsx';
import { Sheet } from './Sheet.tsx';
import { NewPhotoSheet } from './NewPhotoSheet.tsx';
import type { StagedFile } from './NewPhotoSheet.tsx';

/** The 100 MB ask line, overridable ONLY by an E2E fixture on a build compiled
 *  with __FL_E2E__ true (see vite.config.ts / playwright.config.ts) — a real
 *  production build drops this whole branch, proven by grepping the built
 *  bundle for the override's name. Real users always get VIDEO_ASK_BYTES. */
function videoAskBytes(): number {
  return (__FL_E2E__ && typeof window !== 'undefined'
    && (window as { __flVideoAskBytes?: number }).__flVideoAskBytes) || VIDEO_ASK_BYTES;
}

export type { StagedFile };

/**
 * Write a record's staged media changes. Call from the form's save(), AFTER the
 * record itself is saved (so `ownerId` exists). Deletes the staged removals,
 * then stores each new file (shrinking images, applying caption/notes/markup).
 */
export async function commitMedia(
  ownerType: Media['ownerType'],
  ownerId: string,
  newFiles: StagedFile[],
  removedMedia: string[],
  startSeq: number
): Promise<void> {
  for (const id of removedMedia) await deleteOne('media', id);
  const now = Date.now();
  let seq = startSeq;
  for (const nf of newFiles) {
    seq += 1;
    const { data, mime } = await prepareUploadBytes(nf.file);
    await putOne('media', stampNew({
      ownerType,
      ownerId,
      kind: nf.kind,
      name: nf.name?.trim() || `${nf.kind === 'video' ? 'Video' : 'Photo'} ${seq}`,
      annotations: nf.notes ? nf.notes.split('\n').map((s) => s.trim()).filter(Boolean) : [],
      marks: nf.marks ?? [],
      mime,
      data,
    }, newId('md'), now));
  }
}

export function MediaField({
  heading, addLabel, ownerType, ownerId,
  existingMedia, setExistingMedia, removedMedia, setRemovedMedia, newFiles, setNewFiles,
}: {
  heading: string;
  addLabel: string;
  ownerType: Media['ownerType'];
  ownerId: string;
  existingMedia: Media[];
  setExistingMedia: (m: Media[]) => void;
  removedMedia: string[];
  setRemovedMedia: (fn: (prev: string[]) => string[]) => void;
  newFiles: StagedFile[];
  setNewFiles: (fn: (prev: StagedFile[]) => StagedFile[]) => void;
}) {
  const [viewing, setViewing] = useState<Media | null>(null);
  /* P-3 (Reports-media diagnosis memo, 2026-08-24; fixed session 138): staged
     preview URLs were never revoked — not on remove, not on save, not on
     cancel. The ref mirrors the live list so the unmount cleanup (which runs
     once, whatever route closed the form) frees whatever is still staged;
     the remove button frees its own URL immediately. Revoking a preview URL
     never touches the picked file's bytes — saving reads the File, not the URL. */
  const stagedUrlsRef = useRef<string[]>([]);
  stagedUrlsRef.current = newFiles.map((nf) => nf.url);
  useEffect(() => () => { stagedUrlsRef.current.forEach((u) => URL.revokeObjectURL(u)); }, []);
  const [editingNew, setEditingNew] = useState<number | null>(null);
  const [tooBig, setTooBig] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const visible = existingMedia.filter((m) => !removedMedia.includes(m.id));

  // Capture-time large-video choice (spec §3.1). A queue, not a single slot:
  // several large videos picked at once are asked about one at a time — the
  // FIRST entry is what the sheet below shows, and every handler acts on it.
  //
  // Each entry carries a monotonic `id` (cold audit F1/F8, session 141 fix
  // pass 1), assigned once at the moment a file joins the queue. Two things
  // need it: keepStill's async continuation has to know whether it's still
  // running for the item that's actually showing when it finishes (F1 —
  // File identity alone was already unique per pick, but the id is what lets
  // the Sheet below remount cleanly too), and the Sheet's own `key` (F8) —
  // name+size can't tell two identical picks apart, but the id always can.
  interface QueuedAsk { file: File; id: number }
  const askIdRef = useRef(0);
  const [askQueue, setAskQueue] = useState<QueuedAsk[]>([]);
  const [decodeFailed, setDecodeFailed] = useState(false);
  const [capturingStill, setCapturingStill] = useState(false);
  const currentAsk = askQueue[0] ?? null;
  // Mirrors askQueue for the async continuation in keepStill to read the
  // LATEST head against, not the stale one closed over when it started —
  // same direct-during-render mirroring stagedUrlsRef above already uses.
  const askQueueRef = useRef<QueuedAsk[]>(askQueue);
  askQueueRef.current = askQueue;

  function filesPicked(list: FileList | null): void {
    if (!list) return;
    // Read eagerly — the onChange clears the input right after, emptying the
    // live FileList; building this inside a setState updater would lose it.
    // S-2: refuse an outsized single file before it's read into memory (photos
    // are shrunk and videos stored as-is, so one giant file can crash the tab).
    // Guard at the pick; keep everything else the user chose.
    const files = Array.from(list);
    const ok = files.filter((file) => file.size <= MAX_MEDIA_BYTES);
    const rejected = files.length - ok.length;
    // Split what's left FIRST: a video over the ask line joins the queue (a
    // sheet asks about it below); everything else — photos and smaller
    // videos — stages immediately, exactly as before. tooBig's own wording
    // (right below) needs to know whether anything is joining the queue.
    const askBytes = videoAskBytes();
    const toStage: File[] = [];
    const toAsk: File[] = [];
    for (const file of ok) {
      const isVideo = file.type.startsWith('video');
      const verdict = classifyPickedFile({ size: file.size, isVideo }, { askBytes, maxBytes: MAX_MEDIA_BYTES });
      (verdict === 'ask' ? toAsk : toStage).push(file);
    }
    // F10 (cold audit, session 141 fix pass 1): "anything else you picked
    // was added" was no longer exactly true once a large video can join the
    // queue instead of being added outright — say so only when that's
    // actually what happened this pick.
    // V5 (cold audit, session 141 fix pass 2): the em dash joining the two
    // clauses read as a comma splice, and "asked about below" pointed at the
    // Large-video sheet — which is a MODAL that covers this note the moment
    // it opens, so "below" named a place the shooter couldn't see. Two
    // sentences now, and "asked about now" instead of a location.
    setTooBig(rejected > 0
      ? `${rejected} file${rejected > 1 ? 's were' : ' was'} too large to add (over ${humanBytes(MAX_MEDIA_BYTES)} each). `
        + (toAsk.length > 0
          ? 'Anything else you picked was added, or is being asked about now.'
          : 'Anything else you picked was added.')
      : '');
    const added: StagedFile[] = toStage.map((file) => ({
      file,
      url: URL.createObjectURL(file),
      kind: file.type.startsWith('video') ? 'video' as const : 'image' as const,
    }));
    if (added.length) setNewFiles((prev) => [...prev, ...added]);
    if (toAsk.length) {
      setAskQueue((prev) => [...prev, ...toAsk.map((file) => ({ file, id: ++askIdRef.current }))]);
    }
  }

  /** Move past the video currently being asked about, without staging it —
   *  used both after a choice is made and when the sheet is dismissed
   *  (X / backdrop / Escape all count as "don't add this one"). */
  function advanceAskQueue(): void {
    setDecodeFailed(false);
    setAskQueue((prev) => prev.slice(1));
  }

  function keepVideo(): void {
    if (!currentAsk || capturingStill) return;
    const { file } = currentAsk;
    setNewFiles((prev) => [...prev, { file, url: URL.createObjectURL(file), kind: 'video' as const }]);
    advanceAskQueue();
  }

  async function keepStill(): Promise<void> {
    if (!currentAsk || capturingStill) return;
    // Captured once, up front — this is the SPECIFIC item this capture is
    // for, and everything below checks against it rather than against
    // whatever `currentAsk` happens to be when the promise settles.
    const ask = currentAsk;
    setCapturingStill(true);
    try {
      const blob = await captureStill(ask.file);
      // STALE GUARD (cold audit F1, session 141 fix pass 1). While this was
      // in flight the queue could have moved on — the file was force-closed
      // out from under it, or (belt and braces alongside the sheet now being
      // non-dismissable while capturing, below) some future path reorders
      // the queue. If the head is no longer THIS ask, the item this capture
      // was for is no longer what's showing: don't stage it, don't advance
      // past whatever IS showing, and don't flag decode failure against the
      // wrong item. Nothing was ever built for it (File/URL come after this
      // check), so there is nothing to revoke here.
      if (askQueueRef.current[0]?.id !== ask.id) return;
      const name = stillName(ask.file.name);
      const stillFile = new File([blob], name, { type: blob.type || 'image/jpeg' });
      setNewFiles((prev) => [...prev, {
        file: stillFile,
        url: URL.createObjectURL(stillFile),
        kind: 'image' as const,
        name,
      }]);
      advanceAskQueue();
    } catch {
      // Same stale guard on the failure path — a decode failure for an item
      // the shooter already moved past must not surface as a failure on
      // whatever they're looking at now.
      if (askQueueRef.current[0]?.id !== ask.id) return;
      // Decode error or the ~15s timeout inside captureStill — the sheet
      // switches to the decode-failure copy with only Keep the video left.
      setDecodeFailed(true);
    } finally {
      setCapturingStill(false);
    }
  }

  async function reloadExisting(): Promise<void> {
    setExistingMedia(await getMediaForOwner(ownerType, ownerId));
  }

  return (
    <div className="card">
      <h2>{heading}</h2>
      {(visible.length > 0 || newFiles.length > 0) && (
        <div className="photo-grid" style={{ marginBottom: 12 }}>
          {visible.map((m) => (
            <div className="thumb-wrap" key={m.id}>
              <button className="thumb-tap" onClick={() => setViewing(m)} aria-label={`Open ${mediaLabel(m)}`}>
                <MarkThumb media={m} />
              </button>
              <button className="thumb-x" aria-label={`Remove ${m.name}`}
                onClick={() => setRemovedMedia((p) => [...p, m.id])}><Icon name="close" size={16} /></button>
              <span className="thumb-caption">{m.name}</span>
            </div>
          ))}
          {newFiles.map((nf, i) => (
            <div className="thumb-wrap" key={nf.url}>
              <button className="thumb-tap" onClick={() => setEditingNew(i)} aria-label={`Name this new ${nf.kind === 'video' ? 'video' : 'photo'}`}>
                {nf.kind === 'video'
                  ? <VideoFrame src={nf.url} showBadge label={nf.name} />
                  : <img src={nf.url} alt="New photo" />}
              </button>
              <button className="thumb-x" aria-label="Remove new file"
                onClick={() => { URL.revokeObjectURL(nf.url); setNewFiles((p) => p.filter((_, x) => x !== i)); }}><Icon name="close" size={16} /></button>
              <span className="thumb-caption">{nf.name || 'Tap to name'}</span>
            </div>
          ))}
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
        onChange={(e) => { filesPicked(e.target.files); e.target.value = ''; }} />
      <button className="button secondary" onClick={() => fileRef.current?.click()}>{addLabel}</button>
      {tooBig && <p className="report-note" style={{ color: 'var(--danger)' }}>{tooBig}</p>}
      <p className="report-note">Removals only happen when you Save — Cancel really cancels.</p>
      {viewing && (
        <PhotoSheet media={viewing} allowDelete={false} onClose={() => setViewing(null)}
          onChanged={() => void reloadExisting()} />
      )}
      {editingNew !== null && newFiles[editingNew] && (
        <NewPhotoSheet
          file={newFiles[editingNew]}
          onSave={(nm, nt, mk) => setNewFiles((p) => p.map((f, x) => (x === editingNew ? { ...f, name: nm, notes: nt, marks: mk } : f)))}
          onClose={() => setEditingNew(null)}
        />
      )}
      {/* Capture-time large-video choice (spec §3.1). Closing this sheet any
          way (X, backdrop, Escape) is dirty={false} by default, so it closes
          instantly and adds nothing — exactly like cancelling the file picker;
          nothing was ever staged, so nothing is lost.
          F1 (cold audit, session 141 fix pass 1): EXCEPT while a still is
          being captured — onClose no-ops then, so the shooter can't half
          -cancel out from under an in-flight capture (belt and braces
          alongside keepStill's own stale guard above).
          F8: keyed on the ask's id, not name+size (two identical picks would
          share those), so each question mounts fresh — a screen reader
          announces it as new, and focus lands on it rather than carrying
          over stale state from the last one. */}
      {currentAsk && (
        <Sheet
          key={currentAsk.id}
          title="Large video"
          onClose={() => { if (!capturingStill) advanceAskQueue(); }}
        >
          <p className="report-note" style={{ marginBottom: 14 }}>
            {decodeFailed
              ? `${largeVideoSentence(currentAsk.file.size, MAX_MEDIA_BYTES)} ${DECODE_FAILURE_SENTENCE}`
              : largeVideoSentence(currentAsk.file.size, MAX_MEDIA_BYTES)}
          </p>
          {/* F4 (cold audit, session 141 fix pass 1): aria-disabled, not the
              native `disabled` attribute — a natively disabled button drops
              out of the tab order and can throw focus to BODY, which is
              exactly wrong on a dialog that's meant to keep focus trapped
              inside it while it's busy. Both buttons stay focusable; each
              handler just early-returns while capturing. V2 (cold audit, fix
              pass 2): aria-disabled carries none of :disabled's own
              unavailable styling for free — app.css now gives it the same
              opacity/cursor treatment. */}
          <button className="button" aria-disabled={capturingStill || undefined} onClick={keepVideo}>
            Keep the video
          </button>
          {!decodeFailed && (
            <>
              <div style={{ height: 8 }} />
              {/* V3 (cold audit, session 141 fix pass 2): the label used to
                  switch to "Making the still…" too, so the sentence appeared
                  TWICE (button + the live region below) — kept static here so
                  it appears exactly once. */}
              <button
                className="button secondary"
                aria-disabled={capturingStill || undefined}
                onClick={() => void keepStill()}
              >
                Keep a still instead
              </button>
            </>
          )}
          {/* V3: mounted permanently (empty when idle), not conditionally —
              a live region inserted already populated is commonly not
              announced by screen readers, since there is no prior "before"
              state for the mutation observer to diff against. Present from
              the sheet's first render, its text changes when capture starts,
              which IS a mutation and so IS announced. */}
          <p className="report-note" aria-live="polite" style={{ marginTop: 8 }}>
            {capturingStill ? 'Making the still…' : ''}
          </p>
        </Sheet>
      )}
    </div>
  );
}
