// New-version prompt (service-worker freshness): when the service worker installs a
// newer build while the app is already open, show a small, non-blocking, dismissible
// banner offering a one-tap reload — so a user is never silently left running stale code
// in an open tab/window. We do NOT auto-reload (that can yank the page out from under
// someone mid-action); the user chooses when.
//
// Deliberately plain DOM (mirrors globalErrorBanner) so it works regardless of React
// state. Idempotent: at most one banner at a time.
export function installUpdatePrompt(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  let bar: HTMLElement | null = null;

  const show = () => {
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
    reload.onclick = () => window.location.reload();
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
  };

  navigator.serviceWorker.ready
    .then((reg) => {
      // A newer worker was already installed and waiting from a previous visit.
      if (reg.waiting && navigator.serviceWorker.controller) show();

      // A newer worker started installing while the app is open right now.
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // 'installed' + an existing controller => this is an UPDATE, not the first install.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) show();
        });
      });
    })
    .catch(() => {
      /* the update prompt is a bonus, never an error the user sees */
    });
}
