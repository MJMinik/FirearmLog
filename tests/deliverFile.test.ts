// The presentation router that chooses HOW a Blob reaches the user (Share sheet
// on standalone iOS, new-window on other standalone, download anchor on
// desktop/tab). Real iOS can't run here, so the platform forks are proven by
// mocking navigator.share / canShare / standalone signals. See src/ui/deliverFile.ts
// for the bug this exists to prevent (anchor-to-blob navigating an installed
// iOS PWA to a blank white screen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canShareFile,
  deliverFile,
  isIOS,
  isStandalone,
  type DeliverOptions,
} from '../src/ui/deliverFile.ts';

// -- shared minimal doubles -------------------------------------------------

function makeNav(over: Partial<Navigator & {
  standalone?: boolean;
  canShare?: (d: ShareData) => boolean;
  share?: (d: ShareData) => Promise<void>;
  maxTouchPoints?: number;
}> = {}): Navigator {
  return {
    userAgent: 'test',
    platform: 'MacIntel',
    maxTouchPoints: 0,
    ...over,
  } as unknown as Navigator;
}

type FakeAnchor = HTMLAnchorElement & { clicked?: boolean };
function makeAnchor(): FakeAnchor {
  const a = { href: '', download: '' } as FakeAnchor;
  a.click = () => { a.clicked = true; };
  a.remove = () => { /* no-op */ };
  return a;
}

function baseOpts(): {
  opts: DeliverOptions;
  urls: string[];
  revoked: string[];
  anchors: FakeAnchor[];
  windows: string[];
} {
  const urls: string[] = [];
  const revoked: string[] = [];
  const anchors: FakeAnchor[] = [];
  const windows: string[] = [];
  const opts: DeliverOptions = {
    urlFor: () => { const u = `blob:test-${urls.length}`; urls.push(u); return u; },
    revoke: (u) => { revoked.push(u); },
    makeAnchor: () => { const a = makeAnchor(); anchors.push(a); return a; },
    openWindow: (u) => { windows.push(u); return {} as Window; },
  };
  return { opts, urls, revoked, anchors, windows };
}

// -- isIOS / isStandalone / canShareFile ------------------------------------

test('isIOS: iPhone user-agent is iOS', () => {
  const nav = makeNav({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)' });
  assert.equal(isIOS(nav), true);
});

test('isIOS: iPad reports MacIntel with touch — still counts as iOS', () => {
  const nav = makeNav({ userAgent: 'Mozilla/5.0 (Macintosh; ...) Safari/605.1', platform: 'MacIntel', maxTouchPoints: 5 });
  assert.equal(isIOS(nav), true);
});

test('isIOS: real Mac (no touch) is not iOS', () => {
  const nav = makeNav({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel', maxTouchPoints: 0 });
  assert.equal(isIOS(nav), false);
});

test('isStandalone: legacy navigator.standalone true wins', () => {
  const nav = makeNav({ standalone: true });
  assert.equal(isStandalone(nav), true);
});

test('isStandalone: no signal → false', () => {
  const nav = makeNav({ standalone: false });
  // Node has no matchMedia, so the media-query branch returns false — the whole
  // check should still return false, cleanly, not throw.
  assert.equal(isStandalone(nav), false);
});

test('canShareFile: missing canShare/share → false, no throw', () => {
  const nav = makeNav();
  const file = new File(['x'], 'x.flog', { type: 'application/octet-stream' });
  assert.equal(canShareFile(file, nav), false);
});

test('canShareFile: canShare throws → treated as unsupported (false, no throw)', () => {
  const nav = makeNav({
    canShare: () => { throw new Error('boom'); },
    share: async () => { /* not used */ },
  });
  const file = new File(['x'], 'x.flog', { type: 'application/octet-stream' });
  assert.equal(canShareFile(file, nav), false);
});

test('canShareFile: canShare and share present → true', () => {
  const nav = makeNav({
    canShare: () => true,
    share: async () => { /* not used */ },
  });
  const file = new File(['x'], 'x.flog', { type: 'application/octet-stream' });
  assert.equal(canShareFile(file, nav), true);
});

// -- deliverFile: platform forks --------------------------------------------

test('deliverFile: desktop takes the anchor download path', async () => {
  const nav = makeNav({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120' });
  const b = baseOpts();
  const outcome = await deliverFile(
    new Blob(['x'], { type: 'application/octet-stream' }),
    'FirearmLog.flog',
    'application/octet-stream',
    { ...b.opts, nav },
  );
  assert.deepEqual(outcome, { kind: 'download' });
  assert.equal(b.anchors.length, 1);
  assert.equal(b.anchors[0].download, 'FirearmLog.flog');
  assert.equal(b.anchors[0].clicked, true);
  assert.equal(b.windows.length, 0);
});

test('deliverFile: iOS Safari TAB (not standalone) still takes the anchor download path', async () => {
  const nav = makeNav({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)',
    standalone: false,
  });
  const b = baseOpts();
  const outcome = await deliverFile(
    new Blob(['x'], { type: 'application/octet-stream' }),
    'FirearmLog.flog',
    'application/octet-stream',
    { ...b.opts, nav },
  );
  assert.deepEqual(outcome, { kind: 'download' });
  assert.equal(b.anchors.length, 1);
});

test('deliverFile: standalone iOS + file-share support → Share sheet, shared=true', async () => {
  let sharedData: ShareData | undefined;
  const nav = makeNav({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)',
    standalone: true,
    canShare: () => true,
    share: async (d) => { sharedData = d; },
  });
  const b = baseOpts();
  const outcome = await deliverFile(
    new Blob(['x'], { type: 'application/octet-stream' }),
    'FirearmLog.flog',
    'application/octet-stream',
    { ...b.opts, nav },
  );
  assert.deepEqual(outcome, { kind: 'share', shared: true });
  assert.ok(sharedData?.files?.[0], 'share must be called with a file attachment');
  assert.equal(sharedData.files[0].name, 'FirearmLog.flog');
  // No anchor, no window — the file went through the OS share sheet only.
  assert.equal(b.anchors.length, 0);
  assert.equal(b.windows.length, 0);
});

test('deliverFile: standalone iOS + user cancels Share (AbortError) → shared=false, no throw', async () => {
  const nav = makeNav({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)',
    standalone: true,
    canShare: () => true,
    share: async () => {
      const e = new Error('The user aborted a request.');
      e.name = 'AbortError';
      throw e;
    },
  });
  const b = baseOpts();
  const outcome = await deliverFile(
    new Blob(['x'], { type: 'application/octet-stream' }),
    'FirearmLog.flog',
    'application/octet-stream',
    { ...b.opts, nav },
  );
  assert.deepEqual(outcome, { kind: 'share', shared: false });
  assert.equal(b.anchors.length, 0);
});

test('deliverFile: standalone iOS + real share error → rethrown to caller', async () => {
  const nav = makeNav({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)',
    standalone: true,
    canShare: () => true,
    share: async () => { throw new TypeError('permission denied'); },
  });
  const b = baseOpts();
  await assert.rejects(
    () => deliverFile(new Blob(['x']), 'FirearmLog.flog', 'application/octet-stream', { ...b.opts, nav }),
    /permission denied/,
  );
});

test('deliverFile: standalone iOS WITHOUT file-share support → opens a new window', async () => {
  const nav = makeNav({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)',
    standalone: true,
    // canShare missing entirely
  });
  const b = baseOpts();
  const outcome = await deliverFile(
    new Blob(['x'], { type: 'application/octet-stream' }),
    'FirearmLog.flog',
    'application/octet-stream',
    { ...b.opts, nav },
  );
  assert.deepEqual(outcome, { kind: 'window' });
  assert.equal(b.windows.length, 1);
  assert.equal(b.anchors.length, 0);
});

test('deliverFile: standalone iOS, no share, popup blocked → falls back to anchor download', async () => {
  const nav = makeNav({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)',
    standalone: true,
  });
  const b = baseOpts();
  const outcome = await deliverFile(
    new Blob(['x'], { type: 'application/octet-stream' }),
    'FirearmLog.flog',
    'application/octet-stream',
    { ...b.opts, nav, openWindow: () => null },
  );
  assert.deepEqual(outcome, { kind: 'download' });
  assert.equal(b.anchors.length, 1);
  // The pre-fallback URL was revoked, and the anchor got its own — one revoke queued.
  assert.ok(b.urls.length >= 2, 'both the popup-attempt URL and the anchor URL should be created');
});
