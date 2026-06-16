// Name / annotate a photo or video BEFORE the session/match/classifier is saved.
// Saved photos use PhotoSheet (which writes straight to the database); a staged
// photo isn't in the database yet, so this edits the name + notes held in the
// form's draft, applied when the user saves. Shared by every form that stages
// media so the experience is identical (DRY).
import { useState } from 'react';
import { Sheet } from './Sheet.tsx';
import { noAutofillProps } from './SuggestField.tsx';

/** A picked-but-not-yet-saved file held in a form's draft state. */
export interface StagedFile {
  file: File;
  url: string;
  kind: 'image' | 'video';
  name?: string;
  notes?: string;
}

export function NewPhotoSheet({ file, onSave, onClose }: {
  file: StagedFile;
  onSave: (name: string, notes: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(file.name ?? '');
  const [notes, setNotes] = useState(file.notes ?? '');
  const label = file.kind === 'video' ? 'Video' : 'Photo';
  return (
    <Sheet title={label} onClose={onClose}>
      {file.kind === 'video'
        ? <video className="photo-full" src={file.url} controls playsInline preload="metadata" />
        : <img className="photo-full" src={file.url} alt={name || `New ${label.toLowerCase()}`} />}
      <label className="field">Name
        <input value={name} onChange={(e) => setName(e.target.value)}
          {...noAutofillProps} name="photo-title" />
      </label>
      <label className="field">Notes
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <button className="button" onClick={() => { onSave(name, notes); onClose(); }}>Done</button>
    </Sheet>
  );
}
