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
import { probeDb, retryDb } from '../src/lib/db.ts';

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

// The E2E-run-#175 regression: after the boot failure, some OTHER caller (the
// setup-wizard effect, in the real app) re-opened while things were still
// broken, re-filling the cache with a new pending, doomed open. probeDb would
// join that doomed open and fail; Try Again must not. retryDb discards the
// cached attempt and opens fresh.
test('retryDb ignores a doomed in-flight open left by another caller', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = makeFakeRequest();
  stubIndexedDb(() => first.req);
  // retryDb (not probeDb) so this test never inherits the healthy open the
  // previous test left in the module cache — order-independent by design.
  const boot = retryDb();
  const settled = assert.rejects(boot, /db-open-timeout/);
  t.mock.timers.tick(10_000);
  await settled;

  // A bystander re-opens while the database is STILL stuck: the cache now
  // holds a fresh pending open that will never settle.
  const doomed = makeFakeRequest();
  stubIndexedDb(() => doomed.req);
  const bystander = probeDb();
  bystander.catch(() => { /* would reject when its own 10s timer fired */ });

  // Now the blocker goes away (the other tab closes). Try Again must resolve
  // WITHOUT waiting out the bystander's doomed open — note its timer is never
  // ticked here, so joining it would hang this test.
  const third = makeFakeRequest();
  stubIndexedDb(() => {
    queueMicrotask(() => third.req.onsuccess?.());
    return third.req;
  });
  await retryDb(); // resolves — a genuinely fresh attempt
});
