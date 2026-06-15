// The .flog sync file (spec §3.3): a zip holding data.json plus a media/
// folder with the actual photo/video bytes. Pure logic — no IndexedDB, no
// DOM — so the exact same code runs in the app and in the automated tests.

import { readZip, writeZip } from './zip.ts';
import type { Media } from './types.ts';

export const FLOG_FORMAT = 'FirearmLog';
export const FLOG_VERSION = 1;

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
  for (const m of media) if (m.updatedAt > newest) newest = m.updatedAt;
  return newest;
}

export function buildFlog(snapshot: Snapshot): Uint8Array {
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

export function parseFlog(bytes: Uint8Array): Snapshot {
  const entries = readZip(bytes);
  const dataEntry = entries.find((e) => e.name === 'data.json');
  if (!dataEntry) throw new Error("That file isn't a FirearmLog data file (data.json missing inside).");

  let parsed: unknown;
  try {
    // Audit CR-4: strip dangerous keys from an untrusted file so a malicious
    // backup can't pollute Object.prototype via __proto__/constructor/prototype.
    parsed = JSON.parse(new TextDecoder().decode(dataEntry.data), (key, value) =>
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

  const byName = new Map(entries.map((e) => [e.name, e.data]));
  const media: Media[] = (d.mediaMeta ?? []).map((meta) => {
    const file = String(meta.file ?? '');
    const bytesFor = byName.get(file);
    if (!bytesFor) throw new Error(`This data file looks damaged (missing ${file}).`);
    const m = { ...meta } as Record<string, unknown>;
    delete m.file;
    // Copy into a fresh buffer so the Media record owns its bytes outright.
    const owned = new Uint8Array(bytesFor.length);
    owned.set(bytesFor);
    return { ...(m as unknown as Omit<Media, 'data'>), data: owned.buffer };
  });

  return {
    exportedAt: typeof d.exportedAt === 'number' ? d.exportedAt : 0,
    lastModified: typeof d.lastModified === 'number' ? d.lastModified : 0,
    stores: d.stores,
    media
  };
}
