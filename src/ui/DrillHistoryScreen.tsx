// Per-drill history (T3-2): open one drill and see how you've done over time —
// a trend of your key number, your best, and every attempt (newest first),
// each tapping through to the session it came from. Read-only view over the
// drill results you already log; no data-model change.
import { useEffect, useState } from 'react';
import { ScreenLoading } from './ScreenState.tsx';
import type { View } from './nav.ts';
import type { DrillDef, Session } from '../lib/types.ts';
import { getAll } from '../lib/db.ts';
import { activeOnly } from '../lib/softDelete.ts';
import { drillHistory, formatDrillScore, type DrillHistory, type DrillHistoryAttempt } from '../lib/dashboard.ts';
import { formatDayKey } from '../lib/dates.ts';
import { ScreenError } from './ScreenState.tsx';

export function DrillHistoryScreen({ name, refreshKey, onBack, open }: {
  name: string; refreshKey: number; onBack: () => void; open: (v: View) => void;
}) {
  const [history, setHistory] = useState<DrillHistory | null>(null);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(false);
    void Promise.all([getAll<Session>('sessions'), getAll<DrillDef>('drills')])
      .then(([sessions, drills]) => {
        if (!alive) return;
        setHistory(drillHistory(activeOnly(sessions), drills, name));
      })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [name, refreshKey, nonce]);

  if (error) return <ScreenError onRetry={() => setNonce((n) => n + 1)} />;
  if (!history) return <ScreenLoading />;

  const { attempts, best, scoring, lowerIsBetter } = history;

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">{name}</h1>

      {attempts.length === 0 ? (
        <p className="empty">You haven't logged this drill yet. Add it to a session and your runs will show up here.</p>
      ) : (
        <>
          {best && (
            <div className="card">
              <div className="row" style={{ borderBottom: 'none' }}>
                <span className="label">Best</span>
                <span className="value" style={{ color: 'var(--accent-ink)' }}>
                  {formatDrillScore(best, scoring)}
                </span>
              </div>
              <p className="report-note" style={{ marginTop: 0 }}>
                Set {formatDayKey(best.date)} · {attempts.length} run{attempts.length === 1 ? '' : 's'} logged
              </p>
            </div>
          )}

          <div className="card">
            <h2>Trend {lowerIsBetter ? '(lower is better)' : ''}</h2>
            <DrillTrend attempts={attempts} best={best} lowerIsBetter={lowerIsBetter} />
          </div>

          <div className="card">
            <h2>Every Run</h2>
            {attempts.map((a, i) => (
              <button className="row-tap" key={`${a.sessionId}-${i}`}
                onClick={() => open({ kind: 'session-form', id: a.sessionId })}>
                <span className="label">
                  {formatDayKey(a.date)}
                  {best && a === best && (
                    <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: 'var(--accent-ink)' }}>Best</span>
                  )}
                  <div className="row-sub">
                    {[formatDrillScore(a, scoring), a.distance && `${a.distance}`, a.notes].filter(Boolean).join(' · ')}
                  </div>
                </span>
                <span className="value">›</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// A small line chart of the drill's key number over time (oldest → newest,
// left → right), with the best run marked. Hand-rolled SVG, colors via CSS
// variables — matches the app's other charts. Falls back to a plain note when
// there aren't two scoreable runs to draw a line between.
function DrillTrend({ attempts, best, lowerIsBetter }: {
  attempts: DrillHistoryAttempt[]; best: DrillHistoryAttempt | null; lowerIsBetter: boolean;
}) {
  // attempts are newest-first; chart reads oldest → newest.
  const chrono = [...attempts].reverse().filter((a) => a.metric != null);
  if (chrono.length < 2) {
    return <p className="report-note">Log at least two scoreable runs to see a trend.</p>;
  }

  const w = 280, h = 120, padX = 8, padY = 12;
  const values = chrono.map((a) => a.metric as number);
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const stepX = (w - padX * 2) / (chrono.length - 1);
  const x = (i: number) => padX + i * stepX;
  // Higher value plots higher on screen; for time drills low (fast) values sit
  // near the bottom, so an improving run visibly trends downward.
  const y = (v: number) => padY + (1 - (v - min) / range) * (h - padY * 2);

  const line = chrono.map((a, i) => `${x(i)},${y(a.metric as number)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block', marginTop: 4 }}
      role="img" aria-label={`Trend of your key number across ${chrono.length} runs, ${lowerIsBetter ? 'lower is better' : 'higher is better'}`}>
      <polyline points={line} fill="none" stroke="var(--text-dim)" strokeWidth={1.5}
        strokeLinejoin="round" strokeLinecap="round" />
      {chrono.map((a, i) => {
        const isBest = best != null && a === best;
        return (
          <circle key={`${a.sessionId}-${i}`} cx={x(i)} cy={y(a.metric as number)}
            r={isBest ? 4 : 2.5}
            fill={isBest ? 'var(--accent)' : 'var(--text-dim)'} />
        );
      })}
    </svg>
  );
}
