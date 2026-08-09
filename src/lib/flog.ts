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

// ─── One name, computed once, used in both places it is written ───────────────
// Every photo's name goes into a .flog TWICE: as the ZIP entry name, which
// travels as raw UTF-8 bytes, and as meta.file inside data.json, which travels
// as a JSON string. Both writers used to interpolate `media/${id}` separately in
// each place — one string derived twice — and the two paths do not survive the
// same input. A lone surrogate (an unpaired half of a two-part character, which
// JavaScript allows inside a string) passes through JSON untouched but becomes
// U+FFFD, the replacement character, the moment it is encoded as UTF-8 bytes.
// The entry name and meta.file then name different things, and the reader can no
// longer find the photo: the save reports success, and the damage is discovered
// at restore, possibly months later, when the original is long gone.
//
// So the name is computed ONCE, here, through the same encode/decode trip the
// ZIP writer performs, and the single result is used for both. Whatever that
// trip does to an id, the two copies now agree by construction rather than by
// two call sites remembering to do the same thing.
//
// The trip is NOT idempotent in general, and the reason it is safe here is worth
// stating exactly: TextDecoder strips a byte-order mark sitting at position 0, so
// a string that starts with one loses a character on every pass. The constant
// `media/` prefix means position 0 is always `m`, so no BOM can ever be stripped
// and a second pass is a no-op. Verified across all 65,536 single code units
// with the prefix, all 4.2 million surrogate-range pairs, and 400,000 random ids.
//
// It also refuses two records whose names collide, because both readers refuse
// duplicate entry names (see indexByUniqueName below). Without that check the
// writer could emit a file its own reader will not open. Note that DISTINCT ids
// can collide here: two different lone surrogates both encode to U+FFFD.
function mediaEntryNames(ids: readonly string[]): string[] {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const names: string[] = [];
  const idForName = new Map<string, string>();
  for (const id of ids) {
    const name = decoder.decode(encoder.encode(`media/${id}`));
    const firstId = idForName.get(name);
    if (firstId !== undefined) {
      // Naming the ids is the whole point: there is no screen that lists them,
      // so without them a library that acquires a collision can never be saved
      // again and there is nowhere to look for the cause.
      throw new Error(
        `Two photos in this library share the same id, so it can't be saved to one file. Nothing was saved. (${JSON.stringify(firstId)} and ${JSON.stringify(id)} are both stored as ${JSON.stringify(name)}.)`
      );
    }
    idForName.set(name, id);
    names.push(name);
  }
  return names;
}

// ─── One description of the file, used by both writers ────────────────────────
// buildFlog and buildFlogBlob must produce byte-identical archives: same names,
// same data.json down to the key order. That was true, but only because two
// separate implementations happened to agree, and a comment said so. Every
// audit round on this branch found the same shape of defect — two code paths
// that have to agree about one thing, and one of them drifting — so the two
// writers now DERIVE the shared part instead of each building it.
//
// Everything that decides what the archive says lives here. What is left in the
// writers is only how the photo bytes are handed over: all at once for the
// in-memory writer, one at a time for the streaming one. That difference is the
// entire reason both exist; nothing else may differ, and now nothing else can.
interface FlogPlan {
  /** ZIP entry names for the media, in order — the same strings data.json records. */
  readonly mediaNames: readonly string[];
  /** data.json exactly as it goes into the archive. */
  readonly dataJson: Uint8Array<ArrayBuffer>;
}

function planFlog(parts: {
  exportedAt: number;
  lastModified: number;
  stores: Record<string, unknown[]>;
  media: readonly { id: string; meta: Record<string, unknown> }[];
}): FlogPlan {
  const mediaNames = mediaEntryNames(parts.media.map((m) => m.id));
  const mediaMeta = parts.media.map((m, i) => {
    const meta = { ...m.meta } as Record<string, unknown>;
    delete meta.data;
    meta.file = mediaNames[i];
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
  return { mediaNames, dataJson: new TextEncoder().encode(JSON.stringify(dataJson)) };
}

export function buildFlog(snapshot: Snapshot): Uint8Array<ArrayBuffer> {
  const plan = planFlog({
    exportedAt: snapshot.exportedAt,
    lastModified: snapshot.lastModified,
    stores: snapshot.stores,
    // The Media record IS its own metadata here; planFlog copies it and drops
    // the bytes, exactly as this function used to do inline.
    media: snapshot.media.map((m) => ({ id: m.id, meta: m as unknown as Record<string, unknown> })),
  });
  return writeZip([
    { name: 'data.json', data: plan.dataJson },
    ...snapshot.media.map((m, i) => ({ name: String(plan.mediaNames[i]), data: new Uint8Array(m.data) }))
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

// ─── The copy LazyFlog hands out ──────────────────────────────────────────────
// LazyFlog keeps its parsed mediaMeta alive for the whole restore, because
// readMedia(i) reads meta.file out of it on every call. Handing callers a
// shallow { ...meta } meant a caller writing to a NESTED field wrote into the
// reader's own state, and two readMedia(0) calls came back sharing it.
//
// structuredClone, deliberately, and NOT a JSON round trip: JSON cannot
// represent -0 or ±Infinity, so a data.json holding "rot": -0 would read back as
// -0 from parseFlog and 0 from parseFlogLazy, and "w": 1e999 as Infinity from one
// and null from the other, with neither reader raising anything. That is exactly
// the two-readers-disagree defect rounds 1-3 chased, one layer down and
// introduced by the fix for it. Our own writer cannot produce either value
// (JSON.stringify flattens them on the way out), so this only bites on a file
// crafted or edited outside the app — which is precisely the kind of file both
// readers have to treat identically.
//
// BROWSER FLOOR, and it is a real one rather than a footnote. structuredClone
// needs Safari 15.4 (March 2022). vite.config.ts sets no `build.target`, so the
// shipped bundle uses Vite's default, which still lists safari14 — and the
// tsconfig `target: ES2022` does not constrain it, because that pass is
// --noEmit. This is the FIRST call in src/ that needs anything newer than
// Safari 14 (checked: no other post-14 API appears anywhere in src/), so it
// moves the app's real floor. Nothing regresses today, because parseFlogLazy
// has no callers yet — pass 2 wires it up. Before it does, either set
// build.target to match this floor deliberately, or replace this with a hand
// written deep copy and keep Safari 14. That is a decision about who can run
// the app, so it is Michael's, and it is written here so it cannot be made by
// accident.
//
// One honest limit on the sentence above: structuredClone is not total. It
// throws on functions and on structures nested a few thousand deep, where a
// spread would not. Neither can reach here — the input is always JSON.parse
// output, and JSON.parse with our reviver overflows on deeply nested input
// before this function is ever called (measured: both readers refuse together).
function cloneMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(meta);
  delete copy.file;
  return copy;
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
  const plan = planFlog(parts);
  const sources: import('./zip.ts').ZipSource[] = [
    { name: 'data.json', open: async () => plan.dataJson },
    // Call through m rather than passing m.open across: a FlogMediaSource is
    // free to be written as an object literal with a method that uses `this`
    // (the natural shape when it closes over a record), and handing the bare
    // function reference to the zip writer would detach it and call it with the
    // wrong receiver. The failure is not a type error — open() returns
    // undefined and the first sign of trouble is a crash inside crc32.
    ...parts.media.map((m, i) => ({ name: String(plan.mediaNames[i]), open: () => m.open() }))
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
    mediaMeta: mediaMeta.map((meta) => cloneMeta(meta)),
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
      const m = cloneMeta(meta);
      return { ...(m as unknown as Omit<Media, 'data'>), data: data.buffer };
    }
  };
}
