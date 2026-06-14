// Training activity heatmap (spec §10 — calendar heatmap). Pure: builds a grid
// of weeks × 7 days, each day with its rounds/sessions and an intensity level
// 0–4. The Progress screen renders it as a small SVG.
import type { Session } from './types.ts';
import { sessionRounds } from './stats.ts';
import { dayKey } from './dates.ts';

export interface HeatCell {
  date: string;     // YYYY-MM-DD
  rounds: number;
  sessions: number;
  level: number;    // 0 (none) … 4 (heaviest)
  inRange: boolean; // false for future days padding the last column
}

/** Intensity from a day's activity. Any logged day is at least level 1. */
export function heatLevel(rounds: number, sessions: number): number {
  if (sessions === 0) return 0;
  if (rounds >= 300) return 4;
  if (rounds >= 150) return 3;
  if (rounds >= 50) return 2;
  return 1;
}

/**
 * Columns of weeks (oldest→newest), each a Sun→Sat array of 7 HeatCells, for
 * the last `weeks` weeks ending in the week that contains `now`.
 */
export function buildHeatmap(
  sessions: Pick<Session, 'date' | 'planned' | 'guns' | 'type'>[],
  weeks: number,
  now: Date = new Date()
): HeatCell[][] {
  const byDay = new Map<string, { rounds: number; sessions: number }>();
  for (const s of sessions) {
    if (s.planned || !s.date) continue;
    const cur = byDay.get(s.date) ?? { rounds: 0, sessions: 0 };
    cur.rounds += sessionRounds(s);
    cur.sessions += 1;
    byDay.set(s.date, cur);
  }

  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Back up to the Sunday that starts the leftmost column.
  const start = new Date(end);
  start.setDate(end.getDate() - (weeks - 1) * 7 - end.getDay());

  const cols: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    for (let dow = 0; dow < 7; dow++) {
      const d = new Date(start);
      d.setDate(start.getDate() + w * 7 + dow);
      const key = dayKey(d);
      const agg = byDay.get(key) ?? { rounds: 0, sessions: 0 };
      const inRange = d.getTime() <= end.getTime();
      col.push({
        date: key, rounds: agg.rounds, sessions: agg.sessions,
        level: inRange ? heatLevel(agg.rounds, agg.sessions) : 0, inRange
      });
    }
    cols.push(col);
  }
  return cols;
}
