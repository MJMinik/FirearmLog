// The .flog sync file (spec §3.3): a zip holding data.json plus a media/
// folder with the actual photo/video bytes. Pure logic — no IndexedDB, no
// DOM — so the exact same code runs in the app and in the automated tests.

import { readZip, writeZip, writeZipBlob, readZipDirectory, readZipEntry } from './zip.ts';
import type { Media } from './types.ts';

export const FLOG_FORMAT = 'FirearmLog';
// H1 (T3-1 audit): bumped 1 → 2 because the snapshot gained the 'skillSets'
// store (spec §3.3). Without the bump, an OLD app pulling a NEW .flog would
// silently drop skillSets on import (an unknown store just isn't read) and
// then ERASE them on the very next Save to File, since a pull-then-push
// round-trip on that device now writes a snapshot missing the store entirely.
// The version fence below already refuses a file whose version is newer than
// this app understands with a plain "update the app, then pull again"
// message — the bump turns that silent erasure into that refusal instead.
// Backward compat is untouched: a v1 file (version <= FLOG_VERSION) still
// imports exactly as before; only a NEWER file into an OLDER app now refuses.
export const FLOG_VERSION = 2;

/** Everything in the app, ready to travel. */
export interface Snapshot {
  exportedAt: number;
  lastModified: number; // newest updatedAt across all records (never bumped by mere app-open)
  stores: Record<string, unknown[]>; // every object store except media
  media: Media[];
}

/** Newest real change in a snapshot's records. */
export function newestStamp(stores: Record<string, unknown[]>, media: { updatedAt: number }[]): number {
  let newest = 0;
  for (const records of Object.values(stores)) {
    for (const r of records) {
      const u = (r as { updatedAt?: unknown }).updatedAt;
      if (typeof u === 'number' && u > newest) newest = u;
    }
  }
  // Same typeof rule as the store loop above. It used to be missing here, which
  // meant a media record whose updatedAt was stored as TEXT was compared with a
  // number — JavaScript quietly coerces, so "9999999999" won and this function
  // returned a string where its own signature promises a number. Audit finding E,
  // session 114: newestMediaStamp (the cursor path) already applied the rule, so
  // the two functions answering the same question disagreed.
  for (const m of media) {
    const u = (m as { updatedAt?: unknown }).updatedAt;
    if (typeof u === 'number' && u > newest) newest = u;
  }
  return newest;
}

export function buildFlog(snapshot: Snapshot): Uint8Array<ArrayBuffer> {
  const mediaMeta = snapshot.media.map((m) => {
    const meta = { ...m } as Record<string, unknown>;
    delete meta.data;
    meta.file = `media/${m.id}`;
    return meta;
  });
  const dataJson = {
    format: FLOG_FORMAT,
    version: FLOG_VERSION,
    exportedAt: snapshot.exportedAt,
    lastModified: snapshot.lastModified,
    stores: snapshot.stores,
    mediaMeta
  };
  return writeZip([
    { name: 'data.json', data: new TextEncoder().encode(JSON.stringify(dataJson)) },
    ...snapshot.media.map((m) => ({ name: `media/${m.id}`, data: new Uint8Array(m.data) }))
  ], new Date(snapshot.exportedAt));
}

// ─── One name index, shared by both readers ───────────────────────────────────
// Three audit rounds all landed on the same defect in different clothes: the
// eager and lazy readers resolving the SAME name to different entries, silently.
// Round 2 found it on data.json (find() takes the first, new Map() keeps the
// last). Round 3 found it again on media entries, because round 2's fix only
// touched the data.json lookup one line above.
//
// Making two implementations agree is a convention, and a convention is what
// failed twice. So both readers now index through this one function, and it
// REFUSES duplicates rather than picking a winner. Nothing legitimate loses:
// buildFlog writes exactly one data.json and derives media names from unique
// record ids, so a .flog with a duplicate name is corrupt or crafted, and a
// crafted one is a file where an attacker chooses which photo each reader sees.

function indexByUniqueName<T>(items: readonly T[], nameOf: (item: T) => string): Map<string, T> {
  const byName = new Map<string, T>();
  for (const item of items) {
    const name = nameOf(item);
    if (byName.has(name)) {
      throw new Error('This data file looks damaged (it contains the same item twice).');
    }
    byName.set(name, item);
  }
  return byName;
}

export function parseFlog(bytes: Uint8Array): Snapshot {
  const entries = readZip(bytes);
  const byName = indexByUniqueName(entries, (e) => e.name);
  const dataEntry = byName.get('data.json');
  if (!dataEntry) throw new Error("That file isn't a FirearmLog data file (data.json missing inside).");

  // Validated by the SAME helper parseFlogLazy uses. It was inline here until
  // session 114: the lazy reader was added with its own copy, which meant the
  // version fence and the CR-4 reviver existed twice and a later change to one
  // would silently spare the other. Two readers of the same untrusted file must
  // refuse the same files for the same reasons — that is a property, not a
  // coincidence, so it gets ONE implementation rather than a convention.
  const d = parseFlogDataJson(dataEntry.data);

  const media: Media[] = d.mediaMeta.map((meta) => {
    const file = String(meta.file ?? '');
    const bytesFor = byName.get(file)?.data;
    if (!bytesFor) throw new Error(`This data file looks damaged (missing ${file}).`);
    const m = { ...meta } as Record<string, unknown>;
    delete m.file;
    // Copy into a fresh buffer so the Media record owns its bytes outright.
    const owned = new Uint8Array(bytesFor.length);
    owned.set(bytesFor);
    return { ...(m as unknown as Omit<Media, 'data'>), data: owned.buffer };
  });

  return {
    exportedAt: d.exportedAt,
    lastModified: d.lastModified,
    stores: d.stores,
    media
  };
}

// ─── Streaming writer ─────────────────────────────────────────────────────────
// buildFlogBlob produces a byte-identical .flog to buildFlog — same data.json
// key order, same mediaMeta shape — but drives writeZipBlob so each media
// entry's bytes are handed to the Blob store and can be evicted before the
// next one is opened. The snapshot's exportedAt timestamp pins the ZIP date,
// matching what buildFlog writes.

export interface FlogMediaSource {
  id: string;
  meta: Record<string, unknown>;
  open(): Promise<Uint8Array<ArrayBuffer>>;
}

export async function buildFlogBlob(parts: {
  exportedAt: number;
  lastModified: number;
  stores: Record<string, unknown[]>;
  media: FlogMediaSource[];
}): Promise<Blob> {
  const mediaMeta = parts.media.map((m) => {
    const meta = { ...m.meta } as Record<string, unknown>;
    delete meta.data;
    meta.file = `media/${m.id}`;
    return meta;
  });
  const dataJson = {
    format: FLOG_FORMAT,
    version: FLOG_VERSION,
    exportedAt: parts.exportedAt,
    lastModified: parts.lastModified,
    stores: parts.stores,
    mediaMeta
  };
  const dataJsonBytes = new TextEncoder().encode(JSON.stringify(dataJson));
  const sources: import('./zip.ts').ZipSource[] = [
    { name: 'data.json', open: async () => dataJsonBytes },
    // Call through m rather than passing m.open across: a FlogMediaSource is
    // free to be written as an object literal with a method that uses `this`
    // (the natural shape when it closes over a record), and handing the bare
    // function reference to the zip writer would detach it and call it with the
    // wrong receiver. The failure is not a type error — open() returns
    // undefined and the first sign of trouble is a crash inside crc32.
    ...parts.media.map((m) => ({ name: `media/${m.id}`, open: () => m.open() }))
  ];
  return writeZipBlob(sources, new Date(parts.exportedAt));
}

// ─── Shared validation helper ─────────────────────────────────────────────────
// Both parseFlog and parseFlogLazy need the same format/version/structure checks
// and the same prototype-pollution reviver. Factoring them here keeps the error
// messages identical, which the tests assert.

function parseFlogDataJson(jsonBytes: Uint8Array): {
  exportedAt: number;
  lastModified: number;
  stores: Record<string, unknown[]>;
  mediaMeta: Record<string, unknown>[];
} {
  let parsed: unknown;
  try {
    // Audit CR-4: strip dangerous keys from an untrusted file so a malicious
    // backup can't pollute Object.prototype via __proto__/constructor/prototype.
    parsed = JSON.parse(new TextDecoder().decode(jsonBytes), (key, value) =>
      (key === '__proto__' || key === 'constructor' || key === 'prototype') ? undefined : value);
  } catch {
    throw new Error('This data file looks damaged (the records inside are unreadable).');
  }
  const d = parsed as {
    format?: unknown; version?: unknown; exportedAt?: unknown; lastModified?: unknown;
    stores?: Record<string, unknown[]>; mediaMeta?: Record<string, unknown>[];
  };
  if (d.format !== FLOG_FORMAT || typeof d.stores !== 'object' || d.stores === null) {
    throw new Error("That file isn't a FirearmLog data file.");
  }
  if (typeof d.version === 'number' && d.version > FLOG_VERSION) {
    throw new Error('This data file came from a NEWER version of FirearmLog. Update the app on this device, then pull again.');
  }
  // Absent mediaMeta is fine and always was — it just means no photos. Present
  // but not an array is a damaged file, and it used to reach the callers as a
  // raw TypeError (a crash, not a message). Worse, a STRING is iterable, so the
  // two readers diverged on it. One plain-language refusal for both.
  if (d.mediaMeta !== undefined && d.mediaMeta !== null && !Array.isArray(d.mediaMeta)) {
    throw new Error('This data file looks damaged (the photo list inside is unreadable).');
  }
  // ...and every ENTRY in it must be an object. `null` slipped through the check
  // above and reached both readers as `String(meta.file ?? '')`, which is a raw
  // TypeError — a crash on the restore path rather than a message. Same refusal
  // as the list-level check, so a caller has one wording to handle.
  for (const meta of d.mediaMeta ?? []) {
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
      throw new Error('This data file looks damaged (the photo list inside is unreadable).');
    }
  }
  return {
    exportedAt: typeof d.exportedAt === 'number' ? d.exportedAt : 0,
    lastModified: typeof d.lastModified === 'number' ? d.lastModified : 0,
    stores: d.stores,
    mediaMeta: d.mediaMeta ?? [],
  };
}

// ─── Lazy loader ──────────────────────────────────────────────────────────────
// parseFlogLazy reads the ZIP directory and validates data.json without touching
// any media payload. readMedia(i) materialises exactly one media record on demand.
//
// A missing media entry is detected HERE, at open time, rather than deferred to
// readMedia — a load that reports success and then fails partway through is worse
// than one that refuses up front.
//
// The extra copy that parseFlog makes (owned.set(bytesFor)) is NOT needed here:
// readZipEntry already slices a fresh buffer from the Blob via
// blob.slice(...).arrayBuffer(), so the Uint8Array owns its backing memory
// outright and no additional copy is required. This is safe because slice()
// always returns a new ArrayBuffer whose ownership is not shared with the Blob.

export interface LazyFlog {
  exportedAt: number;
  lastModified: number;
  stores: Record<string, unknown[]>;
  mediaCount: number;
  mediaBytes: number;       // summed from the directory — no payload read
  // COPIES, with the internal `file` key stripped — the same shape parseFlog
  // returns. Handing out the live objects let a caller change what readMedia
  // returns by writing to l.mediaMeta[0].file, and exposed a key that is an
  // implementation detail of the archive rather than part of a Media record.
  mediaMeta: Record<string, unknown>[];
  readMedia(index: number): Promise<Media>;
}

export async function parseFlogLazy(blob: Blob): Promise<LazyFlog> {
  const dir = await readZipDirectory(blob);
  const byName = indexByUniqueName(dir, (e) => e.name);

  const dataEntry = byName.get('data.json');
  if (!dataEntry) throw new Error("That file isn't a FirearmLog data file (data.json missing inside).");

  const dataBytes = await readZipEntry(blob, dataEntry);
  const { exportedAt, lastModified, stores, mediaMeta } = parseFlogDataJson(dataBytes);

  // Verify every media entry is PRESENT before declaring success — early
  // detection is better than a readMedia failure deep in a restore.
  //
  // Presence is all that is checked here, and that is a real difference from
  // parseFlog, which verifies every checksum up front because it has already
  // read every byte. Confirming checksums here would mean reading every payload,
  // which is the entire cost this reader exists to avoid. So a .flog with an
  // intact directory and a CORRUPT photo opens successfully and fails later, at
  // readMedia. The caller doing a restore must therefore be rollback-safe —
  // stage the import and commit at the end — rather than assuming a successful
  // open means a successful restore. (Pass 2 owns that; noted here so it cannot
  // be discovered by surprise.)
  for (const meta of mediaMeta) {
    const file = String(meta.file ?? '');
    if (!byName.has(file)) throw new Error(`This data file looks damaged (missing ${file}).`);
  }

  const mediaBytes = mediaMeta.reduce((sum, meta) => {
    const file = String(meta.file ?? '');
    const entry = byName.get(file);
    return sum + (entry ? entry.size : 0);
  }, 0);

  return {
    exportedAt,
    lastModified,
    stores,
    mediaCount: mediaMeta.length,
    mediaBytes,
    mediaMeta: mediaMeta.map((meta) => {
      const copy = { ...meta };
      delete copy.file;
      return copy;
    }),
    async readMedia(index: number): Promise<Media> {
      const meta = mediaMeta[index];
      if (!meta) throw new Error(`readMedia: index ${index} out of range`);
      const file = String(meta.file ?? '');
      const entry = byName.get(file);
      if (!entry) throw new Error(`This data file looks damaged (missing ${file}).`);
      const data = await readZipEntry(blob, entry);
      // data.buffer is the freshly-sliced ArrayBuffer from readZipEntry —
      // it is not shared with the Blob, so returning it directly is safe.
      // No extra copy needed (contrast with parseFlog's owned.set(bytesFor)).
      const m = { ...meta } as Record<string, unknown>;
      delete m.file;
      return { ...(m as unknown as Omit<Media, 'data'>), data: data.buffer };
    }
  };
}
