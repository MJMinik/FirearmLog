// Name / annotate a photo or video BEFORE the session/match/classifier is saved.
// Saved photos use PhotoSheet (which writes straight to the database); a staged
// photo isn't in the database yet, so this edits the name + notes held in the
// form's draft, applied when the user saves. Shared by every form that stages
// media so the experience is identical (DRY).
import { useState } from 'react';
import { Sheet } from './Sheet.tsx';
import { useDirtyTracker } from './useDirtyTracker.ts';
import { noAutofillProps } from './SuggestField.tsx';
import { PhotoMarkup } from './PhotoMarkup.tsx';
import { MarkedImage } from './MarkedImage.tsx';
import type { Mark } from '../lib/types.ts';

/** A picked-but-not-yet-saved file held in a form's draft state. */
export interface StagedFile {
  file: File;
  url: string;
  kind: 'image' | 'video';
  name?: string;
  notes?: string;
  marks?: Mark[];
}

export function NewPhotoSheet({ file, onSave, onClose }: {
  file: StagedFile;
  onSave: (name: string, notes: string, marks: Mark[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(file.name ?? '');
  const [notes, setNotes] = useState(file.notes ?? '');
  const [marks, setMarks] = useState<Mark[]>(file.marks ?? []);
  const [marking, setMarking] = useState(false);
  // F-Universal-Guard: sheet dismiss gestures ask "Discard changes?" when the
  // caption/notes/marks have moved off the file's starting draft.
  const dirty = useDirtyTracker({ name, notes, marks });
  const label = file.kind === 'video' ? 'Video' : 'Photo';
  // Save-from-guard: caption and notes are optional — any dirty state is always
  // valid to save (Done just commits the current draft values). Pass
  // onSaveRequest unconditionally when dirty so the discard sheet shows Save.
  const onSaveRequest = dirty ? () => { onSave(name, notes, marks); onClose(); } : undefined;
  return (
    <Sheet title={label} onClose={onClose} dirty={dirty} onSaveRequest={onSaveRequest}>
      {file.kind === 'video'
        ? <video className="photo-full" src={file.url} controls playsInline preload="metadata" />
        : <MarkedImage url={file.url} alt={name || `New ${label.toLowerCase()}`} marks={marks} />}
      {file.kind === 'image' && (
        <button className="button secondary" style={{ marginTop: 8 }} onClick={() => setMarking(true)}>
          {marks.length ? 'Edit Markup' : 'Mark Up Photo'}
        </button>
      )}
      <label className="field">Caption
        <input value={name} onChange={(e) => setName(e.target.value)}
          {...noAutofillProps} name="photo-title" />
      </label>
      <label className="field">Notes
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <button className="button" onClick={() => { onSave(name, notes, marks); onClose(); }}>Done</button>
      {marking && (
        <PhotoMarkup url={file.url} initial={marks} onSave={setMarks} onClose={() => setMarking(false)} />
      )}
    </Sheet>
  );
}
