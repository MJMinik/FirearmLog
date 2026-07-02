// Service-worker registration (production only).
//
// Uses vite-plugin-pwa's virtual `registerSW` helper (Workbox under the hood). The
// generated SW precaches the app shell + all hashed assets, so a cold launch always
// serves a complete, self-consistent build (never a shell pointing at deleted/404'd
// JS -> never a blank screen) and the app works fully offline. See vite.config.ts for
// the full rationale and the NetworkFirst rule for demo-dataset.bin.
//
// Update UX: the SW is configured with skipWaiting + clientsClaim (auto-takeover), so
// a user stuck on an old build recovers on the next natural reopen with NO tap. For a
// tab left OPEN when a new build ships, we additionally surface the existing
// "A new version is ready — Reload / Later" banner (showUpdateBanner) so the user can
// choose when to jump to the new code rather than being reloaded mid-action.

import { showUpdateBanner } from './updatePrompt.ts';

export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  // Dynamic import so the virtual module is only pulled in for the production build
  // that actually registers a worker.
  void import('virtual:pwa-register')
    .then(({ registerSW }) => {
      const updateSW = registerSW({
        // A newer build is waiting for THIS open tab. Offer the one-tap reload.
        // updateSW(true) tells the waiting SW to skipWaiting; the plugin then reloads
        // the page onto the new shell after control transfers.
        onNeedRefresh() {
          showUpdateBanner(() => {
            void updateSW(true);
          });
        },
        // onOfflineReady intentionally omitted: offline is a silent bonus here, and
        // we don't want a "ready to work offline" toast on first load.
      });
    })
    .catch(() => {
      /* offline support is a bonus, never an error the user sees */
    });
}
