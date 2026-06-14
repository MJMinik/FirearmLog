// Built-in printable targets (Michael's June 14 choice). Each is drawn as an
// SVG so it prints crisp at any size and needs no external artwork. A drill can
// link to one (DrillDef.targetId); the session form's "Print Targets" button
// prints the linked ones, one per page, as a PDF (Save as PDF from the print
// dialog). Pure data + a pure HTML builder so it's all unit-testable.

export interface TargetDef {
  id: string;
  name: string;
  description: string;
  /** Whether it prints true-to-size and any caveat for the user. */
  scaleNote: string;
  /** Width on paper, inches, when printed at 100%. */
  printWidthIn: number;
  svg: string;
}

// ---- B-8 25-yard bullseye (prints actual size on letter) ----
function b8Svg(): string {
  const cx = 350, cy = 350;
  // White scoring rings on a black bull; numbers near the top of each ring.
  const rings = [
    { r: 300, n: '6' }, { r: 250, n: '7' }, { r: 200, n: '8' },
    { r: 150, n: '9' }, { r: 100, n: '10' }, { r: 50, n: 'X' }
  ];
  const circles = rings.map((rg, i) =>
    `<circle cx="${cx}" cy="${cy}" r="${rg.r}" fill="${i === 0 ? '#111' : 'none'}" stroke="${i === 0 ? '#111' : '#fff'}" stroke-width="2"/>`
  ).join('');
  const labels = rings.map((rg) =>
    `<text x="${cx}" y="${cy - rg.r + 22}" text-anchor="middle" font-size="18" fill="${rg.r >= 300 ? '#fff' : '#fff'}" font-family="Arial">${rg.n}</text>`
  ).join('');
  return `<svg viewBox="0 0 700 700" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="700" height="700" fill="#fff"/>
    ${circles}
    <circle cx="${cx}" cy="${cy}" r="4" fill="#fff"/>
    ${labels}
  </svg>`;
}

// ---- 1-inch zeroing grid (prints actual size; 1 square = 1 inch) ----
function zeroSvg(): string {
  let lines = '';
  for (let i = 0; i <= 8; i++) {
    const p = i * 100;
    const heavy = i === 4;
    lines += `<line x1="${p}" y1="0" x2="${p}" y2="800" stroke="${heavy ? '#333' : '#bbb'}" stroke-width="${heavy ? 2 : 1}"/>`;
    lines += `<line x1="0" y1="${p}" x2="800" y2="${p}" stroke="${heavy ? '#333' : '#bbb'}" stroke-width="${heavy ? 2 : 1}"/>`;
  }
  return `<svg viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="800" height="800" fill="#fff"/>
    ${lines}
    <rect x="350" y="350" width="100" height="100" fill="none" stroke="#c00" stroke-width="3"/>
    <line x1="400" y1="330" x2="400" y2="470" stroke="#c00" stroke-width="2"/>
    <line x1="330" y1="400" x2="470" y2="400" stroke="#c00" stroke-width="2"/>
    <circle cx="400" cy="400" r="5" fill="#c00"/>
  </svg>`;
}

// ---- 5-dot drill (actual size; 2-inch dots) ----
function fiveDotSvg(): string {
  const dots = [
    { x: 200, y: 250, n: '1' }, { x: 600, y: 250, n: '2' },
    { x: 400, y: 500, n: '3' },
    { x: 200, y: 750, n: '4' }, { x: 600, y: 750, n: '5' }
  ];
  const body = dots.map((d) =>
    `<circle cx="${d.x}" cy="${d.y}" r="100" fill="none" stroke="#111" stroke-width="3"/>
     <circle cx="${d.x}" cy="${d.y}" r="6" fill="#111"/>
     <text x="${d.x}" y="${d.y - 110}" text-anchor="middle" font-size="22" fill="#111" font-family="Arial">${d.n}</text>`
  ).join('');
  return `<svg viewBox="0 0 800 1000" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="800" height="1000" fill="#fff"/>
    ${body}
  </svg>`;
}

// ---- USPSA-style silhouette (reduced scale; for home practice) ----
function uspsaSvg(): string {
  // Simplified IPSC/USPSA metric outline: head box + tapering body, with the
  // center A-zone and an upper A-zone marked.
  return `<svg viewBox="0 0 460 760" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="460" height="760" fill="#fff"/>
    <!-- body -->
    <polygon points="40,200 420,200 380,740 80,740" fill="#d9d4c7" stroke="#111" stroke-width="3"/>
    <!-- head -->
    <rect x="175" y="40" width="110" height="120" rx="18" fill="#d9d4c7" stroke="#111" stroke-width="3"/>
    <rect x="205" y="60" width="50" height="60" rx="8" fill="none" stroke="#111" stroke-width="2"/>
    <!-- center A zone -->
    <rect x="175" y="320" width="110" height="200" rx="10" fill="none" stroke="#111" stroke-width="2"/>
    <text x="230" y="430" text-anchor="middle" font-size="34" fill="#111" font-family="Arial">A</text>
    <text x="230" y="98" text-anchor="middle" font-size="22" fill="#111" font-family="Arial">A</text>
    <text x="110" y="430" text-anchor="middle" font-size="22" fill="#555" font-family="Arial">C</text>
    <text x="110" y="690" text-anchor="middle" font-size="22" fill="#555" font-family="Arial">D</text>
  </svg>`;
}

export const STANDARD_TARGETS: TargetDef[] = [
  {
    id: 'uspsa',
    name: 'USPSA / IPSC silhouette',
    description: 'Practical-shooting silhouette with center and upper A-zones.',
    scaleNote: 'Reduced to fit one page — not full match size.',
    printWidthIn: 6.5,
    svg: uspsaSvg()
  },
  {
    id: 'b8',
    name: 'B-8 bullseye (25 yd)',
    description: 'Classic pistol bullseye, rings 6 through X.',
    scaleNote: 'Prints close to actual size at 100%.',
    printWidthIn: 7,
    svg: b8Svg()
  },
  {
    id: 'zero',
    name: '1-inch zeroing grid',
    description: 'Grid for sighting in — each square is one inch.',
    scaleNote: 'Print at 100% so each square is a true inch.',
    printWidthIn: 8,
    svg: zeroSvg()
  },
  {
    id: '5dot',
    name: '5-dot drill',
    description: 'Five 2-inch dots for transitions and accuracy.',
    scaleNote: 'Prints close to actual size at 100%.',
    printWidthIn: 8,
    svg: fiveDotSvg()
  }
];

/** Look up a target by id (or undefined). */
export function targetById(id: string | undefined | null): TargetDef | undefined {
  if (!id) return undefined;
  return STANDARD_TARGETS.find((t) => t.id === id);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c] ?? c));
}

/** Printable page: one target per sheet (page-break), as a PDF via the print dialog. */
export function buildTargetsPrintHtml(targets: TargetDef[]): string {
  const styles = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, Arial, sans-serif; color: #111; background: #fff; }
    .close-bar { padding: 16px; }
    .close-btn { font-family: inherit; font-size: 11pt; padding: 10px 16px; border-radius: 8px; border: 1px solid #888; background: #f2f2f2; color: #111; cursor: pointer; }
    .tgt { page-break-after: always; text-align: center; padding: 24px; }
    .tgt:last-child { page-break-after: auto; }
    .tgt h2 { font-size: 14pt; margin-bottom: 2px; }
    .tgt .note { font-size: 9pt; color: #666; margin-bottom: 12px; }
    .tgt svg { display: block; margin: 0 auto; }
    @media print { .close-bar { display: none; } .tgt { padding: 0; } }
  `;
  const body = targets.length === 0
    ? '<p style="padding:24px">None of the chosen drills has a printable target.</p>'
    : targets.map((t) => `<div class="tgt">
        <h2>${escapeHtml(t.name)}</h2>
        <div class="note">${escapeHtml(t.scaleNote)} — print at 100% (do not "fit to page").</div>
        <div style="width:${t.printWidthIn}in; max-width:100%; margin:0 auto;">${t.svg}</div>
      </div>`).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Targets</title><style>${styles}</style></head>
  <body>
    <div class="close-bar"><button class="close-btn" onclick="window.close()">← Close &amp; return to FirearmLog</button></div>
    ${body}
  </body></html>`;
}
