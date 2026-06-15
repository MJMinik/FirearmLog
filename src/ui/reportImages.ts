// Downscale images for printable reports (Insurance Inventory, Session Report).
// Michael's full-resolution insurance photos are 16-29 MB each; embedding them
// raw as base64 into a print window crashes mobile Safari (out of memory). Here
// we draw each photo to an offscreen canvas capped at `maxPx` on its long edge
// and re-encode it as JPEG — a 25 MB photo becomes ~150 KB while staying plenty
// sharp for a printed page. One bad image is skipped rather than crashing the
// whole report.
//
// Canvas / Image are browser-only, so this lives in the UI layer — the Node
// test runner has no DOM. The pure HTML builder stays in src/lib/reports.ts.
import type { Media } from '../lib/types.ts';

/** Print-ready data: URLs for one record's images, downscaled to a safe size. */
export async function reportImageUrls(
  media: Media[],
  ownerType: Media['ownerType'],
  ownerId: string,
  maxPx = 1400,
  quality = 0.85
): Promise<string[]> {
  const mine = media.filter(
    (m) => m.ownerType === ownerType && m.ownerId === ownerId && m.kind === 'image'
  );
  const out: string[] = [];
  for (const m of mine) {
    try {
      out.push(await downscaleOne(m, maxPx, quality));
    } catch {
      // A single unreadable image shouldn't sink the whole report.
    }
  }
  return out;
}

function downscaleOne(m: Media, maxPx: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([m.data], { type: m.mime || 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const longEdge = Math.max(img.width, img.height) || 1;
        const scale = Math.min(1, maxPx / longEdge);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('no canvas context'));
          return;
        }
        // White backing so any transparency prints white, not black.
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (e) {
        reject(e instanceof Error ? e : new Error('downscale failed'));
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
