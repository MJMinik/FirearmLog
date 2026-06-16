// RR-3: shrink photos as they come in. Reuses the same canvas approach as the
// report downscaler and the shared sizing math in lib/imageResize.ts.
//
// Canvas / Image are browser-only, so this lives in the UI layer (the Node test
// runner has no DOM). The pure math it depends on is unit-tested in lib.
import { fitWithin, PHOTO_MAX_EDGE, PHOTO_QUALITY } from '../lib/imageResize.ts';

export interface UploadBytes {
  data: ArrayBuffer;
  mime: string;
}

/**
 * Bytes to store for an uploaded file. Images are downscaled to PHOTO_MAX_EDGE
 * at PHOTO_QUALITY (JPEG); videos and anything that fails to shrink are stored
 * unchanged. We only keep the shrunk copy if it's actually smaller — so a photo
 * that's already small stays exactly as-is. Nothing here can lose data: on any
 * problem we fall back to the original bytes.
 */
export async function prepareUploadBytes(file: File | Blob): Promise<UploadBytes> {
  const type = file.type || 'application/octet-stream';
  const original: UploadBytes = { data: await file.arrayBuffer(), mime: type };
  if (!type.startsWith('image/')) return original;
  try {
    const shrunk = await shrinkImageBlob(file);
    return shrunk.data.byteLength > 0 && shrunk.data.byteLength < original.data.byteLength
      ? shrunk
      : original;
  } catch {
    return original;
  }
}

/** Draw the image to a capped-size canvas and re-encode as JPEG. */
function shrinkImageBlob(file: Blob): Promise<UploadBytes> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const { w, h } = fitWithin(img.width, img.height, PHOTO_MAX_EDGE);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('no canvas context'));
          return;
        }
        // White backing so any transparency becomes white, not black.
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('encode failed'));
              return;
            }
            blob.arrayBuffer().then(
              (data) => resolve({ data, mime: 'image/jpeg' }),
              (e) => reject(e instanceof Error ? e : new Error('read failed'))
            );
          },
          'image/jpeg',
          PHOTO_QUALITY
        );
      } catch (e) {
        reject(e instanceof Error ? e : new Error('shrink failed'));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image decode failed'));
    };
    img.src = url;
  });
}
