import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin, PHOTO_MAX_EDGE, PHOTO_QUALITY } from '../src/lib/imageResize.ts';

test('landscape larger than max scales down, long edge hits the cap, ratio kept', () => {
  const d = fitWithin(4000, 3000, 1600);
  assert.equal(d.w, 1600);
  assert.equal(d.h, 1200); // 3000 * (1600/4000)
});

test('portrait larger than max scales down on its long (height) edge', () => {
  const d = fitWithin(3000, 4000, 1600);
  assert.equal(d.h, 1600);
  assert.equal(d.w, 1200);
});

test('square scales to max x max', () => {
  const d = fitWithin(5000, 5000, 1600);
  assert.deepEqual(d, { w: 1600, h: 1600 });
});

test('already-small image is left unchanged (never upscaled)', () => {
  const d = fitWithin(800, 600, 1600);
  assert.deepEqual(d, { w: 800, h: 600 });
});

test('image exactly at the cap is unchanged', () => {
  const d = fitWithin(1600, 900, 1600);
  assert.deepEqual(d, { w: 1600, h: 900 });
});

test('zero / NaN inputs are guarded to at least 1px', () => {
  assert.deepEqual(fitWithin(0, 0, 1600), { w: 1, h: 1 });
  assert.deepEqual(fitWithin(Number.NaN, Number.NaN, 1600), { w: 1, h: 1 });
});

test('result never exceeds the cap on either edge', () => {
  for (const [w, h] of [[6000, 100], [100, 6000], [2400, 1600], [1601, 1601]]) {
    const d = fitWithin(w, h, 1600);
    assert.ok(Math.max(d.w, d.h) <= 1600, `long edge ${Math.max(d.w, d.h)} should be <= 1600`);
  }
});

test('defaults are the agreed 1600px / 0.8 quality', () => {
  assert.equal(PHOTO_MAX_EDGE, 1600);
  assert.equal(PHOTO_QUALITY, 0.8);
});
