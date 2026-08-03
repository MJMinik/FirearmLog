import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedDemo, gotoTab } from './helpers';

// Session 101 — Michael attached four stage videos to his first sanctioned
// match and every tile came up EMPTY in Safari.
//
// Cause: a bare `<video preload="metadata">` is only asked for duration and
// dimensions. The HTML standard never says the browser must then paint a
// frame; Chrome does it as a courtesy, Safari does not. So the tile sized
// itself correctly, captioned itself correctly, and showed nothing.
//
// Fix (VideoFrame.tsx): once metadata arrives we SEEK a tenth of a second in,
// because seeking IS specified — after a seek completes, the frame at that
// position is what the element displays.
//
// THIS SPEC HAS TO BE ABLE TO FAIL, and that shapes what it asserts. Chromium
// paints the first frame with or without our fix, so "is a frame visible" is
// green on the broken build and proves nothing. THE ONLY DISCRIMINATING
// ASSERTION IS `currentTime > 0` — the readyState checks beside it are sanity
// checks, and they are green on the broken build too (a small file buffers
// fully whatever `preload` says). Said plainly because a header that claims
// two proofs and delivers one is how a suite comes to be trusted for the
// wrong reasons. Verified against the pre-fix tree: the currentTime polls fail.
//
// The third case guards the defect the pre-push cold audit found: forcing the
// frame ALSO left the watch-it surfaces starting a tenth of a second in, which
// would have silently clipped the opening of every match video, sound and all.
const FIXTURE = readFileSync(fileURLToPath(new URL('./fixtures/tiny.webm', import.meta.url)));

/** Open the first match in the demo log, then its Edit form. */
async function openFirstMatchEdit(page: import('@playwright/test').Page): Promise<void> {
  await gotoTab(page, 'Compete');
  const main = page.getByRole('main');
  const matchesCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Matches' }) });
  await matchesCard.locator('.row-tap').first().click();
  await main.getByRole('button', { name: 'Edit' }).first().click();
  await expect(page.getByRole('heading', { name: 'Edit Match' })).toBeVisible();
}

/** The media card on the match form — the exact surface Michael reported. */
function mediaCard(page: import('@playwright/test').Page) {
  return page.getByRole('main').locator('.card').filter({
    has: page.getByRole('heading', { name: 'Stage Videos & Photos' }),
  });
}

test.describe('Video thumbnails paint a real frame', () => {
  test('a just-picked video seeks to a frame instead of sitting blank', async ({ page }) => {
    await seedDemo(page);
    await openFirstMatchEdit(page);

    const card = mediaCard(page);
    await card.locator('input[type="file"]').setInputFiles({
      name: 'stage-1.webm', mimeType: 'video/webm', buffer: FIXTURE,
    });

    const video = card.locator('.thumb-tap video').first();
    await expect(video).toHaveCount(1);

    // The seek is the whole fix. On the pre-fix build currentTime stays 0.
    await expect.poll(
      async () => video.evaluate((v: HTMLVideoElement) => v.currentTime),
      { message: 'the thumbnail never seeked off zero, so no frame was forced' }
    ).toBeGreaterThan(0);

    // ...and a frame really is decoded and available to paint.
    // readyState >= 2 is HAVE_CURRENT_DATA.
    await expect.poll(
      async () => video.evaluate((v: HTMLVideoElement) => v.readyState)
    ).toBeGreaterThanOrEqual(2);

    // A video tile is no longer indistinguishable from a photo tile.
    await expect(card.locator('.video-badge')).toHaveCount(1);
  });

  test('a SAVED video still shows a frame after the match is reopened', async ({ page }) => {
    await seedDemo(page);
    await openFirstMatchEdit(page);

    const card = mediaCard(page);
    await card.locator('input[type="file"]').setInputFiles({
      name: 'stage-1.webm', mimeType: 'video/webm', buffer: FIXTURE,
    });
    await expect(card.locator('.thumb-tap video')).toHaveCount(1);

    await page.getByRole('main').getByRole('button', { name: /^Save/ }).first().click();

    // Back on the match detail, the stored video reads from IndexedDB through
    // MarkThumb — a different code path from the staged file above, and the one
    // that was blank on Michael's four saved videos.
    const detailVideo = page.getByRole('main').locator('.photo-grid video').first();
    await expect(detailVideo).toHaveCount(1);
    await expect.poll(
      async () => detailVideo.evaluate((v: HTMLVideoElement) => v.currentTime),
      { message: 'the saved-video thumbnail never seeked off zero' }
    ).toBeGreaterThan(0);
    await expect.poll(
      async () => detailVideo.evaluate((v: HTMLVideoElement) => v.readyState)
    ).toBeGreaterThanOrEqual(2);
  });

  test('the full-screen player forces a frame AND still starts at the beginning, with sound', async ({ page }) => {
    // Record every seek the app asks for, per element. `currentTime === 0` at
    // the end is true both of a correct round trip AND of a build that stopped
    // seeking controls videos altogether — which would be the original Safari
    // blank bug returning to the player. Only the history tells them apart.
    await page.addInitScript(() => {
      const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
      if (!desc?.set) return;
      const seen = new WeakMap<HTMLMediaElement, number[]>();
      (window as unknown as { __seeks: WeakMap<HTMLMediaElement, number[]> }).__seeks = seen;
      Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
        ...desc,
        set(this: HTMLMediaElement, value: number) {
          const list = seen.get(this) ?? [];
          list.push(value);
          seen.set(this, list);
          desc.set!.call(this, value);
        },
      });
    });

    await seedDemo(page);
    await openFirstMatchEdit(page);

    const card = mediaCard(page);
    await card.locator('input[type="file"]').setInputFiles({
      name: 'stage-1.webm', mimeType: 'video/webm', buffer: FIXTURE,
    });
    await expect(card.locator('.thumb-tap video')).toHaveCount(1);
    await page.getByRole('main').getByRole('button', { name: /^Save/ }).first().click();

    // Thumbnail -> the Video sheet -> the full-screen player.
    await page.getByRole('main').locator('.thumb-tap').first().click();
    const sheet = page.getByRole('dialog', { name: 'Video' }).first();
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Open video full screen' }).click();

    const player = page.locator('video.lightbox-media');
    await expect(player).toHaveCount(1);

    // A frame is decoded — the shooter is not looking at a black rectangle...
    await expect.poll(
      async () => player.evaluate((v: HTMLVideoElement) => v.readyState)
    ).toBeGreaterThanOrEqual(2);

    // ...and the playhead is back at zero, so pressing play starts at the
    // start. Forcing the frame must not eat the opening of his run.
    await expect.poll(
      async () => player.evaluate((v: HTMLVideoElement) => v.currentTime),
      { message: 'the full-screen player was left parked past the start of the video' }
    ).toBe(0);

    // And it got there the right way: a seek PAST zero to force the frame,
    // then back to zero. A build that never seeks the player would also read
    // currentTime === 0, and this is what separates the two.
    const seeks = await player.evaluate((v: HTMLVideoElement) =>
      (window as unknown as { __seeks: WeakMap<HTMLMediaElement, number[]> }).__seeks.get(v) ?? []);
    expect(seeks.some((t) => t > 0),
      `the player never seeked off zero, so no frame was forced — seeks: ${JSON.stringify(seeks)}`).toBe(true);
    expect(seeks[seeks.length - 1],
      `the player's last seek should return it to the start — seeks: ${JSON.stringify(seeks)}`).toBe(0);

    // And it is still audible — the thumbnail fix must not mute the player.
    expect(await player.evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
    expect(await player.evaluate((v: HTMLVideoElement) => v.controls)).toBe(true);
  });
});
