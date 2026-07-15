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
import { chartDateLabel, dateMode, formatMetricTick, labeledTicks, thinIndices } from '../lib/chartFurniture.ts';
import { ChartReadout } from './ChartReadout.tsx';

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
            <DrillTrend attempts={attempts} best={best} lowerIsBetter={lowerIsBetter} scoring={scoring} />
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

// The drill's key number over time (oldest → newest, left → right), with the
// best run marked. F4 (session 62): furnished per the chart-furniture spec —
// y gridlines with unit-aware tick labels, date anchors along the x-axis, an
// always-visible label on the latest run, and a tap-readout line beneath
// (never invisible: it starts as a hint). Falls back to a plain note when
// there aren't two scoreable runs to draw a line between.
function DrillTrend({ attempts, best, lowerIsBetter, scoring }: {
  attempts: DrillHistoryAttempt[]; best: DrillHistoryAttempt | null; lowerIsBetter: boolean;
  scoring: string;
}) {
  // The readout stores WHICH run was tapped, and the text derives from the
  // current data at render — so it can never assert numbers for data the
  // chart no longer shows (fresh-eyes audit finding, session 62).
  const [selIdx, setSelIdx] = useState<number | null>(null);
  // attempts are newest-first; chart reads oldest → newest.
  const chrono = [...attempts].reverse().filter((a) => a.metric != null);
  if (chrono.length < 2) {
    return <p className="report-note">Log at least two scoreable runs to see a trend.</p>;
  }

  const values = chrono.map((a) => a.metric as number);
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  // Deduped by label so a near-flat domain doesn't print one number thrice.
  const ticks = labeledTicks(min, max, (v) => formatMetricTick(v, scoring));
  // The tick gutter grows with the widest label ("HF 10.51" needs more room
  // than "42") so nothing clips at the viewBox edge.
  const padL = Math.max(34, 10 + Math.round(5.6 * Math.max(...ticks.map((t) => t.label.length))));
  const w = 280, h = 140, padR = 12, padT = 14, padB = 20;
  const stepX = (w - padL - padR) / (chrono.length - 1);
  const x = (i: number) => padL + i * stepX;
  // Higher value plots higher on screen; for time drills low (fast) values sit
  // near the bottom, so an improving run visibly trends downward.
  const y = (v: number) => padT + (1 - (v - min) / range) * (h - padT - padB);

  const line = chrono.map((a, i) => `${x(i)},${y(a.metric as number)}`).join(' ');
  const mode = dateMode(chrono[0].date, chrono[chrono.length - 1].date);
  const dateIdxs = thinIndices(chrono.length, 4);
  const lastIdx = chrono.length - 1;
  const lastV = chrono[lastIdx].metric as number;
  // The latest run's label sits above its dot unless the dot is near the top,
  // where it would clip — then it drops below.
  const lastLabelY = y(lastV) < padT + 14 ? y(lastV) + 14 : y(lastV) - 8;

  const sel = selIdx != null && selIdx < chrono.length ? chrono[selIdx] : null;
  const readout = sel
    ? `${formatDayKey(sel.date)} — ${formatDrillScore(sel, scoring)}${best != null && sel === best ? ' · Best' : ''}`
    : null;

  return (
    <>
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block', marginTop: 4 }}
      role="img" aria-label={`Trend of your key number across ${chrono.length} runs from ${formatDayKey(chrono[0].date)} to ${formatDayKey(chrono[lastIdx].date)}, ${lowerIsBetter ? 'lower is better' : 'higher is better'}`}>
      {/* Y gridlines + unit-aware tick labels (the scale the tester was missing). */}
      {ticks.map((t) => (
        <g key={t.label}>
          <line x1={padL} y1={y(t.value)} x2={w - padR} y2={y(t.value)} stroke="var(--separator)" strokeWidth={0.5} />
          <text className="chart-tick" x={padL - 5} y={y(t.value) + 3} textAnchor="end"
            fill="var(--text-dim)" fontSize="10" fontFamily="inherit">
            {t.label}
          </text>
        </g>
      ))}
      {/* X date anchors: first and last always, evenly thinned between. */}
      {dateIdxs.map((i) => (
        <text className="chart-date" key={`d-${i}`} x={x(i)} y={h - 6}
          textAnchor={i === 0 ? 'start' : i === lastIdx ? 'end' : 'middle'}
          fill="var(--text-dim)" fontSize="10" fontFamily="inherit">
          {chartDateLabel(chrono[i].date, mode)}
        </text>
      ))}
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
      {/* Honest tap targets: one full-height column per run, split at the
          midpoints between dots — dense series can't steal each other's taps
          the way overlapping circles could. Drawn after the dots so the whole
          column answers the tap. */}
      {chrono.map((a, i) => {
        const left = i === 0 ? 0 : (x(i - 1) + x(i)) / 2;
        const right = i === lastIdx ? w : (x(i) + x(i + 1)) / 2;
        return (
          <rect className="chart-hit" key={`hit-${a.sessionId}-${i}`} x={left} y={0}
            width={right - left} height={h} fill="transparent" style={{ cursor: 'pointer' }}
            onClick={() => setSelIdx(i)}>
            <title>{`${formatDayKey(a.date)}: ${formatDrillScore(a, scoring)}`}</title>
          </rect>
        );
      })}
      {/* The latest run carries its number — the headline is always readable.
          The card-colored halo (paint-order: stroke) keeps it legible where the
          line passes behind it (live-verify catch, session 62). */}
      <text className="chart-last-label" x={x(lastIdx)} y={lastLabelY} textAnchor="end"
        fill="var(--text)" fontSize="11" fontWeight="600" fontFamily="inherit"
        stroke="var(--bg-card)" strokeWidth={3.5} strokeLinejoin="round"
        style={{ pointerEvents: 'none', paintOrder: 'stroke' }}>
        {formatMetricTick(lastV, scoring)}
      </text>
    </svg>
    <ChartReadout value={readout} hint="Tap a dot to see its date and number." />
    </>
  );
}
