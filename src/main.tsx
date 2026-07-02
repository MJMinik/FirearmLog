import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { installGlobalErrorHandler } from './ui/globalErrorBanner.ts';
import { registerServiceWorker } from './ui/registerSw.ts';
import './app.css';

// App-wide safety net: surface any escaped error/rejection as a small,
// non-blocking banner instead of a silent blank screen (pro-grade audit T1-1).
installGlobalErrorHandler();

// Ask the browser to keep our data persistently (resist automatic eviction).
// Local-first means the user's log lives only in this browser's IndexedDB; without
// a persistence grant, Safari/WebKit can clear it under storage pressure. This is a
// best-effort request: fully guarded, never throws, and never blocks app startup.
// If the browser declines or doesn't support it, the app behaves exactly as before.
async function requestPersistentStorage(): Promise<void> {
  try {
    if (!navigator.storage || typeof navigator.storage.persist !== 'function') return;
    // Don't re-prompt if the grant is already in place.
    if (
      typeof navigator.storage.persisted === 'function' &&
      (await navigator.storage.persisted())
    ) {
      return;
    }
    await navigator.storage.persist();
  } catch {
    /* persistence is a safety bonus, never an error the user sees */
  }
}
void requestPersistentStorage();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Offline support + freshness — register the Workbox service worker (production
// builds only). Handles precaching the app shell, auto-takeover of new builds, and
// the "A new version is ready" banner for tabs left open. See ui/registerSw.ts.
if (import.meta.env.PROD) {
  registerServiceWorker();
}
