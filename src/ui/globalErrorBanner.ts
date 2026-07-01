// App-wide safety net (pro-grade audit T1-1): if any promise rejection or error
// escapes all local handling, show a small, non-blocking, dismissible banner
// that reassures the user their data is safe — never a blank or frozen screen.
//
// Deliberately plain DOM (not React) so it still works if the React tree is the
// thing that errored. Idempotent: at most one banner at a time.
export function installGlobalErrorHandler(): void {
  if (typeof window === 'undefined') return;

  let bar: HTMLElement | null = null;

  const show = () => {
    if (bar) return; // already showing
    bar = document.createElement('div');
    bar.className = 'global-error-banner';
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');

    const text = document.createElement('span');
    text.textContent = "Something didn't finish loading — your data is safe.";
    bar.appendChild(text);

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = 'Dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss message');
    dismiss.onclick = () => {
      bar?.remove();
      bar = null;
    };
    bar.appendChild(dismiss);

    document.body.appendChild(bar);
  };

  window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled promise rejection', e.reason);
    show();
  });
  window.addEventListener('error', (e) => {
    console.error('Uncaught error', e.error ?? e.message);
    show();
  });
}
