// Crash-test catalog — the import/restore subset (Action Queue #7; source:
// CODE_REVIEW_2026-06-29's 26-row bad-data catalog, vault Reviews & Analyses).
// These are the rows guarding the moment a user trusts the app with their
// whole log: a damaged or hostile .flog must be refused BEFORE anything is
// written, and a failing import must leave the database exactly as it was.
//
// Most of the catalog already had tests by the time this file was written
// (T1-6, Batch B, Batch R/S — see db.test.ts, flog.test.ts, zip.test.ts,
// dbValidate.test.ts, inputLimits.test.ts). This file closes the six gaps
// that remained. Tests only — no app code was changed to make them pass.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFlog, parseFlog, FLOG_FORMAT, FLOG_VERSION } from '../src/lib/flog.ts';
import type { Snapshot } from '../src/lib/flog.ts';
import { readZip, writeZip } from '../src/lib/zip.ts';
import { commitClassifiers, getAll, probeDb } from '../src/lib/db.ts';
import type { Media } from '../src/lib/types.ts';

function sampleSnapshot(): Snapshot {
  const photoBytes = new Uint8Array([9, 8, 7, 6, 5, 4]);
  const media: Media[] = [{
    id: 'md-cc-1', createdAt: 1000, updatedAt: 2000,
    ownerType: 'firearm', ownerId: 'fa-cc-1', kind: 'image',
    name: 'Catalog photo', annotations: [],
    mime: 'image/jpeg', data: photoBytes.buffer,
  }];
  return {
    exportedAt: 10000, lastModified: 9000,
    stores: {
      firearms: [{ id: 'fa-cc-1', name: 'Catalog Gun', createdAt: 1000, updatedAt: 5000 }],
      meta: [{ key: 'settings', value: { ownerName: 'Catalog' } }],
    },
    media,
  };
}

// ---------------------------------------------------------------------------
// storage-unavailable: openDb must NOT cache a failed open forever (T1-4).
// Declared FIRST in this file on purpose — it must run before any other test
// here touches the database, because a successfully cached connection would
// bypass the patched indexedDB.open below.
// ---------------------------------------------------------------------------
test('storage-unavailable: a failed database open is retried, not bricked (T1-4)', async () => {
  const idb = indexedDB as unknown as { open: (...a: unknown[]) => IDBOpenDBRequest };
  const realOpen = idb.open.bind(indexedDB);
  // First open: fail the way Safari Private Mode / quota exhaustion does —
  // the request errors after the caller has attached its handlers.
  idb.open = () => {
    const req = {
      onblocked: null, onupgradeneeded: null, onsuccess: null, onerror: null,
      error: new Error('quota exceeded (simulated)'),
      result: undefined,
    } as unknown as IDBOpenDBRequest & { onerror: null | (() => void) };
    setTimeout(() => { (req.onerror as unknown as () => void)?.(); }, 0);
    return req as IDBOpenDBRequest;
  };
  try {
    await assert.rejects(probeDb(), /quota exceeded/);
  } finally {
    idb.open = realOpen;
  }
  // Pre-T1-4 the rejected promise stayed cached and every later call died the
  // same death. Post-fix, the very next call opens fresh and succeeds.
  await probeDb();
});

// ---------------------------------------------------------------------------
// truncated-flog: a file cut off mid-transfer (60%) is refused, nothing read.
// (zip.test.ts covers a corrupted byte and random bytes; truncation is a
// different failure — the central directory itself is gone.)
// ---------------------------------------------------------------------------
test('truncated .flog (cut at 60%) is refused with a plain-language error', () => {
  const whole = buildFlog(sampleSnapshot());
  const cut = whole.slice(0, Math.floor(whole.length * 0.6));
  assert.throws(() => parseFlog(cut), (e: unknown) => {
    // Any of zip.ts/flog.ts's deliberate refusals is safe; what must NOT
    // happen is a raw programming error (TypeError/RangeError = a crash,
    // not a refusal) or a silent partial parse. The instanceof checks keep
    // this from passing on e.g. "x is not a function" (audit finding #2).
    assert.ok(e instanceof Error, 'must throw an Error');
    assert.ok(!(e instanceof TypeError) && !(e instanceof RangeError),
      `a ${e.constructor.name} is a crash, not a plain-language refusal`);
    assert.match(e.message, /damaged|isn't a FirearmLog|not a FirearmLog/i);
    return true;
  });
});

// ---------------------------------------------------------------------------
// flog-missing-media: data.json promises a photo the archive doesn't carry.
// Must throw BEFORE any write (closes the A2 gap on flog.ts's missing-member
// check, previously asserted in comments only).
// ---------------------------------------------------------------------------
test('.flog whose mediaMeta references a missing member is refused', () => {
  const whole = buildFlog(sampleSnapshot());
  // Rebuild the archive with the media entry dropped but data.json intact.
  const entries = readZip(whole).filter((e) => e.name === 'data.json');
  const gutted = writeZip(entries);
  assert.throws(() => parseFlog(gutted), /missing media\/md-cc-1/);
});

// ---------------------------------------------------------------------------
// flog-deflated-entry: FirearmLog only ever writes STORED (uncompressed) zip
// entries; a compressed entry means the file was rewritten by something else.
// readZip must refuse it in plain language (zip.ts:129) — previously untested.
// ---------------------------------------------------------------------------
test('zip entry with a compression method FirearmLog does not write is refused', () => {
  const whole = buildFlog(sampleSnapshot());
  const bytes = whole.slice(); // own copy to patch
  // Patch every method field to 8 (deflate): local headers (PK\x03\x04, method
  // at +8) and central directory entries (PK\x01\x02, method at +10).
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b) {
      if (bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) bytes[i + 8] = 8;
      if (bytes[i + 2] === 0x01 && bytes[i + 3] === 0x02) bytes[i + 10] = 8;
    }
  }
  assert.throws(() => parseFlog(bytes), /packing method/);
});

// ---------------------------------------------------------------------------
// proto-pollution-flog: a hostile data.json must not be able to reach
// Object.prototype through __proto__ / constructor / prototype keys
// (flog.ts's reviver). buildFlog can't produce such a file — JSON.stringify
// never emits __proto__ from a normal object — so craft the JSON by hand.
// ---------------------------------------------------------------------------
test('a hostile __proto__ key in data.json is stripped, prototype untouched', () => {
  const hostileJson = JSON.stringify({
    format: FLOG_FORMAT, version: FLOG_VERSION, exportedAt: 1, lastModified: 1,
    stores: { firearms: [] }, mediaMeta: [],
  }).replace('"firearms":[]', '"firearms":[{"id":"fa-h1","__proto__":{"polluted":true},"constructor":{"bad":1}}]');
  const file = writeZip([{ name: 'data.json', data: new TextEncoder().encode(hostileJson) }]);
  const snap = parseFlog(file);
  const rec = (snap.stores.firearms as Record<string, unknown>[])[0];
  assert.equal(rec.id, 'fa-h1');
  // The assertions that actually discriminate guard-present from guard-absent
  // (audit finding #1: JSON.parse alone creates __proto__/constructor as OWN
  // data properties without polluting the prototype — so only checking the
  // prototype was vacuous). With the reviver, the hostile keys don't exist on
  // the record AT ALL:
  assert.equal(Object.prototype.hasOwnProperty.call(rec, '__proto__'), false,
    'the reviver must strip an own __proto__ data property');
  assert.deepEqual(Object.keys(rec).sort(), ['id'],
    'no hostile key survives onto the record');
  assert.equal(rec.constructor, Object,
    'constructor must resolve through the clean prototype, not an own prop');
  // Defense-in-depth: the global prototype stays untouched either way.
  assert.equal(Object.getPrototypeOf(rec), Object.prototype);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

// ---------------------------------------------------------------------------
// atomic-USPSA-rollback: the forced-FAILURE side of T1-5. db.test.ts proves
// the happy path writes in one transaction; this proves a poison row aborts
// the whole transaction and ZERO rows persist — no half-imported classifier
// set, ever. (A row without the 'id' keyPath makes IndexedDB's put throw.)
// ---------------------------------------------------------------------------
test('commitClassifiers with a poison row persists NOTHING (all-or-nothing)', async () => {
  const rows = [
    { id: 'cl-cc-1', code: '99-01', percent: 60 },
    { id: 'cl-cc-2', code: '99-02', percent: 62 },
    { notId: 'poison — no keyPath, put() must throw' },
  ];
  // Pin the rejection to the intended cause (a keyPath DataError from the
  // poison row) so a rejection for an unrelated reason can't satisfy this.
  await assert.rejects(commitClassifiers(rows), (e: unknown) => {
    const text = `${(e as { name?: string })?.name ?? ''} ${(e as Error)?.message ?? ''}`;
    assert.match(text, /data.?error|key/i);
    return true;
  });
  const after = await getAll<{ id: string }>('classifiers');
  assert.equal(after.some((r) => r.id === 'cl-cc-1' || r.id === 'cl-cc-2'), false,
    'a poison row must roll back the rows queued before it');
});
