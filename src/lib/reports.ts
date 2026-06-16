// Reports (spec §13). One generic printable-HTML builder — the Reports screen
// assembles each report's sections from the already-tested data helpers
// (costing, stats, competition, dashboard, maintenance) and hands them here.
// Pure + unit-testable; "Save as PDF" from the print dialog.

export interface ReportRow { label: string; value: string }
export interface ReportTable { headers: string[]; rows: string[][] }
/** A report photo: a downscaled data: URL (with any markup circles already drawn
 *  on it) plus the optional numbered labels for those circles. */
export interface ReportImage { src: string; legend?: string[] }
export interface ReportSection {
  heading?: string;
  note?: string;
  rows?: ReportRow[];
  table?: ReportTable;
  images?: ReportImage[]; // downscaled photos (see src/ui/reportImages.ts)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c] ?? c));
}

function sectionHtml(s: ReportSection): string {
  const parts: string[] = ['<div class="sec">'];
  if (s.heading) parts.push(`<div class="sec-title">${escapeHtml(s.heading)}</div>`);
  if (s.note) parts.push(`<div class="note">${escapeHtml(s.note)}</div>`);
  if (s.rows && s.rows.length) {
    parts.push('<div class="rows">' + s.rows.map((r) =>
      `<div class="r"><span class="l">${escapeHtml(r.label)}</span><span class="v">${escapeHtml(r.value)}</span></div>`
    ).join('') + '</div>');
  }
  if (s.table && s.table.rows.length) {
    parts.push('<table><thead><tr>' + s.table.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('') + '</tr></thead><tbody>'
      + s.table.rows.map((row) => '<tr>' + row.map((c) => `<td>${escapeHtml(c)}</td>`).join('') + '</tr>').join('')
      + '</tbody></table>');
  }
  if (s.images && s.images.length) {
    parts.push('<div class="imgs">' + s.images.map((im) => {
      const legend = im.legend && im.legend.length
        ? '<ol class="leg">' + im.legend.map((l) => `<li>${escapeHtml(l)}</li>`).join('') + '</ol>'
        : '';
      return `<figure class="imgfig"><img src="${im.src}" alt="" />${legend}</figure>`;
    }).join('') + '</div>');
  }
  parts.push('</div>');
  return parts.join('');
}

/** Build a standalone printable report page. */
export function buildReportHtml(title: string, subtitle: string, sections: ReportSection[]): string {
  const styles = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, Arial, sans-serif; font-size: 11pt; color: #111; background: #fff; padding: 32px 40px; max-width: 760px; margin: 0 auto; }
    .app-label { font-size: 8pt; color: #bbb; text-align: right; margin-bottom: 6px; }
    .header { border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 20px; }
    .header h1 { font-size: 18pt; }
    .header .meta { font-size: 10pt; color: #555; margin-top: 4px; }
    .sec { margin-bottom: 20px; page-break-inside: avoid; }
    .sec-title { font-size: 10pt; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #222; margin-bottom: 8px; }
    .note { font-size: 10pt; color: #555; margin-bottom: 8px; }
    .rows .r { display: flex; justify-content: space-between; padding: 5px 2px; border-bottom: 0.5px solid #e5e5e5; font-size: 10.5pt; }
    .rows .l { color: #333; } .rows .v { color: #111; font-weight: 500; text-align: right; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; font-size: 10pt; padding: 6px 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
    th { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .5px; color: #666; border-bottom: 1.5px solid #888; }
    .imgs { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 6px; align-items: flex-start; }
    .imgfig { margin: 0; width: 240px; }
    .imgs img { width: 240px; height: auto; max-height: 320px; object-fit: contain; border: 1px solid #ccc; border-radius: 4px; }
    .leg { margin: 4px 0 0; padding-left: 18px; font-size: 10pt; }
    .leg li { margin: 1px 0; }
    .close-bar { margin-bottom: 16px; }
    .close-btn { font-family: inherit; font-size: 11pt; padding: 10px 16px; border-radius: 8px; border: 1px solid #888; background: #f2f2f2; color: #111; cursor: pointer; }
    @media print { body { padding: 0.4in 0.5in; } .close-bar { display: none; } }
  `;
  const body = sections.length === 0 ? '<p>Nothing to report yet.</p>' : sections.map(sectionHtml).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title><style>${styles}</style></head>
  <body>
    <div class="close-bar"><button class="close-btn" onclick="window.close()">← Close &amp; return to FirearmLog</button></div>
    <div class="app-label">FirearmLog — Report</div>
    <div class="header"><h1>${escapeHtml(title)}</h1>${subtitle ? `<div class="meta">${escapeHtml(subtitle)}</div>` : ''}</div>
    ${body}
  </body></html>`;
}
