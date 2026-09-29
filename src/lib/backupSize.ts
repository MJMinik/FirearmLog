// The library's size, where the cost is felt (spec §3.2). Pure logic — the
// tally wraps FlogMediaSource.open() (no DOM, no IndexedDB) so it's
// unit-tested with fake sources; SyncCard.tsx wires it into the real save
// path and AppSettings persists the two numbers.
import type { FlogMediaSource } from './flog.ts';
import { humanBytes } from './inputLimits.ts';

export interface BackupSizeTotals {
  /** Every media byte read while packing the archive. */
  total: number;
  /** The subset of `total` whose record's `meta.kind === 'video'`. */
  video: number;
}

export interface TalliedSources {
  /** Pass these to buildFlogBlob in place of the originals — each wraps the
   *  real open() and adds its byte count to the running total as it's read,
   *  so the tally costs nothing extra: it rides the same pass buildFlogBlob
   *  already makes to write the archive. */
  sources: FlogMediaSource[];
  /** Read AFTER buildFlogBlob's promise resolves — the totals are only
   *  complete once every source has actually been opened. */
  sizes(): BackupSizeTotals;
}

/** Wrap a list of FlogMediaSource so their bytes are tallied as they're read.
 *  `meta.kind === 'video'` decides the video subtotal — the same field
 *  scanMediaExportSources already carries on every source's meta. */
export function tallySources(sources: readonly FlogMediaSource[]): TalliedSources {
  let total = 0;
  let video = 0;
  const wrapped: FlogMediaSource[] = sources.map((s) => ({
    id: s.id,
    meta: s.meta,
    open: async () => {
      const bytes = await s.open();
      total += bytes.byteLength;
      if (s.meta.kind === 'video') video += bytes.byteLength;
      return bytes;
    },
  }));
  return { sources: wrapped, sizes: () => ({ total, video }) };
}

/** THE SIGNED COPY (the "Your Data File Is Ready" sheet summary). `fileBytes`
 *  is the finished file's true size (blob.size); `videoBytes` the video tally.
 *  The ", of which… is video" clause is dropped entirely when there's no
 *  video in the backup. */
export function backupSummary(
  sessions: number, photos: number, fileBytes: number, videoBytes: number
): string {
  const base = `${sessions} sessions and ${photos} photos/videos, packed and ready: ${humanBytes(fileBytes)}`;
  return videoBytes > 0 ? `${base}, of which ${humanBytes(videoBytes)} is video.` : `${base}.`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A local (not UTC) "3 Sep"-style date — day then month, matching the signed
 *  copy exactly. Same reasoning as backupFileName in flog.ts: a hand-built
 *  date rather than toLocaleString keeps this testable without depending on
 *  the runtime's ICU data. */
export function shortDate(atMs: number): string {
  const d = new Date(atMs);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** THE SIGNED COPY (the Sync & Backup status line). Replaces, rather than
 *  joins, the older date-only "Last saved to the file…" line — call this only
 *  when `bytes` was actually recorded; an older install with a backup stamp
 *  but no recorded size shows nothing here (see SyncCard.tsx). */
export function lastBackupLine(bytes: number, videoBytes: number, atMs: number): string {
  const videoPart = videoBytes > 0 ? ` (${humanBytes(videoBytes)} video)` : '';
  return `Last backup: ${humanBytes(bytes)}${videoPart}, ${shortDate(atMs)}.`;
}

/** THE SYNC & BACKUP "LOADED" LINE (backup-line spec §3). After Load from File
 *  the card names both dates: when the load happened and when the loaded file
 *  was made. `saveSince` is true once a Save to File has happened after the
 *  load: then only the two dates are said (it sits under the newer "Last
 *  backup" line); until then it also says how to make a newer backup.
 *
 *  It does NOT quote a file size, unlike the spec's example line. The sizes
 *  kept in settings after a load are the ones the file itself carried, and a
 *  file carries the sizes of the save BEFORE it (the same one-save-old effect
 *  as its date stamp, spec §1), so quoting them here could state a wrong
 *  number about this file. */
export function loadedBackupLine(loadedAtMs: number, madeAtMs: number, saveSince: boolean): string {
  const base = `Loaded ${shortDate(loadedAtMs)} from a backup made ${shortDate(madeAtMs)}.`;
  return saveSince ? base : `${base} Save to File from this device to make a newer one.`;
}
