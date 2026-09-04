import { test, expect, type Page } from '@playwright/test';
import { readFileSync, statSync, unlinkSync, openSync, ftruncateSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedDemo, gotoTab, gotoSection } from './helpers';
import { humanBytes } from '../src/lib/inputLimits.ts';

// Session 141, video-guards spec. Three things under test:
//  (1) The capture-time choice — pick a video over the ask line and a sheet
//      offers "keep the video" or "keep a still instead" (§3.1).
//  (2) The library's size, shown on the ready sheet and the Sync & Backup
//      screen once a save completes (§3.2).
//  (3) Neither (1) nor (2) fires below the real 100 MB line — proven by NOT
//      setting the E2E override, which is the only thing that makes a 4 KB
//      fixture look "large".
//
// THE OVERRIDE. tiny.webm is a few KB, nowhere near the real 100 MB ask line,
// so most of this file runs the app with window.__flVideoAskBytes = 1 — the
// test-only threshold override compiled in only when __FL_E2E__ is true (dev
// mode locally; FL_E2E=1 on CI, which runs the BUILT app). See
// src/ui/MediaField.tsx and vite.config.ts. Test (3) is the one spec here
// that deliberately does NOT set the override, so it proves the real line is
// really 100 MB and not something this whole file's setup papers over.
const FIXTURE = readFileSync(fileURLToPath(new URL('./fixtures/tiny.webm', import.meta.url)));

/** Trip the sheet on anything over a handful of bytes — tiny.webm (a few KB)
 *  then reads as "large" without needing a multi-hundred-MB fixture on disk. */
async function withAskOverride(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __flVideoAskBytes: number }).__flVideoAskBytes = 1;
  });
}

/** Open the first match in the demo log, then its Edit form — same surface
 *  Michael reported the video-thumbnail bug on (e2e/video-thumbnail.spec.ts). */
async function openFirstMatchEdit(page: Page): Promise<void> {
  await gotoTab(page, 'Compete');
  const main = page.getByRole('main');
  const matchesCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Matches' }) });
  await matchesCard.locator('.row-tap').first().click();
  await main.getByRole('button', { name: 'Edit' }).first().click();
  await expect(page.getByRole('heading', { name: 'Edit Match' })).toBeVisible();
}

function mediaCard(page: Page) {
  return page.getByRole('main').locator('.card').filter({
    has: page.getByRole('heading', { name: 'Stage Videos & Photos' }),
  });
}

// Picked under its real name, deliberately — stillName() derives "tiny
// (still)" from exactly this, and that's the name the spec (and the tests
// below) pin.
function pickTinyVideo(card: ReturnType<typeof mediaCard>) {
  return card.locator('input[type="file"]').setInputFiles({
    name: 'tiny.webm', mimeType: 'video/webm', buffer: FIXTURE,
  });
}

/** Draw an <img> to an in-page canvas and report whether it decoded to real
 *  pixels: not blank (naturalWidth > 0) and not one flat colour throughout —
 *  the assertion s2 (a sabotaged all-black capture) has to fail. Verified
 *  against a real frame of tiny.webm before writing this: 647 distinct
 *  colours at 0.5s in, values spanning the full 0-255 range on every
 *  channel — nothing close to a flat black or a flat anything. */
async function decodedAndNotFlat(img: ReturnType<Page['locator']>) {
  return img.evaluate((el: HTMLImageElement) => {
    if (!el.complete || el.naturalWidth === 0) {
      return { naturalWidth: el.naturalWidth, allBlack: true, allSameColour: true };
    }
    const canvas = document.createElement('canvas');
    canvas.width = el.naturalWidth;
    canvas.height = el.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(el, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let allBlack = true;
    let allSameColour = true;
    const [r0, g0, b0] = [data[0], data[1], data[2]];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0) allBlack = false;
      if (data[i] !== r0 || data[i + 1] !== g0 || data[i + 2] !== b0) allSameColour = false;
      if (!allBlack && !allSameColour) break;
    }
    return { naturalWidth: el.naturalWidth, allBlack, allSameColour };
  });
}

/** V5 (cold audit, session 141 fix pass 2): a file over MAX_MEDIA_BYTES (500
 *  MB) — `setInputFiles` refuses an in-memory buffer over 50 MB, so this is
 *  written to a real temp file and picked up by path, same as any other
 *  fixture.
 *
 *  W2 (cold audit, session 141 fix pass 3): SPARSE, not zero-filled — the
 *  only thing this test needs is a file whose reported `File.size` is over
 *  the line; nothing reads its bytes. `ftruncateSync` sets a file's length
 *  without allocating or writing any of it, so this costs no 500 MB
 *  allocation and no 500 MB write, per project per run, while still handing
 *  back a real file of exactly the same size the old `Buffer.alloc` version
 *  did. Caller must delete the returned path when done. */
function writeOversizedFile(): string {
  const path = join(tmpdir(), `fl-oversized-${Date.now()}.mp4`);
  const fd = openSync(path, 'w');
  try {
    ftruncateSync(fd, 500 * 1024 * 1024 + 1);
  } finally {
    closeSync(fd);
  }
  return path;
}

/** V1 (cold audit, session 141 fix pass 2): seeds AppSettings by writing
 *  IndexedDB directly, in the exact shape src/lib/db.ts's own openDb() /
 *  putSettings() use — DB name 'firearmlog', schema version 3, the 'meta'
 *  store keyed by 'key', and a {key:'settings', value:{...}} record merged
 *  the same way putSettings merges it.
 *
 *  W3 (cold audit, session 141 fix pass 3): the name and version below are
 *  LITERALS, not read from db.ts — db.ts's own DB_NAME/SCHEMA_VERSION are
 *  module-private (not exported), and db.ts is a danger-zone file (project
 *  rule 9), so exporting them is a change that needs Michael's sign-off
 *  first rather than something this pass makes unasked. The literals below
 *  MUST be kept in sync with db.ts by hand; a mismatch doesn't silently
 *  drift, though — IndexedDB throws a loud VersionError on open() when the
 *  requested version doesn't match, so a forgotten update here fails this
 *  spec immediately rather than seeding the wrong shape quietly.
 *
 *  The PRIOR version of this helper did `await
 *  import('/src/lib/db.ts')` inside page.evaluate — that path exists only
 *  on the Vite DEV server; CI runs the BUILT app under `vite preview`, where
 *  a request for /src/lib/db.ts falls through to index.html (200,
 *  text/html) and the dynamic import throws on the malformed module. Raw
 *  IndexedDB has no such dependency on which server is running. */
async function putSettingsRaw(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (p) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('firearmlog', 3);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      // The app has already opened (and so created) this database via
      // seedDemo() before this ever runs, so onupgradeneeded should not
      // fire here — but a bare open() still needs a handler wired in case
      // the version somehow doesn't match, rather than hanging silently.
      req.onupgradeneeded = () => resolve(req.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite');
      const store = tx.objectStore('meta');
      const getReq = store.get('settings');
      getReq.onsuccess = () => {
        const current = (getReq.result as { value?: Record<string, unknown> } | undefined)?.value ?? {};
        store.put({ key: 'settings', value: { ...current, ...p } });
      };
      getReq.onerror = () => reject(getReq.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, patch);
}

/** F1/F4 (cold audit, session 141 fix pass 1): stretch canvas.toBlob out so a
 *  test gets a real window to act WHILE a still capture is in flight, instead
 *  of racing a capture that (on a 4 KB fixture) settles in well under a
 *  frame. Delays every toBlob call on the page by `ms` — the only caller in
 *  these tests is videoStill.ts's draw(), so nothing else on the page is
 *  affected. */
async function delayCanvasToBlob(page: Page, ms: number): Promise<void> {
  await page.addInitScript((delayMs) => {
    const orig = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function toBlobDelayed(
      this: HTMLCanvasElement,
      cb: BlobCallback,
      type?: string,
      quality?: unknown
    ) {
      setTimeout(() => orig.call(this, cb, type, quality as number | undefined), delayMs);
    };
  }, ms);
}

/** W1 (cold audit, session 141 fix pass 3): a deterministic stand-in for the
 *  decoder-contention race the auditor could only reproduce probabilistically
 *  (desktop 7/800, mobile 14/480 under 16-way concurrency — see the fourth
 *  commit message). Overrides `CanvasRenderingContext2D.prototype.drawImage`
 *  page-wide to no-op the first `blankCalls` calls and let every call after
 *  that through to the real implementation — a no-op leaves the destination
 *  canvas exactly as it started (freshly created, so all-zero/transparent),
 *  which reads as "black" by the same threshold isAllBlack() uses.
 *
 *  draw() makes TWO drawImage calls per attempt — the real paint
 *  (video -> capture canvas) and, when the fix is present, isAllBlack's own
 *  read-back (capture canvas -> 16x16 scratch) — so `blankCalls` is always
 *  chosen as an even number: blanking N attempts means blanking their 2N
 *  calls together, so a blanked attempt's paint AND its own read-back agree
 *  (both no-op, both read as black) rather than one lying about the other.
 *  6 (three whole attempts) sits comfortably under MAX_BLACK_RETRIES (8), so
 *  the fixed code's fourth attempt — its first un-sabotaged one — is what
 *  ships. Against the PRE-FIX code (no retry loop, one drawImage call per
 *  capture) the very first call is always inside the blanked budget, so this
 *  reproduces the bug on demand instead of waiting on load.
 */
async function sabotageDrawImage(page: Page, blankCalls: number): Promise<void> {
  await page.addInitScript((n: number) => {
    const proto = CanvasRenderingContext2D.prototype;
    const orig = proto.drawImage;
    let calls = 0;
    Object.defineProperty(proto, 'drawImage', {
      configurable: true,
      writable: true,
      value: function drawImageSabotaged(this: CanvasRenderingContext2D, ...args: Parameters<typeof orig>) {
        calls += 1;
        if (calls <= n) return; // no-op: destination canvas stays exactly as created (black)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (orig as any).apply(this, args);
      },
    });
  }, blankCalls);
}

/** F2 (cold audit, session 141 fix pass 1): a real MediaRecorder output, built
 *  in-page (Node has no MediaRecorder/canvas). The resulting webm is the
 *  specific shape that trips the bug: Chrome's MediaRecorder container omits
 *  a real duration, so a <video> loading it reports `duration === Infinity`
 *  until something seeks past the (unknown) end.
 *
 *  SIZE AND LENGTH ARE LOAD-BEARING, not cosmetic — verified empirically
 *  before trusting this. A short/tiny clip (a few KB) loads so fast off a
 *  local blob: URL that Chromium reaches HAVE_ENOUGH_DATA before our own
 *  `loadedmetadata` handler even runs, so the pre-fix code's premature draw
 *  never actually catches an undecoded frame — the exact race the bug needs
 *  never opens. At 640×480 / ~8s / vp8, measured directly (a debug probe
 *  logging `video.readyState` from inside the `loadedmetadata` handler
 *  itself): `loadedmetadata` fires at readyState 1 (HAVE_METADATA — below
 *  the HAVE_CURRENT_DATA floor draw() needs), `loadeddata` a few ms later
 *  at readyState 4. The gap in wall-clock time is small, but that's not what
 *  matters: the pre-fix code's `draw()` call for a non-finite duration runs
 *  SYNCHRONOUSLY inside the `loadedmetadata` handler itself, at the exact
 *  instant readyState reads 1 — so it draws before a frame exists regardless
 *  of how soon afterward one becomes available.
 *
 *  A moving multi-colour tile — not a single flat fill, which would make
 *  every possible captured frame monochrome BY CONSTRUCTION and make
 *  decodedAndNotFlat's "not one flat colour" check meaningless here.
 *
 *  Assembled as a data: URL and handed back as a Buffer so it can go through
 *  Playwright's normal setInputFiles, exactly like every other fixture in
 *  this file. */
async function generateInfiniteDurationWebm(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d')!;
    const stream = (canvas as unknown as { captureStream: (fps?: number) => MediaStream }).captureStream(30);
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 5_000_000,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e: BlobEvent) => { if (e.data.size > 0) chunks.push(e.data); };
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
    recorder.start(50);
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff'];
    const started = performance.now();
    let i = 0;
    while (performance.now() - started < 8000) {
      const size = canvas.width / 8;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          ctx.fillStyle = colors[(x + y + i) % colors.length];
          ctx.fillRect(x * size, y * size, size, size);
        }
      }
      i += 1;
      await new Promise((r) => setTimeout(r, 16));
    }
    recorder.stop();
    await stopped;
    const blob = new Blob(chunks, { type: 'video/webm' });
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  });
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Buffer.from(base64, 'base64');
}

/** F6(c) (cold audit, session 141 fix pass 1): 3 KB of random bytes, typed as
 *  video/webm — not a video at all, so the browser's decoder fails it with an
 *  `error` event rather than ever loading metadata. */
function junkVideoBuffer(): Buffer {
  const bytes = Buffer.alloc(3000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) % 256;
  return bytes;
}

/** F6(b) (cold audit, session 141 fix pass 1): a video sized well clear of
 *  the demo library's photos, so the tally test actually DISCRIMINATES a
 *  video/non-video mix-up rather than passing by coincidence. Checked
 *  directly: the demo's whole archive (sessions + 4 photos) packs to about
 *  1.3 MB, so tiny.webm's 4 KB rounds to "1 MB" right alongside the demo
 *  photos' own combined size — a tally that swapped "video" bytes for
 *  "everything else" would ALSO read "1 MB" and this test would never catch
 *  it. At a few MB, kept well under the real 100 MB ask line, that
 *  coincidence is gone. Content doesn't need to be a real decodable video —
 *  this only exercises staging and the byte tally, never a still capture. */
function bigVideoBuffer(): Buffer {
  const bytes = Buffer.alloc(3_000_000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 61 + 7) % 256;
  return bytes;
}

test.describe('Large video capture-time choice', () => {
  test('(1) over the ask line: the sheet shows the signed sentence, and Keep the video stages a video tile', async ({ page }) => {
    await withAskOverride(page);
    await seedDemo(page);
    await openFirstMatchEdit(page);
    const card = mediaCard(page);
    await pickTinyVideo(card);

    const sheet = page.getByRole('dialog', { name: 'Large video' });
    await expect(sheet).toBeVisible();
    // The exact signed sentence (src/lib/videoGuard.ts largeVideoSentence),
    // matched by its fixed wording — the byte count is fixture-dependent so
    // that part is matched loosely.
    await expect(sheet.getByText(/^This video is \d+ MB\. Videos over 500 MB cannot be added:/)).toBeVisible();
    await expect(sheet.getByText(
      'a file that size can crash the app on a phone. This one will load, but videos this size make '
      + 'backups large and slow. Keep it in the log, or keep a still frame and your notes instead?',
      { exact: false }
    )).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Keep the video' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Keep a still instead' })).toBeVisible();

    await sheet.getByRole('button', { name: 'Keep the video' }).click();
    await expect(sheet).toHaveCount(0);

    // Staged exactly as today: a video tile with the play badge.
    await expect(card.locator('.thumb-tap video')).toHaveCount(1);
    await expect(card.locator('.video-badge')).toHaveCount(1);
    await expect(card.locator('.thumb-tap img')).toHaveCount(0);
  });

  test('(2) Keep a still instead stages a real image, which persists after Save + reopen', async ({ page }) => {
    await withAskOverride(page);
    await seedDemo(page);
    await openFirstMatchEdit(page);
    const card = mediaCard(page);
    await pickTinyVideo(card);

    const sheet = page.getByRole('dialog', { name: 'Large video' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Keep a still instead' }).click();
    await expect(sheet).toHaveCount(0);

    // Staged as an IMAGE tile, not a video — named "tiny (still)" from the
    // fixture's own name (stillName() drops ".webm").
    await expect(card.locator('.thumb-tap video')).toHaveCount(0);
    const stagedImg = card.locator('.thumb-tap img').first();
    await expect(stagedImg).toBeVisible();
    await expect(card.getByText('tiny (still)')).toBeVisible();

    const staged = await decodedAndNotFlat(stagedImg);
    expect(staged.naturalWidth, 'the staged still must actually decode').toBeGreaterThan(0);
    expect(staged.allBlack, 'the staged still must not be a blank black frame').toBe(false);
    expect(staged.allSameColour, 'the staged still must have real picture content, not one flat colour').toBe(false);

    // Save the match, then leave and come back — proving the still is a
    // genuine stored record, not just draft UI state.
    await page.getByRole('main').getByRole('button', { name: /^Save/ }).first().click();
    const detailImg = page.getByRole('main').locator('.photo-grid img[alt="tiny (still)"]');
    await expect(detailImg).toBeVisible();

    await openFirstMatchEdit(page); // navigates to Compete and reopens the same match
    const reopenedCard = mediaCard(page);
    await expect(reopenedCard.getByText('tiny (still)')).toBeVisible();
    const reopenedImg = reopenedCard.locator('.thumb-tap img').first();
    const persisted = await decodedAndNotFlat(reopenedImg);
    expect(persisted.naturalWidth, 'the SAVED still must still decode after reopening').toBeGreaterThan(0);
  });

  test('(3) without the override, tiny.webm stages silently — the real line is 100 MB, not a few KB', async ({ page }) => {
    // Deliberately no withAskOverride() here.
    await seedDemo(page);
    await openFirstMatchEdit(page);
    const card = mediaCard(page);
    await pickTinyVideo(card);

    await expect(page.getByRole('dialog', { name: 'Large video' })).toHaveCount(0);
    await expect(card.locator('.thumb-tap video')).toHaveCount(1);
  });

  test('(4) closing the sheet (Escape) adds nothing — same as cancelling the file picker', async ({ page }) => {
    await withAskOverride(page);
    await seedDemo(page);
    await openFirstMatchEdit(page);
    const card = mediaCard(page);
    await pickTinyVideo(card);

    const sheet = page.getByRole('dialog', { name: 'Large video' });
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);

    // Nothing staged at all — no video tile, no still tile.
    await expect(card.locator('.thumb-tap')).toHaveCount(0);
  });

  test('(11) V5: the too-big note reads as two sentences, and names what actually happened', async ({ page }) => {
    await withAskOverride(page);
    await seedDemo(page);
    await openFirstMatchEdit(page);
    const card = mediaCard(page);
    const oversizedPath = writeOversizedFile();
    try {
      // One file too big to add at all, and one (over the overridden ask
      // line) that joins the queue instead of staging outright — the exact
      // combination the finding is about.
      await card.locator('input[type="file"]').setInputFiles([
        oversizedPath,
        fileURLToPath(new URL('./fixtures/tiny.webm', import.meta.url)),
      ]);
      const tooBig = card.locator('.report-note', { hasText: 'too large to add' });
      await expect(tooBig).toHaveText(
        '1 file was too large to add (over 500 MB each). Anything else you picked was added, or is being asked about now.'
      );
      // No em dash, no comma splice (rule 44 / V5).
      const text = await tooBig.textContent();
      expect(text, 'V5: no em dash left in this note').not.toContain('—');
    } finally {
      unlinkSync(oversizedPath);
    }
  });

  test('(6) F1/F4: Escape during capture does not close the sheet or drop the queued second video', async ({ page }) => {
    await delayCanvasToBlob(page, 2000);
    await withAskOverride(page);
    await seedDemo(page);
    await openFirstMatchEdit(page);
    const card = mediaCard(page);
    // Two large videos: the first is what's showing; the second sits queued
    // behind it (MediaField.tsx's askQueue, spec §3.1).
    await pickTinyVideo(card);
    await pickTinyVideo(card);

    const sheet = page.getByRole('dialog', { name: 'Large video' });
    await expect(sheet).toBeVisible();
    // V3 (cold audit, session 141 fix pass 2): the button label is now
    // static — "Making the still…" moved to a permanently-mounted aria-live
    // note instead, so it appears exactly once, not twice.
    const keepStillBtn = sheet.getByRole('button', { name: 'Keep a still instead' });
    const keepVideoBtn = sheet.getByRole('button', { name: 'Keep the video' });
    await keepStillBtn.click();

    // F4/V3: feedback shows immediately — no need to wait out the injected
    // delay. The live-region note's own text is now the one and only place
    // this sentence appears.
    const liveNote = sheet.locator('[aria-live="polite"]');
    await expect(liveNote).toHaveText('Making the still…');
    const sheetText = await sheet.innerText();
    expect(
      [...sheetText.matchAll(/Making the still…/g)].length,
      'V3: the sentence must appear EXACTLY once in the sheet — a live region ' +
      'inserted already-populated is commonly not announced, so mounting it ' +
      'permanently only helps if the button label does not ALSO say it'
    ).toBe(1);

    // V2 (cold audit, session 141 fix pass 2): aria-disabled must carry
    // real "unavailable" styling — measured, not eyeballed.
    const [keepStillOpacity, keepVideoOpacity] = await Promise.all([
      keepStillBtn.evaluate((el) => getComputedStyle(el).opacity),
      keepVideoBtn.evaluate((el) => getComputedStyle(el).opacity),
    ]);
    expect(keepStillOpacity, 'V2: the button being pressed must look unavailable while busy').toBe('0.5');
    expect(keepVideoOpacity, 'V2: the OTHER button must look unavailable too — the whole sheet is busy').toBe('0.5');

    // F4: focus stays inside the dialog while it's busy — a natively
    // `disabled` button would have thrown it to BODY.
    const activeInsideDialog = await page.evaluate(() =>
      document.activeElement?.closest('[role="dialog"]') !== null
    );
    expect(activeInsideDialog, 'focus must still be somewhere inside the sheet while capturing').toBe(true);

    // F1: Escape while capturing must be a no-op — the sheet is
    // non-dismissable mid-capture (MediaField.tsx's onClose guard).
    await page.keyboard.press('Escape');
    await expect(sheet).toBeVisible();
    await expect(liveNote).toHaveText('Making the still…');

    // Let the (delayed) capture actually finish. The queue then advances on
    // its own: exactly one still staged for video #1, and the sheet is now
    // showing video #2 — proving Escape neither dropped it nor stole it.
    await expect(liveNote).toHaveText('', { timeout: 10_000 });
    await expect(sheet).toBeVisible(); // still open, now for the second video
    await expect(card.locator('.thumb-tap img')).toHaveCount(1);
    await expect(card.locator('.thumb-tap video')).toHaveCount(0);
    // Buttons read as available again once the sheet is idle.
    await expect(sheet.getByRole('button', { name: 'Keep the video' })).toHaveCSS('opacity', '1');

    // Close out the second ask so the test ends in a clean state.
    await sheet.getByRole('button', { name: 'Keep the video' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(card.locator('.thumb-tap')).toHaveCount(2); // 1 still + 1 video
  });

  test('(7) F2: a still can be captured from a video whose duration reports Infinity (MediaRecorder output)', async ({ page }) => {
    await withAskOverride(page);
    await seedDemo(page);
    await openFirstMatchEdit(page);
    const card = mediaCard(page);
    const buffer = await generateInfiniteDurationWebm(page);
    await card.locator('input[type="file"]').setInputFiles({
      name: 'infinity.webm', mimeType: 'video/webm', buffer,
    });

    const sheet = page.getByRole('dialog', { name: 'Large video' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Keep a still instead' }).click();
    await expect(sheet).toHaveCount(0, { timeout: 20_000 });

    const stagedImg = card.locator('.thumb-tap img').first();
    await expect(stagedImg).toBeVisible();
    const staged = await decodedAndNotFlat(stagedImg);
    expect(staged.naturalWidth, 'the still must actually decode').toBeGreaterThan(0);
    expect(staged.allBlack, 'FIX F2: a non-finite duration used to draw before any frame decoded, '
      + 'producing an all-black still').toBe(false);
    expect(staged.allSameColour, 'the still must have real picture content').toBe(false);
  });

  test('(8) F6(c): a file that cannot be decoded shows the decode-failure copy, and only Keep the video remains', async ({ page }) => {
    await withAskOverride(page);
    await seedDemo(page);
    await openFirstMatchEdit(page);
    const card = mediaCard(page);
    await card.locator('input[type="file"]').setInputFiles({
      name: 'junk.webm', mimeType: 'video/webm', buffer: junkVideoBuffer(),
    });

    const sheet = page.getByRole('dialog', { name: 'Large video' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Keep a still instead' }).click();

    // DECODE_FAILURE_SENTENCE, appended to the large-video sentence.
    await expect(sheet.getByText(
      "A still frame can't be made from this video on this device, so the choice is to keep the video or not add it.",
      { exact: false }
    )).toBeVisible({ timeout: 20_000 });
    await expect(sheet.getByRole('button', { name: 'Keep a still instead' })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: 'Keep the video' })).toBeVisible();
    // The sheet's own Close (X) is still there — "or Close" per the finding.
    await expect(sheet.getByRole('button', { name: 'Close' })).toBeVisible();

    await sheet.getByRole('button', { name: 'Keep the video' }).click();
    await expect(sheet).toHaveCount(0);
    // Staged as a video tile — but this specific file is genuinely
    // undecodable junk, so VideoFrame.tsx's own (pre-existing, unrelated to
    // this fix pass) error handling swaps the <video> tag for a "Preview
    // unavailable" badge rather than an empty box. Assert what's actually
    // true here: one tile was added, and it's the video kind, not an image.
    await expect(card.locator('.thumb-tap')).toHaveCount(1);
    await expect(card.locator('.thumb-tap img')).toHaveCount(0);
  });

  test('(12) W1: a sabotaged all-black draw is retried, not shipped', async ({ page }) => {
    await withAskOverride(page);
    // Three whole draw() attempts (paint + read-back, 2 calls each) forced
    // black — comfortably under MAX_BLACK_RETRIES (8) — so the fourth,
    // un-sabotaged attempt is what the capture ships.
    await sabotageDrawImage(page, 6);
    await seedDemo(page);
    await openFirstMatchEdit(page);
    const card = mediaCard(page);
    await pickTinyVideo(card);

    const sheet = page.getByRole('dialog', { name: 'Large video' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Keep a still instead' }).click();
    await expect(sheet).toHaveCount(0, { timeout: 20_000 });

    const stagedImg = card.locator('.thumb-tap img').first();
    await expect(stagedImg).toBeVisible();
    const staged = await decodedAndNotFlat(stagedImg);
    expect(staged.naturalWidth, 'the still must actually decode').toBeGreaterThan(0);
    expect(staged.allBlack, 'W1: the first three draws were sabotaged all-black by '
      + 'overriding drawImage — the retry must rescue the capture rather than shipping '
      + 'one of them').toBe(false);
  });
});

test.describe('Library size on the backup', () => {
  test('(5) the ready sheet names a size, and the Sync & Backup screen shows it after the save', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Sync & Backup');

    await page.getByRole('main').getByRole('button', { name: 'Save to File' }).click();
    const readySheet = page.getByRole('dialog', { name: 'Your Data File Is Ready' });
    await expect(readySheet).toBeVisible();
    // backupSummary's exact shape: "... packed and ready: {SIZE}" — SIZE is
    // whatever humanBytes(blob.size) says for the real demo archive.
    await expect(readySheet.getByText(/packed and ready: \d+(\.\d+)? (MB|GB)/)).toBeVisible();
    // Captured BEFORE the click below: tapping "Save the File Now" finishes
    // the save (SyncCard.tsx's afterDelivery), which unmounts this sheet
    // immediately — there is nothing left to read off it once the download
    // has actually landed.
    const summaryText = await readySheet.getByText(/packed and ready/).textContent();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      readySheet.getByRole('button', { name: 'Save the File Now' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^FirearmLog-\d{4}-\d{2}-\d{2}\.flog$/);

    // F6(a) (cold audit, session 141 fix pass 1): assert the EXACT size
    // string, not just its shape — the downloaded file's real byte count run
    // through the app's own humanBytes(), compared against the sentence the
    // sheet actually showed, so a rounding or wrong-source-value bug would
    // really fail this rather than slide through a loose regex.
    const path = await download.path();
    if (!path) throw new Error('download produced no local path to stat');
    const exactSize = humanBytes(statSync(path).size);
    expect(summaryText, 'the ready sheet must name the EXACT size of the file it just handed off')
      .toContain(`packed and ready: ${exactSize}.`);
    // lastBackupLine's exact shape: "Last backup: {SIZE}, {date}." — the
    // demo log carries no video, so no "(... video)" parenthesis is expected.
    await expect(page.getByText(`Last backup: ${exactSize},`, { exact: false })).toBeVisible();
  });

  test('(9) F6(b): a video actually in the library is tallied and named separately, on both lines', async ({ page }) => {
    // Deliberately no ask-override: this proves the real tally against a real
    // stored video, not the sheet's own capture-time math.
    await seedDemo(page);
    await openFirstMatchEdit(page);
    const card = mediaCard(page);
    const bigVideo = bigVideoBuffer();
    await card.locator('input[type="file"]').setInputFiles({
      name: 'big.webm', mimeType: 'video/webm', buffer: bigVideo,
    });
    await expect(page.getByRole('dialog', { name: 'Large video' })).toHaveCount(0); // under the real 100 MB line
    await expect(card.locator('.thumb-tap')).toHaveCount(1);
    await page.getByRole('main').getByRole('button', { name: /^Save/ }).first().click();

    await gotoSection(page, 'Sync & Backup');
    await page.getByRole('main').getByRole('button', { name: 'Save to File' }).click();
    const readySheet = page.getByRole('dialog', { name: 'Your Data File Is Ready' });
    await expect(readySheet).toBeVisible();
    // The video is stored byte-for-byte (videos are never shrunk —
    // shrinkImage.ts only touches image/*), so the tallied video bytes are
    // exactly the fixture's own size — computed here, not guessed, per the
    // finding's own instruction.
    const videoHuman = humanBytes(bigVideo.length);
    await expect(readySheet.getByText(`, of which ${videoHuman} is video.`, { exact: false })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      readySheet.getByRole('button', { name: 'Save the File Now' }).click(),
    ]);
    void download;
    await expect(page.getByText(`(${videoHuman} video)`, { exact: false })).toBeVisible();
  });

  test('(10) F3: an install with a backup date but no recorded size keeps the legacy line, until the next save replaces it', async ({ page }) => {
    await seedDemo(page);
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    // Exactly the shape of an install that saved before this feature shipped:
    // lastBackupAt is set, lastBackupBytes never was. See putSettingsRaw's
    // own comment for why this writes IndexedDB directly rather than
    // importing db.ts in-page (V1, cold audit fix pass 2 — the import path
    // only exists on the dev server and is red under CI's built-app preview).
    await putSettingsRaw(page, { lastBackupAt: yesterday });
    await page.reload();
    await gotoSection(page, 'Sync & Backup');

    // FIX F3: the pre-feature sentence, unchanged, not silently dropped.
    await expect(page.getByText(/^Last saved to the file from this device: .+\.$/)).toBeVisible();
    await expect(page.getByText(/^Last backup: /)).toHaveCount(0);

    await page.getByRole('main').getByRole('button', { name: 'Save to File' }).click();
    const readySheet = page.getByRole('dialog', { name: 'Your Data File Is Ready' });
    await expect(readySheet).toBeVisible();
    await Promise.all([
      page.waitForEvent('download'),
      readySheet.getByRole('button', { name: 'Save the File Now' }).click(),
    ]);

    // A real save now replaces the legacy line with the signed one.
    await expect(page.getByText(/^Last backup: \d+(\.\d+)? (MB|GB).*\.$/)).toBeVisible();
    await expect(page.getByText(/^Last saved to the file from this device:/)).toHaveCount(0);
  });
});
