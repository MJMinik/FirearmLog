import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, readZip, writeZip } from '../src/lib/zip.ts';

test('crc32 matches the standard check value', () => {
  // "123456789" -> 0xCBF43926 is the published CRC-32 test vector.
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});

test('zip round-trip: text and binary entries come back byte-for-byte', () => {
  const bin = new Uint8Array(10000);
  for (let i = 0; i < bin.length; i++) bin[i] = (i * 37) & 0xFF;
  const entries = [
    { name: 'data.json', data: new TextEncoder().encode('{"hello":"world"}') },
    { name: 'media/md-1', data: bin },
    { name: 'media/md-2', data: new Uint8Array(0) }
  ];
  const zipped = writeZip(entries, new Date(2026, 5, 11, 12, 0, 0));
  const back = readZip(zipped);
  assert.equal(back.length, 3);
  assert.deepEqual(back.map((e) => e.name), ['data.json', 'media/md-1', 'media/md-2']);
  assert.deepEqual([...back[1].data], [...bin]);
  assert.equal(new TextDecoder().decode(back[0].data), '{"hello":"world"}');
});

test('a damaged file is refused with a plain-language error', () => {
  const zipped = writeZip([{ name: 'a.txt', data: new TextEncoder().encode('hello hello') }]);
  zipped[35] ^= 0xFF; // flip a byte inside the stored data
  assert.throws(() => readZip(zipped), /damaged/);
});

test('random bytes are refused', () => {
  assert.throws(() => readZip(new Uint8Array(100)), /Not a FirearmLog data file/);
});

// ─── Tests for writeZipBlob, readZipDirectory, readZipEntry ──────────────────
// The overriding constraint: a file written by writeZipBlob must be byte-identical
// to one written by writeZip from the same input, and every existing corruption
// test must fire on the new reader with the same messages as readZip.

import {
  writeZipBlob, readZipDirectory, readZipEntry,
} from '../src/lib/zip.ts';
import type { ZipSource } from '../src/lib/zip.ts';
import { readFileSync } from 'node:fs';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeSource(name: string, data: Uint8Array<ArrayBuffer>): ZipSource {
  return { name, open: async () => data };
}

async function blobToBytes(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await blob.arrayBuffer()) as Uint8Array<ArrayBuffer>;
}

// Large-ish binary payload used across several tests.
const BIG = (() => {
  const b = new Uint8Array(110_000) as Uint8Array<ArrayBuffer>;
  for (let i = 0; i < b.length; i++) b[i] = (i * 137 + 7) & 0xFF;
  return b;
})();

// ── 1. Byte equivalence ───────────────────────────────────────────────────────
// For every case, new Uint8Array(await writeZipBlob(sources, when).arrayBuffer())
// must equal writeZip(entries, when) byte for byte.

const WHEN = new Date(2026, 5, 11, 12, 0, 0); // pinned so DOS timestamps match

test('byte-equivalence: zero entries', async () => {
  const blob = await writeZipBlob([], WHEN);
  const fromBlob = await blobToBytes(blob);
  const fromSync = writeZip([], WHEN);
  assert.deepEqual([...fromBlob], [...fromSync]);
});

test('byte-equivalence: one text entry', async () => {
  const data = new TextEncoder().encode('{"hello":"world"}') as Uint8Array<ArrayBuffer>;
  const blob = await writeZipBlob([makeSource('data.json', data)], WHEN);
  const fromBlob = await blobToBytes(blob);
  const fromSync = writeZip([{ name: 'data.json', data }], WHEN);
  assert.deepEqual([...fromBlob], [...fromSync]);
});

test('byte-equivalence: zero-length entry', async () => {
  const empty = new Uint8Array(0) as Uint8Array<ArrayBuffer>;
  const blob = await writeZipBlob([makeSource('empty', empty)], WHEN);
  const fromBlob = await blobToBytes(blob);
  const fromSync = writeZip([{ name: 'empty', data: empty }], WHEN);
  assert.deepEqual([...fromBlob], [...fromSync]);
});

test('byte-equivalence: several entries including one >100 KB', async () => {
  const small1 = new TextEncoder().encode('small-a') as Uint8Array<ArrayBuffer>;
  const small2 = new Uint8Array(0) as Uint8Array<ArrayBuffer>;
  const sources: ZipSource[] = [
    makeSource('data.json', small1),
    makeSource('media/big', BIG),
    makeSource('media/empty', small2),
  ];
  const entries = [
    { name: 'data.json', data: small1 },
    { name: 'media/big', data: BIG },
    { name: 'media/empty', data: small2 },
  ];
  const blob = await writeZipBlob(sources, WHEN);
  const fromBlob = await blobToBytes(blob);
  const fromSync = writeZip(entries, WHEN);
  assert.deepEqual([...fromBlob], [...fromSync]);
});

test('byte-equivalence: multi-byte UTF-8 name (emoji in path)', async () => {
  // A name with multi-byte UTF-8 characters stresses the name-length field.
  const data = new TextEncoder().encode('hi') as Uint8Array<ArrayBuffer>;
  const name = 'media/café-🔫';
  const blob = await writeZipBlob([makeSource(name, data)], WHEN);
  const fromBlob = await blobToBytes(blob);
  const fromSync = writeZip([{ name, data }], WHEN);
  assert.deepEqual([...fromBlob], [...fromSync]);
});

// ── 2. Round-trip through the new reader ─────────────────────────────────────

test('round-trip: writeZipBlob → readZipDirectory → readZipEntry returns exact bytes', async () => {
  const text = new TextEncoder().encode('round-trip text') as Uint8Array<ArrayBuffer>;
  const sources: ZipSource[] = [
    makeSource('data.json', text),
    makeSource('media/big', BIG),
    makeSource('media/empty', new Uint8Array(0) as Uint8Array<ArrayBuffer>),
  ];
  const blob = await writeZipBlob(sources, WHEN);
  const dir = await readZipDirectory(blob);
  assert.equal(dir.length, 3);
  assert.deepEqual(dir.map((e) => e.name), ['data.json', 'media/big', 'media/empty']);

  const back0 = await readZipEntry(blob, dir[0]);
  assert.deepEqual([...back0], [...text]);

  const back1 = await readZipEntry(blob, dir[1]);
  assert.deepEqual([...back1], [...BIG]);

  const back2 = await readZipEntry(blob, dir[2]);
  assert.equal(back2.length, 0);
});

test('round-trip: readZip on writeZipBlob output agrees with readZipDirectory', async () => {
  const text = new TextEncoder().encode('abc') as Uint8Array<ArrayBuffer>;
  const sources: ZipSource[] = [makeSource('a.txt', text)];
  const blob = await writeZipBlob(sources, WHEN);

  // Old reader on new writer's output
  const oldResult = readZip(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(oldResult.length, 1);
  assert.deepEqual([...oldResult[0].data], [...text]);

  // New reader on old writer's output
  const oldZip = writeZip([{ name: 'a.txt', data: text }], WHEN);
  const oldBlob = new Blob([oldZip]);
  const newDir = await readZipDirectory(oldBlob);
  assert.equal(newDir.length, 1);
  const newEntry = await readZipEntry(oldBlob, newDir[0]);
  assert.deepEqual([...newEntry], [...text]);
});

// ── 3. Cross-compatibility ────────────────────────────────────────────────────

test('cross-compat: writeZip output readable by readZipDirectory + readZipEntry', async () => {
  const data = new TextEncoder().encode('cross-compat') as Uint8Array<ArrayBuffer>;
  const bytes = writeZip([{ name: 'x.txt', data }], WHEN);
  const blob = new Blob([bytes]);
  const dir = await readZipDirectory(blob);
  assert.equal(dir.length, 1);
  const entry = await readZipEntry(blob, dir[0]);
  assert.deepEqual([...entry], [...data]);
});

test('cross-compat: writeZipBlob output readable by readZip', async () => {
  const data = new TextEncoder().encode('cross-compat-blob') as Uint8Array<ArrayBuffer>;
  const blob = await writeZipBlob([makeSource('y.txt', data)], WHEN);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const entries = readZip(bytes);
  assert.equal(entries.length, 1);
  assert.deepEqual([...entries[0].data], [...data]);
});

// ── 4. Corruption tests repeated for the new reader ──────────────────────────
// Every message must match the existing readZip messages exactly (same wording,
// not just same shape) because the error strings are user-facing.

test('new reader: flipped byte inside data triggers checksum error', async () => {
  const data = new TextEncoder().encode('hello hello') as Uint8Array<ArrayBuffer>;
  const bytes = writeZip([{ name: 'a.txt', data }], WHEN);
  // byte 35 is the first byte of the stored data (30-byte local header + 5-char name)
  bytes[35] ^= 0xFF;
  const blob = new Blob([bytes]);
  await assert.rejects(
    async () => {
      const dir = await readZipDirectory(blob);
      await readZipEntry(blob, dir[0]);
    },
    /damaged/,
  );
});

test('new reader: random bytes have no zip directory', async () => {
  const blob = new Blob([new Uint8Array(100)]);
  await assert.rejects(readZipDirectory(blob), /Not a FirearmLog data file \(no zip directory found\)/);
});

test('new reader: truncated file is refused', async () => {
  const data = new TextEncoder().encode('hello') as Uint8Array<ArrayBuffer>;
  const bytes = writeZip([{ name: 'a.txt', data }]);
  // truncate to half — no valid EOCD possible
  const blob = new Blob([bytes.slice(0, bytes.length >> 1)]);
  await assert.rejects(readZipDirectory(blob), /Not a FirearmLog data file/);
});

test('new reader: bad directory signature is refused', async () => {
  const data = new TextEncoder().encode('hello') as Uint8Array<ArrayBuffer>;
  const bytes = writeZip([{ name: 'a.txt', data }]);
  // The central directory starts right after the local header + data.
  // local header = 30 + 5 (name) = 35 bytes, data = 5 bytes, so CD starts at 40.
  // Flip the first byte of the CD signature to break it.
  bytes[40] ^= 0xFF;
  const blob = new Blob([bytes]);
  await assert.rejects(readZipDirectory(blob), /damaged/);
});

test('new reader: non-zero compression method is refused', async () => {
  const data = new TextEncoder().encode('hello') as Uint8Array<ArrayBuffer>;
  const bytes = writeZip([{ name: 'a.txt', data }]);
  // Central directory method field is at CD+10. CD starts at 40 (35+5).
  // Find the CD: scan from the end for the EOCD, read cdOffset.
  const v = new DataView(bytes.buffer);
  const len = bytes.length;
  let eocdPos = -1;
  for (let i = len - 22; i >= 0; i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocdPos = i; break; }
  }
  const cdOffset = v.getUint32(eocdPos + 16, true);
  // method is at CD entry offset +10
  v.setUint16(cdOffset + 10, 8, true); // 8 = DEFLATE
  const blob = new Blob([bytes]);
  await assert.rejects(readZipDirectory(blob), /packing method/);
});

// The entry count is a uint16, so the "absurd count" this once claimed to test
// is not expressible: 200000 & 0xFFFF is 3392, which no cap would have caught.
// What actually protects us is that a count higher than the directory holds runs
// the walk off the end. That is what this now asserts, at the highest count the
// format can express.
test('new reader: an entry count higher than the directory holds is refused', async () => {
  const data = new TextEncoder().encode('hi') as Uint8Array<ArrayBuffer>;
  const bytes = writeZip([{ name: 'a.txt', data }]);
  const v = new DataView(bytes.buffer);
  const eocdPos = findEocd(bytes);
  v.setUint16(eocdPos + 8, 0xFFFF, true);
  v.setUint16(eocdPos + 10, 0xFFFF, true);
  await assert.rejects(readZipDirectory(new Blob([bytes])), /damaged/);
});

// ── 4b. Guards that nothing was watching ─────────────────────────────────────
// The cold audit of this branch found three checks in the new reader that could
// be deleted with the whole suite still green. A bounds check on untrusted input
// that no test watches is one careless refactor from being gone, so each gets a
// hand-built hostile file here. Each of these was confirmed to go red with its
// guard removed.

function findEocd(bytes: Uint8Array): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (v.getUint32(i, true) === 0x06054b50) return i;
  }
  throw new Error('test fixture has no EOCD');
}

// Outcome test, not a line test: the refusal here is doubly guarded (an explicit
// cdOffset > eocdAbs check, and the directory walk running off an empty slice),
// so removing either one alone leaves this green. What matters is that a file
// claiming its directory starts after the record that ends it never opens.
test('new reader: a directory offset pointing past the EOCD is refused', async () => {
  const data = new TextEncoder().encode('hi') as Uint8Array<ArrayBuffer>;
  const bytes = writeZip([{ name: 'a.txt', data }]);
  const v = new DataView(bytes.buffer);
  const eocdPos = findEocd(bytes);
  // Claim the directory starts after the record that terminates it.
  v.setUint32(eocdPos + 16, bytes.length - 4, true);
  await assert.rejects(readZipDirectory(new Blob([bytes])), /damaged/);
});

test('new reader: an entry whose payload runs past the end of the file is refused', async () => {
  const data = new TextEncoder().encode('hi') as Uint8Array<ArrayBuffer>;
  const bytes = writeZip([{ name: 'a.txt', data }]);
  const v = new DataView(bytes.buffer);
  const eocdPos = findEocd(bytes);
  const cdOffset = v.getUint32(eocdPos + 16, true);
  // Central-directory compressed size (+20) claims far more than the file holds.
  v.setUint32(cdOffset + 20, 0x7FFFFFF0, true);
  await assert.rejects(readZipDirectory(new Blob([bytes])), /damaged/);
});

// ── 4c. The new reader must not be STRICTER than readZip ─────────────────────
// readZip never reads the EOCD's cdSize field; it walks from cdOffset and bounds
// against the file. An earlier version of readZipDirectory sliced exactly cdSize
// bytes, which meant a .flog with a damaged cdSize field — and everything else
// intact — opened under the old reader and failed under the new one. Since the
// new reader is destined to replace the old one on the restore path, that is a
// file the owner could restore before the change and not after.
test('new reader: a wrong cdSize field does not stop a good file opening', async () => {
  const data = new TextEncoder().encode('hi') as Uint8Array<ArrayBuffer>;
  const bytes = writeZip([{ name: 'a.txt', data }]);
  const v = new DataView(bytes.buffer);
  const eocdPos = findEocd(bytes);
  v.setUint32(eocdPos + 12, 0, true);            // cdSize lies: says empty
  const viaOld = readZip(bytes);                  // old reader is unbothered
  assert.equal(viaOld.length, 1);
  const entries = await readZipDirectory(new Blob([bytes]));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'a.txt');
});

// ── 5. Memory-discipline guards — SOURCE TEXT, NOT BEHAVIOUR ─────────────────
// Read the names carefully: these grep the source for two specific regressions
// (reintroducing `new Uint8Array(total)`, or calling .arrayBuffer() on the whole
// Blob). They do NOT measure memory, and the cold audit of this branch proved
// the limit by adding a line that retained every payload — the exact bug the
// function exists to avoid — with the whole suite still green.
//
// Node cannot stand in for the real proof here: its Blob COPIES its inputs and
// copies again on concatenation, so measuring in Node reports the new path as
// worse than the old one. The real evidence is a Chromium measurement recorded
// on the pull request (renderer resident memory over a 200 MB library in 4
// files: write grew 415 MB -> 94 MB, read grew 603 MB -> 142 MB). WebKit is
// unproven from CI; the owner's iPhone is the deciding test.
//
// So: keep these as cheap tripwires for an obvious edit, and never read a green
// run here as evidence that the memory property still holds.

test('source guard (not a memory measurement): writeZipBlob body has no whole-file Uint8Array allocation', () => {
  const src = readFileSync('src/lib/zip.ts', 'utf8');
  // Find the body of writeZipBlob.
  const startIdx = src.indexOf('export async function writeZipBlob(');
  assert.ok(startIdx !== -1, 'writeZipBlob not found in zip.ts');
  let depth = 0, bodyStart = -1, bodyEnd = -1;
  for (let i = startIdx; i < src.length; i++) {
    if (src[i] === '{') {
      if (depth === 0) bodyStart = i;
      depth++;
    } else if (src[i] === '}') {
      depth--;
      if (depth === 0) { bodyEnd = i; break; }
    }
  }
  assert.ok(bodyEnd > bodyStart, 'could not find writeZipBlob body');
  const body = src.slice(bodyStart, bodyEnd + 1);
  // Ban every allocation in the body except the three small fixed-size ones a
  // ZIP header needs. An earlier version banned the literal string
  // `new Uint8Array(total)`, which the second audit pass pointed out is defeated
  // by renaming the variable to `size`. Allowlisting the arguments instead means
  // ANY new allocation has to be added here deliberately.
  const ALLOWED_ALLOCATIONS = ['30 + name.length', '46 + name.length', '22'];
  const allocations = [...body.matchAll(/new Uint8Array\(([^)]*)\)/g)].map((m) => m[1].trim());
  const unexpected = allocations.filter((a) => !ALLOWED_ALLOCATIONS.includes(a));
  assert.deepEqual(
    unexpected, [],
    `writeZipBlob allocates a Uint8Array this guard does not recognise: ${unexpected.join(', ')}. ` +
    'If it is small and per-entry, add it to ALLOWED_ALLOCATIONS. If it is sized by the whole ' +
    'archive, the streaming property has been lost.',
  );
  // Positive check: entries must be wrapped in Blob before the loop advances.
  assert.ok(
    body.includes('new Blob([local])') && body.includes('new Blob([bytes])'),
    'writeZipBlob must wrap each entry in a Blob immediately — Blob([local]) and Blob([bytes]) not found',
  );
});

test('source guard (not a memory measurement): parseFlogLazy body does not call .arrayBuffer() on the whole blob', () => {
  const src = readFileSync('src/lib/flog.ts', 'utf8');
  const startIdx = src.indexOf('export async function parseFlogLazy(');
  assert.ok(startIdx !== -1, 'parseFlogLazy not found in flog.ts');
  let depth = 0, bodyStart = -1, bodyEnd = -1;
  for (let i = startIdx; i < src.length; i++) {
    if (src[i] === '{') {
      if (depth === 0) bodyStart = i;
      depth++;
    } else if (src[i] === '}') {
      depth--;
      if (depth === 0) { bodyEnd = i; break; }
    }
  }
  assert.ok(bodyEnd > bodyStart, 'could not find parseFlogLazy body');
  const body = src.slice(bodyStart, bodyEnd + 1);
  // The forbidden pattern is `blob.arrayBuffer()` — reading the whole file
  // into one buffer. The lazy path must only ever slice the blob and call
  // .arrayBuffer() on those small slices (inside readZipDirectory/readZipEntry).
  assert.equal(
    /\bblob\.arrayBuffer\(\)/.test(body),
    false,
    'parseFlogLazy calls blob.arrayBuffer() — whole-file allocation reintroduced',
  );
});

// ── 6. Format limits: refuse rather than wrap ────────────────────────────────
// A plain ZIP holds the entry count in 16 bits. Writing 65,536 entries used to
// store a count of 0, and readZip read that file back as an empty archive
// without complaint — a backup that reports success and restores as nothing.
// Both writers now refuse. The >4 GB case has the same shape and cannot be
// tested here without allocating 4 GB, so only the count is exercised.

test('writeZip refuses more entries than the format can count', () => {
  const empty = new Uint8Array(0) as Uint8Array<ArrayBuffer>;
  const many = Array.from({ length: 65536 }, (_, i) => ({ name: `m/${i}`, data: empty }));
  assert.throws(() => writeZip(many), /too many photos and videos/);
});

test('writeZipBlob refuses more entries than the format can count', async () => {
  const empty = new Uint8Array(0) as Uint8Array<ArrayBuffer>;
  const many = Array.from({ length: 65536 }, (_, i) => ({
    name: `m/${i}`, open: async () => empty
  }));
  await assert.rejects(writeZipBlob(many), /too many photos and videos/);
});

test('writeZip still accepts the largest count the format CAN hold', () => {
  const empty = new Uint8Array(0) as Uint8Array<ArrayBuffer>;
  const many = Array.from({ length: 65535 }, (_, i) => ({ name: `m/${i}`, data: empty }));
  const bytes = writeZip(many);
  assert.equal(readZip(bytes).length, 65535, 'the boundary itself must still work');
});

// ── 7. Two more guards the second audit pass found unwatched ─────────────────

test('new reader: a directory name length overrunning the directory is refused', async () => {
  const data = new TextEncoder().encode('hi') as Uint8Array<ArrayBuffer>;
  const bytes = writeZip([{ name: 'a.txt', data }]);
  const v = new DataView(bytes.buffer);
  const eocdPos = findEocd(bytes);
  const cdOffset = v.getUint32(eocdPos + 16, true);
  v.setUint16(cdOffset + 28, 0xFFFF, true);   // nameLen claims 65535
  await assert.rejects(readZipDirectory(new Blob([bytes])), /damaged/);
});

test('new reader: a local-header offset past the end of the file is refused plainly', async () => {
  const data = new TextEncoder().encode('hi') as Uint8Array<ArrayBuffer>;
  const bytes = writeZip([{ name: 'a.txt', data }]);
  const v = new DataView(bytes.buffer);
  const eocdPos = findEocd(bytes);
  const cdOffset = v.getUint32(eocdPos + 16, true);
  v.setUint32(cdOffset + 42, bytes.length - 2, true);  // local header past the end
  // Must be the plain-language error, NOT a raw RangeError from a DataView read.
  await assert.rejects(readZipDirectory(new Blob([bytes])), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /damaged/);
    assert.equal(err.constructor.name, 'Error', 'a crash shape must not reach the restore path');
    return true;
  });
});
