// Tap any photo/video to see it big, rename it, jot notes on it, or delete it
// (req. 29: every image is namable and annotatable).
import { useState } from 'react';
import type { Media } from '../lib/types.ts';
import { deleteOne, putOne } from '../lib/db.ts';
import { stampUpdate } from '../lib/stamps.ts';
import { mediaUrl } from './media.ts';
import { noAutofillProps } from './SuggestField.tsx';
import { Sheet, ConfirmSheet } from './Sheet.tsx';

export function PhotoSheet({ media, onClose, onChanged, allowDelete = true }: {
  media: Media;
  onClose: () => void;
  /** Called after a save or delete; `deletedId` is set when the photo was removed. */
  onChanged: (deletedId?: string) => void;
  allowDelete?: boolean;
}) {
  const [name, setName] = useState(media.name);
  const [annotations, setAnnotations] = useState(media.annotations.join('\n'));
  const [confirming, setConfirming] = useState(false);

  async function save() {
    const updated = stampUpdate({
      ...media,
      name: name.trim() || media.name,
      annotations: annotations.split('\n').map((a) => a.trim()).filter(Boolean)
    }, Date.now());
    await putOne('media', updated);
    onChanged();
    onClose();
  }

  async function reallyDelete() {
    await deleteOne('media', media.id);
    onChanged(media.id);
    onClose();
  }

  return (
    <Sheet title={media.kind === 'video' ? 'Video' : 'Photo'} onClose={onClose}>
      {media.kind === 'video' ? (
        <video className="photo-full" src={mediaUrl(media)} controls playsInline preload="metadata" />
      ) : (
        <img className="photo-full" src={mediaUrl(media)} alt={media.name} />
      )}
      <label className="field">Name
        <input value={name} onChange={(e) => setName(e.target.value)}
          {...noAutofillProps} name="photo-title" />
      </label>
      <label className="field">Notes
        <textarea rows={3} value={annotations} onChange={(e) => setAnnotations(e.target.value)} />
      </label>
      <button className="button" onClick={() => void save()}>Save</button>
      {allowDelete && (
        <>
          <div style={{ height: 8 }} />
          <button className="button danger" onClick={() => setConfirming(true)}>
            Delete {media.kind === 'video' ? 'Video' : 'Photo'}
          </button>
        </>
      )}
      {confirming && (
        <ConfirmSheet
          title={`Delete this ${media.kind}?`}
          message="It comes off this record for good. There's no undo."
          confirmLabel="Delete"
          onConfirm={() => void reallyDelete()}
          onClose={() => setConfirming(false)}
        />
      )}
    </Sheet>
  );
}
