// One video element for the whole app — and one that is guaranteed to SHOW
// something.
//
// THE DEFECT THIS EXISTS TO FIX (session 101, reported by Michael in Safari):
// every video in the app was drawn as a bare `<video preload="metadata">`.
// "preload=metadata" asks the browser only for duration and dimensions; the
// HTML standard does not require it to paint any frame, and Safari paints
// none. The result was a correctly sized, correctly captioned, completely
// empty box wherever a video appeared — a stage video looked identical to a
// video that had failed to save.
//
// SEEKING is specified where the initial paint is not: once a seek completes,
// the frame at that position is what the element displays. So as soon as
// metadata arrives we seek a tenth of a second in, which forces a real frame
// to be decoded and painted in every browser, deliberately rather than by
// luck. Nothing is stored and nothing is migrated — the frame is derived from
// the bytes we already hold.
//
// Deliberately NOT the `#t=0.1` media-fragment trick: that leans on the same
// class of unpromised browser behaviour that produced the bug.
import { useRef, useState } from 'react';
import { Icon } from './Icon.tsx';

/** Where to land the seek. A tenth of a second is past a black opening frame
 *  on most clips while staying inside even a very short one. */
const FRAME_AT = 0.1;

export function VideoFrame({
  src, className, controls = false, muted = true, showBadge = false, label,
}: {
  src: string;
  className?: string;
  /** Play/scrub controls. On for the views a shooter actually watches. */
  controls?: boolean;
  /** Muted by default so a preview can never make noise; the lightbox unmutes. */
  muted?: boolean;
  /** Corner play glyph, so a video tile is not mistaken for a photo. */
  showBadge?: boolean;
  label?: string;
}) {
  const [failed, setFailed] = useState(false);
  // The position OUR frame-forcing seek asked for, on a surface with controls,
  // while that seek is still in flight — null the rest of the time. It holds
  // the TARGET rather than a bare "a rewind is owed" flag on purpose: if the
  // shooter drags the scrubber while our seek is in flight, HIS seek is what
  // completes, and a bare flag would consume that event and throw him back to
  // the start of his own run. Comparing positions means we only ever undo the
  // seek we ourselves asked for.
  const rewindFrom = useRef<number | null>(null);

  function toFirstFrame(el: HTMLVideoElement): void {
    // Deliberately NOT a seek-once flag. iOS can reclaim a media resource and
    // reload it, which re-fires loadedmetadata at zero — a once-only guard
    // would leave the tile blank for the rest of the session. Re-arming is
    // safe because the two conditions below mean we only ever touch a video
    // nobody is using: paused, and still at the very start.
    if (!el.paused || el.currentTime > 0) return;
    const d = el.duration;
    const target = Number.isFinite(d) && d > 0 ? Math.min(FRAME_AT, d / 2) : FRAME_AT;
    // On a surface the shooter WATCHES, the seek is only there to force a
    // frame — playback must still start at zero, or the first tenth of a
    // second of his match run (picture and sound) silently disappears. So we
    // rewind as soon as the frame has landed. The frame stays painted: by
    // then it is decoded, so the browser can draw position zero too.
    rewindFrom.current = controls ? target : null;
    try {
      el.currentTime = target;
    } catch {
      // A stream that refuses to seek keeps whatever the browser painted;
      // nothing else in the tile depends on this having worked.
      rewindFrom.current = null;
    }
  }

  function afterSeek(el: HTMLVideoElement): void {
    const target = rewindFrom.current;
    if (target === null) return;
    // Only OUR seek. A scrub that lands first leaves the flag armed for the
    // one we asked for, which either arrives next or never does.
    if (Math.abs(el.currentTime - target) > 0.01) return;
    rewindFrom.current = null;
    // If he pressed play inside the round trip, leave him alone: he is
    // watching, and starting a tenth of a second in is a far smaller
    // intrusion than snatching the playhead out from under him.
    if (!el.paused || el.currentTime === 0) return;
    try {
      el.currentTime = 0;
    } catch {
      // Leave it where it is — a tenth of a second in is a far smaller
      // problem than an unplayable video, and the controls still work.
    }
  }

  if (failed) {
    // Say it plainly rather than leaving an unexplained blank — and this is
    // also the diagnostic: an empty tile now means "cannot decode this file",
    // not "cannot be bothered to paint it".
    return (
      <span className={`video-unavailable${className ? ` ${className}` : ''}`} role="img"
        aria-label={label ? `${label} — video preview unavailable` : 'Video preview unavailable'}>
        <Icon name="malfunction" size={20} />
        <span className="video-unavailable-text">Preview unavailable</span>
      </span>
    );
  }

  const video = (
    <video
      className={className}
      src={src}
      preload="metadata"
      playsInline
      muted={muted}
      controls={controls}
      onLoadedMetadata={(e) => toFirstFrame(e.currentTarget)}
      onSeeked={(e) => afterSeek(e.currentTarget)}
      onError={() => setFailed(true)}
    />
  );

  if (!showBadge) return video;
  return (
    <span className="video-badge-wrap">
      {video}
      <span className="video-badge" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14" focusable="false"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
      </span>
    </span>
  );
}
