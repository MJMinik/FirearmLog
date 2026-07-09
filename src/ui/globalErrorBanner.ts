// App-wide safety net (pro-grade audit T1-1): if any promise rejection or error
// escapes all local handling, show a small, non-blocking, dismissible banner
// that reassures the user their data is safe — never a blank or frozen screen.
//
// Deliberately plain DOM (not React) so it still works if the React tree is the
// thing that errored. Idempotent: at most one banner at a time.
export function installGlobalErrorHandler(): void {
  if (typeof window === 'undefined') return;

  let bar: HTMLElement | null = null;

  const errName = (err: unknown): string => (err as { name?: string } | null)?.name ?? '';

  // S-3: out-of-space gets its OWN words. "didn't finish saving — check the
  // entry" is misleading when the real cause is a full device — there's nothing
  // wrong with the entry, the phone is out of room.
  const isQuotaError = (err: unknown): boolean => errName(err) === 'QuotaExceededError';

  // A failed database WRITE deserves accurate words — "didn't finish loading"
  // would be untrue for a save that failed (code review L-5/L-6 wording note).
  const isWriteError = (err: unknown): boolean =>
    ['TransactionInactiveError', 'ConstraintError', 'DataError', 'ReadOnlyError']
      .includes(errName(err));

  const show = (err?: unknown) => {
    if (bar) return; // already showing
    bar = document.createElement('div');
    bar.className = 'global-error-banner';
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');

    const text = document.createElement('span');
    text.textContent = isQuotaError(err)
      ? 'This device is out of storage space — free up space and try again. Your existing data is safe.'
      : isWriteError(err)
        ? "Something didn't finish saving — your existing data is safe. Check the entry and try again."
        : "Something didn't finish loading — your data is safe.";
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
    show(e.reason);
  });
  window.addEventListener('error', (e) => {
    console.error('Uncaught error', e.error ?? e.message);
    show(e.error);
  });
}
