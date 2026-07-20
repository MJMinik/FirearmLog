// deliverFile — how a Blob we built in the browser reaches the shooter's hands.
// The bug that made this file exist (Michael, on his iPhone, July 2026): the
// "Save the File Now" button was a plain <a href={blob-url} download> anchor.
// In a Safari tab that downloads. In the installed iOS PWA (added to Home
// Screen, `display-mode: standalone`), an anchor to `application/octet-stream`
// NAVIGATES the webview to the blob URL — a blank white screen with no browser
// chrome and no way back. Restart-the-app blank.
//
// The fix is a small router in the presentation layer: pick the delivery path
// that ACTUALLY hands the file to the user on the platform they're on. The
// bytes are unchanged; only how they leave the app is.
//
//   Standalone iOS + Web Share Level 2 (files) → present the iOS Share sheet
//     via navigator.share({ files: [...] }) so the user can Save to Files,
//     AirDrop, mail it, etc. This is the only path that works cleanly for a
//     home-screen PWA on iPhone.
//   Standalone WITHOUT file-share support → open the blob in a new window,
//     so the current webview is never navigated away from. If even that is
//     blocked (popup blocker in some engines), fall back to the download-anchor.
//   Anywhere else (Mac, Windows, Android Chrome, iOS Safari as a TAB) → the
//     original download-anchor path, which is what those platforms expect.
//
// This file lives in src/ui/ on purpose: it is presentation, not storage. The
// backup FORMAT (src/lib/flog.ts) and the write path (src/lib/db.ts) are not
// touched — those are DANGER-ZONE and stay untouched by this fix.

/** Was the app opened from the Home Screen (standalone display mode)? */
export function isStandalone(nav: Navigator = navigator): boolean {
  // Safari on iOS exposes the legacy `navigator.standalone` boolean; every
  // other engine exposes the CSS media query. Read both — either is truth.
  const legacy = (nav as Navigator & { standalone?: boolean }).standalone === true;
  const mm = typeof matchMedia === 'function'
    && matchMedia('(display-mode: standalone)').matches;
  return legacy || mm;
}

/** iPhone / iPad / iPod — device-family detector that matches SyncCard's. */
export function isIOS(nav: Navigator = navigator): boolean {
  return /iP(hone|ad|od)/.test(nav.userAgent)
    || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

/** Can this engine hand us the OS Share sheet with THIS file attached? */
export function canShareFile(file: File, nav: Navigator = navigator): boolean {
  const n = nav as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof n.canShare !== 'function' || typeof n.share !== 'function') return false;
  try {
    return n.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/** What path did deliverFile take? Useful for tests and callers that adapt copy. */
export type DeliveryOutcome =
  | { kind: 'share'; shared: boolean } // shared=false means the user cancelled the Share sheet
  | { kind: 'window' } // opened in a new tab/window
  | { kind: 'download' }; // classic anchor download

export interface DeliverOptions {
  /** Injected for tests. Defaults to the real globals. */
  nav?: Navigator;
  openWindow?: (url: string) => Window | null;
  makeAnchor?: () => HTMLAnchorElement;
  urlFor?: (b: Blob) => string;
  revoke?: (url: string) => void;
}

/**
 * Hand `blob` to the user under `filename`. Picks the safest delivery path for
 * the current platform. Returns which path was taken so callers can adjust
 * their instructions.
 *
 * On Share-sheet cancel (user tapped X or backed out), resolves with
 * `{ kind:'share', shared:false }` — cancel is a user choice, NOT an error.
 * Real share errors are re-thrown so callers can surface them.
 */
export async function deliverFile(
  blob: Blob,
  filename: string,
  mimeType: string,
  opts: DeliverOptions = {},
): Promise<DeliveryOutcome> {
  const nav = opts.nav ?? navigator;
  const urlFor = opts.urlFor ?? ((b: Blob) => URL.createObjectURL(b));
  const revoke = opts.revoke ?? ((u: string) => URL.revokeObjectURL(u));

  // Path 1 — installed iOS PWA with file-share support: the ONLY path that
  // reaches Files / AirDrop / Mail without navigating the webview away.
  if (isStandalone(nav) && isIOS(nav)) {
    const file = new File([blob], filename, { type: mimeType });
    if (canShareFile(file, nav)) {
      try {
        await (nav as Navigator).share({ files: [file], title: filename });
        return { kind: 'share', shared: true };
      } catch (e) {
        // AbortError = the user cancelled the Share sheet. Silent by design.
        if (e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message))) {
          return { kind: 'share', shared: false };
        }
        throw e;
      }
    }

    // Path 2 — standalone but no file-share: open in a NEW window so the
    // installed app itself is never navigated to the blob. If window.open is
    // blocked, fall through to the anchor download.
    const url = urlFor(blob);
    const opened = (opts.openWindow ?? ((u: string) => window.open(u, '_blank')))(url);
    if (opened) {
      // The new window owns the URL now; revoke lazily.
      // unref keeps a Node test runner from staying alive on this timer;
    // browser setTimeout doesn't expose unref, so the optional call is a no-op.
    (setTimeout(() => revoke(url), 120_000) as unknown as { unref?: () => void }).unref?.();
      return { kind: 'window' };
    }
    // Popup blocked — fall through.
    revoke(url);
  }

  // Path 3 — desktop / Safari tab / Android: the classic download-anchor.
  const url = urlFor(blob);
  const makeA = opts.makeAnchor ?? (() => document.createElement('a'));
  const a = makeA();
  a.href = url;
  a.download = filename;
  // Anchor must be in the DOM in some engines for the click to trigger a save.
  // (Only when we're creating a real element — an injected test anchor has no
  // document to attach to, and doesn't need one.)
  if (!opts.makeAnchor) document.body.appendChild(a);
  a.click();
  if (!opts.makeAnchor) a.remove();
  (setTimeout(() => revoke(url), 120_000) as unknown as { unref?: () => void }).unref?.();
  return { kind: 'download' };
}
