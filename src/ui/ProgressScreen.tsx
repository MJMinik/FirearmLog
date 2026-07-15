// Progress tab (spec §10): goals, skill ratings, trends, heatmap. Built up
// across the M7 batches; this batch adds Goals (req 26 — create several in a
// row without leaving the page, editable anytime).
import { useEffect, useState } from 'react';
import type {
  AppSettings, Classifier, DrillDef, Firearm, Goal, GunCategory, MalfunctionEntry, Match, Session, SkillAssessment
} from '../lib/types.ts';
import { GUN_CATEGORIES } from '../lib/types.ts';
import { deleteOne, getAll, getSettings, putOne, putSettings } from '../lib/db.ts';
import { activeOnly, activeMalfunctions, trashedIdSet } from '../lib/softDelete.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { formatDayKey, todayKey } from '../lib/dates.ts';
import { goalCategories, goalStats, pinGolden, sortGoals } from '../lib/goals.ts';
import { SKILL_AREAS, assessmentAverage, assessmentsByDate, latestAssessment } from '../lib/skills.ts';
import {
  allClassifications, formatDrillScore, personalRecords, roundsByMonth, type RoundsFilter
} from '../lib/dashboard.ts';
import { bucketTotals, malfunctionsInRange, ratePerThousand, spanStartDate } from '../lib/trends.ts';
import { matchAccuracyTrend } from '../lib/competition.ts';
import { buildHeatmap, monthLabels, sessionsOnDay } from '../lib/heatmap.ts';
import { sessionRounds } from '../lib/stats.ts';
import { chartDateLabel, dateMode, thinIndices } from '../lib/chartFurniture.ts';
import { ChartReadout } from './ChartReadout.tsx';
import type { View } from './nav.ts';
import { RoundsByMonthChart } from './screens.tsx';
import { SuggestField, noAutofillProps } from './SuggestField.tsx';
import { ConfirmSheet, Sheet } from './Sheet.tsx';
import { FormProblem } from './FormProblem.tsx';
import { Icon } from './Icon.tsx';
import { SwipeRow } from './SwipeRow.tsx';
import { InfoTip } from './InfoTip.tsx';
import { openSessionReport } from './sessionReport.ts';
import { Reveal } from './Reveal.tsx';
import { ScreenError } from './ScreenState.tsx';

export function ProgressScreen({ refreshKey, open }: { refreshKey: number; open: (v: View) => void }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [skills, setSkills] = useState<SkillAssessment[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [drills, setDrills] = useState<DrillDef[]>([]);
  const [classifiers, setClassifiers] = useState<Classifier[]>([]);
  const [malfunctions, setMalfunctions] = useState<MalfunctionEntry[]>([]);
  const [bump, setBump] = useState(0);
  const [error, setError] = useState(false);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const [target, setTarget] = useState('');
  const [goalProblem, setGoalProblem] = useState('');
  const [editing, setEditing] = useState<Goal | null>(null);
  const [skillSheet, setSkillSheet] = useState<SkillAssessment | 'new' | null>(null);
  const [goldenId, setGoldenId] = useState<string>('');
  const [coachingRemarks, setCoachingRemarks] = useState(true);

  useEffect(() => {
    let alive = true;
    setError(false);
    void (async () => {
      try {
        const [g, s, se, m, f, d, c, mf] = await Promise.all([
          getAll<Goal>('goals'), getAll<SkillAssessment>('skills'), getAll<Session>('sessions'),
          getAll<Match>('matches'), getAll<Firearm>('firearms'), getAll<DrillDef>('drills'),
          getAll<Classifier>('classifiers'), getAll<MalfunctionEntry>('malfunctions')
        ]);
        if (!alive) return;
        // App 7: drop trashed sessions and any malfunctions filed against them, so
        // trends, personal records, and the malfunction rate never count deleted data.
        const live = activeOnly(se);
        const trashedIds = trashedIdSet(se);
        setGoals(sortGoals(g)); setSkills(s); setSessions(live); setMatches(m);
        setFirearms(f); setDrills(d); setClassifiers(c);
        setMalfunctions(activeMalfunctions(mf, trashedIds));
        const settings = await getSettings<AppSettings>();
        if (alive) { setGoldenId(settings?.goldenGoalId ?? ''); setCoachingRemarks(settings?.coachingRemarks !== false); }
      } catch (e) {
        console.error('Progress load failed', e);
        if (alive) setError(true);
      }
    })();
    return () => { alive = false; };
  }, [refreshKey, bump]);

  if (error) return <ScreenError onRetry={() => setBump((n) => n + 1)} />;

  async function disableRemarks() {
    setCoachingRemarks(false); // optimistic; re-enable in Settings
    await putSettings<AppSettings>({ coachingRemarks: false });
  }

  async function addGoal() {
    if (!text.trim()) { setGoalProblem('Enter the goal before saving.'); return; }
    setGoalProblem('');
    await putOne('goals', stampNew({
      text: text.trim(), category: category.trim(), target: target.trim(),
      achieved: false, dateSet: todayKey(), dateAchieved: ''
    }, newId('go'), Date.now()));
    // Keep the form open and the category sticky so several goals go in fast.
    setText(''); setTarget('');
    setBump((b) => b + 1);
  }

  async function toggleAchieved(g: Goal) {
    const achieved = !g.achieved;
    await putOne('goals', stampUpdate({ ...g, achieved, dateAchieved: achieved ? todayKey() : '' }, Date.now()));
    setBump((b) => b + 1);
  }

  // Swipe-left delete on a goal row. Goals carry no references and are trivial to
  // re-create, and the SwipeRow's reveal-then-tap is itself the guard, so this
  // deletes immediately (no extra confirm) — matching the session swipe and iOS.
  // (The Edit Goal sheet keeps its own confirm for the deliberate delete path.)
  async function deleteGoal(g: Goal) {
    await deleteOne('goals', g.id);
    setBump((b) => b + 1);
  }

  // Golden goal: exactly one, tracked by a single settings pointer (no change to
  // the Goal records themselves, so "exactly one" can't drift). Tapping the star
  // on the current golden goal clears it. A deleted golden goal simply leaves a
  // dangling id that resolves to nothing — harmless, and re-set on next tap.
  async function toggleGolden(g: Goal) {
    const next = goldenId === g.id ? '' : g.id;
    setGoldenId(next);
    await putSettings<AppSettings>({ goldenGoalId: next });
  }

  const stats = goalStats(goals);
  const cats = goalCategories(goals);

  return (
    <div className="screen">
      <h1 className="large-title">Progress</h1>

      <div className="card">
        <h2>Goals <InfoTip title="Goals">Set a target like "Bill Drill under 2.0s." Add several in a row, check one off when you hit it, and edit any goal later. Your North Star is the one thing you're ultimately working toward, like "USPSA A — 2027" — tap the star to pin it to the top here and keep it in front of you on Home. Keep it short; it shows on one line.</InfoTip></h2>
        {stats.total > 0 && (
          <p className="report-note">{stats.open} open · {stats.achieved} achieved</p>
        )}

        {adding ? (
          <div className="goal-add">
            <FormProblem problem={goalProblem} />
            <label className="field">Goal
              <input value={text} {...noAutofillProps} name="fl-goal-text" autoFocus
                enterKeyHint="done"
                placeholder="Bill Drill under 2.0 seconds"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void addGoal(); }} />
            </label>
            <SuggestField label="Category (optional)" value={category} onChange={setCategory}
              name="fl-goal-cat" suggestions={cats} placeholder="Speed" />
            <label className="field">Target (optional)
              <input value={target} {...noAutofillProps} name="fl-goal-target" placeholder="under 2.0s"
                onChange={(e) => setTarget(e.target.value)} />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="button" style={{ flex: 1 }} onClick={() => void addGoal()}>Add Goal</button>
              <button className="button secondary" style={{ flex: 1 }} onClick={() => setAdding(false)}>Done</button>
            </div>
            <p className="report-note">Add as many as you like — the form stays open.</p>
          </div>
        ) : (
          <button className="button secondary" onClick={() => setAdding(true)}>+ Add Goal</button>
        )}

        {goals.length === 0 && !adding && (
          <p className="report-note">No goals yet. Set a target — "Bill Drill under 2.0s" — and check it off when you get there.</p>
        )}
        {pinGolden(goals, goldenId).map((g) => {
          const isGolden = g.id === goldenId;
          return (
          <SwipeRow key={g.id} onDelete={() => void deleteGoal(g)} deleteLabel="Delete"
            className={isGolden ? 'golden-sep' : ''}>
            <div className={isGolden ? 'goal-row goal-golden' : 'goal-row'}>
              <button className="goal-star" aria-pressed={isGolden}
                aria-label={isGolden ? `Remove ${g.text} as your North Star` : `Make ${g.text} your North Star`}
                onClick={() => void toggleGolden(g)}>{isGolden ? <Icon name="starFilled" size={18} /> : <Icon name="star" size={18} />}</button>
              <div className="goal-main">
                <label className="checklist-take">
                  <input type="checkbox" checked={g.achieved} onChange={() => void toggleAchieved(g)} />
                  <span style={g.achieved ? { textDecoration: 'line-through', color: 'var(--text-dim)' } : undefined}>
                    {g.text}
                  </span>
                </label>
                {(isGolden || g.category || g.target || (g.achieved && g.dateAchieved)) && (
                  <div className="goal-subs">
                    {isGolden && <div className="row-sub" style={{ color: 'var(--accent-ink)' }}>North Star</div>}
                    {(g.category || g.target) && (
                      <div className="row-sub">{[g.category, g.target].filter(Boolean).join(' · ')}</div>
                    )}
                    {g.achieved && g.dateAchieved && (
                      <div className="row-sub">Achieved {formatDayKey(g.dateAchieved)}</div>
                    )}
                  </div>
                )}
              </div>
              <button className="icon-btn" aria-label={`Edit ${g.text}`} onClick={() => setEditing(g)}><Icon name="edit" size={18} /></button>
            </div>
          </SwipeRow>
          );
        })}
      </div>

      <SkillsCard skills={skills} onNew={() => setSkillSheet('new')} onEdit={(a) => setSkillSheet(a)} />

      <TrendsCard sessions={sessions} matches={matches} firearms={firearms}
        drills={drills} classifiers={classifiers} malfunctions={malfunctions} open={open} />

      <SpeedAccuracyTrendCard matches={matches} coachingRemarks={coachingRemarks}
        onDisableRemarks={() => void disableRemarks()} />

      <HeatmapCard sessions={sessions} />

      {editing && (
        <GoalEditSheet goal={editing} categories={cats}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setBump((b) => b + 1); }} />
      )}
      {skillSheet && (
        <SkillSheet assessment={skillSheet === 'new' ? null : skillSheet}
          onClose={() => setSkillSheet(null)}
          onSaved={() => { setSkillSheet(null); setBump((b) => b + 1); }} />
      )}
    </div>
  );
}

const SESSION_TYPE_LABEL: Record<string, string> = {
  practice: 'Live practice', dry_fire: 'Dry fire', class: 'Class'
};

function HeatmapCard({ sessions }: { sessions: Session[] }) {
  const [weeks, setWeeks] = useState(26);
  // Audit #20: tapping a day shows its count here — the SVG <title> only worked
  // on desktop hover, so on a phone the "press a square" help did nothing.
  const [selText, setSelText] = useState<string | null>(null);
  // Default: tapping a day opens that day's Session Report (Michael, July 8
  // 2026 — supersedes the session-36 open-the-edit-screen default). One session
  // opens its report directly; several show a picker; an empty day falls back
  // to showing its count so the tap is never dead. The checkbox opts into the
  // quieter "just show the day's count" behaviour. Not remembered across visits.
  const [showCountOnly, setShowCountOnly] = useState(false);
  const [daySheet, setDaySheet] = useState<Session[] | null>(null);
  // Michael, July 8 2026: a day square opens the day's Session Report — the
  // finished read with the target photos — not the edit screen. Editing still
  // lives on the Log tab. openReport is called straight from the tap so the
  // report window opens inside the gesture (iOS popup rule); if the browser
  // blocks it anyway, the card's note line says so instead of a dead tap.
  async function openReport(s: Session) {
    const trouble = await openSessionReport(s);
    if (trouble) setSelText(trouble);
  }
  function tapCell(c: { date: string; sessions: number; rounds: number }) {
    if (!showCountOnly) {
      const day = sessionsOnDay(sessions, c.date);
      if (day.length === 1) { void openReport(day[0]); return; }
      if (day.length > 1) { setDaySheet(day); return; }
      // Empty day: fall through to the count so the tap is never dead.
    }
    setSelText(`${formatDayKey(c.date)}: ${c.sessions} session${c.sessions !== 1 ? 's' : ''}, ${c.rounds.toLocaleString()} rounds`);
  }
  const grid = buildHeatmap(sessions, weeks, new Date());
  const cell = 12, gap = 3, rows = 7;
  const w = grid.length * (cell + gap) - gap;
  const h = rows * (cell + gap) - gap;
  const opacities = [0, 0.3, 0.5, 0.75, 1];
  // Month strip below the grid (spec §10) — placed at the bottom to match the
  // Trends bar chart's x-axis labels (consistency). The dates already live on
  // every square, so this is display-only. Thin to every-other label once there
  // are many months (the 52-week view spans ~13) so they don't collide. Mobile
  // wins (rule 4): the label font scales up with the grid width so it stays
  // readable on a phone, where a 52-week grid is shrunk to fit the screen.
  const labels = monthLabels(grid);
  const labelStep = labels.length > 8 ? 2 : 1;
  const labelFont = Math.min(24, Math.max(11, Math.round((10 * w) / 360)));
  const labelH = labelFont + 4;
  return (
    <div className="card">
      <h2>Training grid <InfoTip title="Training grid">Each square is a day — darker means more rounds, with the months labeled along the bottom. Switch between the last 26 or 52 weeks. Tap a day to open that day's session report — drills, notes, and target photos on one page — or turn on "Just show the day's count" to peek at a day without opening it. (To change a session, open it from the Log tab.)</InfoTip></h2>
      <div className="chart-filters">
        <select aria-label="Training grid weeks" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
          <option value={26}>26 weeks</option>
          <option value={52}>52 weeks</option>
        </select>
      </div>
      <label className="report-note" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 4, minHeight: 'var(--touch-min)' }}>
        <input type="checkbox" checked={showCountOnly} onChange={(e) => setShowCountOnly(e.target.checked)} />
        Just show the day's count, don't open the report
      </label>
      <svg viewBox={`0 0 ${w} ${h + labelH}`} width="100%" role="img" aria-label="Training activity heatmap"
        style={{ display: 'block', maxWidth: w, marginTop: 4 }}>
        {grid.map((col, ci) => col.map((c, ri) => (
          <rect key={c.date} x={ci * (cell + gap)} y={ri * (cell + gap)} width={cell} height={cell} rx={2}
            fill={c.level === 0 ? 'var(--separator)' : 'var(--accent)'}
            opacity={c.level === 0 ? (c.inRange ? 0.4 : 0.12) : opacities[c.level]}
            style={{ cursor: 'pointer' }}
            onClick={() => tapCell(c)}>
            <title>{`${c.date}: ${c.sessions} session${c.sessions !== 1 ? 's' : ''}, ${c.rounds.toLocaleString()} rounds`}</title>
          </rect>
        )))}
        {labels.map((lab, li) => {
          if (li % labelStep !== 0) return null;
          const lx = lab.col * (cell + gap);
          // A label near the right edge would run past the chart and get
          // clipped (e.g. the current month). Right-anchor it to the edge so
          // it tucks in flush instead of spilling off.
          const overflowRight = lx + labelFont * 2 > w;
          return (
            <text key={lab.col} x={overflowRight ? w : lx} y={h + labelFont}
              textAnchor={overflowRight ? 'end' : 'start'}
              fill="var(--text-dim)" fontSize={labelFont} fontFamily="inherit">
              {lab.text}
            </text>
          );
        })}
      </svg>
      {selText
        ? <p className="report-note" aria-live="polite">{selText}</p>
        : <p className="report-note">
            {showCountOnly
              ? `Each square is a day; darker = more rounds — tap one to see its count. Last ${weeks} weeks.`
              : `Each square is a day; darker = more rounds — tap one for that day's session report. Last ${weeks} weeks.`}
          </p>}
      {daySheet && (
        <Sheet title="Sessions on this day" onClose={() => setDaySheet(null)}>
          {daySheet.map((s) => (
            <button key={s.id} className="drill-pick-row"
              onClick={() => { setDaySheet(null); void openReport(s); }}>
              <strong>{formatDayKey(s.date)} · {SESSION_TYPE_LABEL[s.type] ?? s.type}</strong>
              <span>{sessionRounds(s).toLocaleString()} rounds{s.location ? ` · ${s.location}` : ''}</span>
            </button>
          ))}
        </Sheet>
      )}
    </div>
  );
}

/**
 * Speed & Accuracy over time (phase 2). Plots USPSA accuracy (points kept) across
 * matches — the board's "the real signal is the trend, not one match." No pace line
 * (raw time isn't comparable across matches); pace enters only as the trend-backed
 * remark when a clear multi-match pattern holds. Hidden until there are >= 2 matches
 * with a hit breakdown, so it never clutters a log that can't yet support it.
 */
function SpeedAccuracyTrendCard({ matches, coachingRemarks, onDisableRemarks }: {
  matches: Match[]; coachingRemarks: boolean; onDisableRemarks: () => void;
}) {
  // The readout stores WHICH match was tapped (by id) and derives its text
  // from the current data at render — it can never assert numbers for data
  // the chart no longer shows (fresh-eyes audit finding, session 62).
  const [selMatchId, setSelMatchId] = useState<string | null>(null);
  const trend = matchAccuracyTrend(matches);
  const pts = trend.points;
  if (pts.length < 2) return null;

  // F4 (session 62): furnished per the chart-furniture spec — date anchors on
  // the x-axis (the pilot tester's note, verbatim: "Date should show along
  // horizontal axis"), the 90% mid tick labeled, the latest match's number
  // always visible, and a tap-readout line beneath.
  const w = 280, h = 138, padR = 12, padL = 34, padT = 14, padB = 20;
  const vals = pts.map((p) => p.pointsKept * 100);
  const min = Math.min(...vals), max = Math.max(...vals);
  // M6: fix the y-domain to a meaningful accuracy band (80–100%) rather than
  // auto-scaling min→max — auto-scaling made a 94→96% wiggle fill the whole chart and
  // read as a big swing. Only drop the floor below 80 if a match actually dipped there.
  const loY = Math.min(80, Math.floor(min / 5) * 5);
  const hiY = 100;
  const domain = hiY - loY;
  const stepX = (w - padL - padR) / (pts.length - 1);
  const xAt = (i: number) => padL + i * stepX;
  const yAt = (v: number) => padT + (1 - (v - loY) / domain) * (h - padT - padB);
  const line = pts.map((p, i) => `${xAt(i)},${yAt(p.pointsKept * 100)}`).join(' ');
  const mode = dateMode(pts[0].date, pts[pts.length - 1].date);
  const dateIdxs = thinIndices(pts.length, 4);
  const lastIdx = pts.length - 1;
  const lastV = vals[lastIdx];
  const lastLabelY = yAt(lastV) < padT + 14 ? yAt(lastV) + 14 : yAt(lastV) - 8;

  const sel = selMatchId != null ? pts.find((p) => p.matchId === selMatchId) ?? null : null;
  const readout = sel
    ? `${formatDayKey(sel.date)} — ${sel.name} — ${(sel.pointsKept * 100).toFixed(1)}% of points kept`
    : null;

  return (
    <div className="card">
      <h2>Accuracy across matches <InfoTip title="Accuracy across matches">Your USPSA accuracy — the share of available points you kept — across your matches, oldest to newest, with the dates along the bottom. Tap any dot for that match's name, date, and number. This is the place to read the trend: one match is a small sample; the run of matches is the signal for whether you're getting cleaner or looser over a season. There's no pace line on purpose: raw time isn't comparable across different matches, so pace shows up only as a note below, and only when a clear pattern holds.</InfoTip></h2>
      <p className="report-note" style={{ marginTop: 0 }}>
        Points kept — {Math.round(min)}% to {Math.round(max)}% across {pts.length} USPSA matches.
      </p>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block', marginTop: 4 }}
        role="img" aria-label={`Accuracy across ${pts.length} matches from ${formatDayKey(pts[0].date)} to ${formatDayKey(pts[lastIdx].date)} — ${Math.round(min)} to ${Math.round(max)} percent of points kept, oldest to newest`}>
        {[hiY, (hiY + loY) / 2, loY].map((gv, k) => (
          <g key={k}>
            <line x1={padL} y1={yAt(gv)} x2={w - padR} y2={yAt(gv)} stroke="var(--separator)" strokeWidth={0.5} />
            <text className="chart-tick" x={padL - 4} y={yAt(gv) + 3} fontSize={10} fill="var(--text-dim)" textAnchor="end">
              {Math.round(gv)}%
            </text>
          </g>
        ))}
        {dateIdxs.map((i) => (
          <text className="chart-date" key={`d-${i}`} x={xAt(i)} y={h - 6}
            textAnchor={i === 0 ? 'start' : i === lastIdx ? 'end' : 'middle'}
            fill="var(--text-dim)" fontSize={10} fontFamily="inherit">
            {chartDateLabel(pts[i].date, mode)}
          </text>
        ))}
        <polyline points={line} fill="none" stroke="var(--accent-ink)" strokeWidth={1.5}
          strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={p.matchId} cx={xAt(i)} cy={yAt(p.pointsKept * 100)} r={2.5} fill="var(--accent-ink)" />
        ))}
        {/* The selection ring: the tapped match wears an amber ring, so the
            readout below visibly belongs to a specific dot (Michael's call,
            session 62). Same derived selection as the readout. */}
        {sel != null && (
          <circle className="chart-sel-ring" cx={xAt(pts.indexOf(sel))} cy={yAt(sel.pointsKept * 100)}
            r={6.5} fill="none" stroke="var(--accent)" strokeWidth={1.75}
            style={{ pointerEvents: 'none' }} />
        )}
        {/* Honest tap targets: one full-height column per match, split at the
            midpoints — dense seasons can't steal each other's taps. */}
        {pts.map((p, i) => {
          const left = i === 0 ? 0 : (xAt(i - 1) + xAt(i)) / 2;
          const right = i === lastIdx ? w : (xAt(i) + xAt(i + 1)) / 2;
          return (
            <rect className="chart-hit" key={`hit-${p.matchId}`} x={left} y={0}
              width={right - left} height={h} fill="transparent" style={{ cursor: 'pointer' }}
              onClick={() => setSelMatchId(p.matchId)}>
              <title>{`${formatDayKey(p.date)}: ${p.name} — ${(p.pointsKept * 100).toFixed(1)}%`}</title>
            </rect>
          );
        })}
        {/* Card-colored halo (paint-order: stroke) keeps the headline number
            legible where the line passes behind it (live-verify catch, s62). */}
        <text className="chart-last-label" x={xAt(lastIdx)} y={lastLabelY} textAnchor="end"
          fill="var(--text)" fontSize={11} fontWeight={600} fontFamily="inherit"
          stroke="var(--bg-card)" strokeWidth={3.5} strokeLinejoin="round"
          style={{ pointerEvents: 'none', paintOrder: 'stroke' }}>
          {lastV.toFixed(1)}%
        </text>
      </svg>
      <ChartReadout value={readout} hint="Tap a dot to see that match's date and number." />
      {trend.consistentlyClean && coachingRemarks && (
        <p className="report-note" style={{ marginTop: 8 }}>
          Your recent matches have all been very clean (95%+ of points kept) — you may consistently have room to push the pace.{' '}
          <button className="link-btn" onClick={onDisableRemarks}>Turn off (Settings)</button>
        </p>
      )}
    </div>
  );
}

function TrendsCard({ sessions, matches, firearms, drills, classifiers, malfunctions, open }: {
  sessions: Session[]; matches: Match[]; firearms: Firearm[];
  drills: DrillDef[]; classifiers: Classifier[]; malfunctions: MalfunctionEntry[];
  open: (v: View) => void;
}) {
  const [months, setMonths] = useState(12);
  const [filter, setFilter] = useState<RoundsFilter>({});

  const buckets = roundsByMonth(sessions, matches, months, new Date(), filter, firearms);
  const totals = bucketTotals(buckets);
  const since = spanStartDate(months);
  const malfCount = malfunctionsInRange(malfunctions, since, filter, firearms);
  const malfRate = ratePerThousand(malfCount, totals.liveAndMatch);
  const divisions = allClassifications(classifiers);
  const prs = personalRecords(sessions, drills).filter((p) => p.best).slice(0, 8);
  const anyRounds = totals.live + totals.match + totals.dry > 0;

  return (
    <div className="card">
      <h2>Trends <InfoTip title="Trends">Your rounds and reps over the span you pick. "Dry : live" is dry-fire reps per live round; "malfunctions / 1,000" is your stoppage rate. Filter by gun or gun type. Tap a bar for that month's exact numbers.</InfoTip></h2>
      {/* Progressive disclosure: show the chart with its defaults (last 12 mo, all guns)
          first; the filter row is one tap away rather than clutter above the data. */}
      <Reveal label="Filters">
        <div className="chart-filters">
          <select aria-label="Gun type" value={filter.category ?? ''} disabled={!!filter.firearmId}
            onChange={(e) => setFilter({ category: e.target.value as GunCategory | '', firearmId: '' })}>
            <option value="">All types</option>
            {GUN_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select aria-label="Gun" value={filter.firearmId ?? ''}
            onChange={(e) => setFilter({ category: '', firearmId: e.target.value })}>
            <option value="">All guns</option>
            {firearms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <select aria-label="Months" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            <option value={6}>6 mo</option>
            <option value={12}>12 mo</option>
            <option value={24}>24 mo</option>
          </select>
        </div>
      </Reveal>

      {anyRounds
        ? <RoundsByMonthChart buckets={buckets} />
        : <p className="report-note">No rounds logged{(filter.category || filter.firearmId) ? ' for this gun.' : ' yet.'}</p>}

      <div className="row"><span className="label">Live + match rounds (span)</span><span className="value">{totals.liveAndMatch.toLocaleString()}</span></div>
      <div className="row"><span className="label">Dry-fire reps (span)</span><span className="value">{totals.dry.toLocaleString()}</span></div>
      <div className="row">
        <span className="label">Dry : live</span>
        <span className="value">{totals.liveAndMatch > 0 ? `${(totals.dry / totals.liveAndMatch).toFixed(2)} : 1` : '—'}</span>
      </div>
      <div className="row">
        <span className="label">Malfunctions / 1,000 rds</span>
        <span className="value">{malfRate != null ? `${malfRate.toFixed(1)} (${malfCount})` : '—'}</span>
      </div>

      {divisions.length > 0 && (
        <>
          <h2 style={{ marginTop: 12 }}>Classification</h2>
          {divisions.map((d) => (
            <div className="row" key={d.division}>
              <span className="label">{d.division}</span>
              <span className="value">
                {d.average != null ? `${d.average.toFixed(1)}%` : '—'}{d.currentClass ? ` · ${d.currentClass}` : ''}
              </span>
            </div>
          ))}
        </>
      )}

      {prs.length > 0 && (
        <>
          <h2 style={{ marginTop: 12 }}>Personal Records</h2>
          {prs.map((p) => (
            <button className="pr-row" key={p.name}
              onClick={() => open({ kind: 'drill-history', name: p.name })}>
              <span className="label">
                {p.name}
                <div className="row-sub">{p.attempts} attempt{p.attempts !== 1 ? 's' : ''}</div>
              </span>
              <span className="value">{formatDrillScore(p.best, p.scoring)} <span aria-hidden="true">›</span></span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

function SkillsCard({ skills, onNew, onEdit }: {
  skills: SkillAssessment[]; onNew: () => void; onEdit: (a: SkillAssessment) => void;
}) {
  const latest = latestAssessment(skills);
  const history = [...assessmentsByDate(skills)].reverse(); // newest first
  return (
    <div className="card">
      <h2>Skills Check <InfoTip title="Skills Check">Rate yourself 1–10 in eight areas now and then. You'll see your latest scores, your average, and how they trend over time.</InfoTip></h2>
      <button className="button secondary" onClick={onNew}>+ New Check</button>
      {!latest && (
        <p className="report-note">Rate yourself 1–10 across the 8 areas now and then to see your trend.</p>
      )}
      {latest && (
        <>
          <p className="report-note">Latest — {formatDayKey(latest.date)}
            {assessmentAverage(latest.ratings) != null ? ` · avg ${assessmentAverage(latest.ratings)!.toFixed(1)}` : ''}</p>
          {SKILL_AREAS.map((a) => (
            <div className="row" key={a.key}>
              <span className="label">{a.label}</span>
              <span className="value">{latest.ratings[a.key] ? `${latest.ratings[a.key]} / 10` : '—'}</span>
            </div>
          ))}
        </>
      )}
      {history.length > 1 && (
        <>
          <h2 style={{ marginTop: 12 }}>History</h2>
          {history.map((a) => {
            const avg = assessmentAverage(a.ratings);
            return (
              <button className="row-tap" key={a.id} onClick={() => onEdit(a)}>
                <span className="label">{formatDayKey(a.date)}</span>
                <span className="value">{avg != null ? `avg ${avg.toFixed(1)}` : '—'} ›</span>
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}

function SkillSheet({ assessment, onClose, onSaved }: {
  assessment: SkillAssessment | null; onClose: () => void; onSaved: () => void;
}) {
  const [date, setDate] = useState(assessment?.date || todayKey());
  const [ratings, setRatings] = useState<Record<string, string>>(() => {
    const r: Record<string, string> = {};
    for (const a of SKILL_AREAS) r[a.key] = assessment?.ratings[a.key] ? String(assessment.ratings[a.key]) : '';
    return r;
  });
  const [notes, setNotes] = useState(assessment?.notes || '');
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState('');

  async function save() {
    const r: Record<string, number> = {};
    for (const a of SKILL_AREAS) {
      const v = Number(ratings[a.key]);
      if (Number.isFinite(v) && v > 0) r[a.key] = v;
    }
    if (Object.keys(r).length === 0) { setProblem('Rate at least one area before saving.'); return; }
    if (assessment) {
      await putOne('skills', stampUpdate({ ...assessment, date, ratings: r, notes: notes.trim() }, Date.now()));
    } else {
      await putOne('skills', stampNew({ date, ratings: r, notes: notes.trim() }, newId('sk'), Date.now()));
    }
    onSaved();
  }

  async function reallyDelete() {
    if (assessment) await deleteOne('skills', assessment.id);
    onSaved();
  }

  return (
    <Sheet title={assessment ? 'Edit Check' : 'New Check'} onClose={onClose}>
      <FormProblem problem={problem} />
      <label className="field">Date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {SKILL_AREAS.map((a) => (
        <div className="row" key={a.key}>
          <span className="label">{a.label}</span>
          <select className="category-pick" aria-label={a.label} value={ratings[a.key]}
            onChange={(e) => setRatings((prev) => ({ ...prev, [a.key]: e.target.value }))}>
            <option value="">–</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      ))}
      <label className="field">Notes
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <button className="button" onClick={() => void save()}>{assessment ? 'Save changes' : 'Save assessment'}</button>
      {assessment && (
        <button className="button danger" style={{ marginTop: 8 }} onClick={() => setConfirming(true)}>Delete Assessment</button>
      )}
      {confirming && (
        <ConfirmSheet title="Delete this assessment?" message="There's no undo."
          confirmLabel="Delete Assessment" onConfirm={() => void reallyDelete()} onClose={() => setConfirming(false)} />
      )}
    </Sheet>
  );
}

function GoalEditSheet({ goal, categories, onClose, onSaved }: {
  goal: Goal; categories: string[]; onClose: () => void; onSaved: () => void;
}) {
  const [text, setText] = useState(goal.text);
  const [category, setCategory] = useState(goal.category);
  const [target, setTarget] = useState(goal.target);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState('');

  async function save() {
    if (!text.trim()) { setProblem('Enter the goal before saving.'); return; }
    await putOne('goals', stampUpdate({ ...goal, text: text.trim(), category: category.trim(), target: target.trim() }, Date.now()));
    onSaved();
  }

  async function reallyDelete() {
    await deleteOne('goals', goal.id);
    onSaved();
  }

  return (
    <Sheet title="Edit Goal" onClose={onClose}>
      <FormProblem problem={problem} />
      <label className="field">Goal
        <input value={text} {...noAutofillProps} name="fl-goal-text"
          onChange={(e) => setText(e.target.value)} />
      </label>
      <SuggestField label="Category (optional)" value={category} onChange={setCategory}
        name="fl-goal-cat" suggestions={categories} placeholder="Speed" />
      <label className="field">Target (optional)
        <input value={target} {...noAutofillProps} name="fl-goal-target"
          onChange={(e) => setTarget(e.target.value)} />
      </label>
      <button className="button" onClick={() => void save()}>Save changes</button>
      <button className="button danger" style={{ marginTop: 8 }} onClick={() => setConfirming(true)}>Delete goal</button>
      {confirming && (
        <ConfirmSheet title="Delete this goal?" message="There's no undo."
          confirmLabel="Delete goal" onConfirm={() => void reallyDelete()} onClose={() => setConfirming(false)} />
      )}
    </Sheet>
  );
}
