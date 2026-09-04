// Session 141, video-guards spec §3.1: pure logic for the capture-time
// large-video choice. No DOM, so the boundaries and the exact signed copy are
// tested here without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPickedFile,
  stillName,
  largeVideoSentence,
  DECODE_FAILURE_SENTENCE,
} from '../src/lib/videoGuard.ts';

const MB = 1024 * 1024;
const ASK = 100 * MB;
const MAX = 500 * MB;
const LIMITS = { askBytes: ASK, maxBytes: MAX };

test('classifyPickedFile: a photo never asks, at any size up to the max', () => {
  assert.equal(classifyPickedFile({ size: 1, isVideo: false }, LIMITS), 'stage');
  assert.equal(classifyPickedFile({ size: ASK, isVideo: false }, LIMITS), 'stage');
  assert.equal(classifyPickedFile({ size: ASK + 1, isVideo: false }, LIMITS), 'stage');
  assert.equal(classifyPickedFile({ size: MAX, isVideo: false }, LIMITS), 'stage');
});

test('classifyPickedFile: a photo over the max is refused, same as a video', () => {
  assert.equal(classifyPickedFile({ size: MAX + 1, isVideo: false }, LIMITS), 'refuse');
});

test('classifyPickedFile: a video at or under the ask line stages, exactly on the boundary', () => {
  assert.equal(classifyPickedFile({ size: ASK - 1, isVideo: true }, LIMITS), 'stage');
  assert.equal(classifyPickedFile({ size: ASK, isVideo: true }, LIMITS), 'stage');
});

test('classifyPickedFile: a video just over the ask line asks, exactly on the boundary', () => {
  assert.equal(classifyPickedFile({ size: ASK + 1, isVideo: true }, LIMITS), 'ask');
});

test('classifyPickedFile: a video at the max line still asks, not refuses', () => {
  assert.equal(classifyPickedFile({ size: MAX, isVideo: true }, LIMITS), 'ask');
});

test('classifyPickedFile: a video just over the max refuses, exactly on the boundary', () => {
  assert.equal(classifyPickedFile({ size: MAX + 1, isVideo: true }, LIMITS), 'refuse');
});

test('stillName: a normal extension is dropped and " (still)" added', () => {
  assert.equal(stillName('clip.MOV'), 'clip (still)');
  assert.equal(stillName('stage-1.webm'), 'stage-1 (still)');
});

test('stillName: a name with no extension is used as-is', () => {
  assert.equal(stillName('clip'), 'clip (still)');
});

test('stillName: a name that is only a dotted extension (nothing before the dot) is left whole', () => {
  assert.equal(stillName('.webm'), '.webm (still)');
});

// F6(d) (cold audit, session 141 fix pass 1): a mutation that dropped
// EVERYTHING from the first dot on (rather than only the last extension)
// survived the earlier suite — none of it had a name with more than one dot.
test('stillName: only the LAST dot is treated as the extension, on a multi-dot name', () => {
  assert.equal(stillName('range.day.mov'), 'range.day (still)');
});

test('largeVideoSentence: the exact signed copy, numbers derived via humanBytes', () => {
  const s = largeVideoSentence(150 * MB, MAX);
  assert.equal(
    s,
    'This video is 150 MB. Videos over 500 MB cannot be added: a file that size can crash the app on '
    + 'a phone. This one will load, but videos this size make backups large and slow. Keep it in the '
    + 'log, or keep a still frame and your notes instead?'
  );
});

test('largeVideoSentence: the size figure tracks the real byte count, not a hard-coded number', () => {
  const s = largeVideoSentence(143 * MB, MAX);
  assert.match(s, /^This video is 143 MB\./);
});

// F6(d) (cold audit, session 141 fix pass 1): the previous test only ever
// called this with maxBytes = 500 MB (the app's real MAX_MEDIA_BYTES), so a
// mutation that hard-coded "500 MB" into the "Videos over ..." clause,
// instead of deriving it from the maxBytes argument, survived. A DIFFERENT
// maxBytes here is what actually exercises that argument.
test('largeVideoSentence: the "Videos over ..." figure tracks maxBytes too, not just the byte count', () => {
  const s = largeVideoSentence(50 * MB, 300 * MB);
  assert.match(s, /^This video is 50 MB\. Videos over 300 MB cannot be added:/);
  assert.doesNotMatch(s, /500 MB/);
});

test('DECODE_FAILURE_SENTENCE: the exact signed copy for the decode-failure variant', () => {
  assert.equal(
    DECODE_FAILURE_SENTENCE,
    "A still frame can't be made from this video on this device, so the choice is to keep the video or not add it."
  );
});

test('the signed copy carries no em dash (rule 44)', () => {
  assert.doesNotMatch(largeVideoSentence(150 * MB, MAX), /—/);
  assert.doesNotMatch(DECODE_FAILURE_SENTENCE, /—/);
});
