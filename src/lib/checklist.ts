// Gear Checklist (Log/Plan Session): ported from Pistol Tracker's gear
// checklist feature, restyled for FirearmLog. Pure functions only — the
// SessionForm screen owns all the JSX/state wiring.
import type { ChecklistCustomItems, ChecklistItem, ChecklistItemState, Firearm, SessionChecklist } from './types.ts';
import { formatDayKey } from './dates.ts';

/** Carried over verbatim from Pistol Tracker's DEFAULT_CHECKLIST_ITEMS. */
export const DEFAULT_CHECKLIST_ITEMS: ChecklistCustomItems = {
  essentials: [
    { id: 'e1', label: 'Eye protection' },
    { id: 'e2', label: 'Ear protection (passive)' },
    { id: 'e3', label: 'Electronic ear protection' },
    { id: 'e4', label: 'Ammo packed' },
    { id: 'e5', label: 'Magazines loaded' },
    { id: 'e6', label: 'Range bag' },
    { id: 'e7', label: 'Targets' },
    { id: 'e8', label: 'Staple gun / tape' },
    { id: 'e9', label: 'Water / snacks' },
    { id: 'e10', label: 'Medical kit / tourniquet' }
  ],
  night: [
    { id: 'n1', label: 'Weapon light (charged & functional)' },
    { id: 'n2', label: 'Handheld flashlight' },
    { id: 'n3', label: 'Headlamp' },
    { id: 'n4', label: 'Extra batteries' },
    { id: 'n5', label: 'High-vis target markers' },
    { id: 'n6', label: 'Night vision (if applicable)' },
    { id: 'n7', label: 'Dark clothing' }
  ],
  // N7: reframed from "Tactical" to class / force-on-force training gear (rule 34 —
  // sport/training frame). Body armor and helmet were dropped from the DEFAULTS (a user
  // can still add them as custom items); FoF/class-relevant gear stays. Night vision stays
  // in the Night category — it's legal low-light sport gear and clears Apple/Google policy
  // (which target sales, auto-fire conversion parts, 30+ mags, and manufacturing, not optics).
  tactical: [
    { id: 't3', label: 'Eye pro rated for FoF' },
    { id: 't4', label: 'Magazine pouches / chest rig' },
    { id: 't5', label: 'Radio / comms' },
    { id: 't6', label: 'Knee and elbow pads' },
    { id: 't7', label: 'Full IFAK medical kit' },
    { id: 't8', label: 'Simunition barrel (if applicable)' }
  ]
};

export const EMPTY_CUSTOM_ITEMS: ChecklistCustomItems = { essentials: [], night: [], tactical: [] };

export type ChecklistCategory = keyof ChecklistCustomItems;

/** A fresh checklist for a brand-new session. */
export function newChecklist(): SessionChecklist {
  return { nightMode: false, tacticalMode: false, items: {} };
}

/** Defensive parse for whatever happens to be in Session.checklist (old imports, etc.). */
export function normalizeChecklist(raw: unknown): SessionChecklist {
  if (!raw || typeof raw !== 'object') return newChecklist();
  const r = raw as Record<string, unknown>;
  const items: SessionChecklist['items'] = {};
  if (r.items && typeof r.items === 'object') {
    for (const [key, val] of Object.entries(r.items as Record<string, unknown>)) {
      if (!val || typeof val !== 'object') continue;
      const v = val as Record<string, unknown>;
      items[key] = { take: v.take === true, packed: v.packed === true };
    }
  }
  return { nightMode: r.nightMode === true, tacticalMode: r.tacticalMode === true, items };
}

/** Defensive parse for AppSettings.checklistCustomItems. */
export function normalizeCustomItems(raw: unknown): ChecklistCustomItems {
  if (!raw || typeof raw !== 'object') return { essentials: [], night: [], tactical: [] };
  const r = raw as Record<string, unknown>;
  const cat = (key: string): ChecklistItem[] => {
    const v = r[key];
    if (!Array.isArray(v)) return [];
    return v.filter((i): i is ChecklistItem =>
      !!i && typeof i === 'object'
      && typeof (i as Record<string, unknown>).id === 'string'
      && typeof (i as Record<string, unknown>).label === 'string');
  };
  return { essentials: cat('essentials'), night: cat('night'), tactical: cat('tactical') };
}

/** Default + custom items for one category, in display order. */
export function checklistItemsForCategory(
  cat: keyof ChecklistCustomItems,
  custom: ChecklistCustomItems
): ChecklistItem[] {
  return [...DEFAULT_CHECKLIST_ITEMS[cat], ...(custom[cat] ?? [])];
}

/** The take/packed state for one item, defaulting to "neither" if not yet recorded. */
export function itemState(cl: SessionChecklist, itemId: string): ChecklistItemState {
  return cl.items[itemId] ?? {};
}

/** Toggle whether a single item (or `f_<firearmId>`) is on the take list. Unchecking also clears "packed". */
export function setItemTake(cl: SessionChecklist, itemId: string, take: boolean): SessionChecklist {
  const cur = itemState(cl, itemId);
  const items = { ...cl.items, [itemId]: take ? { ...cur, take: true } : { take: false, packed: false } };
  return { ...cl, items };
}

/** Mark an item as packed (or not). No-op data-wise if the item isn't on the take list. */
export function setItemPacked(cl: SessionChecklist, itemId: string, packed: boolean): SessionChecklist {
  const cur = itemState(cl, itemId);
  return { ...cl, items: { ...cl.items, [itemId]: { ...cur, packed } } };
}

/** Turn the Night Session or Tactical category on/off. Turning off clears its items' take/packed state. */
export function setChecklistMode(
  cl: SessionChecklist,
  cat: 'night' | 'tactical',
  enabled: boolean,
  custom: ChecklistCustomItems
): SessionChecklist {
  let items = cl.items;
  if (!enabled) {
    items = { ...items };
    for (const item of checklistItemsForCategory(cat, custom)) delete items[item.id];
  }
  return {
    ...cl,
    items,
    nightMode: cat === 'night' ? enabled : cl.nightMode,
    tacticalMode: cat === 'tactical' ? enabled : cl.tacticalMode
  };
}

/** Append a custom gear item to a category. Returns the updated settings object. */
export function addCustomItem(custom: ChecklistCustomItems, cat: keyof ChecklistCustomItems, id: string, label: string): ChecklistCustomItems {
  const trimmed = label.trim();
  if (!trimmed) return custom;
  return { ...custom, [cat]: [...(custom[cat] ?? []), { id, label: trimmed }] };
}

/** Progress across firearms + active gear categories: how many "take" items are also "packed". */
export function checklistProgress(
  cl: SessionChecklist,
  firearms: Firearm[],
  custom: ChecklistCustomItems
): { toTake: number; packed: number; pct: number } {
  let toTake = 0;
  let packed = 0;

  for (const f of firearms) {
    const s = cl.items[`f_${f.id}`];
    if (s?.take) {
      toTake += 1;
      if (s.packed) packed += 1;
    }
  }

  const cats: (keyof ChecklistCustomItems)[] = ['essentials'];
  if (cl.nightMode) cats.push('night');
  if (cl.tacticalMode) cats.push('tactical');
  for (const cat of cats) {
    for (const item of checklistItemsForCategory(cat, custom)) {
      const s = cl.items[item.id];
      if (s?.take) {
        toTake += 1;
        if (s.packed) packed += 1;
      }
    }
  }

  const pct = toTake > 0 ? Math.round((packed / toTake) * 100) : 0;
  return { toTake, packed, pct };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c] ?? c));
}

/** Build the standalone printable HTML page for "Print Checklist" (ported from PT). */
export function buildChecklistPrintHtml(opts: {
  date: string;
  location: string;
  notes: string;
  checklist: SessionChecklist;
  custom: ChecklistCustomItems;
  firearms: Firearm[];
}): string {
  const { date, location, notes, checklist: cl, custom, firearms } = opts;

  const styles = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, Arial, sans-serif; font-size: 11pt; color: #111; background: #fff; padding: 32px 40px; max-width: 680px; margin: 0 auto; }
    .header { border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 20px; }
    .header h1 { font-size: 18pt; font-weight: bold; }
    .header .meta { font-size: 10pt; color: #555; margin-top: 4px; }
    .progress { margin-bottom: 20px; font-size: 12pt; color: #444; }
    .cl-section { margin-bottom: 18px; }
    .cl-section-title { font-size: 9pt; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #222; margin-bottom: 8px; }
    .cl-item { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border: 1px solid #888; border-radius: 4px; margin-bottom: 4px; }
    .cl-item.packed { background: #f0f8f0; border-color: #2a7a2a; }
    .cl-box { width: 18px; height: 18px; border: 1.5px solid #555; border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 11pt; font-weight: bold; color: #2a7a2a; flex-shrink: 0; }
    .cl-item.packed .cl-box { background: #d4edda; border-color: #2a7a2a; }
    .cl-label { font-size: 11pt; }
    .app-label { font-size: 8pt; color: #bbb; text-align: right; margin-bottom: 6px; }
    .notes-section { margin-top: 24px; padding-top: 16px; border-top: 1px solid #ccc; }
    .notes-title { font-size: 9pt; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #222; margin-bottom: 8px; }
    .notes-body { font-size: 11pt; color: #333; white-space: pre-wrap; line-height: 1.5; }
    .close-bar { margin-bottom: 16px; }
    .close-btn {
      font-family: inherit; font-size: 11pt; padding: 10px 16px; border-radius: 8px;
      border: 1px solid #888; background: #f2f2f2; color: #111; cursor: pointer;
    }
    @media print { body { padding: 0.4in 0.5in; } .close-bar { display: none; } }
  `;

  const fwSelected = firearms.filter((f) => cl.items[`f_${f.id}`]?.take);

  function sectionRows(cat: keyof ChecklistCustomItems, title: string, icon: string): string {
    const items = checklistItemsForCategory(cat, custom).filter((i) => cl.items[i.id]?.take);
    if (!items.length) return '';
    return `<div class="cl-section">
      <div class="cl-section-title">${icon ? icon + ' ' : ''}${title}</div>
      ${items.map((item) => {
        const isPacked = cl.items[item.id]?.packed;
        return `<div class="cl-item ${isPacked ? 'packed' : ''}">
          <span class="cl-box">${isPacked ? '✓' : ''}</span>
          <span class="cl-label">${escapeHtml(item.label)}</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  const { toTake, packed } = checklistProgress(cl, firearms, custom);

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Gear Checklist — ${escapeHtml(date)}</title><style>${styles}</style></head>
  <body>
    <div class="close-bar"><button class="close-btn" onclick="window.close()">← Close &amp; return to FirearmLog</button></div>
    <div class="app-label">FirearmLog — Gear Checklist</div>
    <div class="header">
      <h1>Gear Checklist — ${escapeHtml(formatDayKey(date))}</h1>
      <div class="meta">${fwSelected.length ? fwSelected.map((fw) => escapeHtml(fw.name)).join(', ') : '—'}${location ? ' · ' + escapeHtml(location) : ''}</div>
    </div>
    <div class="progress">${packed} of ${toTake} items packed</div>
    ${fwSelected.length ? `<div class="cl-section">
      <div class="cl-section-title">🔫 Firearms</div>
      ${fwSelected.map((fw) => {
        const isPacked = cl.items[`f_${fw.id}`]?.packed;
        return `<div class="cl-item ${isPacked ? 'packed' : ''}"><span class="cl-box">${isPacked ? '✓' : ''}</span><span class="cl-label">${escapeHtml(fw.name)}</span></div>`;
      }).join('')}
    </div>` : ''}
    ${sectionRows('essentials', 'Range Essentials', '🎯')}
    ${cl.nightMode ? sectionRows('night', 'Night Session', '🔦') : ''}
    ${cl.tacticalMode ? sectionRows('tactical', 'Class / force-on-force gear', '') : ''}
    ${notes ? `<div class="notes-section"><div class="notes-title">Notes</div><div class="notes-body">${escapeHtml(notes)}</div></div>` : ''}
  </body></html>`;
}
