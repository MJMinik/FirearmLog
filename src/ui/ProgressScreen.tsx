// Progress tab (spec §10): goals, skill ratings, trends, heatmap. Built up
// across the M7 batches; this batch adds Goals (req 26 — create several in a
// row without leaving the page, editable anytime).
import { useEffect, useState } from 'react';
import type {
  Classifier, DrillDef, Firearm, Goal, GunCategory, MalfunctionEntry, Match, Session, SkillAssessment
} from '../lib/types.ts';
import { GUN_CATEGORIES } from '../lib/types.ts';
import { deleteOne, getAll, putOne } from '../lib/db.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { formatDayKey, todayKey } from '../lib/dates.ts';
import { goalCategories, goalStats, sortGoals } from '../lib/goals.ts';
import { SKILL_AREAS, assessmentAverage, assessmentsByDate, latestAssessment } from '../lib/skills.ts';
import {
  allClassifications, formatDrillScore, personalRecords, roundsByMonth, type RoundsFilter
} from '../lib/dashboard.ts';
import { bucketTotals, malfunctionsInRange, ratePerThousand, spanStartDate } from '../lib/trends.ts';
import { buildHeatmap } from '../lib/heatmap.ts';
import { RoundsByMonthChart } from './screens.tsx';
import { SuggestField, noAutofillProps } from './SuggestField.tsx';
import { ConfirmSheet, Sheet } from './Sheet.tsx';

export function ProgressScreen({ refreshKey }: { refreshKey: number }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [skills, setSkills] = useState<SkillAssessment[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [drills, setDrills] = useState<DrillDef[]>([]);
  const [classifiers, setClassifiers] = useState<Classifier[]>([]);
  const [malfunctions, setMalfunctions] = useState<MalfunctionEntry[]>([]);
  const [bump, setBump] = useState(0);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const [target, setTarget] = useState('');
  const [editing, setEditing] = useState<Goal | null>(null);
  const [skillSheet, setSkillSheet] = useState<SkillAssessment | 'new' | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [g, s, se, m, f, d, c, mf] = await Promise.all([
        getAll<Goal>('goals'), getAll<SkillAssessment>('skills'), getAll<Session>('sessions'),
        getAll<Match>('matches'), getAll<Firearm>('firearms'), getAll<DrillDef>('drills'),
        getAll<Classifier>('classifiers'), getAll<MalfunctionEntry>('malfunctions')
      ]);
      if (!alive) return;
      setGoals(sortGoals(g)); setSkills(s); setSessions(se); setMatches(m);
      setFirearms(f); setDrills(d); setClassifiers(c); setMalfunctions(mf);
    })();
    return () => { alive = false; };
  }, [refreshKey, bump]);

  async function addGoal() {
    if (!text.trim()) return;
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

  const stats = goalStats(goals);
  const cats = goalCategories(goals);

  return (
    <div className="screen">
      <h1 className="large-title">Progress</h1>

      <div className="card">
        <h2>Goals</h2>
        {stats.total > 0 && (
          <p className="report-note">{stats.open} open · {stats.achieved} achieved</p>
        )}

        {adding ? (
          <div className="goal-add">
            <label className="field">Goal
              <input value={text} {...noAutofillProps} name="fl-goal-text" autoFocus
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
        {goals.map((g) => (
          <div className="goal-row" key={g.id}>
            <label className="checklist-take" style={{ flex: 1 }}>
              <input type="checkbox" checked={g.achieved} onChange={() => void toggleAchieved(g)} />
              <span style={g.achieved ? { textDecoration: 'line-through', color: 'var(--text-dim)' } : undefined}>
                {g.text}
                {(g.category || g.target) && (
                  <div className="row-sub">{[g.category, g.target].filter(Boolean).join(' · ')}</div>
                )}
                {g.achieved && g.dateAchieved && (
                  <div className="row-sub">Achieved {formatDayKey(g.dateAchieved)}</div>
                )}
              </span>
            </label>
            <button className="icon-btn" aria-label={`Edit ${g.text}`} onClick={() => setEditing(g)}>✎</button>
          </div>
        ))}
      </div>

      <SkillsCard skills={skills} onNew={() => setSkillSheet('new')} onEdit={(a) => setSkillSheet(a)} />

      <TrendsCard sessions={sessions} matches={matches} firearms={firearms}
        drills={drills} classifiers={classifiers} malfunctions={malfunctions} />

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

function HeatmapCard({ sessions }: { sessions: Session[] }) {
  const [weeks, setWeeks] = useState(26);
  const grid = buildHeatmap(sessions, weeks, new Date());
  const cell = 12, gap = 3, rows = 7;
  const w = grid.length * (cell + gap) - gap;
  const h = rows * (cell + gap) - gap;
  const opacities = [0, 0.3, 0.5, 0.75, 1];
  return (
    <div className="card">
      <h2>Training Heatmap</h2>
      <div className="chart-filters">
        <select aria-label="Heatmap weeks" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
          <option value={26}>26 weeks</option>
          <option value={52}>52 weeks</option>
        </select>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label="Training activity heatmap"
        style={{ display: 'block', maxWidth: w, marginTop: 4 }}>
        {grid.map((col, ci) => col.map((c, ri) => (
          <rect key={c.date} x={ci * (cell + gap)} y={ri * (cell + gap)} width={cell} height={cell} rx={2}
            fill={c.level === 0 ? 'var(--separator)' : 'var(--accent)'}
            opacity={c.level === 0 ? (c.inRange ? 0.4 : 0.12) : opacities[c.level]}>
            <title>{`${c.date}: ${c.sessions} session${c.sessions !== 1 ? 's' : ''}, ${c.rounds.toLocaleString()} rounds`}</title>
          </rect>
        )))}
      </svg>
      <p className="report-note">Each square is a day; darker = more rounds. Last {weeks} weeks.</p>
    </div>
  );
}

function TrendsCard({ sessions, matches, firearms, drills, classifiers, malfunctions }: {
  sessions: Session[]; matches: Match[]; firearms: Firearm[];
  drills: DrillDef[]; classifiers: Classifier[]; malfunctions: MalfunctionEntry[];
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
      <h2>Trends</h2>
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
            <div className="pr-row" key={p.name}>
              <div>
                <div className="label">{p.name}</div>
                <div className="row-sub">{p.attempts} attempt{p.attempts !== 1 ? 's' : ''}</div>
              </div>
              <div className="value">{formatDrillScore(p.best, p.scoring)}</div>
            </div>
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
      <h2>Skill Self-Assessment</h2>
      <button className="button secondary" onClick={onNew}>+ New Assessment</button>
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
    for (const a of SKILL_AREAS) r[a.key] = assessment?.ratings[a.key] ? String(assessment.ratings[a.key]) : '5';
    return r;
  });
  const [notes, setNotes] = useState(assessment?.notes || '');
  const [confirming, setConfirming] = useState(false);

  async function save() {
    const r: Record<string, number> = {};
    for (const a of SKILL_AREAS) {
      const v = Number(ratings[a.key]);
      if (Number.isFinite(v) && v > 0) r[a.key] = v;
    }
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
    <Sheet title={assessment ? 'Edit Assessment' : 'New Assessment'} onClose={onClose}>
      <label className="field">Date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {SKILL_AREAS.map((a) => (
        <div className="row" key={a.key}>
          <span className="label">{a.label}</span>
          <select className="category-pick" aria-label={a.label} value={ratings[a.key]}
            onChange={(e) => setRatings((prev) => ({ ...prev, [a.key]: e.target.value }))}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      ))}
      <label className="field">Notes
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <button className="button" onClick={() => void save()}>{assessment ? 'Save Changes' : 'Save Assessment'}</button>
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

  async function save() {
    if (!text.trim()) return;
    await putOne('goals', stampUpdate({ ...goal, text: text.trim(), category: category.trim(), target: target.trim() }, Date.now()));
    onSaved();
  }

  async function reallyDelete() {
    await deleteOne('goals', goal.id);
    onSaved();
  }

  return (
    <Sheet title="Edit Goal" onClose={onClose}>
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
      <button className="button" onClick={() => void save()}>Save Changes</button>
      <button className="button danger" style={{ marginTop: 8 }} onClick={() => setConfirming(true)}>Delete Goal</button>
      {confirming && (
        <ConfirmSheet title="Delete this goal?" message="There's no undo."
          confirmLabel="Delete Goal" onConfirm={() => void reallyDelete()} onClose={() => setConfirming(false)} />
      )}
    </Sheet>
  );
}
