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
  const cells: (number | null)[] = [
    ...(Array.from({ length: startPad }, () => null) as null[]),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1)
  ];
  while (cells.length % 7 !== 0) cells.push(null);
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
        {cells.map((d, i) => {
          if (d === null) return <div key={i} className="cal-cell empty" />;
          const key = dayKey(new Date(year, month, d));
          const list = items.get(key) ?? [];
          const present = KIND_ORDER.filter((k) => list.some((x) => x.kind === k));
          return (
            <button key={i}
              className={`cal-cell ${key === todayK ? 'today' : ''} ${list.length ? 'busy' : ''}`}
              onClick={() => tapDay(d)}
              aria-label={`${key}: ${present.length ? present.map((k) => KIND_LABEL[k]).join(', ') : 'nothing logged'}`}>
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
        <Sheet title="That Day" onClose={() => setDaySheet(null)}>
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
