// F1: the boot open guard. A stuck indexedDB.open used to hang every screen
// on a spinner forever; openDb now times out (10s), tags WHY (blocked vs.
// plain timeout), closes a too-late success instead of leaking it, and clears
// its cache on rejection so Try Again gets a genuinely fresh attempt.
// These tests stub indexedDB.open directly (no fake-indexeddb here — the
// point is exactly the case where the real open never settles) and drive the
// clock with node:test's mock timers. Runs in its own process, so db.ts's
// module-level cache starts fresh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeDb } from '../src/lib/db.ts';

// A minimal IDBOpenDBRequest stand-in whose events WE fire (or never fire).
type FakeRequest = {
  onblocked: (() => void) | null;
  onupgradeneeded: (() => void) | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  result: { close: () => void };
  error: Error | null;
};

function makeFakeRequest(): { req: FakeRequest; closed: () => boolean } {
  let closed = false;
  const req: FakeRequest = {
    onblocked: null,
    onupgradeneeded: null,
    onsuccess: null,
    onerror: null,
    result: { close: () => { closed = true; } },
    error: null,
  };
  return { req, closed: () => closed };
}

function stubIndexedDb(open: () => FakeRequest): void {
  (globalThis as { indexedDB: unknown }).indexedDB = { open };
}

test('a never-settling open rejects with db-open-timeout after 10s', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { req } = makeFakeRequest();
  stubIndexedDb(() => req);

  const p = probeDb();
  const settled = assert.rejects(p, /db-open-timeout/);
  t.mock.timers.tick(10_000);
  return settled;
});

test('a blocked open rejects with db-open-blocked (names the likely cause)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { req } = makeFakeRequest();
  stubIndexedDb(() => req);

  const p = probeDb();
  req.onblocked?.();
  const settled = assert.rejects(p, /db-open-blocked/);
  t.mock.timers.tick(10_000);
  return settled;
});

test('a success arriving after the timeout closes the leaked connection', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { req, closed } = makeFakeRequest();
  stubIndexedDb(() => req);

  const p = probeDb();
  const settled = assert.rejects(p, /db-open-timeout/);
  t.mock.timers.tick(10_000);
  await settled;

  // The open finally "succeeds" — too late. It must be closed, not resolved:
  // a leaked connection is exactly what blocks the NEXT open.
  req.onsuccess?.();
  assert.equal(closed(), true);
});

test('after a failure, Try Again gets a fresh open (the cache was cleared)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = makeFakeRequest();
  stubIndexedDb(() => first.req);
  const p = probeDb();
  const settled = assert.rejects(p, /db-open-timeout/);
  t.mock.timers.tick(10_000);
  await settled;

  // Second attempt: the stub now settles immediately. If the failed promise
  // were still cached, this would reject again instead of resolving.
  const second = makeFakeRequest();
  stubIndexedDb(() => {
    queueMicrotask(() => second.req.onsuccess?.());
    return second.req;
  });
  await probeDb(); // resolves — retry works
});
