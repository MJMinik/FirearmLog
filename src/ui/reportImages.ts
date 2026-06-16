// Downscale images for printable reports (Insurance Inventory, Session Report).
// Michael's full-resolution insurance photos are 16-29 MB each; embedding them
// raw as base64 into a print window crashes mobile Safari (out of memory). Here
// we draw each photo to an offscreen canvas capped at `maxPx` on its long edge
// and re-encode it as JPEG — a 25 MB photo becomes ~150 KB while staying plenty
// sharp for a printed page. Any markup circles are drawn onto the canvas so they
// print too, and their labels are returned as a legend. One bad image is skipped
// rather than crashing the whole report.
//
// Canvas / Image are browser-only, so this lives in the UI layer — the Node
// test runner has no DOM. The pure HTML builder stays in src/lib/reports.ts.
import type { Media } from '../lib/types.ts';
import type { ReportImage } from '../lib/reports.ts';
import { fitWithin } from '../lib/imageResize.ts';

/** Print-ready photos for one record: downscaled (with markup drawn on) + legend. */
export async function reportImageUrls(
  media: Media[],
  ownerType: Media['ownerType'],
  ownerId: string,
  maxPx = 1400,
  quality = 0.85
): Promise<ReportImage[]> {
  const mine = media.filter(
    (m) => m.ownerType === ownerType && m.ownerId === ownerId && m.kind === 'image'
  );
  const out: ReportImage[] = [];
  for (const m of mine) {
    try {
      const src = await downscaleOne(m, maxPx, quality);
      const marks = m.marks ?? [];
      const legend = marks.length ? marks.map((mk) => mk.label.trim() || '—') : undefined;
      out.push({ src, legend });
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
        const { w, h } = fitWithin(img.width, img.height, maxPx);
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
        drawMarks(ctx, m, w, h);
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

/** Draw the labeled circles (numbered badges) onto the report canvas. */
function drawMarks(ctx: CanvasRenderingContext2D, m: Media, w: number, h: number): void {
  const marks = m.marks ?? [];
  const unit = Math.min(w, h);
  marks.forEach((mk, i) => {
    const ex = mk.cx * w;
    const ey = mk.cy * h;
    const erx = Math.max(2, mk.rx * w);
    const ery = Math.max(2, mk.ry * h);
    ctx.lineWidth = Math.max(2, Math.round(unit * 0.008));
    ctx.strokeStyle = mk.color;
    ctx.beginPath();
    ctx.ellipse(ex, ey, erx, ery, 0, 0, Math.PI * 2);
    ctx.stroke();
    // Numbered badge at the circle's top-left, matching the on-screen markup.
    const br = Math.max(9, Math.round(unit * 0.03));
    const bx = ex - erx;
    const by = ey - ery;
    ctx.fillStyle = mk.color;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = `bold ${Math.round(br * 1.2)}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), bx, by);
  });
}
