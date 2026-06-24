// The "Print Drills" run-sheet (Michael's June-23 redesign): a printable score
// table for a session's drills. Drills run down the left; columns across the top
// are Drill, Distance, Time (s), Score, Out of.
//   - Planned session  -> blank grey boxes you fill in by hand at the range
//                         (Distance pre-filled if one was set, otherwise blank).
//   - Logged session   -> the same grid with your recorded results.
// Pure HTML builder so it's unit-testable; the session form resolves each drill
// row against the drill library and hands the items here.
import { formatDayKey } from './dates.ts';

export interface DrillReportItem {
  name: string;
  brief: string;              // short description, printed under the drill name
  distance: string;          // planned: pre-filled if set; logged: as recorded
  time: number | null;
  score: number | null;
  maxScore: number | null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c] ?? c));
}

const num = (n: number | null): string => (n == null ? '' : String(n));

/**
 * Printable drill score-sheet. `planned` chooses blank fill-in boxes (true) vs.
 * the recorded results (false).
 */
export function buildDrillReportHtml(
  items: DrillReportItem[],
  opts: { planned: boolean; date?: string; location?: string }
): string {
  const { planned, date, location } = opts;

  const styles = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, Arial, sans-serif; font-size: 11pt; color: #111; background: #fff; padding: 32px 40px; max-width: 720px; margin: 0 auto; }
    .app-label { font-size: 8pt; color: #bbb; text-align: right; margin-bottom: 6px; }
    .header { border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 18px; }
    .header h1 { font-size: 18pt; font-weight: bold; }
    .header .meta { font-size: 10pt; color: #555; margin-top: 4px; }
    .hint { font-size: 9.5pt; color: #666; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th { text-align: left; color: #555; font-weight: 600; font-size: 9.5pt; padding: 4px 6px; border-bottom: 1.5px solid #999; }
    td { padding: 9px 6px; vertical-align: top; border-bottom: 1px solid #e3e3e3; }
    tr { page-break-inside: avoid; }
    .drill-name { font-weight: bold; font-size: 11.5pt; }
    .drill-brief { font-size: 9pt; color: #666; margin-top: 2px; }
    .box { background: #f1f1f1; border: 1px solid #cfcfcf; border-radius: 6px; height: 30px; }
    .val { font-size: 11pt; padding-top: 3px; }
    .close-bar { margin-bottom: 16px; }
    .close-btn { font-family: inherit; font-size: 11pt; padding: 10px 16px; border-radius: 8px; border: 1px solid #888; background: #f2f2f2; color: #111; cursor: pointer; }
    @media print { body { padding: 0.4in 0.5in; } .close-bar { display: none; } }
  `;

  const metaBits = [date ? formatDayKey(date) : '', location ?? ''].filter(Boolean).map(escapeHtml).join(' · ');

  // One cell: a blank box (planned) or the recorded value (logged). The planned
  // Distance cell shows its pre-filled value when one was set.
  const cell = (value: string, forceBox = false): string => {
    if (planned && (forceBox || !value)) return '<div class="box"></div>';
    return `<div class="val">${escapeHtml(value) || '&nbsp;'}</div>`;
  };

  const rows = items.length === 0
    ? '<tr><td colspan="5" style="color:#666;padding:14px 6px;">No drills scheduled yet.</td></tr>'
    : items.map((d) => `<tr>
        <td>
          <div class="drill-name">${escapeHtml(d.name)}</div>
          ${d.brief ? `<div class="drill-brief">${escapeHtml(d.brief)}</div>` : ''}
        </td>
        <td>${cell(d.distance)}</td>
        <td>${cell(num(d.time), true)}</td>
        <td>${cell(num(d.score), true)}</td>
        <td>${cell(num(d.maxScore), true)}</td>
      </tr>`).join('');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Drills${date ? ' — ' + escapeHtml(date) : ''}</title><style>${styles}</style></head>
  <body>
    <div class="close-bar"><button class="close-btn" onclick="window.close()">← Close &amp; return to FirearmLog</button></div>
    <div class="app-label">FirearmLog — Drill Run-Sheet</div>
    <div class="header">
      <h1>Drills for this session</h1>
      ${metaBits ? `<div class="meta">${metaBits}</div>` : ''}
    </div>
    ${planned ? '<div class="hint">Fill in your results at the range.</div>' : ''}
    <table>
      <colgroup><col style="width:34%"><col style="width:16.5%"><col style="width:16.5%"><col style="width:16.5%"><col style="width:16.5%"></colgroup>
      <thead><tr>
        <th>Drill</th><th>Distance</th><th>Time (s)</th><th>Score</th><th>Out of</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </body></html>`;
}
