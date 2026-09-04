// Capture-time choice, still-frame side (spec §3.1). Browser-only (video +
// canvas), so this lives in the UI layer — the Node test runner has no DOM.
// Reuses the same sizing math photos use (src/lib/imageResize.ts) so a kept
// still costs no more storage than any other photo.
import { fitWithin, PHOTO_MAX_EDGE, PHOTO_QUALITY } from '../lib/imageResize.ts';

/** ~15 s: long enough for a real device to decode and seek a video file, short
 *  enough that a shooter waiting on the sheet isn't left staring at nothing. */
const CAPTURE_TIMEOUT_MS = 15_000;

/** How long to wait for `seeked` after asking for one before giving up on it
 *  and drawing whatever frame is already decoded instead. Only matters on the
 *  non-finite-duration path (below) — a normal file's seek settles in a few
 *  tens of milliseconds, nowhere near this. */
const SEEK_FALLBACK_MS = 1500;

/** W1 (cold audit, session 141 fix pass 3): how long to wait between a
 *  black-sample retry and the next drawImage attempt, and how many such
 *  retries to allow before giving up and accepting whatever's on the canvas
 *  — see isAllBlack() and its call site in draw(). 8 retries at 60ms is a
 *  worst case of ~0.5s, which is what a genuinely black source frame (a
 *  video that fades in from black) costs; nothing is ever refused over it. */
const BLACK_RETRY_MS = 60;
const MAX_BLACK_RETRIES = 8;

/** W1: is a just-drawn canvas suspiciously all-black? Sampled cheaply — a
 *  16x16 scratch copy, not the full-size frame — because this runs inside a
 *  retry loop that may fire several times per capture. `> 8` per channel
 *  (not `> 0`) so ordinary compression noise in a genuinely near-black frame
 *  doesn't read as "still not painted" forever. The same 16x16 / `> 8`
 *  sample is what the pre-ship concurrency measurement used (32 captures at
 *  once, 640 total: 0 black with this check, 6 without — the numbers are in
 *  the commit message), so the threshold that was measured clean is the
 *  threshold that ships. e2e/video-guards.spec.ts test (12) forces three
 *  black draws deterministically and proves the retry rescues the still. */
function isAllBlack(source: HTMLCanvasElement): boolean {
  const sample = document.createElement('canvas');
  sample.width = 16;
  sample.height = 16;
  const sctx = sample.getContext('2d');
  if (!sctx) return false; // can't sample — don't block the capture over it
  sctx.drawImage(source, 0, 0, 16, 16);
  const data = sctx.getImageData(0, 0, 16, 16).data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 8 || data[i + 1] > 8 || data[i + 2] > 8) return false;
  }
  return true;
}

/**
 * Draw one frame of a video file to a JPEG blob, sized like a stored photo.
 *
 * With a normal, finite duration: seeks to one second in, or half the
 * duration when the clip is a second or shorter (so the seek always lands
 * inside a very short clip rather than at or past its end), and draws once
 * `seeked` fires.
 *
 * FIX (cold audit F2, session 141 fix pass 1): a video whose `duration` is
 * non-finite — Chrome's `MediaRecorder` output reports `Infinity` until a
 * later fix-up runs — used to fall through to `duration = 0`, which read as
 * "nothing to seek to" and drew immediately at `loadedmetadata`. But
 * `loadedmetadata` promises only metadata, not a decoded frame — the HTML
 * spec does not require `readyState` to have reached `HAVE_CURRENT_DATA`
 * yet — so that draw silently produced an all-black JPEG. Now: a non-finite
 * or zero duration waits for `loadeddata` (which DOES guarantee a decoded
 * frame) before doing anything, then still attempts a blind seek to one
 * second — many such recordings seek fine despite the bad duration — and
 * falls back to drawing the already-decoded frame if `seeked` doesn't
 * arrive within `SEEK_FALLBACK_MS`. `draw()` itself is the backstop: it
 * refuses to run at all below `HAVE_CURRENT_DATA`, on every path.
 *
 * FIX (cold audit W1, session 141 fix pass 3): `HAVE_CURRENT_DATA` is not
 * enough, on its own, to rule out an all-black draw — under decoder
 * contention (several captures running at once, or a loaded phone) `seeked`
 * can fire, and `readyState` can read 2+, before the frame the decoder just
 * landed on has actually been PAINTED into the video element's own buffer.
 * `drawImage` at that instant faithfully copies an empty buffer: readyState
 * was never wrong, the frame just wasn't there yet. Measured in the
 * session-141 cold audit (numbers also in this file's commit message and the
 * build journal) at 16-way concurrency: desktop 8/80 black, mobile 12/80 — and
 * concurrency 1 was clean (0/4), which is why F2's per-instance guard never
 * caught it. `requestVideoFrameCallback` does not help here either — on a
 * paused, just-seeked video in Chromium it does not fire at all. The fix
 * that measured clean (0/160 under the same load, see the commit message
 * for the exact before/after numbers): after drawing, cheaply SAMPLE what
 * was actually drawn (isAllBlack, above) — if it reads as black and fewer
 * than MAX_BLACK_RETRIES attempts have run, redraw shortly and check again,
 * rather than trusting readyState alone.
 *
 * Rejects if the browser can't decode the file, or after about 15 seconds —
 * the sheet in MediaField.tsx turns either into the decode-failure copy.
 */
export function captureStill(file: File | Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    let settled = false;
    let seekAttempted = false;
    let seekFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    // W1 (cold audit, session 141 fix pass 3): counts black-sample retries
    // within THIS capture's draw() — see isAllBlack() above.
    let blackRetries = 0;

    const timer = setTimeout(() => fail(new Error('Timed out reading this video.')), CAPTURE_TIMEOUT_MS);

    function clearSeekFallback(): void {
      if (seekFallbackTimer !== null) { clearTimeout(seekFallbackTimer); seekFallbackTimer = null; }
    }
    function cleanup(): void {
      clearTimeout(timer);
      clearSeekFallback();
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      // F9 (cold audit, session 141 fix pass 1): detach the decoder rather
      // than just dropping our references to the element. Without this, a
      // video element whose src is never cleared can keep its decoder (and
      // the underlying blob) alive until GC gets around to it — on a phone,
      // several large videos capturing in a row could hold more decoders
      // open at once than the browser is happy with.
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    }
    function fail(e: unknown): void {
      if (settled) return;
      settled = true;
      cleanup();
      reject(e instanceof Error ? e : new Error('This video could not be read.'));
    }
    function draw(): void {
      if (settled) return;
      // Never draw before a frame actually exists. HAVE_CURRENT_DATA (2) is
      // the HTML spec's own floor for "there is a frame to paint" — below
      // it, drawImage silently paints nothing, which is the F2 bug.
      if (video.readyState < 2) return;
      clearSeekFallback();
      try {
        const { w, h } = fitWithin(video.videoWidth, video.videoHeight, PHOTO_MAX_EDGE);
        if (w <= 1 && h <= 1) { fail(new Error('This video has no picture to capture.')); return; }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { fail(new Error('no canvas context')); return; }
        ctx.drawImage(video, 0, 0, w, h);
        // W1: readyState said a frame was there, but under decoder
        // contention it can be lying — the buffer hasn't actually been
        // painted yet. A cheap sample catches that; a genuinely black
        // source frame (a fade-in) still ships, just up to
        // MAX_BLACK_RETRIES * BLACK_RETRY_MS later, capped well under a
        // second.
        if (isAllBlack(canvas) && blackRetries < MAX_BLACK_RETRIES) {
          blackRetries += 1;
          setTimeout(draw, BLACK_RETRY_MS);
          return;
        }
        canvas.toBlob((blob) => {
          if (!blob) { fail(new Error('encode failed')); return; }
          settled = true;
          cleanup();
          resolve(blob);
        }, 'image/jpeg', PHOTO_QUALITY);
      } catch (e) {
        fail(e);
      }
    }
    /** Try to land on a real frame past the very start. `knownDuration` is
     *  the real duration when we have one; undefined means we don't (the F2
     *  case) and 1 second is just a reasonable blind guess. Idempotent —
     *  loadedmetadata and loadeddata can both reach here and only the first
     *  call should act. */
    function attemptSeek(knownDuration: number | undefined): void {
      if (seekAttempted || settled) return;
      seekAttempted = true;
      // "One second in, or half the duration if the clip is shorter" — read
      // as shorter than what a one-second seek needs room for, i.e. at or
      // under a second, so a seek target never lands exactly on (or past) a
      // boundary some decoders clamp at.
      const target = knownDuration === undefined ? 1 : (knownDuration > 1 ? 1 : knownDuration / 2);
      if (target <= 0) { draw(); return; } // a real duration of 0 — nothing to seek to
      try {
        video.currentTime = target;
        // V4 (cold audit, session 141 fix pass 2): armed ONLY on the
        // non-finite/unknown-duration path, matching what the comment above
        // SEEK_FALLBACK_MS always claimed but the code didn't do — it used
        // to arm unconditionally, including on a normal finite-duration
        // clip. On a slow seek into a large (300-500 MB) file on WebKit,
        // that let this 1.5s timer draw frame 0 before a legitimate `seeked`
        // for the REAL target arrived — a worse frame than just waiting for
        // the seek to actually finish. The finite path relies on the 15s
        // CAPTURE_TIMEOUT_MS instead, same as before this fix pass touched
        // any of this.
        if (knownDuration === undefined) seekFallbackTimer = setTimeout(draw, SEEK_FALLBACK_MS);
      } catch {
        // A seek some browsers refuse outright on a bad-duration blob.
        // Fall back to whatever's already decoded rather than failing the
        // whole capture over an optional seek.
        draw();
      }
    }
    function onLoadedMetadata(): void {
      const d = video.duration;
      if (Number.isFinite(d) && d > 0) { attemptSeek(d); return; }
      // Non-finite (Infinity) or zero duration: metadata alone gives us
      // nothing usable to seek to, AND — the actual F2 bug — loadedmetadata
      // fires before any frame is guaranteed decoded. Wait for loadeddata,
      // which DOES guarantee one, before doing anything at all.
    }
    function onLoadedData(): void {
      attemptSeek(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined);
    }
    function onSeeked(): void {
      draw();
    }
    function onError(): void {
      fail(new Error('This video could not be decoded.'));
    }
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.src = url;
  });
}
