// Which install-guidance steps to highlight, from the browser's own hints.
// Pure so it can be unit-tested without a real browser.

export type InstallTarget = 'ios' | 'android' | 'mac-safari' | 'desktop';

/**
 * Pick the install steps that fit the visitor's device. iPadOS 13+ reports
 * itself as a Mac, so a "Mac" with touch points is treated as iOS. Mac Safari
 * gets the Add-to-Dock steps; Mac/Windows Chrome or Edge get the address-bar
 * install steps. Everything else falls back to the desktop Chrome/Edge steps.
 */
export function detectInstallTarget(
  nav: { ua: string; platform?: string; maxTouchPoints?: number }
): InstallTarget {
  const ua = nav.ua || '';
  const platform = nav.platform || '';
  const touch = nav.maxTouchPoints || 0;

  const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Mac/.test(platform) && touch > 1);
  if (isIOS) return 'ios';
  if (/Android/.test(ua)) return 'android';

  const isMac = /Mac/.test(ua) || /Mac/.test(platform);
  const isChromium = /Chrome|Chromium|Edg|OPR/.test(ua);
  if (isMac && !isChromium) return 'mac-safari';
  return 'desktop';
}
