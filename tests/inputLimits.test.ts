// S-2 / S-3: the boundary-guard logic is pure, so its refusals are tested here
// without a browser. The UI screens just call these and show the returned string.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fileTooLargeMessage,
  textTooLongMessage,
  storageShortfallMessage,
  humanBytes,
  MAX_FLOG_BYTES,
  MAX_PASTE_CHARS,
} from '../src/lib/inputLimits.ts';

const MB = 1024 * 1024;
const GB = 1024 * MB;

test('fileTooLargeMessage: at or under the cap is allowed (null)', () => {
  assert.equal(fileTooLargeMessage(10 * MB, MAX_FLOG_BYTES, 'data file'), null);
  assert.equal(fileTooLargeMessage(MAX_FLOG_BYTES, MAX_FLOG_BYTES, 'data file'), null);
});

test('fileTooLargeMessage: over the cap refuses, names the noun, and says nothing was read', () => {
  const msg = fileTooLargeMessage(2 * GB, MAX_FLOG_BYTES, 'data file');
  assert.ok(msg, 'expected a refusal message');
  assert.match(msg, /data file/);
  assert.match(msg, /2 GB/);
  assert.match(msg, /Nothing was read/);
});

test('textTooLongMessage: at or under the cap is allowed, over is refused', () => {
  assert.equal(textTooLongMessage(100), null);
  assert.equal(textTooLongMessage(MAX_PASTE_CHARS), null);
  assert.ok(textTooLongMessage(MAX_PASTE_CHARS + 1));
});

test('storageShortfallMessage: unknown estimate never blocks (null)', () => {
  assert.equal(storageShortfallMessage(100, null), null);
  assert.equal(storageShortfallMessage(100, undefined), null);
  assert.equal(storageShortfallMessage(100, { usage: 5 }), null); // quota missing
});

test('storageShortfallMessage: null with room, a message when short', () => {
  assert.equal(storageShortfallMessage(100, { quota: 1000, usage: 200 }), null); // 800 free
  assert.equal(storageShortfallMessage(800, { quota: 1000, usage: 200 }), null); // exactly fits
  const msg = storageShortfallMessage(900, { quota: 1000, usage: 200 }); // needs 900, 800 free
  assert.ok(msg);
  assert.match(msg, /space/);
  assert.match(msg, /nothing on this device was changed/i);
});

test('humanBytes: MB below a gigabyte, GB at or above, 0 handled', () => {
  assert.equal(humanBytes(5 * MB), '5 MB');
  assert.equal(humanBytes(GB), '1 GB');
  assert.equal(humanBytes(GB + GB / 2), '1.5 GB');
  assert.equal(humanBytes(0), '0 MB');
});
