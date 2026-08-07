// One shared "photos & videos" field for every form that attaches media
// (sessions, matches, classifiers). It owns the whole UI — the thumbnail grid
// (existing + just-picked), the add button, picking files, naming/annotating,
// and markup — so a photo feature is built ONCE here, not copied per form (DRY;
// this is the CR-11/CR-12 consolidation). The form keeps the draft state
// (existing/removed/new) because only the form knows when its record is saved,
// and calls commitMedia() at save time.
import { useRef, useState } from 'react';
import type { Media } from '../lib/types.ts';
import { getMediaForOwner, putOne, deleteOne } from '../lib/db.ts';
import { MAX_MEDIA_BYTES, humanBytes } from '../lib/inputLimits.ts';
import { stampNew } from '../lib/stamps.ts';
import { newId } from '../lib/id.ts';
import { prepareUploadBytes } from './shrinkImage.ts';
import { Icon } from './Icon.tsx';
import { MarkThumb } from './MarkThumb.tsx';
import { VideoFrame } from './VideoFrame.tsx';
import { mediaLabel } from './media.ts';
import { PhotoSheet } from './PhotoSheet.tsx';
import { NewPhotoSheet } from './NewPhotoSheet.tsx';
import type { StagedFile } from './NewPhotoSheet.tsx';

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
  const [editingNew, setEditingNew] = useState<number | null>(null);
  const [tooBig, setTooBig] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const visible = existingMedia.filter((m) => !removedMedia.includes(m.id));

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
    setTooBig(rejected > 0
      ? `${rejected} file${rejected > 1 ? 's were' : ' was'} too large to add (over ${humanBytes(MAX_MEDIA_BYTES)} each) — anything else you picked was added.`
      : '');
    const added: StagedFile[] = ok.map((file) => ({
      file,
      url: URL.createObjectURL(file),
      kind: file.type.startsWith('video') ? 'video' as const : 'image' as const,
    }));
    if (added.length) setNewFiles((prev) => [...prev, ...added]);
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
                onClick={() => setNewFiles((p) => p.filter((_, x) => x !== i))}><Icon name="close" size={16} /></button>
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
    </div>
  );
}
