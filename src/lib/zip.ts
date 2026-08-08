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
