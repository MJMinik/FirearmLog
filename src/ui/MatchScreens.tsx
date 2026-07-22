// Match logging (spec §11): the full match record with stage-by-stage entry,
// auto hit factors, stage videos, entry fee, and PractiScore link.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, Firearm, Match, MatchStage, Media } from '../lib/types.ts';
import { deleteOne, getAll, getOne, getSettings, putOne, putSettings } from '../lib/db.ts';
import { formatDayKey, todayKey } from '../lib/dates.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { DIVISIONS, IDPA_DIVISIONS, STEEL_DIVISIONS, MATCH_TYPES, POWER_FACTORS, hitFactor, analyzeMatch, scoreStageHits, hasHitBreakdown,
  scoringTypeFor, scoreSteelStage, steelMatchTotal, steelStringsExpected, STEEL_STAGES,
  scoreIdpaStage, idpaMatchTotal, reconcileTime, matchSpeedAccuracy, matchWhatItCost, coachingRead } from '../lib/competition.ts';
import type { SpeedAccuracy, WhatItCost } from '../lib/competition.ts';
import { MarkThumb } from './MarkThumb.tsx';
import { InfoTip } from './InfoTip.tsx';
import { Reveal } from './Reveal.tsx';
import { Stepper } from './Stepper.tsx';
import type { View } from './nav.ts';
import { ConfirmSheet, DiscardChangesSheet } from './Sheet.tsx';
import { PhotoSheet } from './PhotoSheet.tsx';
import { MediaField, commitMedia } from './MediaField.tsx';
import type { StagedFile } from './MediaField.tsx';
import { noAutofillProps } from './SuggestField.tsx';
import { FieldProblem, type SaveProblem } from './FieldProblem.tsx';
import { NotFound } from './NotFound.tsx';
import { ScreenError, ScreenLoading } from './ScreenState.tsx';
import { Icon } from './Icon.tsx';
import { pickableGuns } from '../lib/gunStatus.ts';

/** Format a stage's ranking metric for the debrief read-out. */
function fmtMetric(s: { percent: number | null; hitFactor: number | null }, by: 'percent' | 'hitFactor' | 'none'): string {
  if (by === 'percent' && s.percent !== null) return `${s.percent}%`;
  if (by === 'hitFactor' && s.hitFactor !== null) return `HF ${s.hitFactor}`;
  return '--';
}

/**
 * The descriptive "Speed & Accuracy" read on the match debrief. Two dimensions kept
 * SEPARATE (the sport has no single blended number) from data we already compute. The
 * over-accuracy nudge is a reversible question and only shows when coaching remarks are on.
 */
function SpeedAccuracyCard({ sa, coachingRemarks, onDisableRemarks }: {
  sa: SpeedAccuracy; coachingRemarks: boolean; onDisableRemarks: () => void;
}) {
  const nudge = sa.discipline !== 'steel' && sa.overAccuracy && coachingRemarks ? (
    <p className="report-note" style={{ marginTop: 8 }}>
      You kept almost all your points -- on the closer targets, was there room to push the pace?{' '}
      <button className="link-btn" onClick={onDisableRemarks}>Turn off (Settings)</button>
    </p>
  ) : null;

  if (sa.discipline === 'uspsa') {
    const errors = [
      sa.misses ? `${sa.misses} miss${sa.misses > 1 ? 'es' : ''}` : null,
      sa.noShoots ? `${sa.noShoots} no-shoot${sa.noShoots > 1 ? 's' : ''}` : null,
      sa.procedurals ? `${sa.procedurals} procedural${sa.procedurals > 1 ? 's' : ''}` : null,
    ].filter(Boolean).join(', ');
    return (
      <div className="card">
        <h2>Speed &amp; Accuracy <InfoTip title="Speed & Accuracy">Two things, kept separate -- the sport has no single "speed vs accuracy" number. Accuracy is the share of the available points you kept; a miss counts against it, while no-shoots and procedurals are separate errors. One match is a small sample, so read it as this match -- the real signal is the trend across matches.</InfoTip></h2>
        <p className="report-note" style={{ marginTop: 0 }}>
          Accuracy: you kept <strong>{Math.round(sa.pointsKept * 100)}%</strong> of your points ({sa.pointsDown} down)
          {sa.stagesUsed < sa.stagesTotal ? ` -- from ${sa.stagesUsed} of ${sa.stagesTotal} stages` : ''}.
          {errors ? ` Errors: ${errors}.` : ''}
        </p>
        {nudge}
      </div>
    );
  }
  if (sa.discipline === 'idpa') {
    return (
      <div className="card">
        <h2>Speed &amp; Accuracy <InfoTip title="Speed & Accuracy">IDPA's time-plus scoring already splits your total into three parts: the raw time (speed), the seconds added by dropped points (1s each -- accuracy), and any penalties. Read it as this match; the real signal is the trend across matches.</InfoTip></h2>
        <p className="report-note" style={{ marginTop: 0 }}>
          Your <strong>{sa.totalTime}s</strong>: <strong>{sa.timeSeconds}s</strong> time · <strong>{sa.downSeconds}s</strong> dropped points
          {sa.penaltySeconds > 0 ? ` · ${sa.penaltySeconds}s penalties` : ''}.
        </p>
        {nudge}
      </div>
    );
  }
  return (
    <div className="card">
      <h2>Speed &amp; Accuracy <InfoTip title="Speed & Accuracy">Steel is a time sport -- accuracy shows up only as missed plates (3 seconds each). There's no points breakdown to weigh against the clock.</InfoTip></h2>
      <p className="report-note" style={{ marginTop: 0 }}>
        {sa.misses > 0
          ? `${sa.misses} missed plate${sa.misses > 1 ? 's' : ''} added ${sa.missSeconds}s.`
          : 'Clean -- no missed plates.'}
      </p>
    </div>
  );
}

/** "2 misses and 1 no-shoot" -- a natural-language list. */
function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/**
 * The "What it cost" card (T3-4): the match-level cost of the day's mistakes, in the
 * shooter's own units -- penalty points and an anchored what-if percent (USPSA),
 * seconds (IDPA, Steel). Renders nothing when the day was clean or nothing is
 * computable. Display math only; clearly framed as a what-if, never a redo.
 */
function WhatItCostCard({ wic }: { wic: WhatItCost }) {
  if (wic.discipline === 'uspsa') {
    const errors = joinAnd([
      wic.misses ? `${wic.misses} miss${wic.misses > 1 ? 'es' : ''}` : null,
      wic.noShoots ? `${wic.noShoots} no-shoot${wic.noShoots > 1 ? 's' : ''}` : null,
      wic.procedurals ? `${wic.procedurals} procedural${wic.procedurals > 1 ? 's' : ''}` : null,
    ].filter((x): x is string => x !== null));
    const hasWhatIf = wic.hypotheticalPercent !== null && wic.actualPercent !== null
      && (wic.exceeds100 || wic.hypotheticalPercent > wic.actualPercent);
    if (wic.penaltyPoints === 0 && !hasWhatIf) return null; // a clean day cost nothing
    return (
      <div className="card">
        <h2>What it cost <InfoTip title="What it cost">Misses, no-shoots, and procedurals are 10-point penalties -- and a missed shot also earns nothing, so its full cost runs a little higher. The what-if replays your same times with every scoring hit an A; no-shoot and procedural penalties stay, because those are separate errors, not accuracy. Your entered stage percents anchor the percent math (your percent plus your hit factor implies the stage winner's pace), so it appears only when every stage has its percent, hit breakdown, and time entered. A what-if, not a redo -- match pressure doesn't replay.</InfoTip></h2>
        <p className="report-note" style={{ marginTop: 0 }}>
          {wic.penaltyPoints > 0
            ? `Your ${errors} cost about ${wic.penaltyPoints} points in penalties`
            : `No penalties -- your ${wic.pointsDown} points down came from C’s and D’s`}
          {wic.stagesUsed < wic.stagesTotal ? ` -- from ${wic.stagesUsed} of ${wic.stagesTotal} stages` : ''}.
          {hasWhatIf ? (wic.exceeds100
            ? ' With every scoring hit an A at your same times, the what-if comes out above 100% -- a clean run at your pace would have outrun the day’s winners -- shown here as 100%.'
            : ` With every scoring hit an A at your same times, this match scores about ${wic.hypotheticalPercent}% instead of ${wic.actualPercent}%.`) : ''}
        </p>
      </div>
    );
  }
  if (wic.discipline === 'idpa') {
    if (wic.costSeconds <= 0) return null;
    const parts = joinAnd([
      wic.downSeconds > 0 ? `dropped points added ${wic.downSeconds}s` : null,
      wic.penaltySeconds > 0 ? `penalties added ${wic.penaltySeconds}s` : null,
    ].filter((x): x is string => x !== null));
    return (
      <div className="card">
        <h2>What it cost <InfoTip title="What it cost">In time-plus scoring the cost is already in seconds: each point down adds 1s, and each penalty adds its fixed seconds. The clean total replays your same raw times with every hit a -0 -- penalties stay, because they're separate errors, not accuracy. A what-if, not a redo.</InfoTip></h2>
        <p className="report-note" style={{ marginTop: 0 }}>
          {parts.charAt(0).toUpperCase() + parts.slice(1)} -- {wic.costSeconds}s of your {wic.totalTime}s total.
          {wic.downSeconds > 0 ? ` With every hit a -0 at your same times, your day is about ${wic.cleanTotal}s.` : ''}
        </p>
      </div>
    );
  }
  // Steel
  if (wic.misses === 0) return null;
  const trueCost = Math.round((wic.totalTime - wic.cleanTotal) * 100) / 100;
  return (
    <div className="card">
      <h2>What it cost <InfoTip title="What it cost">Each missed plate adds 3s to its string. The clean what-if zeroes the misses at your same raw times and re-drops the slowest string -- so a miss on a string you dropped anyway can cost nothing, and a miss that forced a drop can cost less than 3s. A string whose stop plate was never hit stays at the 30s maximum -- its real time is unknown.</InfoTip></h2>
      <p className="report-note" style={{ marginTop: 0 }}>
        {trueCost > 0
          ? `Your ${wic.misses} missed plate${wic.misses > 1 ? 's' : ''} cost ${trueCost}s -- clean at your same times, your match total is about ${wic.cleanTotal}s instead of ${wic.totalTime}s.`
          : `Your ${wic.misses} missed plate${wic.misses > 1 ? 's' : ''} ended up free -- ${wic.misses > 1 ? 'they' : 'it'} landed on dropped strings, so your total didn’t change.`}
      </p>
    </div>
  );
}

export function MatchDetail({ id, onEdit, onBack, onDeleted, refreshKey, open }: {
  id: string; onEdit: () => void; onBack: () => void; onDeleted: () => void; refreshKey: number;
  open: (v: View) => void;
}) {
  const [match, setMatch] = useState<Match | null>(null);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [videos, setVideos] = useState<Media[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [viewing, setViewing] = useState<Media | null>(null);
  const [localBump, setLocalBump] = useState(0);
  const [showReconcile, setShowReconcile] = useState(false);
  const [officialTimes, setOfficialTimes] = useState<string[]>([]);
  const [coachingRemarks, setCoachingRemarks] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setError(false);
    void (async () => {
      try {
        const [m, f, media, settings] = await Promise.all([
          getOne<Match>('matches', id), getAll<Firearm>('firearms'), getAll<Media>('media'),
          getSettings<AppSettings>()
        ]);
        if (!alive) return;
        if (!m) { setNotFound(true); return; }
        setMatch(m);
        setFirearms(f);
        setVideos(media.filter((x) => x.ownerType === 'match' && x.ownerId === id));
        setCoachingRemarks(settings?.coachingRemarks !== false);
      } catch (e) {
        console.error('Match detail load failed', e);
        if (alive) setError(true);
      }
    })();
    return () => { alive = false; };
  }, [id, refreshKey, localBump]);

  if (error) return <ScreenError onRetry={() => setLocalBump((n) => n + 1)} />;
  if (notFound) return <NotFound what="This match no longer exists." onBack={onBack} />;
  if (!match) return <ScreenLoading />;
  const gunName = firearms.find((f) => f.id === match.firearmId)?.name ?? '--';
  const isSteel = match.scoringType === 'steel';
  const isIdpa = match.scoringType === 'idpa';
  const wikiSection = isSteel ? 'steel' : isIdpa ? 'idpa' : 'uspsa'; // deep-link target into the wiki
  const insights = analyzeMatch(match.stages, match.powerFactor);
  const sa = matchSpeedAccuracy(match.stages, match.scoringType ?? 'uspsa', match.powerFactor);
  const wic = matchWhatItCost(match.stages, match.scoringType ?? 'uspsa', match.powerFactor);
  const read = coachingRead(insights, sa);
  const showRead = coachingRemarks && read.length > 0;
  const steelRows = isSteel ? match.stages.map((st) => ({ st, score: scoreSteelStage(st) })) : [];
  const steelTotal = isSteel ? steelMatchTotal(match.stages) : null;
  const idpaRows = isIdpa ? match.stages.map((st) => ({ st, score: scoreIdpaStage(st) })) : [];
  const idpaTotal = isIdpa ? idpaMatchTotal(match.stages) : null;
  // Reconcile-with-official (time-plus sports only): compare our per-stage times to the
  // user's entered official times. Transient/diagnostic -- no db write, no danger zone.
  const oursByStage: (number | null)[] = isSteel ? steelRows.map((r) => r.score.stageTime)
    : isIdpa ? idpaRows.map((r) => r.score.stageTime) : [];
  const ourTotal = isSteel ? steelTotal : isIdpa ? idpaTotal : null;
  const parseNum = (t: string | undefined): number | null => {
    const s = (t ?? '').trim();
    return s === '' ? null : Number(s);
  };
  const allOfficialEntered = oursByStage.length > 0 && oursByStage.every((_, i) => (officialTimes[i] ?? '').trim() !== '');
  const officialTotal = allOfficialEntered
    ? Math.round(oursByStage.reduce<number>((s, _, i) => s + (parseNum(officialTimes[i]) ?? 0), 0) * 100) / 100
    : null;
  const totalReconcile = ourTotal != null && officialTotal != null ? reconcileTime(ourTotal, officialTotal) : null;

  async function reallyDelete() {
    for (const v of videos) await deleteOne('media', v.id);
    await deleteOne('matches', id);
    onDeleted();
  }

  async function disableRemarks() {
    setCoachingRemarks(false); // optimistic; re-enable in Settings
    await putSettings<AppSettings>({ coachingRemarks: false });
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
        <button className="navbar-action" onClick={onEdit}>Edit</button>
      </div>
      <h1 className="large-title">{match.name || formatDayKey(match.date)}</h1>

      {(match.matchPercent != null || match.divisionPlace != null) && (
        <div className="card">
          <div className="stat-grid">
            {match.divisionPlace != null && (
              <div className="stat">
                <div className="num">{match.divisionPlace}{match.divisionOf != null ? ` of ${match.divisionOf}` : ''}</div>
                <div className="cap">{match.division || 'Division'} finish</div>
              </div>
            )}
            {match.matchPercent != null && (
              <div className="stat">
                <div className="num" style={{ color: 'var(--accent-ink)' }}>{match.matchPercent}%</div>
                <div className="cap">Match percent</div>
              </div>
            )}
          </div>
        </div>
      )}

      {showRead && (
        <div className="card">
          <h2>Coaching read <InfoTip title="Coaching read">The debrief, said in one place: the stage whose mistakes cost the most (in penalty points -- a missed shot also earns nothing, so its full cost runs a little higher), the points you kept, and -- when the run was very clean -- the pace question. Assembled from this match's numbers. Questions, not verdicts, and one match is a small sample -- the real signal is the trend.</InfoTip></h2>
          <p className="report-note" style={{ marginTop: 0 }}>{read.join(' ')}</p>
          <button className="link-btn" onClick={() => void disableRemarks()}>Turn off (Settings)</button>
        </div>
      )}

      <div className="card">
        <h2>Match</h2>
        <div className="row"><span className="label">Date</span><span className="value">{formatDayKey(match.date)}</span></div>
        <div className="row"><span className="label">Type</span><span className="value">{match.matchType}</span></div>
        <div className="row"><span className="label">Division</span><span className="value">{match.division}{!isSteel && !isIdpa && match.powerFactor ? ` · ${match.powerFactor}` : ''}</span></div>
        <div className="row"><span className="label">Gun</span><span className="value">{gunName}</span></div>
        {match.totalRounds != null && <div className="row"><span className="label">Rounds fired</span><span className="value">{match.totalRounds.toLocaleString()}</span></div>}
        {match.matchPercent != null && <div className="row"><span className="label">Match percent</span><span className="value">{match.matchPercent}%</span></div>}
        {match.divisionPlace != null && (
          <div className="row"><span className="label">Division finish</span>
            <span className="value">{match.divisionPlace}{match.divisionOf ? ` of ${match.divisionOf}` : ''}</span></div>
        )}
        {match.overallPlace != null && (
          <div className="row"><span className="label">Overall finish</span>
            <span className="value">{match.overallPlace}{match.overallOf ? ` of ${match.overallOf}` : ''}</span></div>
        )}
        {match.entryFee != null && <div className="row"><span className="label">Entry fee</span><span className="value">${match.entryFee.toFixed(2)}</span></div>}
        {match.practiScoreUrl && (
          <a className="row-tap" href={match.practiScoreUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            <span className="label" style={{ color: 'var(--accent-ink)' }}>Results on PractiScore</span>
            <span className="value"><Icon name="external" size={16} /></span>
          </a>
        )}
      </div>

      {sa && <SpeedAccuracyCard sa={sa} coachingRemarks={coachingRemarks && !showRead}
        onDisableRemarks={() => void disableRemarks()} />}

      {wic && <WhatItCostCard wic={wic} />}

      {match.stages.length > 0 && !isSteel && !isIdpa && (
        <div className="card">
          <h2>Stage breakdown <InfoTip title="Stage breakdown">Hit factor is your points divided by your time (higher is better). Stage percent is your score against the stage winner. We flag your toughest stage -- where you lost the most ground -- and your strongest. Add a stage's A/C/D/miss breakdown (when you log or edit the match) and we'll show what it would have scored with all A's, plus your % of available points.</InfoTip></h2>
          <button className="link-btn" style={{ marginTop: -2, marginBottom: 8 }} onClick={() => open({ kind: 'numbers', section: wikiSection })}>How the numbers work ›</button>
          {insights.rankedBy !== 'none' && insights.strongest && insights.toughest.length > 0 && (
            <p className="report-note" style={{ marginTop: 0, marginBottom: 10 }}>
              Toughest: {insights.toughest.map((s) => `Stage ${s.number} (${fmtMetric(s, insights.rankedBy)})`).join(', ')}.{' '}
              Strongest: Stage {insights.strongest.number} ({fmtMetric(insights.strongest, insights.rankedBy)}).
            </p>
          )}
          {insights.stages.map((st, i) => (
            <div className="row" key={i}>
              <span className="label">
                Stage {st.number}
                {st.isToughest && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>Toughest</span>}
                {st.isStrongest && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: 'var(--accent-ink)' }}>Strongest</span>}
                {st.notes && <div className="row-sub">{st.notes}</div>}
                {st.score && (
                  <div className="row-sub">
                    A {st.score.alphas} · C {st.score.charlies} · D {st.score.deltas} · M {st.score.misses}
                    {(st.score.noShoots > 0 || st.score.procedurals > 0) ? ` · NS ${st.score.noShoots} · P ${st.score.procedurals}` : ''}
                    {st.score.allAlphaDelta != null && st.score.allAlphaDelta > 0 ? ` -- all A's ${st.score.allAlphaHitFactor} (+${st.score.allAlphaDelta})` : ''}
                    {st.score.pctAvailable != null ? ` -- ${Math.round(st.score.pctAvailable * 100)}% of points` : ''}
                  </div>
                )}
              </span>
              <span className="value">
                {[(st.score ? st.score.stagePoints : st.points) !== null ? `${st.score ? st.score.stagePoints : st.points} pts` : null,
                  st.time !== null ? `${st.time}s` : null,
                  st.hitFactor !== null ? `HF ${st.hitFactor}` : null,
                  st.percent !== null ? `${st.percent}%` : null].filter(Boolean).join(' · ') || '--'}
              </span>
            </div>
          ))}
        </div>
      )}

      {match.stages.length > 0 && isSteel && (
        <div className="card">
          <h2>Stage times <InfoTip title="Steel Challenge scoring">Steel is scored on time -- lowest wins. Each string is your raw time plus 3 seconds for every missed plate, capped at 30 seconds (a string whose stop plate you never hit scores the full 30). A stage keeps your best 4 of 5 strings -- the single slowest is dropped -- and Outer Limits keeps your best 3 of 4 (the slowest is still dropped). Your match total is the sum of your stage times. Full details in "How the numbers work."</InfoTip></h2>
          <button className="link-btn" style={{ marginTop: -2, marginBottom: 8 }} onClick={() => open({ kind: 'numbers', section: wikiSection })}>How the numbers work ›</button>
          {steelTotal != null && (
            <div className="row">
              <span className="label"><strong>Match total</strong><span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>lowest wins</span></span>
              <span className="value" style={{ color: 'var(--accent-ink)' }}><strong>{steelTotal}s</strong></span>
            </div>
          )}
          {steelRows.map(({ st, score }, i) => (
            <div className="row" key={i}>
              <span className="label">
                Stage {st.number}{st.steelStage ? ` -- ${st.steelStage}` : ''}
                {st.notes && <div className="row-sub">{st.notes}</div>}
                {score.stageTime != null && score.droppedIndex != null && (
                  <div className="row-sub">Dropped the slowest string (String {score.droppedIndex + 1})</div>
                )}
                {score.strings.some((s) => s.capped !== null) && (
                  <div className="row-sub">
                    {score.strings.map((s, n) => s.capped === null ? null :
                      `S${n + 1} ${s.stopMissed ? '30.00 (stop plate missed)' : (s.capped as number).toFixed(2) + (s.misses > 0 ? ` (+${s.misses} miss)` : '')}`
                    ).filter(Boolean).join(' · ')}
                  </div>
                )}
              </span>
              <span className="value">{score.stageTime != null ? `${score.stageTime}s` : '--'}</span>
            </div>
          ))}
        </div>
      )}

      {match.stages.length > 0 && isIdpa && (
        <div className="card">
          <h2>Stage times <InfoTip title="IDPA scoring">IDPA is time-plus -- lowest total wins. Your stage score is your raw time, plus 1 second for each point down (a -1 is 1, a -3 is 3, a miss is 5), plus penalties: a hit on a non-threat is 5s, a procedural is 3s, a flagrant is 10s, and a failure to do right is 20s. Full math and the exact rules are in "How the numbers work."</InfoTip></h2>
          <button className="link-btn" style={{ marginTop: -2, marginBottom: 8 }} onClick={() => open({ kind: 'numbers', section: wikiSection })}>How the numbers work ›</button>
          {idpaTotal != null && (
            <div className="row">
              <span className="label"><strong>Match total</strong><span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>lowest wins</span></span>
              <span className="value" style={{ color: 'var(--accent-ink)' }}><strong>{idpaTotal}s</strong></span>
            </div>
          )}
          {idpaRows.map(({ st, score }, i) => (
            <div className="row" key={i}>
              <span className="label">
                Stage {st.number}
                {st.notes && <div className="row-sub">{st.notes}</div>}
                {score.rawTime != null && (
                  <div className="row-sub">
                    {score.rawTime}s raw
                    {score.pointsDown > 0 ? ` · ${score.pointsDown} down (+${score.accuracySeconds}s)` : ' · clean hits'}
                    {score.penaltySeconds > 0 ? ` · +${score.penaltySeconds}s penalties` : ''}
                  </div>
                )}
              </span>
              <span className="value">{score.stageTime != null ? `${score.stageTime}s` : '--'}</span>
            </div>
          ))}
        </div>
      )}

      {(isSteel || isIdpa) && match.stages.length > 0 && (
        <div className="card">
          <h2>Reconcile with the official score</h2>
          {!showReconcile ? (
            <button className="link-btn" onClick={() => setShowReconcile(true)}>
              My official score didn&rsquo;t match? Reconcile it ›
            </button>
          ) : (
            <>
              <p className="report-note" style={{ marginTop: 0 }}>
                Enter your official time for each stage. A gap almost always means a number was entered
                differently than the official card -- we&rsquo;ll flag which stage and where to look.
              </p>
              {oursByStage.map((ours, i) => {
                const { diff, matches } = reconcileTime(ours, parseNum(officialTimes[i]));
                return (
                  <div className="row" key={i}>
                    <span className="label">
                      Stage {i + 1}
                      <div className="row-sub">Ours: {ours != null ? `${ours}s` : '--'}</div>
                      {diff !== null && (matches ? (
                        <div className="row-sub" style={{ color: 'var(--success)' }}>Matches <span aria-hidden="true">✓</span></div>
                      ) : (
                        <div className="row-sub" style={{ color: 'var(--warn-text)' }}>
                          Off by {diff > 0 ? '+' : ''}{diff}s -- {isIdpa
                            ? "recheck this stage's points down and penalties"
                            : "recheck this stage's string times and missed-plate counts"}.
                        </div>
                      ))}
                    </span>
                    <label className="field small" style={{ maxWidth: 130 }}>Official (s)
                      <input type="number" inputMode="decimal" value={officialTimes[i] ?? ''}
                        onChange={(e) => setOfficialTimes((p) => { const n = p.slice(); n[i] = e.target.value; return n; })} />
                    </label>
                  </div>
                );
              })}
              {totalReconcile && (
                <div className="row" style={{ marginTop: 4 }}>
                  <span className="label"><strong>Match total</strong>
                    <div className="row-sub">Ours: {ourTotal}s · official: {officialTotal}s</div>
                  </span>
                  <span className="value" style={{ color: totalReconcile.matches ? 'var(--success)' : 'var(--warn-text)' }}>
                    {totalReconcile.matches ? <>Matches <span aria-hidden="true">✓</span></> : `off by ${totalReconcile.diff !== null && totalReconcile.diff > 0 ? '+' : ''}${totalReconcile.diff}s`}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {videos.length > 0 && (
        <div className="card">
          <h2>Stage Videos &amp; Photos</h2>
          <p className="report-note" style={{ marginBottom: 8 }}>Tap one to name it, jot notes, or remove it.</p>
          <div className="photo-grid">
            {videos.map((m) => (
              <div className="thumb-wrap" key={m.id}>
                <button className="thumb-tap" onClick={() => setViewing(m)} aria-label={m.name}>
                  <MarkThumb media={m} />
                </button>
                <span className="thumb-caption">{m.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {match.notes && (
        <div className="card">
          <h2>Notes</h2>
          <p className="note-text">{match.notes}</p>
        </div>
      )}

      <button className="button danger" onClick={() => setConfirming(true)}>Delete match</button>

      {confirming && (
        <ConfirmSheet title="Delete this match?"
          message="The match, its stages, and its videos all go. There's no undo."
          confirmLabel="Delete match"
          onConfirm={() => void reallyDelete()}
          onClose={() => setConfirming(false)} />
      )}
      {viewing && (
        <PhotoSheet media={viewing} onClose={() => setViewing(null)}
          onChanged={() => setLocalBump((b) => b + 1)} />
      )}
    </div>
  );
}

interface StageRow {
  points: string; time: string; percent: string; notes: string;
  showBreak: boolean;
  alphas: string; charlies: string; deltas: string;
  misses: string; noShoots: string; procedurals: string;
  // Steel Challenge input (used only when the match's scoring type is 'steel').
  // Arrays are always length STEEL_STRINGS_MAX; only the first `expected` (4 or 5)
  // are rendered and saved, so switching to/from Outer Limits never loses entries.
  steelStage: string;
  strings: string[];
  stringMisses: string[];
  stringStopMissed: boolean[];
  stringShowPenalty: boolean[]; // per-string reveal for the miss / stop-plate fields
  // IDPA input (used only when scoringType is 'idpa'). The shared `time` above is the
  // raw timer time; these are the points-down zone counts + penalty counts.
  idpaShowDetail: boolean; // progressive-disclosure reveal for the breakdown + penalties
  idpaDown0: string; idpaDown1: string; idpaDown3: string; idpaMisses: string;
  idpaHnt: string; idpaPe: string; idpaFp: string; idpaFtdr: string;
}

/** The six hit-breakdown keys, with their on-screen labels. */
const BREAK_FIELDS = [
  ['alphas', 'Alphas (A)'], ['charlies', 'Charlies (C)'], ['deltas', 'Deltas (D)'],
  ['misses', 'Misses (M)'], ['noShoots', 'No-shoots'], ['procedurals', 'Procedurals'],
] as const;

const STEEL_STRINGS_MAX = 5;

/** Grow/trim an array to exactly `len`, filling new slots with `fill`. */
function padArr<T>(arr: T[], len: number, fill: T): T[] {
  const out = arr.slice(0, len);
  while (out.length < len) out.push(fill);
  return out;
}

/** A blank stage row carrying both USPSA and Steel input fields. */
function emptyStageRow(): StageRow {
  return {
    points: '', time: '', percent: '', notes: '', showBreak: false,
    alphas: '', charlies: '', deltas: '', misses: '', noShoots: '', procedurals: '',
    steelStage: '',
    strings: Array(STEEL_STRINGS_MAX).fill(''),
    stringMisses: Array(STEEL_STRINGS_MAX).fill(''),
    stringStopMissed: Array(STEEL_STRINGS_MAX).fill(false),
    stringShowPenalty: Array(STEEL_STRINGS_MAX).fill(false),
    idpaShowDetail: false,
    idpaDown0: '', idpaDown1: '', idpaDown3: '', idpaMisses: '',
    idpaHnt: '', idpaPe: '', idpaFp: '', idpaFtdr: '',
  };
}

export function MatchForm({ id, onSaved, onCancel, onDirtyChange, onSaverChange }: {
  id?: string; onSaved: (matchId: string) => void; onCancel: () => void;
  // F3 parity: reports unsaved-edits state up to App, so the exits App owns
  // (tab bar, sidebar, browser Back) show the same Discard-changes? guard this
  // form's own ‹ Cancel uses. Must be reference-stable (useCallback in App).
  onDirtyChange?: (dirty: boolean) => void;
  onSaverChange?: (fn: (() => Promise<boolean>) | null) => void;
}) {
  const editing = id !== undefined;
  const [original, setOriginal] = useState<Match | null>(null);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [name, setName] = useState('');
  const [date, setDate] = useState(todayKey());
  const [matchType, setMatchType] = useState(MATCH_TYPES[0]);
  const [division, setDivision] = useState('Carry Optics');
  const [powerFactor, setPowerFactor] = useState('Minor');
  const [firearmId, setFirearmId] = useState('');
  const [totalRounds, setTotalRounds] = useState('');
  const [matchPercent, setMatchPercent] = useState('');
  const [divPlace, setDivPlace] = useState('');
  const [divOf, setDivOf] = useState('');
  const [overallPlace, setOverallPlace] = useState('');
  const [overallOf, setOverallOf] = useState('');
  const [stages, setStages] = useState<StageRow[]>([]);
  const [existingMedia, setExistingMedia] = useState<Media[]>([]);
  const [removedMedia, setRemovedMedia] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<StagedFile[]>([]);
  const [entryFee, setEntryFee] = useState('');
  const [psUrl, setPsUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<SaveProblem>(null);
  const matchGroupRef = useRef<HTMLDivElement>(null);
  const dateFieldRef = useRef<HTMLInputElement>(null);
  const gunFieldRef = useRef<HTMLSelectElement>(null);
  const [discarding, setDiscarding] = useState(false);
  // M4: watch for any real user edit (bubbled change). Programmatic loads and the
  // async first-gun auto-select don't fire input events, so this never false-fires.
  // Click-only mutators (add/remove stage, staged-media changes) fire no change
  // event, so they call setTouched(true) explicitly -- same pattern as SessionForm.
  const [touched, setTouched] = useState(false);

  // F3 parity: keep App's dirty flag in step with `touched`, and clear it on
  // unmount so a stale flag can never guard a navigation after this form is gone.
  useEffect(() => {
    onDirtyChange?.(touched);
    return () => onDirtyChange?.(false);
  }, [touched, onDirtyChange]);

  // F3 parity: last-resort guard for exits the app can't intercept -- closing the
  // tab, a reload, typing a new URL. Best-effort on iOS Safari/PWA (often skipped);
  // the in-app exits are the real fix.
  useEffect(() => {
    if (!touched) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [touched]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const f = await getAll<Firearm>('firearms');
      if (!alive) return;
      const sorted = f.sort((a, b) => a.name.localeCompare(b.name));
      setFirearms(sorted);
      const firstPick = pickableGuns(sorted);
      if (!editing && firstPick.length > 0) setFirearmId(firstPick[0].id);
      if (id !== undefined) {
        const [m, allMedia] = await Promise.all([getOne<Match>('matches', id), getAll<Media>('media')]);
        if (!alive || !m) return;
        setOriginal(m);
        setName(m.name); setDate(m.date); setMatchType(m.matchType);
        setDivision(m.division); setPowerFactor(m.powerFactor || 'Minor');
        setFirearmId(m.firearmId);
        setTotalRounds(m.totalRounds == null ? '' : String(m.totalRounds));
        setMatchPercent(m.matchPercent == null ? '' : String(m.matchPercent));
        setDivPlace(m.divisionPlace == null ? '' : String(m.divisionPlace));
        setDivOf(m.divisionOf == null ? '' : String(m.divisionOf));
        setOverallPlace(m.overallPlace == null ? '' : String(m.overallPlace));
        setOverallOf(m.overallOf == null ? '' : String(m.overallOf));
        setStages(m.stages.map((st) => {
          const strings = padArr((st.strings ?? []).map((v) => v == null ? '' : String(v)), STEEL_STRINGS_MAX, '');
          const stringMisses = padArr((st.stringMisses ?? []).map((v) => v == null ? '' : String(v)), STEEL_STRINGS_MAX, '');
          const stringStopMissed = padArr((st.stringStopMissed ?? []).slice(), STEEL_STRINGS_MAX, false);
          return {
            ...emptyStageRow(),
            points: st.points == null ? '' : String(st.points),
            time: st.time == null ? '' : String(st.time),
            percent: st.percent == null ? '' : String(st.percent),
            notes: st.notes,
            showBreak: hasHitBreakdown(st),
            alphas: st.alphas == null ? '' : String(st.alphas),
            charlies: st.charlies == null ? '' : String(st.charlies),
            deltas: st.deltas == null ? '' : String(st.deltas),
            misses: st.misses == null ? '' : String(st.misses),
            noShoots: st.noShoots == null ? '' : String(st.noShoots),
            procedurals: st.procedurals == null ? '' : String(st.procedurals),
            steelStage: st.steelStage ?? '',
            strings, stringMisses, stringStopMissed,
            stringShowPenalty: stringStopMissed.map((stop, n) => stop || (stringMisses[n] !== '' && Number(stringMisses[n]) > 0)),
            idpaShowDetail: [st.idpaDown0, st.idpaDown1, st.idpaDown3, st.idpaMisses, st.idpaNonThreatHits,
              st.idpaProceduralErrors, st.idpaFlagrantPenalties, st.idpaFailureToDoRight].some((v) => v != null),
            idpaDown0: st.idpaDown0 == null ? '' : String(st.idpaDown0),
            idpaDown1: st.idpaDown1 == null ? '' : String(st.idpaDown1),
            idpaDown3: st.idpaDown3 == null ? '' : String(st.idpaDown3),
            idpaMisses: st.idpaMisses == null ? '' : String(st.idpaMisses),
            idpaHnt: st.idpaNonThreatHits == null ? '' : String(st.idpaNonThreatHits),
            idpaPe: st.idpaProceduralErrors == null ? '' : String(st.idpaProceduralErrors),
            idpaFp: st.idpaFlagrantPenalties == null ? '' : String(st.idpaFlagrantPenalties),
            idpaFtdr: st.idpaFailureToDoRight == null ? '' : String(st.idpaFailureToDoRight),
          };
        }));
        setExistingMedia(allMedia.filter((x) => x.ownerType === 'match' && x.ownerId === id));
        setEntryFee(m.entryFee == null ? '' : String(m.entryFee));
        setPsUrl(m.practiScoreUrl); setNotes(m.notes);
      }
    })();
    return () => { alive = false; };
  }, [editing, id]);

  const num = (t: string): number | null => t.trim() === '' ? null : Number(t);
  const scoringType = scoringTypeFor(matchType);
  const divisionOptions = scoringType === 'idpa' ? IDPA_DIVISIONS
    : scoringType === 'steel' ? STEEL_DIVISIONS : DIVISIONS;
  // Keep the division valid for the sport: switching scoring type swaps the division
  // list (USPSA / IDPA / Steel), so snap to the first valid division if the current
  // one isn't in the new list.
  useEffect(() => {
    const opts = scoringType === 'idpa' ? IDPA_DIVISIONS
      : scoringType === 'steel' ? STEEL_DIVISIONS : DIVISIONS;
    setDivision((d) => (opts.includes(d) ? d : opts[0]));
  }, [scoringType]);

  const stageObjs: MatchStage[] = useMemo(() => stages.map((st, i) => {
    if (scoringType === 'steel') {
      // Steel: source of truth is the raw strings; points/HF don't apply. Only the
      // first `expected` strings count (4 on Outer Limits, 5 elsewhere) so a stage
      // switched to Outer Limits never carries a phantom 5th string into scoring.
      const expected = steelStringsExpected(st.steelStage);
      return {
        number: i + 1,
        points: null, time: null, percent: null, notes: st.notes.trim(),
        steelStage: st.steelStage || '',
        strings: st.strings.slice(0, expected).map(num),
        stringMisses: st.stringMisses.slice(0, expected).map(num),
        stringStopMissed: st.stringStopMissed.slice(0, expected),
      };
    }
    if (scoringType === 'idpa') {
      // IDPA: raw time is the shared `time`; the zone counts + penalty counts feed
      // scoreIdpaStage. points/percent aren't used by IDPA scoring.
      return {
        number: i + 1,
        points: null, time: num(st.time), percent: num(st.percent), notes: st.notes.trim(),
        idpaDown0: num(st.idpaDown0), idpaDown1: num(st.idpaDown1),
        idpaDown3: num(st.idpaDown3), idpaMisses: num(st.idpaMisses),
        idpaNonThreatHits: num(st.idpaHnt), idpaProceduralErrors: num(st.idpaPe),
        idpaFlagrantPenalties: num(st.idpaFp), idpaFailureToDoRight: num(st.idpaFtdr),
      };
    }
    const hb = {
      alphas: num(st.alphas), charlies: num(st.charlies), deltas: num(st.deltas),
      misses: num(st.misses), noShoots: num(st.noShoots), procedurals: num(st.procedurals),
    };
    // When a breakdown is entered, the stage's points are DERIVED from the hits
    // (and the field is read-only), so points can never disagree with the hits.
    const sc = scoreStageHits(hb, powerFactor, num(st.time));
    return {
      number: i + 1,
      points: sc ? sc.stagePoints : num(st.points),
      time: num(st.time), percent: num(st.percent), notes: st.notes.trim(),
      ...hb,
    };
  }), [stages, powerFactor, scoringType]);

  const steelTotal = useMemo(
    () => scoringType === 'steel' ? steelMatchTotal(stageObjs) : null,
    [stageObjs, scoringType]);
  const idpaTotal = useMemo(
    () => scoringType === 'idpa' ? idpaMatchTotal(stageObjs) : null,
    [stageObjs, scoringType]);


  // ONE source of validation truth for both Save button and nav-guard Save.
  function saveProblem(): SaveProblem {
    if (!date) return { field: 'date', message: 'Pick a date.' };
    if (!firearmId) return { field: 'gun', message: 'Pick a gun.' };
    // M2: don't save an empty shell -- require at least something that identifies the match.
    if (!name.trim() && !num(totalRounds) && stageObjs.length === 0) {
      return { field: 'matchGroup', message: 'Add a name, the rounds fired, or a stage before saving.' };
    }
    const topNumbers = [num(totalRounds), num(matchPercent), num(divPlace), num(divOf),
      num(overallPlace), num(overallOf), num(entryFee)];
    if (topNumbers.some((n) => n !== null && !Number.isFinite(n))) {
      return { field: 'numbers', message: "One of the match numbers isn't a plain number — check rounds, places, percent, and entry fee." };
    }
    for (let si = 0; si < stageObjs.length; si++) {
      const st = stageObjs[si];
      const stNums = [st.points, st.time, st.percent,
        st.alphas ?? null, st.charlies ?? null, st.deltas ?? null,
        st.misses ?? null, st.noShoots ?? null, st.procedurals ?? null,
        st.idpaDown0 ?? null, st.idpaDown1 ?? null, st.idpaDown3 ?? null, st.idpaMisses ?? null,
        st.idpaNonThreatHits ?? null, st.idpaProceduralErrors ?? null,
        st.idpaFlagrantPenalties ?? null, st.idpaFailureToDoRight ?? null];
      if (stNums.some((n) => n !== null && !Number.isFinite(n))) {
        return { field: 'numbers', message: `Stage ${si + 1} has a value that isn't a plain number.` };
      }
    }
    return null;
  }

  async function persistForm(): Promise<string | null> {
    if (saving) return null;
    const p = saveProblem();
    if (p) {
      setProblem(p);
      setTimeout(() => {
        const target =
          p.field === 'date' ? dateFieldRef.current :
          p.field === 'gun' ? gunFieldRef.current :
          matchGroupRef.current;
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (p.field === 'date') dateFieldRef.current?.focus();
        else if (p.field === 'gun') gunFieldRef.current?.focus();
      }, 0);
      return null;
    }
    setSaving(true);
    try {
      const mid = original ? original.id : newId('mt');
      const now = Date.now();
      const fields = {
        date, name: name.trim(), matchType, division, powerFactor, firearmId, scoringType,
        totalRounds: num(totalRounds), matchPercent: num(matchPercent),
        divisionPlace: num(divPlace), divisionOf: num(divOf),
        overallPlace: num(overallPlace), overallOf: num(overallOf),
        stages: stageObjs, entryFee: num(entryFee),
        practiScoreUrl: psUrl.trim(), notes: notes.trim()
      };
      if (original) {
        await putOne('matches', stampUpdate({ ...original, ...fields }, now));
      } else {
        await putOne('matches', stampNew(fields, mid, now));
      }
      await commitMedia('match', mid, newFiles, removedMedia, existingMedia.length);
      // F3 parity: the edits are saved -- nothing left to guard. Clear the dirty
      // flag before onSaved navigates (its replace/back would otherwise hit App's guard).
      onDirtyChange?.(false);
      return mid;
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    const mid = await persistForm();
    if (mid) onSaved(mid);
  }

  // Always-fresh saver: the ref holds the LATEST persistForm (re-pointed after
  // every render), and the reported wrapper is reference-stable so App's ref
  // write never churns. This replaces a hand-maintained dep list that could — and
  // did — go stale and save old values.
  const persistRef = useRef(persistForm);
  useEffect(() => { persistRef.current = persistForm; });
  const stablePersist = useCallback(async (): Promise<boolean> => {
    const mid = await persistRef.current();
    return mid !== null;
  }, []);

  // Report after every render (cheap: App just writes a ref) so the reported
  // validity can never lag the form state. Saver present ⟺ touched AND valid.
  useEffect(() => {
    onSaverChange?.(touched && saveProblem() === null ? stablePersist : null);
  });
  useEffect(() => () => onSaverChange?.(null), [onSaverChange]);

  return (
    <div className="screen" onChange={() => { setTouched(true); if (problem?.field === 'numbers') setProblem(null); }}>
      <div className="navbar">
        <button className="back-btn" onClick={() => (touched ? setDiscarding(true) : onCancel())}>‹ Cancel</button>
        <button className="navbar-action" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <h1 className="large-title">{editing ? 'Edit Match' : 'Log Match'}</h1>
      {problem && !['date', 'gun', 'matchGroup', 'numbers'].includes(problem.field) && (
        <p className="form-problem" role="alert">{problem.message}</p>
      )}
      {discarding && (
        <DiscardChangesSheet
          // Clear App's dirty flag BEFORE leaving: onCancel is history.back(),
          // which fires popstate -- without this, App's own F3 guard would see a
          // still-dirty form and show a SECOND sheet on top of this one.
          onConfirm={() => { onDirtyChange?.(false); onCancel(); }}
          onClose={() => setDiscarding(false)}
          // Local ‹ Cancel sheet uses full save() so post-save navigation runs.
          onSave={saveProblem() === null ? () => void save() : undefined} />
      )}

      <div className="card" ref={matchGroupRef}>
        <FieldProblem id="match-group-err" problem={problem} field="matchGroup" />
        <label className="field">What this match is called
          <input value={name} onChange={(e) => { setName(e.target.value); if (problem?.field === 'matchGroup') setProblem(null); }} placeholder="June Club Match"
            {...noAutofillProps} name="match-title" />
        </label>
        <label className={`field${problem?.field === 'date' ? ' invalid' : ''}`}>Date
          <input
            ref={dateFieldRef}
            id="match-date-input"
            type="date"
            value={date}
            onChange={(e) => { setDate(e.target.value); if (problem?.field === 'date') setProblem(null); }}
            aria-invalid={problem?.field === 'date' || undefined}
            aria-describedby={problem?.field === 'date' ? 'match-date-err' : undefined} />
          <FieldProblem id="match-date-err" problem={problem} field="date" />
        </label>
        <label className="field">Match type
          <select value={matchType} onChange={(e) => setMatchType(e.target.value)}>
            {MATCH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="field">Division
          <select value={division} onChange={(e) => setDivision(e.target.value)}>
            {divisionOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        {scoringType === 'uspsa' && (
          <>
            <h2>Power Factor</h2>
            <div className="seg" role="group" aria-label="Power factor">
              {POWER_FACTORS.map((pf) => (
                <button key={pf} type="button" aria-pressed={powerFactor === pf}
                  className={powerFactor === pf ? 'on' : ''} onClick={() => { setPowerFactor(pf); setTouched(true); }}>{pf}</button>
              ))}
            </div>
          </>
        )}
        <label className={`field${problem?.field === 'gun' ? ' invalid' : ''}`}>Gun
          <select
            ref={gunFieldRef}
            id="match-gun-select"
            value={firearmId}
            onChange={(e) => { setFirearmId(e.target.value); if (problem?.field === 'gun') setProblem(null); }}
            aria-invalid={problem?.field === 'gun' || undefined}
            aria-describedby={problem?.field === 'gun' ? 'match-gun-err' : undefined}>
            {firearms.length === 0 && <option value="">No guns yet</option>}
            {pickableGuns(firearms, [firearmId]).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <FieldProblem id="match-gun-err" problem={problem} field="gun" />
        </label>
        <label className="field">Rounds fired (adds to the gun's round count)
          <input type="number" inputMode="numeric" min="0" value={totalRounds}
            onChange={(e) => { setTotalRounds(e.target.value); if (problem?.field === 'matchGroup') setProblem(null); }} />
        </label>
        <FieldProblem id="match-numbers-err" problem={problem} field="numbers" />
      </div>

      <div className="card">
        {/* Progressive disclosure: placement + percent usually arrive AFTER the match (or
            via a PractiScore import), so they're collapsed -- the default match is
            name/date/type/division/power-factor/gun/stages. Values live in form state,
            so an unopened block simply saves empty, exactly as leaving them blank did. */}
        <Reveal label="Results & placement">
          <label className="field">Match percent
            <input type="number" inputMode="decimal" value={matchPercent} onChange={(e) => setMatchPercent(e.target.value)} />
          </label>
          <div className="drill-edit-fields">
            <label className="field small">Division place
              <input type="number" inputMode="numeric" value={divPlace} onChange={(e) => setDivPlace(e.target.value)} />
            </label>
            <label className="field small">of
              <input type="number" inputMode="numeric" value={divOf} onChange={(e) => setDivOf(e.target.value)} />
            </label>
          </div>
          <div className="drill-edit-fields">
            <label className="field small">Overall place
              <input type="number" inputMode="numeric" value={overallPlace} onChange={(e) => setOverallPlace(e.target.value)} />
            </label>
            <label className="field small">of
              <input type="number" inputMode="numeric" value={overallOf} onChange={(e) => setOverallOf(e.target.value)} />
            </label>
          </div>
        </Reveal>
      </div>

      <div className="card">
        <h2>{scoringType === 'steel' ? 'Stages & strings' : 'Stages'} <InfoTip title="How the numbers work">{scoringType === 'steel'
          ? <>Steel is scored on time -- lowest wins. Enter each string's raw time; if a plate was missed or the stop plate was never hit, tap "+ miss / penalty" on that string. Each miss adds 3 seconds, a string is capped at 30 seconds, and a missed stop plate scores the full 30. A stage keeps your best 4 of 5 strings (the slowest is dropped) -- and Outer Limits keeps your best 3 of 4 (the slowest is still dropped). Full math and sources are in "How the numbers work."</>
          : scoringType === 'idpa'
          ? <>IDPA is time-plus -- lowest total wins. Enter each stage's raw time; tap "+ points down / penalties" to record accuracy (down-1, down-3, misses) and any penalties. Each point down adds 1 second (a -1 is 1, a -3 is 3, a miss is 5); a non-threat hit (hitting a target you weren't meant to shoot) is 5s, a procedural (a rule/procedure penalty) 3s, a flagrant 10s, and failure to do right 20s. Full math and sources are in "How the numbers work."</>
          : <>Hit factor = points / time. Add a stage's A/C/D/miss breakdown and the points are computed from your hits -- A is 5; C is 4 major / 3 minor; D is 2 major / 1 minor -- minus 10 for each miss, no-shoot (a penalty target you weren't meant to hit), and procedural (a rule/procedure penalty), and never below zero (the Points field then becomes read-only). The full math and sources are in "How the numbers work," under More or from a saved match's debrief.</>}</InfoTip></h2>
        {scoringType === 'steel' ? stages.map((st, i) => {
          const expected = steelStringsExpected(st.steelStage);
          const ss = scoreSteelStage({
            steelStage: st.steelStage,
            strings: st.strings.slice(0, expected).map(num),
            stringMisses: st.stringMisses.slice(0, expected).map(num),
            stringStopMissed: st.stringStopMissed.slice(0, expected),
          });
          return (
            <div className="drill-edit" key={i}>
              <div className="drill-edit-head">
                <strong>Stage {i + 1}{ss.stageTime !== null ? ` -- ${ss.stageTime}s` : ''}</strong>
                <button className="icon-btn" aria-label={`Remove stage ${i + 1}`}
                  onClick={() => { setTouched(true); setStages((p) => p.filter((_, x) => x !== i)); }}><Icon name="close" size={18} /></button>
              </div>
              <label className="field">Which Steel stage
                <select value={st.steelStage}
                  onChange={(e) => setStages((p) => p.map((x, n) => n === i ? { ...x, steelStage: e.target.value } : x))}>
                  <option value="">Generic (5 strings)</option>
                  {STEEL_STAGES.map((s) => <option key={s.name} value={s.name}>{s.name}{s.strings === 4 ? ' (4 strings)' : ''}</option>)}
                </select>
              </label>
              {Array.from({ length: expected }).map((_, n) => (
                <div key={n}>
                  <div className="drill-edit-fields">
                    <label className="field small">String {n + 1} time (s)
                      <input type="number" inputMode="decimal" value={st.strings[n] ?? ''}
                        onChange={(e) => setStages((p) => p.map((x, m) => m === i ? { ...x, strings: x.strings.map((v, k) => k === n ? e.target.value : v) } : x))} />
                    </label>
                  </div>
                  {!st.stringShowPenalty[n] && (
                    <button type="button" className="link-btn" style={{ marginTop: 2 }}
                      onClick={() => setStages((p) => p.map((x, m) => m === i ? { ...x, stringShowPenalty: x.stringShowPenalty.map((v, k) => k === n ? true : v) } : x))}>
                      + miss / penalty
                    </button>
                  )}
                  {st.stringShowPenalty[n] && (
                    <div className="drill-edit-fields break-fields">
                      <Stepper label="Plates missed" value={st.stringMisses[n] ?? ''}
                        onChange={(val) => setStages((p) => p.map((x, m) => m === i ? { ...x, stringMisses: x.stringMisses.map((v, k) => k === n ? val : v) } : x))} />
                      <label className="field small" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <input type="checkbox" checked={st.stringStopMissed[n] ?? false} style={{ width: 18, height: 18 }}
                          onChange={(e) => setStages((p) => p.map((x, m) => m === i ? { ...x, stringStopMissed: x.stringStopMissed.map((v, k) => k === n ? e.target.checked : v) } : x))} />
                        Stop plate missed
                      </label>
                    </div>
                  )}
                </div>
              ))}
              {ss.stageTime !== null && (
                <p className="report-note" style={{ marginTop: 2 }}>
                  Stage time <InfoTip title="How this is derived">Each string = raw time + 3 seconds per missed plate, capped at 30s (a missed stop plate scores the full 30). The stage keeps the best 4 of 5 strings -- the slowest is dropped -- and Outer Limits keeps the best 3 of its 4 (slowest dropped too). Lowest total wins.</InfoTip>: {ss.stageTime}s{ss.droppedIndex !== null ? ` · dropped String ${ss.droppedIndex + 1}` : ''}
                </p>
              )}
              <label className="field">Stage notes
                <input value={st.notes}
                  onChange={(e) => setStages((p) => p.map((x, n) => n === i ? { ...x, notes: e.target.value } : x))} />
              </label>
            </div>
          );
        }) : scoringType === 'idpa' ? stages.map((st, i) => {
          const is = scoreIdpaStage({
            time: num(st.time),
            idpaDown1: num(st.idpaDown1), idpaDown3: num(st.idpaDown3), idpaMisses: num(st.idpaMisses),
            idpaNonThreatHits: num(st.idpaHnt), idpaProceduralErrors: num(st.idpaPe),
            idpaFlagrantPenalties: num(st.idpaFp), idpaFailureToDoRight: num(st.idpaFtdr),
          });
          return (
            <div className="drill-edit" key={i}>
              <div className="drill-edit-head">
                <strong>Stage {i + 1}{is.stageTime !== null ? ` -- ${is.stageTime}s` : ''}</strong>
                <button className="icon-btn" aria-label={`Remove stage ${i + 1}`}
                  onClick={() => { setTouched(true); setStages((p) => p.filter((_, x) => x !== i)); }}><Icon name="close" size={18} /></button>
              </div>
              <label className="field small">Raw time (s)
                <input type="number" inputMode="decimal" value={st.time}
                  onChange={(e) => setStages((p) => p.map((x, n) => n === i ? { ...x, time: e.target.value } : x))} />
              </label>
              {!st.idpaShowDetail && (
                <button type="button" className="link-btn" style={{ marginTop: 2 }}
                  onClick={() => setStages((p) => p.map((x, n) => n === i ? { ...x, idpaShowDetail: true } : x))}>
                  + points down / penalties
                </button>
              )}
              {st.idpaShowDetail && (
                <>
                  <p className="report-note" style={{ marginTop: 6, marginBottom: 2 }}>Points down (accuracy)</p>
                  <div className="drill-edit-fields break-fields">
                    <Stepper label="Down-1 hits" value={st.idpaDown1}
                      onChange={(v) => setStages((p) => p.map((x, n) => n === i ? { ...x, idpaDown1: v } : x))} />
                    <Stepper label="Down-3 hits" value={st.idpaDown3}
                      onChange={(v) => setStages((p) => p.map((x, n) => n === i ? { ...x, idpaDown3: v } : x))} />
                    <Stepper label="Misses" value={st.idpaMisses}
                      onChange={(v) => setStages((p) => p.map((x, n) => n === i ? { ...x, idpaMisses: v } : x))} />
                  </div>
                  <p className="report-note" style={{ marginTop: 6, marginBottom: 2 }}>Penalties</p>
                  <div className="drill-edit-fields break-fields">
                    <Stepper label="Non-threat hits" value={st.idpaHnt}
                      onChange={(v) => setStages((p) => p.map((x, n) => n === i ? { ...x, idpaHnt: v } : x))} />
                    <Stepper label="Procedurals (PE)" value={st.idpaPe}
                      onChange={(v) => setStages((p) => p.map((x, n) => n === i ? { ...x, idpaPe: v } : x))} />
                    <Stepper label="Flagrant" value={st.idpaFp}
                      onChange={(v) => setStages((p) => p.map((x, n) => n === i ? { ...x, idpaFp: v } : x))} />
                    <Stepper label="Failure to Do Right" value={st.idpaFtdr}
                      onChange={(v) => setStages((p) => p.map((x, n) => n === i ? { ...x, idpaFtdr: v } : x))} />
                  </div>
                </>
              )}
              {is.stageTime !== null && (
                <p className="report-note" style={{ marginTop: 2 }}>
                  Stage time <InfoTip title="How this is derived">Stage = raw time + 1 second per point down (a -1 is 1, a -3 is 3, a miss is 5) + penalties (non-threat 5s, procedural 3s, flagrant 10s, failure to do right 20s). Lowest total wins. Full math and the exact rules are in "How the numbers work."</InfoTip>: {is.stageTime}s
                  {is.pointsDown > 0 ? ` · ${is.pointsDown} down (+${is.accuracySeconds}s)` : ''}
                  {is.penaltySeconds > 0 ? ` · +${is.penaltySeconds}s penalties` : ''}
                </p>
              )}
              <label className="field">Stage notes
                <input value={st.notes}
                  onChange={(e) => setStages((p) => p.map((x, n) => n === i ? { ...x, notes: e.target.value } : x))} />
              </label>
            </div>
          );
        }) : stages.map((st, i) => {
          const sc = scoreStageHits(
            { alphas: num(st.alphas), charlies: num(st.charlies), deltas: num(st.deltas),
              misses: num(st.misses), noShoots: num(st.noShoots), procedurals: num(st.procedurals) },
            powerFactor, num(st.time));
          const hf = sc ? sc.hitFactor : hitFactor(num(st.points), num(st.time));
          return (
            <div className="drill-edit" key={i}>
              <div className="drill-edit-head">
                <strong>Stage {i + 1}{hf !== null ? ` -- HF ${hf}` : ''}</strong>
                <button className="icon-btn" aria-label={`Remove stage ${i + 1}`}
                  onClick={() => { setTouched(true); setStages((p) => p.filter((_, x) => x !== i)); }}><Icon name="close" size={18} /></button>
              </div>
              <div className="drill-edit-fields">
                <label className="field small">Points{sc ? ' (from hits)' : ''}
                  <input type="number" inputMode="decimal"
                    value={sc ? String(sc.stagePoints) : st.points}
                    readOnly={!!sc} aria-readonly={!!sc}
                    style={sc ? { color: 'var(--text-dim)' } : undefined}
                    onChange={(e) => setStages((p) => p.map((x, n) => n === i ? { ...x, points: e.target.value } : x))} />
                </label>
                <label className="field small">Time (s)
                  <input type="number" inputMode="decimal" value={st.time}
                    onChange={(e) => setStages((p) => p.map((x, n) => n === i ? { ...x, time: e.target.value } : x))} />
                </label>
                <label className="field small">Stage %
                  <input type="number" inputMode="decimal" value={st.percent}
                    onChange={(e) => setStages((p) => p.map((x, n) => n === i ? { ...x, percent: e.target.value } : x))} />
                </label>
              </div>
              {!st.showBreak && (
                <button type="button" className="link-btn" style={{ marginTop: 2 }}
                  onClick={() => setStages((p) => p.map((x, n) => n === i ? { ...x, showBreak: true } : x))}>
                  + Add hit breakdown (A/C/D/miss)
                </button>
              )}
              {st.showBreak && (
                <>
                  <div className="drill-edit-fields break-fields">
                    {BREAK_FIELDS.map(([key, label]) => (
                      <Stepper key={key} label={label} value={st[key]}
                        onChange={(v) => setStages((p) => p.map((x, n) => n === i ? ({ ...x, [key]: v }) as StageRow : x))} />
                    ))}
                  </div>
                  {sc && (
                    <p className="report-note" style={{ marginTop: 2 }}>
                      Derived <InfoTip title="How this is derived">Hit factor = points / time. Points come from your hits -- A is 5; C is 4 major / 3 minor; D is 2 major / 1 minor -- minus 10 for each miss, no-shoot, and procedural, and never below zero. "All A's" is what it would be if every hit were an alpha, at the same time. Full math and sources: "How the numbers work" (under More, or from any saved match).</InfoTip>: {sc.stagePoints} pts{sc.hitFactor != null ? ` · HF ${sc.hitFactor}` : ''}
                      {sc.allAlphaDelta != null && sc.allAlphaDelta > 0 ? ` · all A's ${sc.allAlphaHitFactor} (+${sc.allAlphaDelta})` : ''}
                      {sc.pctAvailable != null ? ` · ${Math.round(sc.pctAvailable * 100)}% of points` : ''}
                    </p>
                  )}
                </>
              )}
              <label className="field">Stage notes
                <input value={st.notes}
                  onChange={(e) => setStages((p) => p.map((x, n) => n === i ? { ...x, notes: e.target.value } : x))} />
              </label>
            </div>
          );
        })}
        {scoringType === 'steel' && stages.length > 0 && steelTotal !== null && (
          <p className="report-note" style={{ marginTop: 4 }}>
            Match total: <strong>{steelTotal}s</strong> -- lowest wins.
          </p>
        )}
        {scoringType === 'idpa' && stages.length > 0 && idpaTotal !== null && (
          <p className="report-note" style={{ marginTop: 4 }}>
            Match total: <strong>{idpaTotal}s</strong> -- lowest wins.
          </p>
        )}
        <button className="button secondary"
          onClick={() => { setTouched(true); setStages((p) => [...p, emptyStageRow()]); if (problem?.field === 'matchGroup') setProblem(null); }}>
          + Add Stage
        </button>
      </div>

      {/* F3 parity: MediaField's remove buttons mutate staged state by click alone,
          so the setter wrappers mark the form dirty explicitly. */}
      <MediaField heading="Stage Videos & Photos" addLabel="+ Add Videos or Photos"
        ownerType="match" ownerId={original?.id ?? ''}
        existingMedia={existingMedia} setExistingMedia={setExistingMedia}
        removedMedia={removedMedia} setRemovedMedia={(fn) => { setTouched(true); setRemovedMedia(fn); }}
        newFiles={newFiles} setNewFiles={(fn) => { setTouched(true); setNewFiles(fn); }} />

      <div className="card">
        <h2>Wrap-Up</h2>
        <label className="field">Entry fee ($) -- feeds your Costs, never double-counted
          <input type="number" inputMode="decimal" min="0" value={entryFee} onChange={(e) => setEntryFee(e.target.value)} />
        </label>
        <label className="field">PractiScore link
          <input value={psUrl} onChange={(e) => setPsUrl(e.target.value)} placeholder="https://practiscore.com/results/…" />
        </label>
        <label className="field">Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>

      <button className="button" disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : editing ? 'Save changes' : 'Save match'}
      </button>

    </div>
  );
}
