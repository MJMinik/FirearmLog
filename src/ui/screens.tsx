// Tab screens. Home and Log are live against the database; Compete and
// Progress arrive in M5 and M7 and say so in plain language.
import { useEffect, useState, useCallback } from 'react';
import type { Ammunition, Classifier, DrillDef, Firearm, GunCategory, MaintenanceEntry, Match, Purchase, Reference, Session } from '../lib/types.ts';
import { GUN_CATEGORIES } from '../lib/types.ts';
import { getAll, getOne, putOne } from '../lib/db.ts';
import { maintenanceAlerts, maintenanceStatus, resolveSchedule } from '../lib/maintenance.ts';
import type { Alert } from '../lib/maintenance.ts';
import { lowAmmo } from '../lib/costing.ts';
import { ammoLabel } from './AmmoScreens.tsx';
import { buildRefLookup } from '../lib/referenceData.ts';
import type { ReferenceEntry } from '../lib/referenceData.ts';
import { formatDayKey } from '../lib/dates.ts';
import { sessionRounds, roundsForFirearm, dryRepsForFirearm } from '../lib/stats.ts';
import { ImportFlow } from './ImportFlow.tsx';
import { SyncCard } from './SyncCard.tsx';
import { MonthCalendar } from './Calendar.tsx';
import type { CalItem } from './Calendar.tsx';
import { LogFilterBar } from './FilterBar.tsx';
import { emptyLogFilter, matchMatchesFilter, sessionKind, sessionMatchesFilter } from '../lib/searchFilter.ts';
import type { LogFilter } from '../lib/searchFilter.ts';
import type { View } from './nav.ts';
import { dashboardStats, roundsByMonth, daysSinceLastSession, selfRatingDipping, alertDismissKey, isAlertDismissed, personalRecords, formatDrillScore, allClassifications } from '../lib/dashboard.ts';
import type { MonthBucket, RoundsFilter } from '../lib/dashboard.ts';

function useData(refreshKey: number) {
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceEntry[]>([]);
  const [references, setReferences] = useState<Reference[]>([]);
  const [ammo, setAmmo] = useState<Ammunition[]>([]);
  const [classifiers, setClassifiers] = useState<Classifier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [drills, setDrills] = useState<DrillDef[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [f, s, m, mt, r, am, cl, pu, dr] = await Promise.all([
        getAll<Firearm>('firearms'), getAll<Session>('sessions'),
        getAll<Match>('matches'), getAll<MaintenanceEntry>('maintenance'),
        getAll<Reference>('references'), getAll<Ammunition>('ammunition'),
        getAll<Classifier>('classifiers'), getAll<Purchase>('purchases'),
        getAll<DrillDef>('drills')
      ]);
      if (!alive) return;
      setFirearms(f);
      setSessions(s.sort((a, b) => b.date.localeCompare(a.date)));
      setMatches(m);
      setMaintenance(mt);
      setReferences(r);
      setAmmo(am);
      setClassifiers(cl);
      setPurchases(pu);
      setDrills(dr);
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [refreshKey]);
  return { firearms, sessions, matches, maintenance, references, ammo, classifiers, purchases, drills, loaded };
}

function SessionRow({ s, firearms, onTap }: { s: Session; firearms: Firearm[]; onTap: () => void }) {
  const names = s.guns
    .map((g) => firearms.find((f) => f.id === g.firearmId)?.name ?? '—')
    .join(', ');
  return (
    <button className="row-tap" onClick={onTap}>
      <span className="label">
        {formatDayKey(s.date)}
        {s.planned && <span className="badge info" style={{ marginLeft: 6 }}>Planned</span>}
        <div className="row-sub">{names}{s.location ? ` · ${s.location}` : ''}</div>
      </span>
      <span className="value">{sessionRounds(s).toLocaleString()} {s.type === 'dry_fire' ? 'reps' : 'rds'}</span>
    </button>
  );
}

// ---- Rounds by Month bar chart (SVG, hand-rolled per spec §3.4) ----

function RoundsByMonthChart({ buckets }: { buckets: MonthBucket[] }) {
  const max = Math.max(...buckets.map(b => b.total), 1);
  const barW = Math.floor(280 / buckets.length);
  const gap = 4;
  const w = buckets.length * (barW + gap) - gap;
  const h = 140;
  const axisW = 14; // left margin for the rotated "Rounds fired" axis label

  // With a lot of months, showing every label crowds them together —
  // thin them out so at most ~12 are drawn, evenly spaced.
  const labelStep = buckets.length > 12 ? Math.ceil(buckets.length / 12) : 1;

  return (
    <svg viewBox={`0 0 ${w + axisW} ${h + 28}`} width="100%" style={{ display: 'block', marginTop: 8 }}
      role="img" aria-label="Rounds by month bar chart">
      {/* Vertical axis label */}
      <text x={10} y={h / 2} textAnchor="middle"
        fill="var(--text-dim)" fontSize="9" fontFamily="inherit"
        transform={`rotate(-90 10 ${h / 2})`}>
        Rounds fired
      </text>
      <g transform={`translate(${axisW},0)`}>
        {buckets.map((b, i) => {
          const x = i * (barW + gap);
          const liveH = (b.liveRounds / max) * h;
          const matchH = (b.matchRounds / max) * h;
          const dryH = (b.dryReps / max) * h;
          const totalH = liveH + matchH + dryH;
          return (
            <g key={b.key}>
              {/* Live rounds */}
              <rect x={x} y={h - totalH} width={barW} height={liveH}
                rx={2} fill="var(--accent)" />
              {/* Match rounds stacked on top */}
              {matchH > 0 && (
                <rect x={x} y={h - matchH - dryH} width={barW} height={matchH}
                  rx={2} fill="var(--warn)" />
              )}
              {/* Dry fire reps on top */}
              {dryH > 0 && (
                <rect x={x} y={h - dryH} width={barW} height={dryH}
                  rx={2} fill="var(--text-dim)" opacity={0.4} />
              )}
              {/* Month label (thinned out when there are many months) */}
              {i % labelStep === 0 && (
                <text x={x + barW / 2} y={h + 14} textAnchor="middle"
                  fill="var(--text-dim)" fontSize="9" fontFamily="inherit">
                  {b.label.split(' ')[0]}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

// ---- Firearm status card ----

function FirearmStatusCard({ gun, refLookup, sessions, maintenance, firearms, open }: {
  gun: Firearm;
  refLookup: (id: string | null) => ReferenceEntry | undefined;
  sessions: Session[];
  maintenance: MaintenanceEntry[];
  firearms: Firearm[];
  open: (v: View) => void;
}) {
  const liveRds = roundsForFirearm(gun.id, firearms, sessions, []);
  const dryReps = dryRepsForFirearm(gun.id, sessions);
  const items = maintenanceStatus(gun, refLookup(gun.referenceId), sessions, maintenance, firearms, new Date());
  const deepClean = items.find(i => i.type === 'deep_clean');
  const lastFS = items.find(i => i.type === 'field_strip');

  // Parse deep clean progress from detail string
  const schedule = resolveSchedule(gun, refLookup(gun.referenceId));
  const dcMatch = deepClean?.detail.match(/^([\d,]+)/);
  const dcRounds = dcMatch ? parseInt(dcMatch[1].replace(/,/g, ''), 10) : 0;
  const dcInterval = schedule.deepCleanRounds;
  const dcPct = Math.min(dcRounds / dcInterval, 1);

  return (
    <button className="row-tap" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4, padding: '10px 0' }}
      onClick={() => open({ kind: 'gun-detail', id: gun.id })}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 600 }}>{gun.name}</span>
        <span className="row-sub" style={{ fontSize: 13 }}>
          {liveRds.toLocaleString()} live{dryReps > 0 ? ` · ${dryReps.toLocaleString()} dry` : ''}
        </span>
      </div>
      <div className="dc-bar-wrap">
        <div className={`dc-bar-fill ${dcPct >= 1 ? 'danger' : dcPct >= 0.9 ? 'warn' : ''}`}
          style={{ width: `${dcPct * 100}%` }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)' }}>
        <span>Deep clean: {dcRounds.toLocaleString()} / {dcInterval.toLocaleString()}</span>
        <span>{lastFS && lastFS.detail.includes('Clean since') ? 'Clean' : lastFS?.detail.split(' since')[0] ?? ''}</span>
      </div>
    </button>
  );
}

// ---- Dismissible alert row ----

function AlertRow({ alert, onTap, onDismiss, onComplete }: {
  alert: Alert;
  onTap: () => void;
  onDismiss: () => void;
  onComplete: () => void;
}) {
  const [showActions, setShowActions] = useState(false);
  return (
    <div className="alert-row">
      <button className="row-tap" style={{ flex: 1 }} onClick={onTap}>
        <span className="label">
          {alert.gunName}: {alert.item.label.toLowerCase()}
          <div className="row-sub">{alert.item.detail}</div>
        </span>
        <span className={`badge ${alert.item.level === 'due' ? 'bad' : 'warn-badge'}`}>
          {alert.item.level === 'due' ? 'Due' : 'Soon'}
        </span>
      </button>
      <button className="alert-dismiss-btn" onClick={() => setShowActions(!showActions)}
        aria-label="Dismiss options" title="Dismiss or mark complete">···</button>
      {showActions && (
        <div className="alert-actions">
          <button onClick={() => { onComplete(); setShowActions(false); }}>Log maintenance</button>
          <button onClick={() => { onDismiss(); setShowActions(false); }}>Dismiss for now</button>
        </div>
      )}
    </div>
  );
}

export function HomeScreen({ refreshKey, onImported, open }: {
  refreshKey: number; onImported: () => void; open: (v: View) => void;
}) {
  const { firearms, sessions, matches, maintenance, references, ammo, classifiers, drills, loaded } = useData(refreshKey);
  const [dismissed, setDismissed] = useState<Record<string, string>>({});
  const [chartFilter, setChartFilter] = useState<RoundsFilter>({});
  const [chartMonths, setChartMonths] = useState(12);

  // Load dismissed alerts from meta store on mount.
  useEffect(() => {
    void (async () => {
      const row = await getOne<{ key: string; value: Record<string, string> }>('meta', 'dismissedAlerts');
      if (row?.value) setDismissed(row.value);
    })();
  }, [refreshKey]);

  const saveDismissed = useCallback(async (next: Record<string, string>) => {
    setDismissed(next);
    await putOne('meta', { key: 'dismissedAlerts', value: next });
  }, []);

  if (!loaded) return <div className="screen" />;

  const empty = firearms.length === 0 && sessions.length === 0;
  const refLookup = buildRefLookup(references);
  const allAlerts = maintenanceAlerts(firearms, refLookup, sessions, maintenance, new Date());
  // Filter out dismissed alerts (dismissed = same detail string → still the same trigger)
  const alerts = allAlerts.filter(a => {
    const key = alertDismissKey(a.firearmId, a.item.type, a.item.level);
    return !isAlertDismissed(key, dismissed, a.item.detail);
  });
  const lowCans = lowAmmo(ammo);

  const stats = dashboardStats(firearms, sessions, matches, classifiers, ammo);
  const buckets = roundsByMonth(sessions, matches, chartMonths, new Date(), chartFilter, firearms);
  const trainingGap = daysSinceLastSession(sessions);
  const ratingTrend = selfRatingDipping(sessions);
  const divisions = allClassifications(classifiers);
  const topPRs = personalRecords(sessions.filter(s => !s.planned), drills).filter(p => p.best).slice(0, 5);

  const handleDismiss = (a: Alert) => {
    const key = alertDismissKey(a.firearmId, a.item.type, a.item.level);
    void saveDismissed({ ...dismissed, [key]: a.item.detail });
  };

  const recentMatches = [...matches].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  return (
    <div className="screen">
      <h1 className="large-title">FirearmLog</h1>
      {empty ? (
        <>
          <p className="empty">Welcome. Let's get your range history in here.</p>
          <ImportFlow onImported={onImported} />
        </>
      ) : (
        <>
          {stats.trainingSince && (
            <p className="report-note" style={{ marginTop: -8, marginBottom: 12 }}>
              {formatDayKey(new Date().toISOString().slice(0, 10))} · Training since {stats.trainingSince}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button" style={{ flex: 1 }} onClick={() => open({ kind: 'session-form' })}>+ Log Session</button>
            <button className="button secondary" style={{ flex: 1 }} onClick={() => open({ kind: 'session-form', planned: true })}>+ Plan Session</button>
          </div>

          {/* ---- Stat grid ---- */}
          <div className="stat-grid" style={{ marginTop: 16 }}>
            <div className="stat">
              <div className="num">{stats.liveFireRounds.toLocaleString()}</div>
              <div className="cap">Live-fire rounds</div>
            </div>
            <div className="stat">
              <div className="num">
                {stats.liveSessions}
                {stats.drySessions > 0 && (
                  <span style={{ fontSize: 13, color: 'var(--text-dim)', marginLeft: 6 }}>
                    +{stats.drySessions} dry
                  </span>
                )}
              </div>
              <div className="cap">Sessions</div>
            </div>
            <div className="stat">
              <div className="num">{stats.ammoInventory.toLocaleString()}</div>
              <div className="cap">Ammo inventory</div>
            </div>
            {stats.classification ? (
              <div className="stat">
                <div className="num" style={{ color: 'var(--accent)' }}>
                  {stats.classification.currentClass}
                  <span style={{ fontSize: 15, color: 'var(--text-dim)', marginLeft: 6 }}>
                    {stats.classification.average?.toFixed(1)}%
                  </span>
                </div>
                <div className="cap">{stats.classification.division} class</div>
              </div>
            ) : (
              <div className="stat">
                <div className="num">{firearms.length}</div>
                <div className="cap">Guns</div>
              </div>
            )}
          </div>

          {/* ---- Multiple divisions: PT showed every division you have classifier scores in ---- */}
          {divisions.length > 1 && (
            <div className="stat-grid" style={{ marginTop: 8 }}>
              {divisions.map(d => (
                <div className="stat" key={d.division}>
                  <div className="num">
                    {d.currentClass}
                    <span style={{ fontSize: 15, color: 'var(--text-dim)', marginLeft: 6 }}>
                      {d.average?.toFixed(1)}%
                    </span>
                  </div>
                  <div className="cap">{d.division}</div>
                </div>
              ))}
            </div>
          )}

          {/* ---- Needs Attention (dismissible) ---- */}
          {(alerts.length > 0 || lowCans.length > 0 || (trainingGap !== null && trainingGap >= 14) || (ratingTrend?.dipping)) && (
            <div className="card" style={{ marginTop: 16 }}>
              <h2>Needs Attention</h2>
              {alerts.map((a, i) => (
                <AlertRow key={`${a.firearmId}-${a.item.type}-${i}`} alert={a}
                  onTap={() => open({ kind: 'gun-detail', id: a.firearmId })}
                  onDismiss={() => handleDismiss(a)}
                  onComplete={() => open({ kind: 'maint-form', gunId: a.firearmId })} />
              ))}
              {lowCans.map((a) => (
                <button className="row-tap" key={a.id} onClick={() => open({ kind: 'ammo' })}>
                  <span className="label">
                    Low ammo: {ammoLabel(a)}
                    <div className="row-sub">{(a.quantity || 0).toLocaleString()} rounds left</div>
                  </span>
                  <span className="badge warn-badge">Low</span>
                </button>
              ))}
              {trainingGap !== null && trainingGap >= 14 && (
                <div className="row-tap" style={{ cursor: 'default' }}>
                  <span className="label">
                    Training gap: {trainingGap} days since your last session
                    <div className="row-sub">Time to get to the range!</div>
                  </span>
                  <span className="badge warn-badge" style={{ fontSize: 11 }}>Gap</span>
                </div>
              )}
              {ratingTrend?.dipping && (
                <div className="row-tap" style={{ cursor: 'default' }}>
                  <span className="label">
                    Fundamentals dipping
                    <div className="row-sub">
                      Last 3 avg {ratingTrend.last3Avg.toFixed(1)} vs {ratingTrend.prevAvg.toFixed(1)} before
                    </div>
                  </span>
                  <span className="badge warn-badge" style={{ fontSize: 11 }}>Trend</span>
                </div>
              )}
            </div>
          )}

          {/* ---- Firearm Status + Rounds by Month (side by side on desktop) ---- */}
          <div className="dash-grid">
            <div className="card">
              <h2>Firearm Status</h2>
              {firearms.map(gun => (
                <FirearmStatusCard key={gun.id} gun={gun} refLookup={refLookup}
                  sessions={sessions} maintenance={maintenance} firearms={firearms} open={open} />
              ))}
            </div>
            <div className="card">
              <h2>Rounds by Month (last {chartMonths})</h2>
              <div className="field-row" style={{ marginBottom: 4 }}>
                <label className="field small">Gun type
                  <select value={chartFilter.category ?? ''} disabled={!!chartFilter.firearmId}
                    onChange={(e) => setChartFilter({ category: e.target.value as GunCategory | '', firearmId: '' })}>
                    <option value="">All types</option>
                    {GUN_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="field small">One gun
                  <select value={chartFilter.firearmId ?? ''}
                    onChange={(e) => setChartFilter({ category: '', firearmId: e.target.value })}>
                    <option value="">All guns</option>
                    {firearms.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </label>
                <label className="field small">Span
                  <select value={chartMonths} onChange={(e) => setChartMonths(Number(e.target.value))}>
                    <option value={6}>6 months</option>
                    <option value={12}>12 months</option>
                    <option value={24}>24 months</option>
                  </select>
                </label>
              </div>
              {buckets.every(b => b.total === 0)
                ? <p className="report-note">No rounds logged yet{(chartFilter.category || chartFilter.firearmId) ? ' for this gun.' : '.'}</p>
                : <RoundsByMonthChart buckets={buckets} />}
              <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: 'var(--text-dim)' }}>
                <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--accent)', marginRight: 4 }} />Live</span>
                <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--warn)', marginRight: 4 }} />Match</span>
                <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--text-dim)', opacity: 0.4, marginRight: 4 }} />Dry</span>
              </div>
            </div>
          </div>

          {/* ---- Recent Sessions ---- */}
          <div className="dash-grid">
            <div className="card">
              <h2>Recent Sessions</h2>
              {sessions.filter(s => !s.planned).slice(0, 5).map((s) => (
                <SessionRow key={s.id} s={s} firearms={firearms}
                  onTap={() => open({ kind: 'session-form', id: s.id })} />
              ))}
              {sessions.filter(s => !s.planned).length === 0 && (
                <p className="report-note">No sessions logged yet.</p>
              )}
            </div>
            {recentMatches.length > 0 && (
              <div className="card">
                <h2>Recent Matches</h2>
                {recentMatches.map(m => (
                  <button className="row-tap" key={m.id}
                    onClick={() => open({ kind: 'match-detail', id: m.id })}>
                    <span className="label">
                      {m.name || 'Match'}
                      <div className="row-sub">{formatDayKey(m.date)} · {m.division}</div>
                    </span>
                    {m.matchPercent != null && (
                      <span className="value">{m.matchPercent.toFixed(1)}%</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ---- Top Personal Records ---- */}
          {topPRs.length > 0 && (
            <div className="card">
              <h2>Top Personal Records</h2>
              {topPRs.map(p => (
                <div className="pr-row" key={p.name}>
                  <div>
                    <div className="label">{p.name}</div>
                    <div className="row-sub">
                      {p.attempts} attempt{p.attempts !== 1 ? 's' : ''} · PR {formatDayKey(p.best!.date)}
                    </div>
                  </div>
                  <div className="value">{formatDrillScore(p.best, p.scoring)}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function LogScreen({ refreshKey, open }: { refreshKey: number; open: (v: View) => void }) {
  const { firearms, sessions, matches, loaded } = useData(refreshKey);
  const [mode, setMode] = useState<'list' | 'calendar'>('list');
  const [filter, setFilter] = useState<LogFilter>(emptyLogFilter());
  if (!loaded) return <div className="screen" />;

  // B6: one filter rules both the list and the calendar.
  const shownSessions = sessions.filter((s) => sessionMatchesFilter(s, filter, firearms));
  const shownMatches = matches.filter((m) => matchMatchesFilter(m, filter, firearms));

  const calItems = new Map<string, CalItem[]>();
  for (const s of shownSessions) {
    if (!s.date) continue;
    const names = s.guns.map((g) => firearms.find((f) => f.id === g.firearmId)?.name ?? '—').join(', ');
    const kind = sessionKind(s.type);
    const kindLabel = kind === 'dry' ? 'Dry fire' : kind === 'class' ? 'Class' : 'Practice';
    const list = calItems.get(s.date) ?? [];
    list.push({ kind, id: s.id, label: `${kindLabel}${s.planned ? ' (planned)' : ''} — ${names}`, sub: `${sessionRounds(s).toLocaleString()} rounds` });
    calItems.set(s.date, list);
  }
  for (const m of shownMatches) {
    if (!m.date) continue;
    const list = calItems.get(m.date) ?? [];
    list.push({ kind: 'match', id: m.id, label: m.name || 'Match', sub: `${m.matchType ?? 'Match'} · ${m.division ?? ''}` });
    calItems.set(m.date, list);
  }

  return (
    <div className="screen">
      <h1 className="large-title">Log</h1>
      <p className="report-note" style={{ marginTop: -8, marginBottom: 12 }}>
        Your training record: live practice, dry fire, classes, and planned range
        trips — with rounds, drills, ammo used, malfunctions, photos, and how it felt.
        Matches and classifiers live in the Compete tab; they show up here on the calendar.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="button" style={{ flex: 1 }} onClick={() => open({ kind: 'session-form' })}>+ Log Session</button>
        <button className="button secondary" style={{ flex: 1 }} onClick={() => open({ kind: 'session-form', planned: true })}>+ Plan Session</button>
      </div>
      <LogFilterBar value={filter} onChange={setFilter} firearms={firearms}
        shown={shownSessions.length + shownMatches.length}
        total={sessions.length + matches.length} />
      <div className="seg" role="radiogroup" aria-label="View" style={{ marginTop: 12 }}>
        <button role="radio" aria-checked={mode === 'list'} className={mode === 'list' ? 'on' : ''}
          onClick={() => setMode('list')}>List</button>
        <button role="radio" aria-checked={mode === 'calendar'} className={mode === 'calendar' ? 'on' : ''}
          onClick={() => setMode('calendar')}>Calendar</button>
      </div>
      {mode === 'calendar' ? (
        <MonthCalendar items={calItems}
          onOpen={(it) => open(it.kind === 'match'
            ? { kind: 'match-detail', id: it.id }
            : { kind: 'session-form', id: it.id })} />
      ) : sessions.length === 0 ? (
        <p className="empty">Nothing logged yet. Tap "Log Session" after your next range trip, or import your Pistol Tracker data from the Home screen.</p>
      ) : shownSessions.length === 0 ? (
        <p className="empty">Nothing matches your search. Tap Clear to see everything again{shownMatches.length > 0 ? ', or flip to Calendar — your matches are there' : ''}.</p>
      ) : (
        <div className="card">
          <h2>{shownSessions.length === sessions.length ? 'All Sessions' : 'Matching Sessions'}</h2>
          {shownSessions.map((s) => (
            <SessionRow key={s.id} s={s} firearms={firearms}
              onTap={() => open({ kind: 'session-form', id: s.id })} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ProgressScreen() {
  return (
    <div className="screen">
      <h1 className="large-title">Progress</h1>
      <p className="empty">Trends, personal records, and goals land here in a later build.</p>
    </div>
  );
}

export function MoreScreen({ refreshKey, onImported, open }: {
  refreshKey: number; onImported: () => void; open: (v: View) => void;
}) {
  const { firearms, loaded } = useData(refreshKey);
  if (!loaded) return <div className="screen" />;
  return (
    <div className="screen">
      <h1 className="large-title">More</h1>
      <div className="card">
        <h2>Guns</h2>
        {firearms.map((f) => (
          <button className="row-tap" key={f.id} onClick={() => open({ kind: 'gun-detail', id: f.id })}>
            <span className="label">{f.name}</span>
            <span className="value">{f.category} · {f.caliber} ›</span>
          </button>
        ))}
        <div style={{ marginTop: 10 }}>
          <button className="button secondary" onClick={() => open({ kind: 'gun-form' })}>+ Add Gun</button>
        </div>
      </div>
      <div className="card">
        <h2>Firearms &amp; Gear</h2>
        <button className="row-tap" onClick={() => open({ kind: 'drills' })}>
          <span className="label">Drills</span>
          <span className="value">›</span>
        </button>
        <button className="row-tap" onClick={() => open({ kind: 'magazines' })}>
          <span className="label">Magazines</span>
          <span className="value">›</span>
        </button>
        <button className="row-tap" onClick={() => open({ kind: 'optics' })}>
          <span className="label">Optics</span>
          <span className="value">›</span>
        </button>
        <button className="row-tap" onClick={() => open({ kind: 'ammo' })}>
          <span className="label">Ammo</span>
          <span className="value">›</span>
        </button>
        <button className="row-tap" onClick={() => open({ kind: 'costs' })}>
          <span className="label">Costs &amp; Purchases</span>
          <span className="value">›</span>
        </button>
        <button className="row-tap" onClick={() => open({ kind: 'maintenance' })}>
          <span className="label">Maintenance</span>
          <span className="value">›</span>
        </button>
        <button className="row-tap" onClick={() => open({ kind: 'parts' })}>
          <span className="label">Spare Parts &amp; Inventory</span>
          <span className="value">›</span>
        </button>
        <button className="row-tap" onClick={() => open({ kind: 'references' })}>
          <span className="label">Reference</span>
          <span className="value">›</span>
        </button>
      </div>
      <SyncCard onPulled={onImported} />
      <div className="card">
        <h2>Settings &amp; Data</h2>
        <p className="report-note" style={{ marginBottom: 12 }}>
          Import your Pistol Tracker backup here. Running it again simply re-applies the same
          records — it won't double anything up.
        </p>
        <ImportFlow onImported={onImported} />
      </div>
    </div>
  );
}
