// Shared image-sizing math (RR-3). Pure and unit-tested here in lib; the actual
// canvas work that uses it is browser-only and lives in src/ui/shrinkImage.ts
// (and the report downscaler reuses this same math, so there's one source of
// truth for "fit an image within a max long edge").

/** Stored photos are shrunk to this long-edge (px) and JPEG quality on the way in. */
export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_QUALITY = 0.8;

export interface Dim {
  w: number;
  h: number;
}

/**
 * Scale (width × height) down so its long edge is at most `maxEdge`, keeping the
 * aspect ratio. Never scales an image UP. Guards against zero/NaN inputs.
 */
export function fitWithin(width: number, height: number, maxEdge: number): Dim {
  const longEdge = Math.max(width, height) || 1;
  const scale = Math.min(1, maxEdge / longEdge);
  // `|| 1` also rescues NaN inputs (Math.round(NaN) is NaN, which is falsy).
  return {
    w: Math.max(1, Math.round(width * scale) || 1),
    h: Math.max(1, Math.round(height * scale) || 1),
  };
}
