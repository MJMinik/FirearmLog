// Spare Parts inventory report (printable). Pure functions — grouping, totals,
// and the HTML page — so the math/layout can be unit-tested without a DOM.
// Mirrors the checklist print page's look.
import type { Firearm, Part } from './types.ts';
import { formatDayKey } from './dates.ts';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c] ?? c));
}

export interface PartsGroup { heading: string; parts: Part[]; }

function sortParts(parts: Part[]): Part[] {
  return [...parts].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Group parts by the firearm they're for. Guns come first (alphabetical by
 * name), with "Any / Universal" parts last. Each group's parts are sorted by
 * name.
 */
export function groupParts(parts: Part[], firearms: Firearm[]): PartsGroup[] {
  const nameOf = (id: string) => firearms.find((f) => f.id === id)?.name ?? '—';
  const byKey = new Map<string, Part[]>(); // '' = universal
  for (const p of parts) {
    const key = p.firearmId || '';
    const arr = byKey.get(key) ?? [];
    arr.push(p);
    byKey.set(key, arr);
  }
  const groups: PartsGroup[] = [];
  const gunKeys = [...byKey.keys()].filter((k) => k !== '');
  gunKeys.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  for (const k of gunKeys) groups.push({ heading: nameOf(k), parts: sortParts(byKey.get(k) ?? []) });
  if (byKey.has('')) groups.push({ heading: 'Any / Universal', parts: sortParts(byKey.get('') ?? []) });
  return groups;
}

/** Distinct part records and the sum of their quantities. */
export function partsTotals(parts: Part[]): { distinct: number; quantity: number } {
  return {
    distinct: parts.length,
    quantity: parts.reduce((t, p) => t + (Number.isFinite(p.quantity) ? p.quantity : 0), 0)
  };
}

/** Standalone printable HTML page for the Spare Parts report. */
export function buildPartsReportHtml(opts: { parts: Part[]; firearms: Firearm[]; today: string }): string {
  const { parts, firearms, today } = opts;
  const groups = groupParts(parts, firearms);
  const totals = partsTotals(parts);

  const styles = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, Arial, sans-serif; font-size: 11pt; color: #111; background: #fff; padding: 32px 40px; max-width: 760px; margin: 0 auto; }
    .header { border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 20px; }
    .header h1 { font-size: 18pt; font-weight: bold; }
    .header .meta { font-size: 10pt; color: #555; margin-top: 4px; }
    .app-label { font-size: 8pt; color: #bbb; text-align: right; margin-bottom: 6px; }
    .grp { margin-bottom: 22px; }
    .grp-title { font-size: 10pt; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #222; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; font-size: 10.5pt; padding: 6px 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
    th { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .5px; color: #666; border-bottom: 1.5px solid #888; }
    td.qty, th.qty { text-align: right; white-space: nowrap; }
    .totals { margin-top: 8px; font-size: 11pt; color: #444; }
    .close-bar { margin-bottom: 16px; }
    .close-btn { font-family: inherit; font-size: 11pt; padding: 10px 16px; border-radius: 8px; border: 1px solid #888; background: #f2f2f2; color: #111; cursor: pointer; }
    @media print { body { padding: 0.4in 0.5in; } .close-bar { display: none; } }
  `;

  const groupHtml = groups.map((g) => `
    <div class="grp">
      <div class="grp-title">${escapeHtml(g.heading)}</div>
      <table>
        <thead><tr><th>Part</th><th class="qty">Qty</th><th>Part #</th><th>Purchased</th><th>Notes</th></tr></thead>
        <tbody>
          ${g.parts.map((p) => `<tr>
            <td>${escapeHtml(p.name)}</td>
            <td class="qty">${Number.isFinite(p.quantity) ? p.quantity : 0}</td>
            <td>${escapeHtml(p.partNumber || '—')}</td>
            <td>${p.datePurchased ? escapeHtml(formatDayKey(p.datePurchased)) : '—'}</td>
            <td>${escapeHtml(p.notes || '')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`).join('');

  const body = parts.length === 0
    ? '<p>No spare parts logged yet.</p>'
    : `${groupHtml}<div class="totals">${totals.distinct} part${totals.distinct === 1 ? '' : 's'} on hand · ${totals.quantity} item${totals.quantity === 1 ? '' : 's'} total</div>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Spare Parts — ${escapeHtml(today)}</title><style>${styles}</style></head>
  <body>
    <div class="close-bar"><button class="close-btn" onclick="window.close()">← Close &amp; return to FirearmLog</button></div>
    <div class="app-label">FirearmLog — Spare Parts Report</div>
    <div class="header">
      <h1>Spare Parts Inventory</h1>
      <div class="meta">${escapeHtml(formatDayKey(today))}</div>
    </div>
    ${body}
  </body></html>`;
}
