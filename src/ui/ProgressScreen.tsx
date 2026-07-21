// Progress tab (spec §10): goals, skill ratings, trends, heatmap. Built up
// across the M7 batches; this batch adds Goals (req 26 — create several in a
// row without leaving the page, editable anytime).
import { useEffect, useRef, useState } from 'react';
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
import { SKILL_AREAS, assessmentAverage, assessmentsByDate, latestAssessment, resolveSkillEvidence, skillRatingSeries } from '../lib/skills.ts';
import {
  allClassifications, formatDrillScore, personalRecords, roundsByMonth, type RoundsFilter
} from '../lib/dashboard.ts';
import { bucketTotals, malfunctionsInRange, ratePerThousand, sessionRatioCounts, spanStartDate } from '../lib/trends.ts';
import { matchAccuracyTrend } from '../lib/competition.ts';
import { buildHeatmap, monthLabels, sessionsOnDay } from '../lib/heatmap.ts';
import { sessionRounds } from '../lib/stats.ts';
import { chartDateLabel, dateMode, thinIndices } from '../lib/chartFurniture.ts';
import { ChartReadout } from './ChartReadout.tsx';
import type { View } from './nav.ts';
import { RoundsByMonthChart } from './screens.tsx';
import { SuggestField, noAutofillProps } from './SuggestField.tsx';
import { filterHidden } from '../lib/listEdits.ts';
import { ConfirmSheet, Sheet } from './Sheet.tsx';
import { useDirtyTracker } from './useDirtyTracker.ts';
import { FormProblem } from './FormProblem.tsx';
import { Icon } from './Icon.tsx';
import { SwipeRow } from './SwipeRow.tsx';
import { InfoTip } from './InfoTip.tsx';
import { openSessionReport } from './sessionReport.ts';
import { Reveal } from './Reveal.tsx';
import { ScreenError } from './ScreenState.tsx';

export function ProgressScreen({ refreshKey, open }: { refreshKey: number; open: (v: View) => void }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [hiddenSuggestions, setHiddenSuggestions] = useState<Record<string, string[]>>({});
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
  // Tester-2 F2 (July 16 2026): Return advances field-to-field in the goals
  // form (Goal → Category → Target → dismiss keyboard); ONLY the Add Goal
  // button commits. Refs let each field hand focus to the next.
  const goalCatRef = useRef<HTMLInputElement>(null);
  const goalTargetRef = useRef<HTMLInputElement>(null);
  // A6 (Michael, July 17 2026): when Enter advances focus INTO the Category
  // field, its suggestion list used to auto-open — noise the shooter didn't ask
  // for. This one-shot flag, set on the Enter-advance path just below, tells the
  // Category SuggestField to skip opening for that programmatic focus only; a
  // real tap or typing still opens it, so discoverability is untouched.
  const suppressCatOpen = useRef(false);

  useEffect(() => {
    let alive = true;
    setError(false);
    void (async () => {
      try {
        const [g, s, se, _hiddenSettings, m, f, d, c, mf] = await Promise.all([
          getAll<Goal>('goals'), getAll<SkillAssessment>('skills'), getAll<Session>('sessions'),
          getSettings<{ hiddenSuggestions?: Record<string, string[]> }>(),
          getAll<Match>('matches'), getAll<Firearm>('firearms'), getAll<DrillDef>('drills'),
          getAll<Classifier>('classifiers'), getAll<MalfunctionEntry>('malfunctions')
        ]);
        if (!alive) return;
        // App 7: drop trashed sessions and any malfunctions filed against them, so
        // trends, personal records, and the malfunction rate never count deleted data.
        const live = activeOnly(se);
        const trashedIds = trashedIdSet(se);
        setGoals(sortGoals(g)); setSkills(s); setSessions(live); setMatches(m);
        setHiddenSuggestions((_hiddenSettings as { hiddenSuggestions?: Record<string, string[]> } | undefined)?.hiddenSuggestions ?? {});
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

  // F7 (batch 2): the Skills Check "measured evidence" bridge resolves against
  // real data. A drill counts as evidence only if it has at least one logged run
  // (any session it appears in); the accuracy card counts only when it's showing.
  const loggedDrillNames = new Set<string>();
  for (const se of sessions) for (const d of se.drills ?? []) if (d.name) loggedDrillNames.add(d.name);
  const accuracyAvailable = matchAccuracyTrend(matches).points.length >= 2;
  // Scroll the "Accuracy across matches" card into view — the Accuracy skill's
  // evidence lives there, not on a drill.
  function scrollToAccuracy() {
    document.getElementById('accuracy-across-matches')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

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
                enterKeyHint="next"
                placeholder="Bill Drill under 2.0 seconds"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  // Tester-2 F2 (July 16 2026): Enter ADVANCES to Category, it no
                  // longer commits — testers were banking junk goals hidden under
                  // the iOS keyboard. Only the Add Goal button commits.
                  // A6: arm the one-shot flag so the Category field doesn't pop its
                  // suggestion list open just because Enter moved focus into it.
                  if (e.key === 'Enter') { e.preventDefault(); suppressCatOpen.current = true; goalCatRef.current?.focus(); }
                }} />
            </label>
            <SuggestField label="Category (optional)" value={category} onChange={setCategory}
              name="fl-goal-cat" suggestions={filterHidden(cats, hiddenSuggestions, 'goal-categories')} placeholder="Speed"
              inputRef={goalCatRef} enterKeyHint="next" suppressOpenOnFocus={suppressCatOpen}
              onEnter={() => goalTargetRef.current?.focus()} />
            <label className="field">Target (optional)
              <input value={target} {...noAutofillProps} name="fl-goal-target" placeholder="under 2.0s"
                ref={goalTargetRef} enterKeyHint="done"
                onChange={(e) => setTarget(e.target.value)}
                onKeyDown={(e) => {
                  // Tester-2 F2 (July 16 2026): Enter on the last field just
                  // dismisses the keyboard; it does NOT commit.
                  if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                }} />
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

      <SkillsCard skills={skills} loggedDrills={loggedDrillNames} accuracyAvailable={accuracyAvailable}
        open={open} onScrollToAccuracy={scrollToAccuracy}
        onNew={() => setSkillSheet('new')} onEdit={(a) => setSkillSheet(a)} />

      <TrendsCard sessions={sessions} matches={matches} firearms={firearms}
        drills={drills} classifiers={classifiers} malfunctions={malfunctions} open={open} />

      <SpeedAccuracyTrendCard matches={matches} coachingRemarks={coachingRemarks}
        onDisableRemarks={() => void disableRemarks()} />

      <HeatmapCard sessions={sessions} />

      {editing && (
        <GoalEditSheet goal={editing} categories={filterHidden(cats, hiddenSuggestions, 'goal-categories')}
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

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Per-month totals over the heatmap grid — the coarse, phone-friendly readout
 *  (a whole month is a real 44pt tap target; a single ~11px day square isn't).
 *  Only real (in-range) days count; oldest→newest. */
function monthSummaries(grid: { date: string; sessions: number; rounds: number; inRange: boolean }[][]): {
  ym: string; label: string; sessions: number; rounds: number;
}[] {
  const map = new Map<string, { sessions: number; rounds: number }>();
  for (const col of grid) for (const c of col) {
    if (!c.inRange) continue;
    const ym = c.date.slice(0, 7);
    const cur = map.get(ym) ?? { sessions: 0, rounds: 0 };
    cur.sessions += c.sessions; cur.rounds += c.rounds;
    map.set(ym, cur);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ym, v]) => ({
      ym, label: `${MONTH_ABBR[Number(ym.slice(5, 7)) - 1]} '${ym.slice(2, 4)}`,
      sessions: v.sessions, rounds: v.rounds,
    }));
}

function HeatmapCard({ sessions }: { sessions: Session[] }) {
  const [weeks, setWeeks] = useState(26);
  // Audit #20: tapping a day shows its count here — the SVG <title> only worked
  // on desktop hover, so on a phone the "press a square" help did nothing.
  const [selText, setSelText] = useState<string | null>(null);
  // A4 (batch 2): at PHONE width the day squares render ~11px (26wk) to ~5px
  // (52wk) — a quarter of the 44pt tap minimum, so per-cell tapping was never an
  // honest target there. On phone the grid is DISPLAY-ONLY and the readout moves
  // to a coarser grain: tap a MONTH below (a real 44pt target) for its totals.
  // Desktop keeps the per-cell tap (a pointer hits a 12px square fine). Evaluated
  // once at mount; the same ≥900px breakpoint the app uses for its nav switch.
  const [isPhone] = useState(
    () => typeof window !== 'undefined' &&
      !window.matchMedia('(min-width: 900px) and (min-height: 500px)').matches
  );
  const [selMonth, setSelMonth] = useState<string | null>(null);
  // Desktop only: tapping a day opens that day's Session Report (Michael, July 8
  // 2026); the checkbox opts into the quieter "just show the count" behaviour.
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
  const months = isPhone ? monthSummaries(grid) : [];
  function tapMonth(mo: { ym: string; label: string; sessions: number; rounds: number }) {
    setSelMonth(mo.ym);
    setSelText(`${mo.label}: ${mo.sessions} session${mo.sessions !== 1 ? 's' : ''}, ${mo.rounds.toLocaleString()} rounds`);
  }
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
      <h2>Training grid <InfoTip title="Training grid">Each square is a day — darker means more rounds, with the months labeled along the bottom. Switch between the last 26 or 52 weeks. On a phone the squares are too small to tap one by one, so the grid is just to look at — tap a month below it for that month's totals. On a bigger screen, tap a square to open that day's session report — drills, notes, and target photos on one page (the checkbox switches to just showing the count). To change a session, open it from the Log tab.</InfoTip></h2>
      <div className="chart-filters">
        <select aria-label="Training grid weeks"
          value={weeks}
          onChange={(e) => {
            setWeeks(Number(e.target.value));
            // Drop any month readout — it belongs to the OTHER span's grid.
            setSelMonth(null);
            setSelText(null);
          }}>
          <option value={26}>26 weeks</option>
          <option value={52}>52 weeks</option>
        </select>
      </div>
      {!isPhone && (
        <label className="report-note" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 4, minHeight: 'var(--touch-min)' }}>
          <input type="checkbox" checked={showCountOnly} onChange={(e) => setShowCountOnly(e.target.checked)} />
          Just show the day's count, don't open the report
        </label>
      )}
      <svg viewBox={`0 0 ${w} ${h + labelH}`} width="100%" role="img" aria-label="Training activity heatmap"
        style={{ display: 'block', maxWidth: w, marginTop: 4 }}>
        {grid.map((col, ci) => col.map((c, ri) => (
          <rect key={c.date} x={ci * (cell + gap)} y={ri * (cell + gap)} width={cell} height={cell} rx={2}
            fill={c.level === 0 ? 'var(--separator)' : 'var(--accent)'}
            opacity={c.level === 0 ? (c.inRange ? 0.4 : 0.12) : opacities[c.level]}
            // A4: display-only on phone (no per-cell tap — the squares are far
            // under 44pt there); the pointer-friendly per-day tap stays on desktop.
            style={isPhone ? undefined : { cursor: 'pointer' }}
            onClick={isPhone ? undefined : () => tapCell(c)}>
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
      {isPhone && months.length > 0 && (
        <div className="chip-row" role="group" aria-label="Tap a month for its totals" style={{ marginTop: 8, marginBottom: 0 }}>
          {months.map((mo) => (
            <button key={mo.ym} className={`chip ${selMonth === mo.ym ? 'on' : ''}`}
              aria-pressed={selMonth === mo.ym} onClick={() => tapMonth(mo)}>{mo.label}</button>
          ))}
        </div>
      )}
      {selText
        ? <p className="report-note" aria-live="polite">{selText}</p>
        : <p className="report-note">
            {isPhone
              ? `Each square is a day; darker = more rounds. Tap a month above for its totals. Last ${weeks} weeks.`
              : showCountOnly
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
  // visible whenever no OTHER dot is selected, and a tap-readout line beneath.
  // (Session 64, Michael's tap-through: two numbers at once read as stale —
  // while an older dot is selected, the latest-value label steps aside, the
  // Stocks-app scrub manner. Tapping the selected dot again clears it.)
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
  const selIdx = sel != null ? pts.indexOf(sel) : -1;
  const readout = sel
    ? `${formatDayKey(sel.date)} — ${sel.name} — ${(sel.pointsKept * 100).toFixed(1)}% of points kept`
    : null;

  return (
    <div className="card" id="accuracy-across-matches">
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
          <circle className="chart-sel-ring" cx={xAt(selIdx)} cy={yAt(sel.pointsKept * 100)}
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
              onClick={() => setSelMatchId((prev) => (prev === p.matchId ? null : p.matchId))}>
              <title>{`${formatDayKey(p.date)}: ${p.name} — ${(p.pointsKept * 100).toFixed(1)}%`}</title>
            </rect>
          );
        })}
        {/* Card-colored halo (paint-order: stroke) keeps the headline number
            legible where the line passes behind it (live-verify catch, s62).
            The label yields the stage while an OLDER dot is selected — two
            numbers at once read as stale (Michael's catch, s64) — and returns
            on deselect, or when the selected dot IS the latest. */}
        {(sel == null || selIdx === lastIdx) && (
          <text className="chart-last-label" x={xAt(lastIdx)} y={lastLabelY} textAnchor="end"
            fill="var(--text)" fontSize={11} fontWeight={600} fontFamily="inherit"
            stroke="var(--bg-card)" strokeWidth={3.5} strokeLinejoin="round"
            style={{ pointerEvents: 'none', paintOrder: 'stroke' }}>
            {lastV.toFixed(1)}%
          </text>
        )}
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
  // Tester-2 Change-1 (July 16 2026): the dry/live ratio compares SESSION counts
  // (dry-fire sessions per live session) — firm units on both sides — not
  // reps-per-round. Counted through the shared Home-tile definition so the two
  // surfaces agree; scoped to this card's span and gun/category filter.
  const { liveSessions, drySessions } = sessionRatioCounts(sessions, since, filter, firearms);
  const divisions = allClassifications(classifiers);
  const prs = personalRecords(sessions, drills).filter((p) => p.best).slice(0, 8);
  const anyRounds = totals.live + totals.match + totals.dry > 0;

  return (
    <div className="card">
      <h2>Trends <InfoTip title="Trends">Your rounds and reps over the span you pick. "Dry : live sessions" is how many dry-fire sessions you log for every live session — matches aren't counted here. "Malfunctions / 1,000" is your stoppage rate. Filter by gun or gun type. Tap a bar for that month's exact numbers.</InfoTip></h2>
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

      <div className="row"><span className="label">Live + match rounds (last {months} mo)</span><span className="value">{totals.liveAndMatch.toLocaleString()}</span></div>
      <div className="row"><span className="label">Dry-fire reps (last {months} mo)</span><span className="value">{totals.dry.toLocaleString()}</span></div>
      <div className="row">
        <span className="label">Dry : live sessions (last {months} mo)</span>
        <span className="value">{liveSessions > 0 ? `${(drySessions / liveSessions).toFixed(1)} : 1` : '—'}</span>
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

function SkillsCard({ skills, loggedDrills, accuracyAvailable, open, onScrollToAccuracy, onNew, onEdit }: {
  skills: SkillAssessment[];
  loggedDrills: Set<string>;
  accuracyAvailable: boolean;
  open: (v: View) => void;
  onScrollToAccuracy: () => void;
  onNew: () => void;
  onEdit: (a: SkillAssessment) => void;
}) {
  const latest = latestAssessment(skills);
  const history = [...assessmentsByDate(skills)].reverse(); // newest first
  // F7: which area's self-rating trend is on screen (a picker, one chart at a
  // time — eight charts at once would bury the card).
  const [trendSkill, setTrendSkill] = useState('draw');
  // The two-drill case (Transitions): tapping "Measured" opens a small picker.
  const [pickDrills, setPickDrills] = useState<string[] | null>(null);

  // Open a skill's MEASURED evidence: a drill's history, a small picker when two
  // drills back it, or the "Accuracy across matches" card for accuracy.
  function openEvidence(ev: { kind: 'drills'; drills: string[] } | { kind: 'accuracy' }) {
    if (ev.kind === 'accuracy') { onScrollToAccuracy(); return; }
    if (ev.drills.length === 1) { open({ kind: 'drill-history', name: ev.drills[0] }); return; }
    setPickDrills(ev.drills);
  }

  return (
    <div className="card">
      <h2>Skills Check <InfoTip title="Skills Check">Rate yourself 1–10 in eight areas now and then. You'll see your latest scores, your average, and every check you've saved. Where a timer can back it up, a "Measured" link takes you to the numbers — your rating is your opinion, the drill trend is the timer's.</InfoTip></h2>
      <button className="button secondary" onClick={onNew}>+ New Check</button>
      {!latest && (
        <p className="report-note">Rate yourself 1–10 across the 8 areas now and then to see your trend.</p>
      )}
      {latest && (
        <>
          <p className="report-note">Latest — {formatDayKey(latest.date)}
            {assessmentAverage(latest.ratings) != null ? ` · avg ${assessmentAverage(latest.ratings)!.toFixed(1)}` : ''}</p>
          {SKILL_AREAS.map((a) => {
            const ev = resolveSkillEvidence(a.key, loggedDrills, accuracyAvailable);
            return (
              <div className="row" key={a.key}>
                <span className="label">{a.label}</span>
                <span className="value">{latest.ratings[a.key] ? `${latest.ratings[a.key]} / 10` : '—'}</span>
                {ev && (
                  <button className="link-btn" style={{ marginLeft: 8, flexShrink: 0 }}
                    aria-label={`See the measured evidence for ${a.label}`}
                    onClick={() => openEvidence(ev)}>Measured ›</button>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* F7: the self-rating TREND — your opinion over time, kept visibly apart
          from the measured charts (dashed, dim line; see RatingsTrend). One area
          at a time, picked below. */}
      {skills.length >= 2 && (
        <>
          <h2 style={{ marginTop: 12 }}>Rating trends <InfoTip title="Rating trends">How you've scored yourself in one area over your checks. These are your own ratings — your opinion. The measured trend is the timer's: open an area's "Measured" link above to see it.</InfoTip></h2>
          <div className="chip-row" role="group" aria-label="Pick an area for its rating trend">
            {SKILL_AREAS.map((a) => (
              <button key={a.key} className={`chip ${trendSkill === a.key ? 'on' : ''}`}
                aria-pressed={trendSkill === a.key} onClick={() => setTrendSkill(a.key)}>{a.label}</button>
            ))}
          </div>
          {/* key={trendSkill} remounts on an area switch, so a selection (ring +
              readout) from one area never lingers onto the next. */}
          <RatingsTrend key={trendSkill} series={skillRatingSeries(skills, trendSkill)}
            label={SKILL_AREAS.find((a) => a.key === trendSkill)?.label ?? ''} />
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

      {pickDrills && (
        <Sheet title="Measured evidence" onClose={() => setPickDrills(null)}>
          <p className="report-note" style={{ marginTop: 0 }}>Two drills track this — open one:</p>
          {pickDrills.map((name) => (
            <button key={name} className="drill-pick-row"
              onClick={() => { setPickDrills(null); open({ kind: 'drill-history', name }); }}>
              <strong>{name}</strong>
              <span>See your logged runs and trend.</span>
            </button>
          ))}
        </Sheet>
      )}
    </div>
  );
}

/**
 * F7: one area's SELF-RATINGS over dated checks — the shooter's own opinion, not
 * a measurement. Built on the same F4 chart furniture as the drill/accuracy
 * trends (y ticks, date anchors, tap-readout, selection ring, last-value label
 * that yields while an older dot is selected), but drawn DASHED and dim on
 * purpose so it never reads as a measured line. Fixed 1–10 y-axis. Fewer than two
 * checks falls back to the standard "log at least two…" note.
 */
function RatingsTrend({ series, label }: { series: { date: string; rating: number }[]; label: string }) {
  const [selIdx, setSelIdx] = useState<number | null>(null);
  if (series.length < 2) {
    // Honest condition: the shortfall is checks that RATED THIS AREA, which can
    // be fewer than the total number of checks saved.
    return <p className="report-note">Rate your {label} in at least two checks to see how it's moved.</p>;
  }
  const w = 280, h = 138, padR = 12, padL = 30, padT = 14, padB = 20;
  const loY = 1, hiY = 10, domain = hiY - loY;
  const stepX = (w - padL - padR) / (series.length - 1);
  const xAt = (i: number) => padL + i * stepX;
  const yAt = (v: number) => padT + (1 - (v - loY) / domain) * (h - padT - padB);
  const line = series.map((p, i) => `${xAt(i)},${yAt(p.rating)}`).join(' ');
  const mode = dateMode(series[0].date, series[series.length - 1].date);
  const dateIdxs = thinIndices(series.length, 4);
  const lastIdx = series.length - 1;
  const lastV = series[lastIdx].rating;
  const lastLabelY = yAt(lastV) < padT + 14 ? yAt(lastV) + 14 : yAt(lastV) - 8;
  const sel = selIdx != null && selIdx < series.length ? series[selIdx] : null;
  const readout = sel ? `${formatDayKey(sel.date)} — you rated your ${label} ${sel.rating}/10` : null;

  return (
    <>
      <p className="report-note" style={{ marginTop: 0 }}>
        Your self-ratings — how you scored your own {label}, 1–10, at each check.
      </p>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block', marginTop: 4 }}
        role="img" aria-label={`Your own ${label} self-ratings across ${series.length} checks, on a 1 to 10 scale, oldest to newest`}>
        {[hiY, (hiY + loY) / 2, loY].map((gv, k) => (
          <g key={k}>
            <line x1={padL} y1={yAt(gv)} x2={w - padR} y2={yAt(gv)} stroke="var(--separator)" strokeWidth={0.5} />
            <text className="chart-tick" x={padL - 4} y={yAt(gv) + 3} fontSize={10} fill="var(--text-dim)" textAnchor="end">
              {gv}
            </text>
          </g>
        ))}
        {dateIdxs.map((i) => (
          <text className="chart-date" key={`d-${i}`} x={xAt(i)} y={h - 6}
            textAnchor={i === 0 ? 'start' : i === lastIdx ? 'end' : 'middle'}
            fill="var(--text-dim)" fontSize={10} fontFamily="inherit">
            {chartDateLabel(series[i].date, mode)}
          </text>
        ))}
        {/* Dashed, dim ink — visibly an opinion line, NOT one of the accent
            measurement lines the drill/accuracy charts use. */}
        <polyline points={line} fill="none" stroke="var(--text-dim)" strokeWidth={1.5}
          strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />
        {series.map((p, i) => (
          <circle key={i} cx={xAt(i)} cy={yAt(p.rating)} r={2.5} fill="var(--text-dim)" />
        ))}
        {sel != null && selIdx != null && (
          <circle className="chart-sel-ring" cx={xAt(selIdx)} cy={yAt(sel.rating)} r={6.5}
            fill="none" stroke="var(--accent)" strokeWidth={1.75} style={{ pointerEvents: 'none' }} />
        )}
        {series.map((p, i) => {
          const left = i === 0 ? 0 : (xAt(i - 1) + xAt(i)) / 2;
          const right = i === lastIdx ? w : (xAt(i) + xAt(i + 1)) / 2;
          return (
            <rect className="chart-hit" key={`hit-${i}`} x={left} y={0} width={right - left} height={h}
              fill="transparent" style={{ cursor: 'pointer' }}
              onClick={() => setSelIdx((prev) => (prev === i ? null : i))}>
              <title>{`${formatDayKey(p.date)}: ${p.rating}/10`}</title>
            </rect>
          );
        })}
        {(sel == null || selIdx === lastIdx) && (
          <text className="chart-last-label" x={xAt(lastIdx)} y={lastLabelY} textAnchor="end"
            fill="var(--text)" fontSize={11} fontWeight={600} fontFamily="inherit"
            stroke="var(--bg-card)" strokeWidth={3.5} strokeLinejoin="round"
            style={{ pointerEvents: 'none', paintOrder: 'stroke' }}>
            {lastV}/10
          </text>
        )}
      </svg>
      <ChartReadout value={readout} hint="Tap a dot to see that check's date and score." />
    </>
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
  // F-Universal-Guard: sheet dismiss gestures ask "Discard changes?" when dirty.
  const dirty = useDirtyTracker({ date, ratings, notes });

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

  // Save-from-guard: valid only when at least one rating area is set.
  const hasRating = Object.values(ratings).some((v) => v !== '');
  const onSaveRequest = (dirty && hasRating) ? () => void save() : undefined;

  return (
    <Sheet title={assessment ? 'Edit Check' : 'New Check'} onClose={onClose} dirty={dirty}
      onSaveRequest={onSaveRequest}>
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
  // F-Universal-Guard: the Sheet's own dismiss gestures (backdrop tap, Esc, X)
  // ask "Discard changes?" when this snapshot no longer matches the initial one.
  const dirty = useDirtyTracker({ text, category, target });

  async function save() {
    if (!text.trim()) { setProblem('Enter the goal before saving.'); return; }
    await putOne('goals', stampUpdate({ ...goal, text: text.trim(), category: category.trim(), target: target.trim() }, Date.now()));
    onSaved();
  }

  async function reallyDelete() {
    await deleteOne('goals', goal.id);
    onSaved();
  }

  // Save-from-guard: valid only when the goal text is non-empty.
  const onSaveRequest = (dirty && !!text.trim()) ? () => void save() : undefined;

  return (
    <Sheet title="Edit Goal" onClose={onClose} dirty={dirty} onSaveRequest={onSaveRequest}>
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
