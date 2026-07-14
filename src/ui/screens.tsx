// Tab screens. Home and Log are live against the database; Compete and
// Progress arrive in M5 and M7 and say so in plain language.
import { useEffect, useRef, useState, useCallback } from 'react';
import type { Ammunition, AppSettings, Classifier, DrillDef, Firearm, Goal, GunCategory, MaintenanceEntry, Match, Purchase, Reference, Session } from '../lib/types.ts';
import { goldenGoal } from '../lib/goals.ts';
import { GUN_CATEGORIES } from '../lib/types.ts';
import { getAll, getOne, getSettings, putOne } from '../lib/db.ts';
import { maintenanceAlerts, maintenanceStatus, resolveSchedule } from '../lib/maintenance.ts';
import type { Alert } from '../lib/maintenance.ts';
import { lowAmmo } from '../lib/costing.ts';
import { MIN_SCORES_FOR_CLASSIFICATION } from '../lib/competition.ts';
import { ammoLabel } from './AmmoScreens.tsx';
import { buildRefLookup } from '../lib/referenceData.ts';
import type { ReferenceEntry } from '../lib/referenceData.ts';
import { formatDayKey } from '../lib/dates.ts';
import { sessionRounds, roundsForFirearm, dryRepsForFirearm } from '../lib/stats.ts';
import { telemetryState } from '../lib/telemetry.ts';
import { InfoTip } from './InfoTip.tsx';
import { Reveal } from './Reveal.tsx';
import { Icon } from './Icon.tsx';
import { ClassificationGrid } from './ClassificationGrid.tsx';
import { SetupSteps } from './SetupWizard.tsx';
import { ScreenError, ScreenLoading } from './ScreenState.tsx';
import { ListSearch, matchesQuery } from './ListSearch.tsx';
import { isActive, isOwned, isFormer, isRetired, statusBadge } from '../lib/gunStatus.ts';
import { MonthCalendar } from './Calendar.tsx';
import type { CalItem } from './Calendar.tsx';
import { LogFilterBar } from './FilterBar.tsx';
import { emptyLogFilter, filterCount, matchMatchesFilter, sessionKind, sessionMatchesFilter } from '../lib/searchFilter.ts';
import type { LogFilter } from '../lib/searchFilter.ts';
import { activeOnly, trashedOnly, daysLeft } from '../lib/softDelete.ts';
import { softDeleteSession, restoreSession, purgeSession, purgeExpiredSessions } from './sessionDelete.ts';
import { ConfirmSheet, Sheet } from './Sheet.tsx';
import { SwipeRow } from './SwipeRow.tsx';
import type { View } from './nav.ts';
import { dashboardStats, rangedActivity, roundsByMonth, daysSinceLastSession, selfRatingDipping, alertDismissKey, isAlertDismissed, personalRecords, formatDrillScore, allClassifications, changesSinceBackup, BACKUP_REMINDER_THRESHOLD, BACKUP_TRACKED_STORES } from '../lib/dashboard.ts';
import { spanStartDate } from '../lib/trends.ts';
import type { MonthBucket, RoundsFilter } from '../lib/dashboard.ts';

function useData(refreshKey: number) {
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [trashed, setTrashed] = useState<Session[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceEntry[]>([]);
  const [references, setReferences] = useState<Reference[]>([]);
  const [ammo, setAmmo] = useState<Ammunition[]>([]);
  const [classifiers, setClassifiers] = useState<Classifier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [drills, setDrills] = useState<DrillDef[]>([]);
  const [loaded, setLoaded] = useState(false);
  // If the load fails (a bad read / storage hiccup), fail safe to a recoverable
  // error state instead of hanging on a blank screen (pro-grade audit T1-1).
  const [error, setError] = useState(false);
  // A local counter so an in-screen change (e.g. a swipe-delete) can re-read the
  // database without the parent having to hand down a fresh refreshKey.
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    setError(false);
    void (async () => {
      try {
        // Sweep out anything past its 30-day window first, so the lists below are
        // already clean. Fails safe (returns 0) — it can never block the load.
        await purgeExpiredSessions();
        const [f, s, m, mt, r, am, cl, pu, dr] = await Promise.all([
          getAll<Firearm>('firearms'), getAll<Session>('sessions'),
          getAll<Match>('matches'), getAll<MaintenanceEntry>('maintenance'),
          getAll<Reference>('references'), getAll<Ammunition>('ammunition'),
          getAll<Classifier>('classifiers'), getAll<Purchase>('purchases'),
          getAll<DrillDef>('drills')
        ]);
        if (!alive) return;
        setFirearms(f);
        // Trashed sessions are kept out of the live list and every total; they
        // surface only in the Log's "Recently Deleted" section.
        setSessions(activeOnly(s).sort((a, b) => b.date.localeCompare(a.date)));
        setTrashed(trashedOnly(s));
        setMatches(m);
        setMaintenance(mt);
        setReferences(r);
        setAmmo(am);
        setClassifiers(cl);
        setPurchases(pu);
        setDrills(dr);
        setLoaded(true);
      } catch (e) {
        if (!alive) return;
        console.error('Screen data load failed', e);
        setError(true);
      }
    })();
    return () => { alive = false; };
  }, [refreshKey, nonce]);
  return { firearms, sessions, trashed, matches, maintenance, references, ammo, classifiers, purchases, drills, loaded, error, reload };
}

function SessionRow({ s, firearms, onTap, onDelete }: {
  s: Session; firearms: Firearm[]; onTap: () => void; onDelete?: () => void;
}) {
  const names = s.guns
    .map((g) => firearms.find((f) => f.id === g.firearmId)?.name ?? '—')
    .join(', ');
  return (
    <SwipeRow onDelete={onDelete} desktopButton={s.planned}>
      <button className="row-tap" onClick={onTap}>
        <span className="label">
          {formatDayKey(s.date)}
          {s.planned && <span className="badge info" style={{ marginLeft: 6 }}>Planned</span>}
          <div className="row-sub">{names}{s.location ? ` · ${s.location}` : ''}</div>
        </span>
        <span className="value">{sessionRounds(s).toLocaleString()} {s.type === 'dry_fire' ? 'reps' : 'rds'}</span>
      </button>
    </SwipeRow>
  );
}

// ---- Rounds by Month bar chart (SVG, hand-rolled per spec §3.4) ----

export function RoundsByMonthChart({ buckets }: { buckets: MonthBucket[] }) {
  const max = Math.max(...buckets.map(b => b.total), 1);
  const barW = Math.floor(280 / buckets.length);
  const gap = 4;
  const w = buckets.length * (barW + gap) - gap;
  const h = 140;
  const axisW = 48; // left gutter: rotated "Rounds fired" label + numeric y-ticks (M6)

  // With a lot of months, showing every label crowds them together —
  // thin them out so at most ~12 are drawn, evenly spaced.
  const labelStep = buckets.length > 12 ? Math.ceil(buckets.length / 12) : 1;

  return (
    <>
    <svg viewBox={`0 -8 ${w + axisW} ${h + 36}`} width="100%" style={{ display: 'block', marginTop: 8 }}
      role="img" aria-label="Rounds by month bar chart">
      {/* Vertical axis label */}
      <text x={10} y={h / 2} textAnchor="middle"
        fill="var(--text-dim)" fontSize="9" fontFamily="inherit"
        transform={`rotate(-90 10 ${h / 2})`}>
        Rounds fired
      </text>
      {/* M6: y-axis grid lines + numeric ticks so bar heights read against a scale,
          not just relative to each other. Peak + midpoint; the 0 baseline is the axis.
          Drawn before the bars so the bars sit on top of the grid. The peak label sits
          just below its line (the SVG has top padding) so it never clips. */}
      {[max, Math.round(max / 2)].map((v, k) => {
        const y = h * (1 - v / max);
        return (
          <g key={k}>
            <line x1={axisW} y1={y} x2={w + axisW} y2={y} stroke="var(--separator)" strokeWidth={0.5} />
            <text x={axisW - 6} y={y + (k === 0 ? 8 : 3)} textAnchor="end"
              fill="var(--text-dim)" fontSize="10" fontFamily="inherit">
              {v.toLocaleString()}
            </text>
          </g>
        );
      })}
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
                  rx={2} fill="var(--cat-match)" />
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
    <div className="chart-legend">
      <span><i style={{ background: 'var(--accent)' }} />Live rounds</span>
      <span><i style={{ background: 'var(--cat-match)' }} />Match rounds</span>
      <span><i style={{ background: 'var(--text-dim)', opacity: 0.4 }} />Dry-fire reps</span>
    </div>
    </>
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // M3: an options popover shouldn't stay stuck open over the next row. Dismiss it
  // on Escape (returning focus to its trigger) or on any tap outside it.
  useEffect(() => {
    if (!showActions) return;
    // F5: on a short screen the menu can open past the viewport bottom — nudge it
    // into view (minimal scroll; no-op when it already fits).
    menuRef.current?.scrollIntoView({ block: 'nearest' });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowActions(false); triggerRef.current?.focus(); }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) setShowActions(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [showActions]);
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
      <button ref={triggerRef} className="alert-dismiss-btn" onClick={() => setShowActions(!showActions)}
        aria-expanded={showActions} aria-haspopup="true"
        aria-label={`Options for ${alert.gunName}: ${alert.item.label.toLowerCase()}`}
        title="Dismiss or mark complete">Options ▾</button>
      {showActions && (
        <div className="alert-actions" role="menu" ref={menuRef}>
          <button role="menuitem" onClick={() => { onComplete(); setShowActions(false); }}>Log maintenance</button>
          <button role="menuitem" onClick={() => { onDismiss(); setShowActions(false); }}>Dismiss for now</button>
        </div>
      )}
    </div>
  );
}

export function HomeScreen({ refreshKey, open, onGoBackup }: {
  refreshKey: number; open: (v: View) => void; onGoBackup: () => void;
}) {
  const { firearms, sessions, matches, maintenance, references, ammo, classifiers, drills, loaded, error, reload } = useData(refreshKey);
  const [dismissed, setDismissed] = useState<Record<string, string>>({});
  const [chartFilter, setChartFilter] = useState<RoundsFilter>({});
  const [chartMonths, setChartMonths] = useState(12);
  // Rolling window for the two activity tiles (Live-fire rounds, Sessions). 'all' keeps
  // the lifetime odometer; 6/12 count only what was fired/logged in that window.
  const [statRange, setStatRange] = useState<6 | 12 | 'all'>('all');
  const [backupChanges, setBackupChanges] = useState(0);
  const [golden, setGolden] = useState<Goal | null>(null);
  const [setupGoalDone, setSetupGoalDone] = useState(false);

  // Load dismissed alerts from meta store on mount.
  useEffect(() => {
    void (async () => {
      const row = await getOne<{ key: string; value: Record<string, string> }>('meta', 'dismissedAlerts');
      if (row?.value) setDismissed(row.value);
    })();
  }, [refreshKey]);

  // Count un-backed-up changes for the backup nudge: records across the tracked
  // stores whose updatedAt is newer than the last backup. Read-only. Reads run in
  // parallel (CR-D2), and the whole thing is guarded so a storage hiccup can never
  // break Home — it just hides the nudge (CR-D3, resilience-first per rule 23).
  useEffect(() => {
    void (async () => {
      try {
        const settings = await getSettings<AppSettings>();
        const since = settings?.lastBackupAt ?? 0;
        const lists = await Promise.all(
          BACKUP_TRACKED_STORES.map((store) => getAll<{ updatedAt?: number }>(store))
        );
        setBackupChanges(changesSinceBackup(lists.flat(), since));
      } catch {
        setBackupChanges(0); // fail safe: no nudge rather than a broken screen
      }
    })();
  }, [refreshKey]);

  // The pinned "golden goal" echoed on Home. Only an OPEN (not-yet-achieved) goal
  // shows here — once it's hit, Home stops nudging it (it still lives on Goals).
  // Guarded so a storage hiccup just hides the card rather than breaking Home.
  // Step 3b: the same read decides the checklist's box 2 — "Pick a goal" counts
  // as done once the setup question was answered (any answer, incl. skip) or the
  // user has goals of their own. Fail-safe: an error leaves it unchecked.
  useEffect(() => {
    void (async () => {
      try {
        const settings = await getSettings<AppSettings>();
        const goals = await getAll<Goal>('goals');
        setSetupGoalDone(settings?.northStarSeeded === true || goals.length > 0);
        const gid = settings?.goldenGoalId;
        if (!gid) { setGolden(null); return; }
        const g = goldenGoal(goals, gid);
        setGolden(g && !g.achieved ? g : null);
      } catch {
        setGolden(null);
      }
    })();
  }, [refreshKey]);

  const saveDismissed = useCallback(async (next: Record<string, string>) => {
    setDismissed(next);
    await putOne('meta', { key: 'dismissedAlerts', value: next });
  }, []);

  if (error) return <ScreenError onRetry={reload} />;
  if (!loaded) return <ScreenLoading />;

  const empty = firearms.length === 0 && sessions.length === 0;
  const refLookup = buildRefLookup(references);
  const allAlerts = maintenanceAlerts(firearms, refLookup, sessions, maintenance, new Date());
  // Filter out dismissed alerts (dismissed = same detail string → still the same trigger)
  const alerts = allAlerts.filter(a => {
    const key = alertDismissKey(a.firearmId, a.item.type, a.item.level);
    return !isAlertDismissed(key, dismissed, a.item.detail);
  });
  const lowCans = lowAmmo(ammo);
  const showBackup = backupChanges >= BACKUP_REMINDER_THRESHOLD;

  const stats = dashboardStats(firearms, sessions, matches, classifiers, ammo);
  const statCutoff = statRange === 'all' ? null : spanStartDate(statRange);
  const activity = rangedActivity(firearms, sessions, matches, statCutoff);
  const rangeLabel = statRange === 'all' ? '' : ` · ${statRange} mo`;
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
          {/* Story frame (DESIGN_DIRECTION §4): the skip path tells the SAME
              three-step story as the wizard, in the same register as its
              sample-data card — not a two-step variant with "the app" as hero. */}
          <p className="empty">Welcome to FirearmLog. Three steps: add your first gun, pick a goal to work toward, and log your first session — all from here.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="button" onClick={() => open({ kind: 'gun-form' })}>+ Add your first gun</button>
            <button className="button secondary" onClick={() => open({ kind: 'setup' })}>Just looking? See a log 18 months in</button>
            <p className="report-note" style={{ margin: '0 0 4px' }}>
              It's a sample log — what yours can look like after a while of keeping it. While
              you're exploring it, "Start my own log" at the top of the screen brings you back
              here to begin yours.
            </p>
          </div>
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

          {/* ---- F2 + Step 3b: the guided handoff to the first session — the
               same 1-2-3 checklist the setup wizard showed, with step 3 as the
               tap target. Purely data-derived (guns exist, no session yet) — no
               stored flag, so it can never get stuck on. It disappears forever
               the moment the first session exists: earned, not dismissed. ---- */}
          {firearms.length > 0 && sessions.length === 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <h2>You're set up.</h2>
              <SetupSteps gunDone goalDone={setupGoalDone} active={3}
                onActive={() => open({ kind: 'session-form' })}
                step3Sub="Tap here to log it now, or any time with + Log Session at the top of this screen" />
            </div>
          )}

          {/* ---- Stat grid ---- */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 16 }}>
            <label htmlFor="stat-range" className="cap" style={{ color: 'var(--text-dim)' }}>Rounds &amp; sessions</label>
            <select id="stat-range" value={statRange}
              onChange={(e) => setStatRange(e.target.value === 'all' ? 'all' : (Number(e.target.value) as 6 | 12))}
              style={{ width: 'auto' }}>
              <option value="all">All time</option>
              <option value="12">Last 12 months</option>
              <option value="6">Last 6 months</option>
            </select>
          </div>
          <div className="stat-grid" style={{ marginTop: 8 }}>
            <div className="stat">
              <div className="num">{activity.liveFireRounds.toLocaleString()}</div>
              <div className="cap">Live-fire rounds{rangeLabel}</div>
            </div>
            <div className="stat">
              <div className="num">
                {activity.liveSessions}
                {activity.drySessions > 0 && (
                  <span style={{ fontSize: 13, color: 'var(--text-dim)', marginLeft: 6 }}>
                    +{activity.drySessions} dry
                  </span>
                )}
              </div>
              <div className="cap">Sessions{rangeLabel}</div>
            </div>
            <div className="stat">
              <div className="num">{stats.ammoInventory.toLocaleString()}</div>
              <div className="cap">Ammo inventory</div>
            </div>
            {stats.classification ? (
              <div className="stat">
                <div className="num" style={{ color: 'var(--accent-ink)' }}>
                  {stats.classification.currentClass ?? '—'}
                  <span style={{ fontSize: 15, color: 'var(--text-dim)', marginLeft: 6 }}>
                    {stats.classification.average?.toFixed(1)}%
                  </span>
                </div>
                <div className="cap">
                  {stats.classification.currentClass
                    ? `${stats.classification.division} class`
                    : `${stats.classification.division}: unclassified — ${stats.classification.scoresOnRecord} of ${MIN_SCORES_FOR_CLASSIFICATION} scores`}
                </div>
              </div>
            ) : (
              <div className="stat">
                <div className="num">{firearms.filter(isOwned).length}</div>
                <div className="cap">Guns</div>
              </div>
            )}
          </div>

          {/* ---- Multiple divisions: every division you hold a class in (shared with Compete) ---- */}
          {divisions.length > 1 && <ClassificationGrid divisions={divisions} />}

          {/* ---- Golden goal: the one pinned north-star, echoed from Progress ---- */}
          {golden && (
            <div className="card golden-home" style={{ marginTop: 16 }}>
              <button className="row-tap" onClick={() => open({ kind: 'session-form', planned: true })}>
                <span className="label">
                  <span className="golden-title">
                    <span className="golden-star" aria-hidden="true"><Icon name="starFilled" size={16} /></span>
                    <span className="golden-text">{golden.text}</span>
                  </span>
                  <div className="row-sub">Your North Star · tap to plan a session</div>
                </span>
              </button>
            </div>
          )}

          {/* ---- Needs Attention (dismissible) ---- */}
          {(showBackup || alerts.length > 0 || lowCans.length > 0 || (trainingGap !== null && trainingGap >= 14) || (ratingTrend?.dipping)) && (
            <div className="card" style={{ marginTop: 16 }}>
              <h2>Needs Attention</h2>
              {showBackup && (
                <button className="row-tap" onClick={onGoBackup}>
                  <span className="label">
                    Back up your data
                    <div className="row-sub">{backupChanges} changes since your last backup — your log lives only on this device. Tap to back up; the reminder clears once you do.</div>
                  </span>
                  <span className="badge warn-badge" style={{ fontSize: 11 }}>Backup</span>
                </button>
              )}
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
              {/* Audit #4: training gap now actually does something — tap to plan
                  your next range trip — so it earns its tappable styling. */}
              {trainingGap !== null && trainingGap >= 14 && (
                <button className="row-tap" onClick={() => open({ kind: 'session-form', planned: true })}>
                  <span className="label">
                    Training gap: {trainingGap} days since your last session
                    <div className="row-sub">Time to get to the range — tap to plan a session.</div>
                  </span>
                  <span className="badge warn-badge" style={{ fontSize: 11 }}>Gap</span>
                </button>
              )}
              {/* Audit #4: this one is purely informational, so it uses the plain
                  non-interactive row style (no tap affordance). */}
              {ratingTrend?.dipping && (
                <div className="row">
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
              {/* Audit #10: Home shows your active guns; retired/former live on the Guns screen. */}
              {firearms.filter(isActive).map(gun => (
                <FirearmStatusCard key={gun.id} gun={gun} refLookup={refLookup}
                  sessions={sessions} maintenance={maintenance} firearms={firearms} open={open} />
              ))}
            </div>
            <div className="card">
              <h2>Rounds by Month (last {chartMonths})</h2>
              {/* Progressive disclosure: the chart shows with its defaults (last 12 mo,
                  all guns); the filter row is one tap away, matching Progress's Trends. */}
              <Reveal label="Filters">
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
              </Reveal>
              {buckets.every(b => b.total === 0)
                ? <p className="report-note">No rounds logged yet{(chartFilter.category || chartFilter.firearmId) ? ' for this gun.' : '.'}</p>
                : <RoundsByMonthChart buckets={buckets} />}
              {/* Audit #3: the chart renders its own Live/Match/Dry legend now,
                  so the duplicate inline legend that used to sit here was removed. */}
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
  const { firearms, sessions, trashed, matches, ammo, loaded, error, reload } = useData(refreshKey);
  const [mode, setMode] = useState<'list' | 'calendar'>('list');
  const [filter, setFilter] = useState<LogFilter>(emptyLogFilter());
  const [explain, setExplain] = useState<Session | null>(null); // logged-session swipe
  const [forget, setForget] = useState<Session | null>(null);    // delete-forever confirm

  // Swiping a row: a planned session deletes straight to Recently Deleted (it's
  // recoverable, and the swipe-then-tap is already deliberate). A LOGGED session
  // can't be quick-deleted — we explain why and point to the edit screen.
  function onRowDelete(s: Session) {
    if (s.planned) void softDeleteSession(s, ammo).then(reload);
    else setExplain(s);
  }
  function onRestore(s: Session) { void restoreSession(s, ammo).then(reload); }

  if (error) return <ScreenError onRetry={reload} />;
  if (!loaded) return <ScreenLoading />;

  // B6: one filter rules both the list and the calendar.
  const shownSessions = sessions.filter((s) => sessionMatchesFilter(s, filter, firearms));
  const shownMatches = matches.filter((m) => matchMatchesFilter(m, filter, firearms));

  // F2a (stranger-test finding, July 13 2026): the filter counts matches, so the
  // LIST must show them too when the shooter is narrowing — otherwise "Matches"
  // promises what the list never delivers (the pilot tester called it broken).
  // Default view (no filter active) stays sessions-only: matches live in Compete
  // and on the calendar, which is the app's map. Newest first, like everywhere.
  const narrowing = filterCount(filter) > 0;
  const listedMatches = narrowing
    ? [...shownMatches].sort((a, b) => b.date.localeCompare(a.date))
    : [];

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
      <h1 className="large-title">Log <InfoTip title="Log">Every session, plus a calendar — tap a day to open it, or start a new session. Swipe a row left to delete it (hover it on a computer); deletions wait 30 days in Recently Deleted so you can restore them.</InfoTip></h1>
      <p className="report-note" style={{ marginTop: -8, marginBottom: 12 }}>
        Your training record: live practice, dry fire, classes, and planned range
        trips — with rounds, drills, ammo used, malfunctions, photos, and how it felt.
        Matches and classifiers live in the Compete tab; they show up here on the
        calendar, and in the list when your search includes them.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="button" style={{ flex: 1 }} onClick={() => open({ kind: 'session-form' })}>+ Log Session</button>
        <button className="button secondary" style={{ flex: 1 }} onClick={() => open({ kind: 'session-form', planned: true })}>+ Plan Session</button>
      </div>
      <LogFilterBar value={filter} onChange={setFilter} firearms={firearms}
        shown={shownSessions.length + shownMatches.length}
        total={sessions.length + matches.length} />
      <div className="seg" role="group" aria-label="View" style={{ marginTop: 12 }}>
        <button type="button" aria-pressed={mode === 'list'} className={mode === 'list' ? 'on' : ''}
          onClick={() => setMode('list')}>List</button>
        <button type="button" aria-pressed={mode === 'calendar'} className={mode === 'calendar' ? 'on' : ''}
          onClick={() => setMode('calendar')}>Calendar</button>
      </div>
      {mode === 'calendar' ? (
        <MonthCalendar items={calItems}
          onOpen={(it) => open(it.kind === 'match'
            ? { kind: 'match-detail', id: it.id }
            : { kind: 'session-form', id: it.id })}
          onEmptyDay={(dk) => open({ kind: 'session-form', date: dk })} />
      ) : !narrowing && sessions.length === 0 ? (
        <p className="empty">Nothing logged yet. Tap "Log Session" after your next range trip.</p>
      ) : narrowing && shownSessions.length === 0 && listedMatches.length === 0 ? (
        /* F2a follow-up (Michael, July 14 2026): filtering to Matches with none
           logged at all gets a TEACHING answer, not a generic one — the pilot's
           own confusion, answered in the app forever. */
        <p className="empty">
          {filter.kinds.includes('match') && matches.length === 0
            ? 'No matches logged yet — matches live in the Compete tab. Tap Clear to see everything again.'
            : 'Nothing matches your search. Tap Clear to see everything again.'}
        </p>
      ) : (
        <>
          {shownSessions.length > 0 && (
            <div className="card">
              <h2>{shownSessions.length === sessions.length ? 'All Sessions' : 'Matching Sessions'}</h2>
              {shownSessions.map((s) => (
                <SessionRow key={s.id} s={s} firearms={firearms}
                  onTap={() => open({ kind: 'session-form', id: s.id })}
                  onDelete={() => onRowDelete(s)} />
              ))}
            </div>
          )}
          {/* F2a: matching matches render as real rows while narrowing — same row
              shape as Compete's Matches card so the two read as one system, and
              tapping one opens the match itself. No swipe here: match deletion
              stays where matches are managed, in Compete. */}
          {listedMatches.length > 0 && (
            <div className="card">
              <h2>Matches</h2>
              {listedMatches.map((m) => (
                <button className="row-tap" key={m.id} onClick={() => open({ kind: 'match-detail', id: m.id })}>
                  <span className="label">
                    {m.name || m.matchType}
                    <div className="row-sub">{formatDayKey(m.date)} · {m.division}</div>
                  </span>
                  <span className="value">
                    {m.matchPercent != null ? `${m.matchPercent}%` : m.divisionPlace != null ? `#${m.divisionPlace}` : '›'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <RecentlyDeleted trashed={trashed} firearms={firearms}
        onRestore={onRestore} onForget={setForget} />

      {/* Swiping a logged session explains why it can't be quick-deleted. */}
      {explain && (
        <Sheet title="This one's part of your record" onClose={() => setExplain(null)}>
          <p className="report-note" style={{ marginBottom: 10 }}>
            Logged sessions feed your round counts, costs, and personal records, so
            they can't be swiped away by accident. Here's how to remove this one:
          </p>
          <ol className="report-note" style={{ margin: '0 0 12px', paddingLeft: 22, lineHeight: 1.7 }}>
            <li>Tap <strong>Open This Session</strong> below.</li>
            <li>Scroll to the bottom of the session and tap <strong>Delete session</strong>.</li>
            <li>Tap <strong>Delete session</strong> once more to confirm.</li>
          </ol>
          <p className="report-note" style={{ marginBottom: 14 }}>
            It then moves to <strong>Recently Deleted</strong>, where you can restore it
            for 30 days before it's gone for good.
          </p>
          <button className="button" onClick={() => { const s = explain; setExplain(null); open({ kind: 'session-form', id: s.id }); }}>
            Open This Session
          </button>
          <div style={{ height: 8 }} />
          <button className="button secondary" onClick={() => setExplain(null)}>Not now</button>
        </Sheet>
      )}

      {/* Delete Forever from Recently Deleted — the one permanent action. */}
      {forget && (
        <ConfirmSheet
          title="Delete this session for good?"
          message="This permanently removes the session, its photos, and its malfunctions. It can't be undone."
          confirmLabel="Delete forever"
          onConfirm={() => { const s = forget; setForget(null); void purgeSession(s.id).then(reload); }}
          onClose={() => setForget(null)} />
      )}
    </div>
  );
}

/**
 * "Recently Deleted" — every trashed session, each restorable or deletable on
 * its own (like Apple Photos), with the days it has left before the 30-day
 * purge. Collapsed by default so it never gets in the way of the live list.
 */
function RecentlyDeleted({ trashed, firearms, onRestore, onForget }: {
  trashed: Session[]; firearms: Firearm[];
  onRestore: (s: Session) => void; onForget: (s: Session) => void;
}) {
  const [open, setOpen] = useState(false);
  if (trashed.length === 0) return null;
  const now = Date.now();
  return (
    <div className="card">
      <button className="row-tap" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="label">
          Recently Deleted
          <div className="row-sub">{trashed.length} session{trashed.length === 1 ? '' : 's'} · kept 30 days</div>
        </span>
        <span className="value"><Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} /></span>
      </button>
      {open && trashed.map((s) => {
        const names = s.guns.map((g) => firearms.find((f) => f.id === g.firearmId)?.name ?? '—').join(', ');
        const left = daysLeft(s.deletedAt as number, now);
        return (
          <div className="trash-row" key={s.id}>
            <div className="label">
              {formatDayKey(s.date)}
              {s.planned && <span className="badge info" style={{ marginLeft: 6 }}>Planned</span>}
              <div className="row-sub">{names || 'No gun'} · {left} day{left === 1 ? '' : 's'} left</div>
            </div>
            <div className="trash-actions">
              <button className="button secondary small" onClick={() => onRestore(s)}>Restore</button>
              <button className="button danger small" onClick={() => onForget(s)}>Delete forever</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}


export function MoreScreen({ refreshKey, open }: {
  refreshKey: number; open: (v: View) => void;
}) {
  const { loaded, error, reload } = useData(refreshKey);
  if (error) return <ScreenError onRetry={reload} />;
  if (!loaded) return <ScreenLoading />;
  return (
    <div className="screen">
      <h1 className="large-title">More</h1>

      <h2 className="menu-group-title">Your Gear</h2>
      <p className="menu-group-sub">The things you own</p>
      <div className="card">
        <button className="row-tap" onClick={() => open({ kind: 'guns' })}>
          <span className="row-ico" aria-hidden="true"><Icon name="gun" size={20} /></span>
          <span className="label">Guns</span>
          <span className="value">›</span>
        </button>
        <button className="row-tap" onClick={() => open({ kind: 'optics' })}>
          <span className="row-ico" aria-hidden="true"><Icon name="optic" size={20} /></span>
          <span className="label">Optics</span>
          <span className="value">›</span>
        </button>
        <button className="row-tap" onClick={() => open({ kind: 'magazines' })}>
          <span className="row-ico" aria-hidden="true"><Icon name="magazine" size={20} /></span>
          <span className="label">Magazines</span>
          <span className="value">›</span>
        </button>
        <button className="row-tap" onClick={() => open({ kind: 'ammo' })}>
          <span className="row-ico" aria-hidden="true"><Icon name="ammo" size={20} /></span>
          <span className="label">Ammo</span>
          <span className="value">›</span>
        </button>
        <button className="row-tap" onClick={() => open({ kind: 'parts' })}>
          <span className="row-ico" aria-hidden="true"><Icon name="parts" size={20} /></span>
          <span className="label">Parts</span>
          <span className="value">›</span>
        </button>
        <button className="row-tap" onClick={() => open({ kind: 'references' })}>
          <span className="row-ico" aria-hidden="true"><Icon name="reference" size={20} /></span>
          <span className="label">Care Guides</span>
          <span className="value">›</span>
        </button>
      </div>

      <h2 className="menu-group-title">Training</h2>
      <p className="menu-group-sub">Getting better</p>
      <div className="card">
        <button className="row-tap" onClick={() => open({ kind: 'drills' })}>
          <span className="row-ico" aria-hidden="true"><Icon name="drills" size={20} /></span>
          <span className="label">Drills</span>
          <span className="value">›</span>
        </button>
        <button className="row-tap" onClick={() => open({ kind: 'numbers' })}>
          <span className="row-ico" aria-hidden="true"><Icon name="info" size={20} /></span>
          <span className="label">The numbers</span>
          <span className="value">›</span>
        </button>
      </div>

      <h2 className="menu-group-title">Records</h2>
      <p className="menu-group-sub">Your history</p>
      <div className="card">
        <button className="row-tap" onClick={() => open({ kind: 'maintenance' })}>
          <span className="row-ico" aria-hidden="true"><Icon name="maintenance" size={20} /></span>
          <span className="label">Gun Maintenance</span>
          <span className="value">›</span>
        </button>
        <button className="row-tap" onClick={() => open({ kind: 'malfunctions' })}>
          <span className="row-ico" aria-hidden="true"><Icon name="malfunction" size={20} /></span>
          <span className="label">Malfunctions</span>
          <span className="value">›</span>
        </button>
        <button className="row-tap" onClick={() => open({ kind: 'costs' })}>
          <span className="row-ico" aria-hidden="true"><Icon name="costs" size={20} /></span>
          <span className="label">Costs &amp; Purchases</span>
          <span className="value">›</span>
        </button>
        <button className="row-tap" onClick={() => open({ kind: 'reports' })}>
          <span className="row-ico" aria-hidden="true"><Icon name="reports" size={20} /></span>
          <span className="label">Reports</span>
          <span className="value">›</span>
        </button>
      </div>

      <h2 className="menu-group-title">App &amp; Data</h2>
      <p className="menu-group-sub">Setup, sync, and backups</p>
      <div className="card">
        <button className="row-tap" onClick={() => open({ kind: 'help' })}>
          <span className="row-ico" aria-hidden="true"><Icon name="help" size={20} /></span>
          <span className="label">Tour &amp; Setup</span>
          <span className="value">›</span>
        </button>
        <button className="row-tap" onClick={() => open({ kind: 'settings' })}>
          <span className="row-ico" aria-hidden="true"><Icon name="settings" size={20} /></span>
          <span className="label">Settings</span>
          <span className="value">›</span>
        </button>
        <button className="row-tap" onClick={() => open({ kind: 'sync' })}>
          <span className="row-ico" aria-hidden="true"><Icon name="sync" size={20} /></span>
          <span className="label">Sync &amp; Backup</span>
          <span className="value">›</span>
        </button>
        <button className="row-tap" onClick={() => open({ kind: 'free-space' })}>
          <span className="row-ico" aria-hidden="true"><Icon name="cleanup" size={20} /></span>
          <span className="label">Free Up Space</span>
          <span className="value">›</span>
        </button>
        {/* Rung-1 transparency surface — hidden while telemetry ships dark
            (no provider wired, nothing can be sent), so users never meet a
            control for a pipe that doesn't exist. The activation step makes
            this row appear with the pipe itself. Deep links stay honest: the
            screen is state-aware. */}
        {telemetryState().wired && (
          <button className="row-tap" onClick={() => open({ kind: 'your-data' })}>
            <span className="row-ico" aria-hidden="true"><Icon name="shield" size={20} /></span>
            <span className="label">Your Data</span>
            <span className="value">›</span>
          </button>
        )}
      </div>
    </div>
  );
}

// The Guns list — its own screen now (reached from the "Data & Gear" group on
// both the desktop sidebar and the phone More tab). Mirrors the GUNS card.
export function GunsScreen({ refreshKey, onBack, open }: {
  refreshKey: number; onBack: () => void; open: (v: View) => void;
}) {
  const { firearms, loaded, error, reload } = useData(refreshKey);
  const [q, setQ] = useState('');
  const [showFormer, setShowFormer] = useState(false);
  if (error) return <ScreenError onRetry={reload} />;
  if (!loaded) return <ScreenLoading />;
  // Audit #10: active + retired show by default (with badges); guns you no longer
  // own hide behind a toggle. Open a gun to retire/remove or bring it back.
  const anyFormer = firearms.some(isFormer);
  const shown = firearms.filter((f) =>
    (showFormer || !isFormer(f)) && matchesQuery(q, f.name, f.category, f.caliber));
  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Guns <InfoTip title="Guns">Your firearms. Tap one for its details, maintenance, and photos; use + to add a gun. Open a gun to retire it or mark it sold — its history stays.</InfoTip></h1>
      <button className="button" onClick={() => open({ kind: 'gun-form' })}>+ Add Gun</button>
      {firearms.length > 8 && <ListSearch value={q} onChange={setQ} placeholder="Search guns" />}
      {anyFormer && (
        <label className="checklist-take" style={{ margin: '8px 0' }}>
          <input type="checkbox" checked={showFormer} onChange={(e) => setShowFormer(e.target.checked)} />
          Show guns I no longer own
        </label>
      )}
      <div className="card">
        {firearms.length === 0 && <p className="report-note">No guns yet. Tap "+ Add Gun" to add your first one.</p>}
        {firearms.length > 0 && shown.length === 0 && <p className="report-note">No guns match.</p>}
        {shown.map((f) => {
          const badge = statusBadge(f);
          return (
            <button className="row-tap" key={f.id} onClick={() => open({ kind: 'gun-detail', id: f.id })}>
              <span className="label">
                {f.name}
                {badge && <span className={`badge ${isRetired(f) ? 'warn-badge' : 'bad'}`} style={{ marginLeft: 6 }}>{badge}</span>}
              </span>
              <span className="value">{f.category} · {f.caliber} ›</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
