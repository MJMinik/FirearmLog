// Minimal ZIP writer/reader — entries are STORED (no compression), because
// photos and videos are already compressed. No outside code, full control.
// Works in the browser and in Node, so the same code is what gets tested.

export interface ZipEntry { name: string; data: Uint8Array; }

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

// The return type is Uint8Array<ArrayBuffer>, not the wider Uint8Array: the bytes
// below are allocated with `new Uint8Array(total)`, which always creates a plain
// ArrayBuffer (never a SharedArrayBuffer). Declaring what is actually allocated
// lets callers hand these bytes straight to a Blob with no cast — a cast is a
// promise the compiler cannot check, and this removes the need for one.
export function writeZip(entries: ZipEntry[], when: Date = new Date()): Uint8Array<ArrayBuffer> {
  const te = new TextEncoder();
  const { time, date } = dosDateTime(when);
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = te.encode(e.name);
    const crc = crc32(e.data);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);          // version needed
    lv.setUint16(6, 0, true);           // flags
    lv.setUint16(8, 0, true);           // method: stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);          // extra length
    local.set(name, 30);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);          // version made by
    cv.setUint16(6, 20, true);          // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    // 30 extra, 32 comment, 34 disk, 36 int attrs — all zero
    cv.setUint32(38, 0, true);          // ext attrs
    cv.setUint32(42, offset, true);     // local header offset
    cen.set(name, 46);

    parts.push(local, e.data);
    central.push(cen);
    offset += local.length + e.data.length;
  }

  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of [...parts, ...central, eocd]) { out.set(part, p); p += part.length; }
  return out;
}

// ─── Streaming writer ────────────────────────────────────────────────────────
// writeZipBlob builds the same bytes as writeZip but never holds more than one
// entry's payload in the JS heap at once. Each entry's bytes are handed to the
// browser's Blob store immediately after the CRC is computed — wrapped in their
// own `new Blob([bytes])` — and then the reference to `bytes` is dropped before
// the next source is opened. Pushing a raw Uint8Array into `parts` instead would
// retain every allocation in the array until the final Blob is assembled, so the
// peak would be identical to writeZip and the fix would be cosmetic. The Blob
// wrapper is the load-bearing step: it lets the engine spill to disk before the
// next large photo arrives. (See the P-8/memory-pressure thread for context.)

export interface ZipSource { name: string; open(): Promise<Uint8Array<ArrayBuffer>>; }

export async function writeZipBlob(sources: ZipSource[], when: Date = new Date()): Promise<Blob> {
  const te = new TextEncoder();
  const { time, date } = dosDateTime(when);
  // parts accumulates Blobs (not Uint8Arrays) so the engine can evict each
  // entry's payload to disk between iterations.
  const parts: Blob[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const src of sources) {
    const name = te.encode(src.name);
    const bytes = await src.open();
    const crc = crc32(bytes);

    const local: Uint8Array<ArrayBuffer> = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);          // version needed
    lv.setUint16(6, 0, true);           // flags
    lv.setUint16(8, 0, true);           // method: stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, bytes.length, true);
    lv.setUint32(22, bytes.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);          // extra length
    local.set(name, 30);

    const cen: Uint8Array<ArrayBuffer> = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);          // version made by
    cv.setUint16(6, 20, true);          // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, bytes.length, true);
    cv.setUint32(24, bytes.length, true);
    cv.setUint16(28, name.length, true);
    // 30 extra, 32 comment, 34 disk, 36 int attrs — all zero
    cv.setUint32(38, 0, true);          // ext attrs
    cv.setUint32(42, offset, true);     // local header offset
    cen.set(name, 46);

    // Wrap bytes in a Blob NOW, before advancing to the next source.
    // A Blob can be backed by disk; a Uint8Array in a JS array cannot.
    parts.push(new Blob([local]), new Blob([bytes]));
    central.push(cen);
    offset += local.length + bytes.length;
  }

  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd: Uint8Array<ArrayBuffer> = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, sources.length, true);
  ev.setUint16(10, sources.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...parts, ...central, eocd], { type: 'application/octet-stream' });
}

// ─── Directory-only reader ────────────────────────────────────────────────────
// readZipDirectory reads the central directory of a ZIP Blob without materialising
// any payload bytes. It exists so callers can decide which entries to read and
// then call readZipEntry for each one, keeping at most one payload in
// memory (instead of the whole file, as readZip does).

export interface ZipDirEntry { name: string; dataStart: number; size: number; crc: number; }

export async function readZipDirectory(blob: Blob): Promise<ZipDirEntry[]> {
  const td = new TextDecoder();
  const len = blob.size;
  // Audit CR-3 (same discipline as readZip): every offset and length read from
  // the file is bounds-checked before use.
  const bad = (): never => { throw new Error('This data file looks damaged or is not a FirearmLog data file.'); };

  // Read only the tail to locate the EOCD — same window as readZip uses on bytes.
  const tailSize = Math.min(len, 22 + 65535);
  const tailBuf = await blob.slice(len - tailSize, len).arrayBuffer();
  const tv = new DataView(tailBuf);

  let eocdInTail = -1;
  for (let i = tailSize - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === 0x06054b50) { eocdInTail = i; break; }
  }
  if (eocdInTail < 0) throw new Error('Not a FirearmLog data file (no zip directory found).');

  const eocdAbs = len - tailSize + eocdInTail;
  const count = tv.getUint16(eocdInTail + 10, true);
  if (count > 100000) bad(); // sanity cap — no real .flog has this many entries
  const cdSize = tv.getUint32(eocdInTail + 12, true);
  const cdOffset = tv.getUint32(eocdInTail + 16, true);
  if (cdOffset + cdSize > len || cdOffset > eocdAbs) bad();

  // Read the central directory in one slice.
  const cdBuf = await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer();
  const cd = new Uint8Array(cdBuf);
  const cdv = new DataView(cdBuf);
  const cdLen = cd.length;

  const entries: ZipDirEntry[] = [];
  let p = 0;

  for (let n = 0; n < count; n++) {
    if (p < 0 || p + 46 > cdLen) bad();
    if (cdv.getUint32(p, true) !== 0x02014b50) throw new Error('This data file looks damaged (directory entry missing).');
    const method = cdv.getUint16(p + 10, true);
    const crc = cdv.getUint32(p + 16, true);
    const compSize = cdv.getUint32(p + 20, true);
    const nameLen = cdv.getUint16(p + 28, true);
    const extraLen = cdv.getUint16(p + 30, true);
    const commentLen = cdv.getUint16(p + 32, true);
    const localOffset = cdv.getUint32(p + 42, true);
    if (p + 46 + nameLen > cdLen) bad();
    const name = td.decode(cd.subarray(p + 46, p + 46 + nameLen));
    if (method !== 0) throw new Error('This data file uses a packing method FirearmLog does not write.');

    // Read the local header to find dataStart — same as readZip, but via a
    // tiny slice of the blob rather than an in-memory Uint8Array.
    if (localOffset < 0 || localOffset + 30 > len) bad();
    const lhBuf = await blob.slice(localOffset, localOffset + 30).arrayBuffer();
    const lhv = new DataView(lhBuf);
    if (lhv.getUint32(0, true) !== 0x04034b50) bad();
    const lNameLen = lhv.getUint16(26, true);
    const lExtraLen = lhv.getUint16(28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    // compSize must fit inside the file (also blocks a multi-GB slice alloc).
    if (compSize > len || dataStart < 0 || dataStart + compSize > len) bad();

    entries.push({ name, dataStart, size: compSize, crc });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ─── Single-entry reader ──────────────────────────────────────────────────────
// readZipEntry materialises exactly one entry from a ZIP Blob. Callers drive
// the loop; peak memory at any point is one entry's bytes rather than the whole
// file (readZip's behaviour).

export async function readZipEntry(blob: Blob, entry: ZipDirEntry): Promise<Uint8Array<ArrayBuffer>> {
  const len = blob.size;
  const bad = (): never => { throw new Error('This data file looks damaged or is not a FirearmLog data file.'); };
  if (entry.dataStart < 0 || entry.dataStart + entry.size > len) bad();
  const buf = await blob.slice(entry.dataStart, entry.dataStart + entry.size).arrayBuffer();
  // A slice's ArrayBuffer is freshly allocated and not shared with the Blob, so
  // the caller may keep it outright — this is why the lazy reader needs no copy
  // where parseFlog makes one. Declaring Uint8Array<ArrayBuffer> is what lets
  // callers hand .buffer onward without a cast the compiler cannot check.
  const data: Uint8Array<ArrayBuffer> = new Uint8Array(buf);
  if (crc32(data) !== entry.crc) throw new Error(`This data file looks damaged (checksum failed on ${entry.name}).`);
  return data;
}

// ─── Original readZip (reference implementation — do not modify) ───────────────
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const td = new TextDecoder();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = bytes.length;
  // Audit CR-3: this reads an UNTRUSTED file. Every offset/length from the file
  // is bounds-checked before use so a corrupt or malicious zip can't drive an
  // out-of-bounds read or a giant allocation — it just fails with a clear error.
  const bad = (): never => { throw new Error('This data file looks damaged or is not a FirearmLog data file.'); };

  // Find the end-of-central-directory marker, scanning back past any comment.
  let eocd = -1;
  const lowest = Math.max(0, len - 22 - 65535);
  for (let i = len - 22; i >= lowest; i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a FirearmLog data file (no zip directory found).');

  const count = v.getUint16(eocd + 10, true);
  if (count > 100000) bad(); // sanity cap — no real .flog has this many entries
  let p = v.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];

  for (let n = 0; n < count; n++) {
    if (p < 0 || p + 46 > len) bad();
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('This data file looks damaged (directory entry missing).');
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const compSize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const localOffset = v.getUint32(p + 42, true);
    if (p + 46 + nameLen > len) bad();
    const name = td.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (method !== 0) throw new Error('This data file uses a packing method FirearmLog does not write.');

    // The local header the directory points at must exist and be a real header.
    if (localOffset < 0 || localOffset + 30 > len) bad();
    if (v.getUint32(localOffset, true) !== 0x04034b50) bad();
    const lNameLen = v.getUint16(localOffset + 26, true);
    const lExtraLen = v.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    // compSize must fit inside the file (also blocks a multi-GB slice alloc).
    if (compSize > len || dataStart < 0 || dataStart + compSize > len) bad();
    const data = bytes.slice(dataStart, dataStart + compSize);
    if (crc32(data) !== crc) throw new Error(`This data file looks damaged (checksum failed on ${name}).`);

    entries.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
