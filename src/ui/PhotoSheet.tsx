// Tap any photo/video to see it big, rename it, jot notes on it, or delete it
// (req. 29: every image is namable and annotatable).
import { useEffect, useRef, useState } from 'react';
import type { Media, Mark } from '../lib/types.ts';
import { deleteOne, putOne } from '../lib/db.ts';
import { stampUpdate } from '../lib/stamps.ts';
import { mediaUrl } from './media.ts';
import { noAutofillProps } from './SuggestField.tsx';
import { Sheet, ConfirmSheet, pushSheetToken, popSheetToken, isTopmost } from './Sheet.tsx';
import { useDirtyTracker } from './useDirtyTracker.ts';
import { Icon } from './Icon.tsx';
import { PhotoMarkup } from './PhotoMarkup.tsx';
import { MarkedImage } from './MarkedImage.tsx';
import { VideoFrame } from './VideoFrame.tsx';

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
  const [marks, setMarks] = useState<Mark[]>(media.marks ?? []);
  const [marking, setMarking] = useState(false);
  // F-Universal-Guard: sheet dismiss gestures ask "Discard changes?" when dirty.
  const dirty = useDirtyTracker({ name, annotations, marks });
  // Feature 2 (photo lightbox): tap the image to open a full-screen viewer.
  // The marks stay overlaid at full size (MarkedImage handles positions in %),
  // so labels line up on the enlarged photo too. Videos also open full-screen.
  const [lightbox, setLightbox] = useState(false);
  const url = mediaUrl(media);

  async function save() {
    const updated = stampUpdate({
      ...media,
      name: name.trim() || media.name,
      annotations: annotations.split('\n').map((a) => a.trim()).filter(Boolean),
      marks
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

  // Save-from-guard: photo/video edits have no required fields — any dirty
  // state is always valid to save. Pass the saver unconditionally when dirty.
  const onSaveRequest = dirty ? () => void save() : undefined;

  return (
    <Sheet title={media.kind === 'video' ? 'Video' : 'Photo'} onClose={onClose} dirty={dirty}
      onSaveRequest={onSaveRequest}>
      {media.kind === 'video' ? (
        // Tap the video preview to open the full-screen lightbox (the sheet's
        // preview caps at 45dvh, which is small on a phone — the lightbox is
        // the actual look-at-it view).
        <button type="button" className="photo-fullscreen-btn" aria-label="Open video full screen"
          onClick={() => setLightbox(true)}>
          <VideoFrame className="photo-full" src={url} label={media.name} />
        </button>
      ) : (
        <button type="button" className="photo-fullscreen-btn" aria-label="Open photo full screen"
          onClick={() => setLightbox(true)}>
          <MarkedImage url={url} alt={media.name} marks={marks} />
        </button>
      )}
      {media.kind === 'image' && (
        <button className="button secondary" style={{ marginTop: 8 }} onClick={() => setMarking(true)}>
          {marks.length ? 'Edit Markup' : 'Mark Up Photo'}
        </button>
      )}
      <label className="field">Caption
        <input value={name} onChange={(e) => setName(e.target.value)}
          {...noAutofillProps} name="flog-photo" />
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
      {marking && (
        <PhotoMarkup url={url} initial={marks} onSave={setMarks} onClose={() => setMarking(false)} />
      )}
      {lightbox && (
        <PhotoLightbox url={url} kind={media.kind} alt={media.name} marks={marks}
          onClose={() => setLightbox(false)} />
      )}
    </Sheet>
  );
}

// Feature 2 (photo lightbox, July 20 2026): a dependency-free full-screen viewer
// that sits above the sheet (z-index above sheet-backdrop). Tap anywhere on the
// image/video area OR the X to close. For images, MarkedImage draws the same
// numbered circles at full size (positions are in %, so they scale). For videos,
// controls are shown — iOS Safari blocks unmuted autoplay anyway (HIG treats
// media playback as user-initiated), so the shooter taps play. Respects safe
// areas (env(safe-area-inset-*)) so the X stays reachable under an iPhone notch.
//
// AUDIT FIXES (July 20 2026):
//   3) FOCUS handling — on open, focus moves to the close button; Tab / Shift-
//      Tab cycle inside the lightbox only (mirror the Sheet.tsx focus trap);
//      on close, focus restores to the trigger.
//   4) ESC ordering — the lightbox registers on the shared sheetStack (see
//      Sheet.tsx), so its keydown ignores Esc unless it is TOP-most. That
//      replaces the older capture-phase + stopPropagation approach (which was
//      order-of-listener fragile) with a genuine stack.
function PhotoLightbox({ url, kind, alt, marks, onClose }: {
  url: string; kind: 'image' | 'video'; alt: string; marks: Mark[]; onClose: () => void;
}) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Take a spot on the shared modal stack so this overlay — while open — is
    // the topmost thing the app knows about. The Sheet beneath us also listens
    // for Esc on window, but its handler bails out unless IT is on top, so Esc
    // reaches us here first.
    const token = pushSheetToken();
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Move focus onto the close button — a keyboard user should be able to
    // dismiss without having to Tab first.
    closeBtnRef.current?.focus();
    const focusables = (): HTMLElement[] => {
      const el = stageRef.current?.parentElement;
      if (!el) return [];
      return Array.from(
        el.querySelectorAll<HTMLElement>(
          'a[href], button, input, select, textarea, video[controls], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((n) => !n.hasAttribute('disabled'));
    };
    const h = (e: KeyboardEvent) => {
      if (!isTopmost(token)) return; // only the top-most overlay handles the key
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', h);
    return () => {
      window.removeEventListener('keydown', h);
      popSheetToken(token);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="lightbox-backdrop" role="dialog" aria-modal="true" aria-label={alt}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <button ref={closeBtnRef} className="lightbox-close" aria-label="Close full-screen view" onClick={onClose}>
        <Icon name="close" size={24} />
      </button>
      <div ref={stageRef} className="lightbox-stage" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {kind === 'video' ? (
          // AUDIT FIX #5: no autoPlay — iOS Safari blocks unmuted autoplay
          // anyway, and HIG treats media playback as user-initiated. The
          // controls are present; the shooter taps play.
          <VideoFrame className="lightbox-media" src={url} controls muted={false} label={alt} />
        ) : (
          // MarkedImage keeps its markup-canvas wrapper; the .lightbox-image-wrap
          // class swaps in the fullscreen sizing (max-height: 100dvh).
          <div className="lightbox-media lightbox-image-wrap">
            <MarkedImage url={url} alt={alt} marks={marks} />
          </div>
        )}
      </div>
    </div>
  );
}
