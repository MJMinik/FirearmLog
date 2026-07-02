// "How the numbers work" -- the in-app wiki/explainer: exactly how FirearmLog
// computes every number on the match debrief, with the source of each rule and
// honest flags where a figure is a community rule of thumb vs. an official rule.
// Where a number IS an official rule, we show the EXACT rulebook wording, in quotes,
// labeled as a direct quote, with its section -- so nothing is paraphrased-as-fact.
// Read-only; no data, no storage.

import {
  USPSA_SCORING_QUOTES, USPSA_CLASS_QUOTES, STEEL_RULE_QUOTES, IDPA_RULE_QUOTES,
} from '../lib/competition.ts';

/** Render a verbatim rulebook quote (source lives in competition.ts, one place). */
function RuleQuote({ quote, section }: { quote: string; section: string }) {
  return (
    <div className="rule-quote">
      <div className="quote-label">Direct quote — {section}</div>
      <div className="quote-text">&ldquo;{quote}&rdquo;</div>
    </div>
  );
}

export function NumbersGuide({ onBack }: { onBack: () => void }) {
  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">How the numbers work</h1>
      <p className="report-note">
        Exactly how FirearmLog computes every number on your match debrief, and where each rule
        comes from. Where a figure is an official USPSA rule we say so; where it's a community
        rule of thumb, we flag it — so you always know which is which.
      </p>

      <div className="card">
        <h2>Hit factor</h2>
        <p className="note-text">
          Your stage score is <strong>hit factor = points &divide; time</strong> — points per
          second. Higher is better, and it's the number that decides who wins a stage. Because
          it's points over time, a low hit factor can come from either dropped points (accuracy)
          or a slow time (speed) — which is why we never call a stage "speed" or "accuracy" for
          you without the data to back it.
        </p>
      </div>

      <div className="card">
        <h2>Stage scoring (the points)</h2>
        <p className="note-text">Each scoring hit is worth:</p>
        <div className="row"><span className="label">Alpha (A)</span><span className="value">5 points</span></div>
        <div className="row"><span className="label">Charlie (C)</span><span className="value">4 major &middot; 3 minor</span></div>
        <div className="row"><span className="label">Delta (D)</span><span className="value">2 major &middot; 1 minor</span></div>
        <div className="row"><span className="label">Miss &middot; no-shoot &middot; procedural</span><span className="value">&minus;10 each</span></div>
        <p className="note-text">
          So a stage's points = your hits (5&times;A, plus C and D valued by power factor) minus
          10 for each miss, no-shoot, and procedural. <strong>A stage can't go below zero</strong> —
          heavy penalties floor it at 0, never negative. Major vs. minor only changes the charlie
          and delta values; an alpha is always 5. (Carry Optics and Production always score minor.)
        </p>
        <p className="report-note">
          These are the official USPSA scoring values, straight from the rulebook (USPSA Competition
          Rules, edition 2026-03, at rules.uspsa.org). Here is the exact wording for each number:
        </p>
        {USPSA_SCORING_QUOTES.map((q) => (
          <RuleQuote key={q.section} quote={q.quote} section={q.section} />
        ))}
        <p className="report-note">
          When you enter a stage's A/C/D breakdown, FirearmLog derives the points from these values —
          so your points can never disagree with your hits.
        </p>
      </div>

      <div className="card">
        <h2>% of available points</h2>
        <p className="note-text">
          Your stage points &divide; the most the stage could give (5 points for every scoring
          shot, misses included). It's the accuracy half of your result: 90% of available points
          means you dropped 10% to charlies, deltas, misses, and penalties.
        </p>
        <p className="report-note">
          Community rule of thumb, NOT an official rule: many coaches aim for about 92% of
          available points at a match, and use "95%+ &rarr; push harder, 85% or less &rarr; slow
          down" as a dial. It varies by shooter — treat it as orientation, not a verdict.
        </p>
      </div>

      <div className="card">
        <h2>&ldquo;With all alphas&rdquo;</h2>
        <p className="note-text">
          On a stage with a hit breakdown, we show what your hit factor would have been if every
          scoring shot had been an alpha, at the same time — a clean way to see how much accuracy
          cost you. It keeps any no-shoots and procedurals you committed: those aren't accuracy
          mistakes, so an "all-alpha" run can't erase them. We'd rather show you the honest number
          than a flattering one.
        </p>
      </div>

      <div className="card">
        <h2>Classification</h2>
        <p className="note-text">
          Your class comes from your classifier scores: the average of your
          <strong> best 6 of your 8 most recent</strong> classifier percentages. When that average
          crosses a band, you move up.
        </p>
        <div className="row"><span className="label">C</span><span className="value">40&ndash;59.9%</span></div>
        <div className="row"><span className="label">B</span><span className="value">60&ndash;74.9%</span></div>
        <div className="row"><span className="label">A</span><span className="value">75&ndash;84.9%</span></div>
        <div className="row"><span className="label">Master</span><span className="value">85&ndash;94.9%</span></div>
        <div className="row"><span className="label">Grand Master</span><span className="value">95%+</span></div>
        <p className="report-note">
          Official USPSA classification, from the USPSA Classification System document (published at
          uspsa.org). The exact wording for the two numbers we use:
        </p>
        {USPSA_CLASS_QUOTES.map((q) => (
          <RuleQuote key={q.section} quote={q.quote} section={q.section} />
        ))}
        <p className="report-note">
          Note: USPSA's own bracket lists Grand Master as &ldquo;95 to 110%&rdquo; — the top band runs
          past 100% because a classifier score can now exceed the reference hit factor. We show
          &ldquo;95%+&rdquo; as the plain-English band you cross to reach GM; the math is the same.
        </p>
      </div>

      <div className="card">
        <h2>Steel Challenge (SCSA) scoring</h2>
        <p className="note-text">
          Steel Challenge is scored purely on <strong>time — lowest wins</strong>, the opposite of
          USPSA's hit factor. There are no points and no power factor.
        </p>
        <p className="note-text">Each <strong>string</strong> scores like this:</p>
        <div className="row"><span className="label">Your raw time</span><span className="value">as run</span></div>
        <div className="row"><span className="label">Each missed plate</span><span className="value">+3.00 s</span></div>
        <div className="row"><span className="label">String maximum</span><span className="value">30.00 s</span></div>
        <div className="row"><span className="label">Stop plate never hit</span><span className="value">scores 30.00 s</span></div>
        <p className="note-text">
          A stage is your <strong>best 4 of 5 strings</strong> — the single slowest string is dropped.
          <strong> Outer Limits</strong> is 4 strings, and it works the same way: you keep your
          <strong> best 3 of 4</strong> (the slowest is still dropped). Your
          <strong> match total</strong> is the sum of your stage times, and the lowest total wins.
        </p>
        <p className="report-note">
          These are the official Steel Challenge rules, from the Steel Challenge Rules rulebook (edition
          2026-03, at rules.uspsa.org/scsa). The exact wording for each number:
        </p>
        {STEEL_RULE_QUOTES.map((q) => (
          <RuleQuote key={q.section} quote={q.quote} section={q.section} />
        ))}
        <p className="report-note">
          When you enter your string times, FirearmLog derives your stage and match totals from them — so
          the numbers can never disagree with what you shot.
        </p>
      </div>

      <div className="card">
        <h2>IDPA scoring (time-plus)</h2>
        <p className="note-text">
          IDPA is scored on <strong>time — lowest total wins</strong>, like Steel, but your accuracy
          is folded in as added seconds instead of points. Your stage score is your
          <strong> raw time</strong>, plus <strong>1 second for every point down</strong>, plus any
          penalties. Points down (your accuracy cost):
        </p>
        <div className="row"><span className="label">A down-1 hit</span><span className="value">+1 s</span></div>
        <div className="row"><span className="label">A down-3 hit</span><span className="value">+3 s</span></div>
        <div className="row"><span className="label">A miss (scored &minus;5)</span><span className="value">+5 s</span></div>
        <p className="note-text">Penalties (added seconds):</p>
        <div className="row"><span className="label">Hit on a non-threat</span><span className="value">+5 s each</span></div>
        <div className="row"><span className="label">Procedural (PE)</span><span className="value">+3 s each</span></div>
        <div className="row"><span className="label">Flagrant penalty</span><span className="value">+10 s each</span></div>
        <div className="row"><span className="label">Failure to Do Right</span><span className="value">+20 s</span></div>
        <p className="note-text">
          So a stage = <strong>raw time + (points down &times; 1 s) + penalties</strong>, and your
          match total is the sum of your stage times — lowest wins. Two things that trip people up, so
          we handle them for you: a <strong>hit on a non-threat is the 5-second penalty only</strong> —
          it is NOT also counted as points down, so it never double-counts. And there is
          <strong> no &ldquo;failure to neutralize&rdquo; penalty</strong> anymore — IDPA removed it;
          not putting enough good hits on a target simply shows up as misses (&minus;5 each), plus a
          procedural if you fired too few rounds. We built it strictly from the current rulebook because
          getting scoring subtly wrong is exactly what marks an app as built by someone who doesn't shoot.
        </p>
        <p className="report-note">
          These are the official IDPA rules, from the 2026.2 IDPA Rulebook (idpa.com). The exact wording
          for each number:
        </p>
        {IDPA_RULE_QUOTES.map((q) => (
          <RuleQuote key={q.section} quote={q.quote} section={q.section} />
        ))}
        <p className="report-note">
          When you enter each stage's raw time, points down, and penalties, FirearmLog derives your stage
          and match totals from them — so the numbers can never disagree with what you shot. (Your IDPA
          classification and moving up is coming; it needs the official brackets researched and cited
          first, and we won't ship guessed thresholds.)
        </p>
      </div>

      <div className="card">
        <h2>Where these come from</h2>
        <p className="note-text">
          The USPSA scoring rules are from the official USPSA Competition Rules, now searchable online at
          rules.uspsa.org; the classification rules are from USPSA's Classification System document at
          uspsa.org; the Steel Challenge rules are from the official Steel Challenge Rules at
          rules.uspsa.org/scsa; and the IDPA rules are from the 2026.2 IDPA Rulebook at idpa.com.
          Where a number is an official rule we show the rulebook's exact words, in
          quotes, with its section. Anything labeled a "rule of thumb" is common coaching guidance from the
          shooting community, not an official rule — we flag those so you always know the difference.
        </p>
      </div>
    </div>
  );
}
