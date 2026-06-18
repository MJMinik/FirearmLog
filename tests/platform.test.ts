import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectInstallTarget } from '../src/lib/platform.ts';

test('iPhone Safari -> ios', () => {
  assert.equal(detectInstallTarget({
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Safari/604',
    platform: 'iPhone', maxTouchPoints: 5
  }), 'ios');
});

test('iPadOS reports as Mac with touch -> ios', () => {
  assert.equal(detectInstallTarget({
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605 Version/17 Safari/605',
    platform: 'MacIntel', maxTouchPoints: 5
  }), 'ios');
});

test('Android Chrome -> android', () => {
  assert.equal(detectInstallTarget({
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537 Chrome/120 Mobile Safari/537',
    platform: 'Linux armv8l', maxTouchPoints: 5
  }), 'android');
});

test('Mac Safari (no touch) -> mac-safari', () => {
  assert.equal(detectInstallTarget({
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605 Version/17 Safari/605',
    platform: 'MacIntel', maxTouchPoints: 0
  }), 'mac-safari');
});

test('Mac Chrome -> desktop', () => {
  assert.equal(detectInstallTarget({
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537 Chrome/120 Safari/537',
    platform: 'MacIntel', maxTouchPoints: 0
  }), 'desktop');
});

test('Windows Chrome -> desktop', () => {
  assert.equal(detectInstallTarget({
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537 Chrome/120 Safari/537',
    platform: 'Win32', maxTouchPoints: 0
  }), 'desktop');
});
