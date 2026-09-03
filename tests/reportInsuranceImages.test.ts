// Reports/media narrowing (Sep 2026): Insurance Inventory is the one report
// that reads media, and it now fetches each gun's own images narrowly
// (getMediaForOwner) when the report is built, rather than from a whole-store
// bundle. This proves the real insuranceReport() end to end against a real
// (in-memory) database: one gun with an image AND a video gets exactly one
// printed image (the video never reaches the page), and a gun with no media
// gets none.
//
// TWO PRE-EXISTING ENVIRONMENT WRINKLES THIS FILE WORKS AROUND, NEITHER
// INTRODUCED BY THIS CHANGE:
//
// 1. reportLaunch.ts (unrelated to media at all) imports `ammoLabel` from
//    `./AmmoScreens.tsx` for malfunctionsReport. Node's `--experimental-strip-types`
//    only erases TS *types* — it does not understand the .tsx extension at
//    all (confirmed: even a content-free .tsx import throws
//    ERR_UNKNOWN_FILE_EXTENSION), so no test file has ever imported
//    reportLaunch.ts as a module before now (steel.test.ts instead greps its
//    source text). Rather than touch production code's import shape to work
//    around a test-runner limitation, this file registers a tiny loader
//    (Node's stable `module.register` hook) that resolves any `.tsx`
//    specifier to a stub exporting a no-op `ammoLabel` — insuranceReport
//    never calls it, so the stub's body is irrelevant to what this test
//    proves. The hook is registered only inside this process (Node's test
//    runner isolates each test file in its own process), so it cannot affect
//    any other test file.
// 2. reportImageUrls (src/ui/reportImages.ts) downscales each image with
//    browser-only APIs (Image, canvas, URL.createObjectURL) that don't exist
//    in Node's DOM-less environment. Node itself already provides Blob and
//    URL.createObjectURL/revokeObjectURL (verified on this runner's Node 22:
//    `typeof URL.createObjectURL, typeof Blob` -> "function function"), so
//    only Image and canvas need stubbing — enough to let downscaleOne's
//    promise resolve; the stub never inspects real pixels.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Resolve() intercepts before format-detection ever sees the extension, so
// the ERR_UNKNOWN_FILE_EXTENSION above never happens.
const TSX_STUB_LOADER = `
export async function resolve(specifier, context, next) {
  if (specifier.endsWith('.tsx')) return { url: 'tsx-stub:' + specifier, shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url.startsWith('tsx-stub:')) {
    return { format: 'module', source: 'export const ammoLabel = () => "";', shortCircuit: true };
  }
  return next(url, context);
}
`;
register('data:text/javascript,' + encodeURIComponent(TSX_STUB_LOADER), pathToFileURL('./'));

import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearAllData, putOne } from '../src/lib/db.ts';
import type { Firearm, Media } from '../src/lib/types.ts';
import type { ReportBundle } from '../src/ui/reportLaunch.ts';
// Dynamic (not static) so it runs after the loader above is registered —
// a type-only import (above) is erased before runtime and never triggers
// module resolution, but the real function call needs the runtime export.
const { insuranceReport } = await import('../src/ui/reportLaunch.ts');

// --- minimal DOM stub for reportImages.ts's downscaleOne (wrinkle #2 above) ---
class FakeCtx {
  fillStyle = ''; strokeStyle = ''; lineWidth = 0; font = ''; textAlign = ''; textBaseline = '';
  fillRect() {} drawImage() {} beginPath() {} ellipse() {} stroke() {} arc() {} fill() {} fillText() {}
}
const fakeCtx = new FakeCtx();
class FakeCanvas {
  width = 0; height = 0;
  getContext() { return fakeCtx as unknown as CanvasRenderingContext2D; }
  toDataURL() { return 'data:image/jpeg;base64,FAKE'; }
}
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  width = 800; height = 600;
  set src(_v: string) { queueMicrotask(() => this.onload?.()); }
}
(globalThis as unknown as { document: unknown }).document = {
  createElement: (tag: string) => (tag === 'canvas' ? new FakeCanvas() : null),
};
(globalThis as unknown as { Image: unknown }).Image = FakeImage;

function firearm(id: string, name: string): Firearm {
  return {
    id, name, manufacturer: '', model: '', caliber: '', category: 'Pistol' as Firearm['category'],
    serialNumber: null, dateAcquired: '', startingRoundCount: 0, photoIds: [], referenceId: null,
    notes: '', createdAt: 1, updatedAt: 1,
  } as Firearm;
}

function media(id: string, ownerId: string, kind: 'image' | 'video'): Media {
  return {
    id, ownerType: 'firearm', ownerId, kind, name: `${id}.dat`, annotations: [],
    mime: kind === 'image' ? 'image/jpeg' : 'video/mp4', data: new ArrayBuffer(16),
    createdAt: 1, updatedAt: 1,
  } as Media;
}

function bundleWith(firearms: Firearm[]): ReportBundle {
  return {
    firearms, sessions: [], matches: [], purchases: [], ammo: [], classifiers: [],
    malfunctions: [], maintenance: [], references: [], drills: [], goals: [],
    parts: [], magazines: [], optics: [],
  };
}

test("Insurance Inventory fetches each gun's images narrowly: one image, no video, empty gun prints none", async () => {
  await clearAllData();
  await putOne('firearms', firearm('g1', 'Glock 19'));
  await putOne('firearms', firearm('g2', 'Bare Gun'));
  await putOne('media', media('m-img', 'g1', 'image'));
  await putOne('media', media('m-vid', 'g1', 'video'));

  const d = bundleWith([firearm('g1', 'Glock 19'), firearm('g2', 'Bare Gun')]);
  const result = await insuranceReport(d);

  const g1 = result.sections.find((s) => s.heading === 'Glock 19');
  const g2 = result.sections.find((s) => s.heading === 'Bare Gun');
  assert.ok(g1, 'Glock 19 section present');
  assert.ok(g2, 'Bare Gun section present');
  assert.equal(g1?.images?.length, 1, 'exactly one image printed for the gun with an image and a video');
  assert.equal(g1?.images?.[0].src, 'data:image/jpeg;base64,FAKE');
  assert.equal(g2?.images?.length ?? 0, 0, 'the gun with no media prints none');
});
