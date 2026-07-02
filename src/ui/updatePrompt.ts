// New-version prompt (service-worker freshness): when a newer build installs while
// the app is already open, show a small, non-blocking, dismissible banner offering a
// one-tap reload — so a user is never silently left running stale code in an open
// tab/window. We do NOT auto-reload out from under someone mid-action; they choose.
//
// Deliberately plain DOM (mirrors globalErrorBanner) so it works regardless of React
// state. Idempotent: at most one banner at a time.
//
// This module is now UI-only: it renders the banner and calls back on Reload. The
// service-worker wiring (which build is waiting, when to apply it) lives in
// registerSw.ts, which drives this via `showUpdateBanner`. Keeping the banner here
// preserves its look/placement (styled by `.update-banner` in app.css) and mirrors
// globalErrorBanner.ts.

let bar: HTMLElement | null = null;

/**
 * Show the "A new version is ready" banner. `onReload` is invoked when the user taps
 * Reload (registerSw passes the Workbox updater, which applies the waiting SW and
 * reloads). Idempotent — a second call while a banner is showing is a no-op.
 */
export function showUpdateBanner(onReload: () => void): void {
  if (typeof document === 'undefined') return;
  if (bar) return; // already showing

  bar = document.createElement('div');
  bar.className = 'update-banner';
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-live', 'polite');

  const text = document.createElement('span');
  text.textContent = 'A new version is ready.';
  bar.appendChild(text);

  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'primary';
  reload.textContent = 'Reload';
  reload.onclick = () => {
    // Let the updater apply the new service worker + reload. Guarded so a throw
    // here can never leave the banner stuck; worst case the user reloads manually.
    try {
      onReload();
    } catch {
      window.location.reload();
    }
  };
  bar.appendChild(reload);

  const later = document.createElement('button');
  later.type = 'button';
  later.textContent = 'Later';
  later.setAttribute('aria-label', 'Dismiss update message');
  later.onclick = () => {
    bar?.remove();
    bar = null;
  };
  bar.appendChild(later);

  document.body.appendChild(bar);
}
