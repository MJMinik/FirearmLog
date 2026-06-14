// "Print Drill" report (Michael's June 14 request): a printable run-sheet of
// the drills scheduled for a session, with the option to include or omit the
// scoring. Pure HTML builder so it's unit-testable; the session form resolves
// each drill row against the drill library and hands the items here.
import { formatDayKey } from './dates.ts';

export interface DrillReportItem {
  name: string;
  fire: string;          // 'live' | 'dry' | 'both'
  gunCategories: string[];
  brief: string;
  full: string;
  scoring: string;
  requiresHolster: boolean;
  distance: string;      // planned distance for this session (may be blank)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c] ?? c));
}

const FIRE_LABEL: Record<string, string> = { live: 'Live fire', dry: 'Dry fire', both: 'Live & dry' };

/** Printable drill run-sheet. `includeScoring` shows/hides each drill's scoring. */
export function buildDrillReportHtml(
  items: DrillReportItem[],
  opts: { includeScoring: boolean; date?: string; location?: string }
): string {
  const { includeScoring, date, location } = opts;

  const styles = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, Arial, sans-serif; font-size: 11pt; color: #111; background: #fff; padding: 32px 40px; max-width: 720px; margin: 0 auto; }
    .app-label { font-size: 8pt; color: #bbb; text-align: right; margin-bottom: 6px; }
    .header { border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 20px; }
    .header h1 { font-size: 18pt; font-weight: bold; }
    .header .meta { font-size: 10pt; color: #555; margin-top: 4px; }
    .drill { border: 1px solid #999; border-radius: 6px; padding: 12px 14px; margin-bottom: 12px; page-break-inside: avoid; }
    .drill h2 { font-size: 13pt; margin-bottom: 4px; }
    .drill .tags { font-size: 9pt; color: #666; margin-bottom: 8px; }
    .drill .brief { font-size: 11pt; margin-bottom: 6px; }
    .drill .full { font-size: 10.5pt; color: #333; white-space: pre-wrap; line-height: 1.45; margin-bottom: 6px; }
    .drill .row { font-size: 10pt; color: #222; margin-top: 4px; }
    .drill .label { color: #666; }
    .close-bar { margin-bottom: 16px; }
    .close-btn { font-family: inherit; font-size: 11pt; padding: 10px 16px; border-radius: 8px; border: 1px solid #888; background: #f2f2f2; color: #111; cursor: pointer; }
    @media print { body { padding: 0.4in 0.5in; } .close-bar { display: none; } }
  `;

  const metaBits = [date ? formatDayKey(date) : '', location ?? ''].filter(Boolean).map(escapeHtml).join(' · ');

  const body = items.length === 0
    ? '<p>No drills scheduled yet.</p>'
    : items.map((d) => {
        const tags = [FIRE_LABEL[d.fire] ?? d.fire, d.gunCategories.join(', ') || 'Any gun',
          d.requiresHolster ? 'Holster' : ''].filter(Boolean).map(escapeHtml).join(' · ');
        return `<div class="drill">
          <h2>${escapeHtml(d.name)}</h2>
          <div class="tags">${tags}</div>
          ${d.brief ? `<div class="brief">${escapeHtml(d.brief)}</div>` : ''}
          ${d.full ? `<div class="full">${escapeHtml(d.full)}</div>` : ''}
          ${d.distance ? `<div class="row"><span class="label">Distance:</span> ${escapeHtml(d.distance)}</div>` : ''}
          ${includeScoring && d.scoring ? `<div class="row"><span class="label">Scoring:</span> ${escapeHtml(d.scoring)}</div>` : ''}
        </div>`;
      }).join('');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Drills${date ? ' — ' + escapeHtml(date) : ''}</title><style>${styles}</style></head>
  <body>
    <div class="close-bar"><button class="close-btn" onclick="window.close()">← Close &amp; return to FirearmLog</button></div>
    <div class="app-label">FirearmLog — Drill Run-Sheet</div>
    <div class="header">
      <h1>Drills for This Session</h1>
      ${metaBits ? `<div class="meta">${metaBits}</div>` : ''}
    </div>
    ${body}
  </body></html>`;
}
