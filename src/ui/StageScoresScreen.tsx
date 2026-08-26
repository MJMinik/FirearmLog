// Stage-scores importer -- PASS 2, the screen. Turns a pasted PractiScore
// "Stage Results - Review" page into one stage's hit breakdown + time,
// through pass 1's pure parser (src/lib/stageScores.ts) and the confirm step
// STAGE_SCORES_SPEC.md section 6a Seat 8 condition 1 requires between parse
// and write. Reached from a saved match's own screen (MatchScreens.tsx) --
// never from the Compete "Import…" menu, which is the whole-match importer.
//
// Nothing is written until the shooter taps Save on the confirm step, and
// every write re-reads the match from disk immediately before it happens
// (src/lib/stageScoresWrite.ts) -- never a snapshot this screen has been
// holding since it loaded.
import { useEffect, useState } from 'react';
import type { AppSettings, Match } from '../lib/types.ts';
import { getOne, getSettings } from '../lib/db.ts';
import { formatDayKey } from '../lib/dates.ts';
import { normaliseStoredNames } from '../lib/shooterMatch.ts';
import { textTooLongMessage } from '../lib/inputLimits.ts';
import {
  parseStagePaste, scoreReviewRow,
  type StageScoreResult, type StageReviewRow, type AcceptedStageScore,
} from '../lib/stageScores.ts';
import { commitStageScore, stageFilled, StageScoreWriteError } from '../lib/stageScoresWrite.ts';
import { hasHitBreakdown } from '../lib/competition.ts';
import type { View } from './nav.ts';
import { ConfirmSheet } from './Sheet.tsx';
import { ScreenLoading, ScreenError } from './ScreenState.tsx';
import { NotFound } from './NotFound.tsx';

/** A/C/D/M row, used both in the confirm step and (implicitly, via the
 *  stage's own debrief) after the write lands. */
function hitsLine(h: { alphas: number; charlies: number; deltas: number; misses: number; noShoots: number; procedurals: number }): string {
  const parts = [`A ${h.alphas}`, `C ${h.charlies}`, `D ${h.deltas}`, `M ${h.misses}`];
  if (h.noShoots > 0) parts.push(`NS ${h.noShoots}`);
  if (h.procedurals > 0) parts.push(`Proc ${h.procedurals}`);
  return parts.join(' · ');
}

/** One candidate row in a name/member-number collision, tap to pick. */
function CandidateRow({ c, onPick }: { c: StageReviewRow; onPick: () => void }) {
  const sub = [c.division, c.squad ? `Squad ${c.squad}` : null, c.memberNumber || null].filter(Boolean).join(' · ');
  return (
    <button className="row-tap" onClick={onPick}>
      <span className="label">{c.name || '(no name)'}{sub && <div className="row-sub">{sub}</div>}</span>
      <span className="value">›</span>
    </button>
  );
}

/** The five-step how-to, bridging from where a shooter actually lands (the
 *  club's posted new-style link) to the old-style Review page for one stage
 *  (spec section 6a Seat 11 condition 11). */
function HowTo({ open: opened, onToggle, stageNumber }: { open: boolean; onToggle: (v: boolean) => void; stageNumber: number }) {
  return (
    <details className="import-howto" open={opened} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary>How to copy Stage {stageNumber}&rsquo;s Review page from PractiScore</summary>
      <ol className="report-note" style={{ paddingLeft: 20, margin: '6px 0 12px' }}>
        <li>Open your match on practiscore.com. PractiScore opens its new results view first. Scroll down the match page to find &quot;Old style results&quot;.</li>
        <li>Under &quot;Old style results&quot;, tap <b>Html Results</b>.</li>
        <li>A table opens with one row per stage. Find the row for <b>Stage {stageNumber}</b> and tap <b>Review</b> at the right-hand end of that row -- not Combined, which shows every shooter but not your own hit breakdown.</li>
        <li>On a phone: press and hold on the page just above the table until a blue highlight appears, then drag the round handle down the page -- it scrolls on its own while you hold. Keep dragging until the highlight covers the last shooter, let go, and tap <b>Copy</b>. On a computer: click anywhere in the page, then Command-A and Command-C.</li>
        <li>Paste it in the box above.</li>
      </ol>
    </details>
  );
}

/** The refusal codes that render as a plain problem, distinct from the two
 *  neutral ones (dq-absent, dnf) that get a report-note instead. */
function isNeutralRefusal(code: string): boolean {
  return code === 'dq-absent' || code === 'dnf';
}

export function StageScoresScreen({ id, onBack, open }: {
  id: string; onBack: () => void; open: (v: View) => void;
}) {
  const [match, setMatch] = useState<Match | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);
  const [bump, setBump] = useState(0);

  const [activeStage, setActiveStage] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [result, setResult] = useState<StageScoreResult | null>(null);
  const [howtoOpen, setHowtoOpen] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [writeProblem, setWriteProblem] = useState('');

  useEffect(() => {
    let alive = true;
    setError(false);
    void (async () => {
      try {
        const [m, s] = await Promise.all([getOne<Match>('matches', id), getSettings<AppSettings>()]);
        if (!alive) return;
        if (!m) { setNotFound(true); return; }
        setMatch(m);
        setSettings(s ?? null);
      } catch (e) {
        console.error('Stage scores load failed', e);
        if (alive) setError(true);
      }
    })();
    return () => { alive = false; };
  }, [id, bump]);

  if (error) return <ScreenError onRetry={() => setBump((n) => n + 1)} />;
  if (notFound) return <NotFound what="This match no longer exists." onBack={onBack} />;
  if (!match) return <ScreenLoading />;

  function openStage(n: number) {
    setActiveStage(n);
    setText('');
    setResult(null);
    setHowtoOpen(false);
    setConfirmOverwrite(false);
    setWriteProblem('');
  }

  function closeStage() {
    setActiveStage(null);
    setText('');
    setResult(null);
    setHowtoOpen(false);
    setConfirmOverwrite(false);
    setWriteProblem('');
  }

  function readStage() {
    if (!match) return;
    setWriteProblem('');
    // S-2 (cold audit M-4): the same paste-size guard every sibling importer
    // applies, at the same boundary -- before the parser ever walks the text.
    const tooLong = textTooLongMessage(text.length);
    if (tooLong) { setWriteProblem(tooLong); return; }
    const r = parseStagePaste(text, {
      powerFactor: match.powerFactor,
      memberNumber: settings?.uspsaMemberNumber?.trim() || undefined,
      storedNames: normaliseStoredNames(settings?.shooterNames),
    });
    setResult(r);
    if (!r.ok && (r.code === 'unknown-header' || r.code === 'wrong-surface-combined')) {
      // Both point the shooter at the how-to; wrong-surface-overall points
      // AWAY from this screen instead (to Import from PractiScore), so it
      // does not auto-open a how-to that describes the wrong destination.
      setHowtoOpen(true);
    }
  }

  function pickCandidate(c: StageReviewRow) {
    if (!match) return;
    setResult(scoreReviewRow(c, match.powerFactor));
  }

  async function commit(accepted: AcceptedStageScore, allowOverwrite: boolean) {
    if (!match || activeStage == null || committing) return;
    setCommitting(true);
    setWriteProblem('');
    try {
      await commitStageScore(match.id, activeStage, accepted, allowOverwrite);
      // Disk-driven: re-read the match fresh rather than patching local
      // state by hand, so the stage list always shows exactly what is on
      // disk (spec section 6a Seat 8 condition 4 -- "progress reads disk
      // state"). The load effect above does this via `bump`.
      setBump((n) => n + 1);
      closeStage();
    } catch (e) {
      if (e instanceof StageScoreWriteError && e.code === 'stage-already-filled') {
        setConfirmOverwrite(true);
      } else {
        setWriteProblem("That stage's scores couldn't be saved. Nothing was written -- try again.");
      }
    } finally {
      setCommitting(false);
    }
  }

  const isUspsa = (match.scoringType ?? 'uspsa') === 'uspsa';
  const stageCount = match.stages.length;

  // Defensive fallback: this screen is reached only through the gated entry
  // point on MatchDetail, but a stale link or a direct paste of the URL
  // shouldn't crash -- it should say plainly why there's nothing to do here.
  if (!isUspsa || stageCount === 0) {
    return (
      <div className="screen">
        <div className="navbar"><button className="back-btn" onClick={onBack}>‹ Back</button></div>
        <h1 className="large-title">Add stage scores</h1>
        <div className="card">
          <p className="report-note">
            {!isUspsa
              ? 'Stage scores from PractiScore are read for USPSA matches. This match is scored a different way, so there is nothing to paste here.'
              : 'This match has no stages logged yet. Add stages on the match’s Edit screen first, then come back here to fill them in from PractiScore.'}
          </p>
        </div>
      </div>
    );
  }

  // ── Paste / confirm sub-view for one stage ────────────────────────────
  if (activeStage != null) {
    const alreadyFilled = stageFilled(match, activeStage);
    return (
      <div className="screen">
        <div className="navbar"><button className="back-btn" onClick={closeStage}>‹ Stages</button></div>
        <h1 className="large-title">Stage {activeStage}</h1>

        {writeProblem && <p className="form-problem" role="alert">{writeProblem}</p>}

        {!result && (
          <div className="card">
            <p className="report-note">
              Paste Stage {activeStage}&rsquo;s Review page from PractiScore below. Nothing is saved until you
              confirm it matches this match and this stage.
            </p>
            <label className="field">Stage results text
              <textarea rows={8} value={text} placeholder="Paste one stage's Review page here…"
                onChange={(e) => setText(e.target.value)} />
            </label>
            <button className="button" disabled={!text.trim()} onClick={readStage} style={{ marginTop: 8 }}>Read stage</button>
            <HowTo open={howtoOpen} onToggle={setHowtoOpen} stageNumber={activeStage} />
          </div>
        )}

        {result && result.ok && (
          <>
            <div className="card">
              <h2>This match</h2>
              <div className="row"><span className="label">Match</span><span className="value">{match.name || formatDayKey(match.date)}</span></div>
              <div className="row"><span className="label">Date</span><span className="value">{formatDayKey(match.date)}</span></div>
              <div className="row"><span className="label">Stage</span><span className="value">Stage {activeStage}</span></div>
            </div>
            <div className="card">
              <h2>What was pasted</h2>
              <div className="row"><span className="label">Shooter</span><span className="value">{result.accepted.row.name || '(no name)'}</span></div>
              <div className="row"><span className="label">Hits</span><span className="value">{hitsLine(result.accepted.hits)}</span></div>
              <div className="row"><span className="label">Time</span><span className="value">{result.accepted.time}s</span></div>
              <div className="row"><span className="label">Hit factor</span><span className="value">{result.accepted.derived.hitFactor}</span></div>
              <p className="report-note" style={{ marginTop: 4 }}>
                Checks out against the page&rsquo;s own printed hit factor ({result.accepted.printedHitFactor}).
              </p>
            </div>
            <button className="button" disabled={committing}
              onClick={() => { if (alreadyFilled) setConfirmOverwrite(true); else void commit(result.accepted, false); }}>
              {committing ? 'Saving…' : alreadyFilled ? `Replace Stage ${activeStage}’s scores` : `Save Stage ${activeStage}’s scores`}
            </button>
            <button className="button secondary" style={{ marginTop: 8 }} onClick={() => setResult(null)}>Paste something else</button>
            {confirmOverwrite && (
              <ConfirmSheet title={`Replace Stage ${activeStage}'s scores?`}
                message={`Stage ${activeStage} already has scores logged on this match. Saving here replaces them with what was just pasted -- there's no undo.`}
                confirmLabel="Replace scores"
                onConfirm={() => { setConfirmOverwrite(false); void commit(result.accepted, true); }}
                onClose={() => setConfirmOverwrite(false)} />
            )}
          </>
        )}

        {result && !result.ok && result.code === 'name-collision' && (
          <div className="card">
            {/* Carried a11y Low (cold audit, session 133): a neutral outcome,
                not an error -- role="status" so a screen-reader user who taps
                Read stage hears it, without the assertive interruption
                role="alert" would give a refusal. */}
            <p className="report-note" role="status">
              More than one row on Stage {activeStage}&rsquo;s page could be you. Tap yours.
            </p>
            {result.candidates.map((c, i) => <CandidateRow key={i} c={c} onPick={() => pickCandidate(c)} />)}
          </div>
        )}

        {result && !result.ok && !isNeutralRefusal(result.code) && result.code !== 'name-collision' && (
          <div className="card">
            <p className="form-problem" role="alert">
              {result.code === 'unknown-header' &&
                `Couldn't read that as Stage ${activeStage}'s Review page. Make sure you copied the whole table, header row included.`}
              {result.code === 'wrong-surface-combined' &&
                `This looks like Stage ${activeStage}'s Combined page -- it shows every shooter's stage points, not any one shooter's hit breakdown. Tap Review next to Stage ${activeStage} instead of Combined, then paste that.`}
              {result.code === 'shooter-not-found' &&
                `Couldn't find you on Stage ${activeStage}'s page. Check Settings → Who you are and your USPSA #, or make sure you copied the whole table down to the last shooter.`}
              {result.code === 'unparseable-hf' &&
                `Stage ${activeStage}'s printed hit factor couldn't be read on this page, so nothing was saved. Try copying the page again.`}
              {result.code === 'hf-mismatch' &&
                `Stage ${activeStage}'s numbers include something this app can't verify -- likely an extra penalty the range officer entered, or an edit on the official page. Nothing was saved for Stage ${activeStage}; the other stages are untouched.`}
              {result.code === 'hf-mismatch' && result.powerFactorDisagrees &&
                ` This match is logged as ${match.powerFactor} power factor, and this row's page shows a different one -- check the match's power factor under Edit Match if that's not right.`}
            </p>
            {result.code === 'wrong-surface-combined' && <HowTo open={howtoOpen} onToggle={setHowtoOpen} stageNumber={activeStage} />}
            {result.code === 'unknown-header' && <HowTo open={howtoOpen} onToggle={setHowtoOpen} stageNumber={activeStage} />}
          </div>
        )}

        {result && !result.ok && result.code === 'wrong-surface-overall' && (
          <div className="card">
            {/* Carried a11y Low (cold audit, session 133): neutral outcome, role="status". */}
            <p className="report-note" role="status">
              This looks like the whole match&rsquo;s overall results, not Stage {activeStage} on its own. That
              page goes in Import from PractiScore instead of here.
            </p>
            <button className="button secondary" onClick={() => open({ kind: 'practiscore-import' })}>
              Go to Import from PractiScore ›
            </button>
          </div>
        )}

        {result && !result.ok && result.code === 'dq-absent' && (
          <div className="card">
            {/* Carried a11y Low (cold audit, session 133): neutral outcome, role="status". */}
            <p className="report-note" role="status">
              {result.name} is marked DQ on this page, so PractiScore isn&rsquo;t publishing stage scores for
              Stage {activeStage}. Nothing was saved -- that&rsquo;s expected for a DQ, not an error.
            </p>
          </div>
        )}

        {result && !result.ok && result.code === 'dnf' && (
          <div className="card">
            {/* Carried a11y Low (cold audit, session 133): neutral outcome, role="status". */}
            <p className="report-note" role="status">
              Stage {activeStage}&rsquo;s results page shows no score for you on this stage -- typically a DNF
              or a reassigned score. Nothing was saved.
            </p>
          </div>
        )}

        {/* L-1 (cold audit): every refusal card leaves an obvious way back to
            the paste box -- without it, the only exit was ‹ Stages, and the
            copy above says "try again" with nothing on screen to try again with. */}
        {result && !result.ok && (
          <button className="button secondary" onClick={() => setResult(null)}>Paste something else</button>
        )}
      </div>
    );
  }

  // ── Stage list ─────────────────────────────────────────────────────────
  return (
    <div className="screen">
      <div className="navbar"><button className="back-btn" onClick={onBack}>‹ Back</button></div>
      <h1 className="large-title">Add stage scores</h1>
      <div className="card">
        <p className="report-note">
          Paste each stage&rsquo;s Review page from PractiScore instead of typing the A/C/D/miss breakdown by
          hand. Tap a stage to add or replace it -- every stage saves the moment you confirm it, so you can do
          a few now and come back for the rest later.
        </p>
        {match.stages.map((st) => {
          // Cold audit NEW-L-1 (session 133): the list label used to share
          // stageFilled with the overwrite gate, so a stage with only a
          // hand-entered time/points (no breakdown) read "Added" here while
          // MatchScreens' own entry gate (hasHitBreakdown) still treated it as
          // unfilled and kept offering "Add stage scores" for the match. This
          // stage now gets its own label naming what's actually true, so it
          // agrees with the entry gate instead of contradicting it. The
          // overwrite gate (`alreadyFilled` above) is untouched -- a hand-
          // entered stage still demands confirm-overwrite.
          const hasBreakdown = hasHitBreakdown(st);
          const handEnteredOnly = !hasBreakdown && stageFilled(match, st.number);
          const label = hasBreakdown
            ? 'Added'
            : handEnteredOnly
              ? 'Logged by hand -- paste to add the hit breakdown'
              : 'Empty -- add it or leave it, either is fine';
          return (
            <button className="row-tap" key={st.number} onClick={() => openStage(st.number)}>
              <span className="label">Stage {st.number}
                <div className="row-sub">{label}</div>
              </span>
              <span className="value">›</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
