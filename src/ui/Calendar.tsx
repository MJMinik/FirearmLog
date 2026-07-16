// Month calendar (spec §10.3, req 24): sessions and matches on a grid;
// tap a day to open what happened that day.
import { useState } from 'react';
import { dayKey } from '../lib/dates.ts';
import { Sheet } from './Sheet.tsx';

export interface CalItem { kind: 'practice' | 'dry' | 'class' | 'match'; id: string; label: string; sub: string; }

const KIND_ORDER = ['practice', 'dry', 'class', 'match'] as const;
const KIND_LABEL: Record<CalItem['kind'], string> = {
  practice: 'practice', dry: 'dry fire', class: 'class', match: 'match'
};

export function MonthCalendar({ items, onOpen, onEmptyDay }: {
  items: Map<string, CalItem[]>; onOpen: (it: CalItem) => void;
  /** Audit #9: tapping a day with nothing on it offers to start a session there. */
  onEmptyDay?: (dateKey: string) => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [daySheet, setDaySheet] = useState<CalItem[] | null>(null);

  const first = new Date(year, month, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Tester-2 F7 (July 16 2026): the month's days, no padding cells. We used to
  // pad the grid with empty `.cal-cell` divs; a content-less grid cell takes an
  // intrinsic ~96px height that inflated any row it sat in (the first and last
  // weeks read a full row taller than the middle). Instead we render only the
  // real days and push the 1st into its weekday column with `grid-column-start`,
  // so the grid never holds an empty cell and every row is one clean 44px band.
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const monthName = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const todayK = dayKey(now);

  function shift(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  function tapDay(d: number) {
    const key = dayKey(new Date(year, month, d));
    const list = items.get(key) ?? [];
    if (list.length === 1) onOpen(list[0]);
    else if (list.length > 1) setDaySheet(list);
    else onEmptyDay?.(key);
  }

  return (
    <div className="card">
      <div className="cal-head">
        <button className="icon-btn" aria-label="Previous month" onClick={() => shift(-1)}>‹</button>
        <h2 style={{ margin: 0 }}>{monthName}</h2>
        <button className="icon-btn" aria-label="Next month" onClick={() => shift(1)}>›</button>
      </div>
      <div className="cal-grid cal-weekdays" aria-hidden="true">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => <div key={i}>{w}</div>)}
      </div>
      <div className="cal-grid">
        {days.map((d) => {
          const key = dayKey(new Date(year, month, d));
          const dateLabel = new Date(year, month, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
          const list = items.get(key) ?? [];
          const present = KIND_ORDER.filter((k) => list.some((x) => x.kind === k));
          return (
            <button key={d}
              // Tester-2 F7 (July 16 2026): push the 1st into its weekday column;
              // the rest flow after it. No empty pad cells — see above.
              style={d === 1 ? { gridColumnStart: startPad + 1 } : undefined}
              className={`cal-cell ${key === todayK ? 'today' : ''} ${list.length ? 'busy' : ''}`}
              onClick={() => tapDay(d)}
              aria-label={`${dateLabel}: ${present.length ? present.map((k) => KIND_LABEL[k]).join(', ') : 'nothing logged'}`}>
              <span>{d}</span>
              <span className="cal-dots">
                {list.some((x) => x.kind === 'practice') && <span className="dot practice" />}
                {list.some((x) => x.kind === 'dry') && <span className="dot dry" />}
                {list.some((x) => x.kind === 'class') && <span className="dot class" />}
                {list.some((x) => x.kind === 'match') && <span className="dot match" />}
              </span>
            </button>
          );
        })}
      </div>
      <p className="report-note" style={{ marginTop: 8 }}>
        <span className="dot practice" style={{ display: 'inline-block', verticalAlign: 'middle' }} /> practice ·{' '}
        <span className="dot dry" style={{ display: 'inline-block', verticalAlign: 'middle' }} /> dry fire ·{' '}
        <span className="dot class" style={{ display: 'inline-block', verticalAlign: 'middle' }} /> class ·{' '}
        <span className="dot match" style={{ display: 'inline-block', verticalAlign: 'middle' }} /> match
      </p>
      {daySheet && (
        <Sheet title="Sessions on this day" onClose={() => setDaySheet(null)}>
          {daySheet.map((it) => (
            <button key={`${it.kind}-${it.id}`} className="drill-pick-row"
              onClick={() => { setDaySheet(null); onOpen(it); }}>
              <strong>{it.label}</strong>
              <span>{it.sub}</span>
            </button>
          ))}
        </Sheet>
      )}
    </div>
  );
}
