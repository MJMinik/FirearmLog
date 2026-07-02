// "How the numbers work" -- the in-app wiki/explainer: exactly how FirearmLog
// computes every number on the match debrief. Standard for EVERY entry (Michael,
// session 33): show the math, explain it in plain English, explain WHY we use it,
// and -- where it is an official rule -- quote the rulebook's exact words (labeled a
// direct quote, with its section). Our OWN derived numbers say so plainly and are
// never dressed up as a rulebook figure. Voice: user-focused and factual -- the
// wiki explains the shooter's numbers, it does NOT talk about itself. Read-only.

import { useLayoutEffect, type ReactNode } from 'react';
import {
  USPSA_SCORING_QUOTES, USPSA_CLASS_QUOTES, STEEL_RULE_QUOTES, IDPA_RULE_QUOTES,
} from '../lib/competition.ts';

/** Render a verbatim rulebook quote (source text lives in competition.ts, one place). */
function RuleQuote({ quote, section }: { quote: string; section: string }) {
  return (
    <div className="rule-quote">
      <div className="quote-label">Direct quote — {section}</div>
      <div className="quote-text">&ldquo;{quote}&rdquo;</div>
    </div>
  );
}

/** The math for a number, shown as its own labeled line so it's never buried in prose. */
function TheMath({ children }: { children: ReactNode }) {
  return (
    <p className="note-text"><strong>The math:</strong> {children}</p>
  );
}

/** Why this math is used -- the reasoning, every time. */
function Why({ children }: { children: ReactNode }) {
  return (
    <p className="note-text"><strong>Why:</strong> {children}</p>
  );
}

/** Flag for a FirearmLog-derived number (our own read, not a single rulebook figure). */
function OurRead() {
  return (
    <p className="report-note">
      This is FirearmLog&rsquo;s own read, not a single official rulebook figure — shown here with its
      full math so you can check it yourself.
    </p>
  );
}

export function NumbersGuide({ onBack, section }: { onBack: () => void; section?: string }) {
  // Deep-link: when opened for a specific section (e.g. from a match debrief's "How the
  // numbers work" link), scroll that card into view. A DIRECT scrollIntoView (NOT
  // requestAnimationFrame): rAF is paused while the tab is backgrounded, which would
  // silently skip the scroll and leave the reader at the top; scrollIntoView works
  // regardless of tab visibility. The target card is part of this component's own render,
  // so it exists by layout time; useLayoutEffect runs before paint, so there is no
  // flash-of-top. App no longer snaps this view to the top when a section is set (see
  // push() in App.tsx), so there is nothing to race.
  useLayoutEffect(() => {
    if (!section) return;
    document.getElementById(section)?.scrollIntoView({ block: 'start' });
  }, [section]);

  // Hit factor is its own rule (Comstock); the rest of the USPSA scoring quotes are the
  // A/C/D/penalty values. Split them so each shows up next to the number it defines.
  const comstock = USPSA_SCORING_QUOTES.filter((q) => /Comstock/i.test(q.section));
  const pointValues = USPSA_SCORING_QUOTES.filter((q) => !/Comstock/i.test(q.section));

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">How the numbers work</h1>
      <p className="report-note">
        Every number on your debrief, laid out the same way: the actual math, a plain-English
        explanation, why it&rsquo;s used, and — where it&rsquo;s an official rule — the rulebook&rsquo;s
        exact words in quotes, with the section. Numbers that are FirearmLog&rsquo;s own read (not a
        rulebook figure) say so plainly, and a &ldquo;rule of thumb&rdquo; is flagged as coaching
        guidance, not an official rule.
      </p>

      <div className="card" id="uspsa">
        <h2>Hit factor (USPSA)</h2>
        <TheMath>hit factor = points &divide; time (points per second).</TheMath>
        <p className="note-text">
          Your stage score. Higher is better, and it&rsquo;s the number that decides who wins a stage.
        </p>
        <Why>
          it rewards accuracy and speed in one number — you can&rsquo;t win a stage by being only fast
          (you&rsquo;d drop points) or only accurate (you&rsquo;d run out of time). Because it&rsquo;s
          points over time, a low hit factor can come from dropped points OR a slow time, so a stage
          isn&rsquo;t labeled &ldquo;speed&rdquo; or &ldquo;accuracy&rdquo; unless the hit breakdown is
          there to show which it was.
        </Why>
        {comstock.map((q) => (
          <RuleQuote key={q.section} quote={q.quote} section={q.section} />
        ))}
      </div>

      <div className="card">
        <h2>Stage points (USPSA)</h2>
        <p className="note-text">Each scoring hit is worth:</p>
        <div className="row"><span className="label">Alpha (A)</span><span className="value">5 points</span></div>
        <div className="row"><span className="label">Charlie (C)</span><span className="value">4 major &middot; 3 minor</span></div>
        <div className="row"><span className="label">Delta (D)</span><span className="value">2 major &middot; 1 minor</span></div>
        <div className="row"><span className="label">Miss &middot; no-shoot &middot; procedural</span><span className="value">&minus;10 each</span></div>
        <TheMath>
          stage points = (5&times;A) + (C and D valued by power factor) &minus; 10&times;(misses + no-shoots
          + procedurals), <strong>floored at 0</strong>.
        </TheMath>
        <p className="note-text">
          Major vs. minor only changes the charlie and delta values; an alpha is always 5. (Carry Optics
          and Production always score minor.)
        </p>
        <Why>
          this is how USPSA turns your hits into a points total, and the floor at zero means a bad stage
          can cost you the whole stage but never go negative and drag down your match.
        </Why>
        {pointValues.map((q) => (
          <RuleQuote key={q.section} quote={q.quote} section={q.section} />
        ))}
        <p className="report-note">
          When you enter a stage&rsquo;s A/C/D breakdown, the points are derived from these values, so they
          always match your hits.
        </p>
      </div>

      <div className="card">
        <h2>% of available points</h2>
        <TheMath>
          your stage points &divide; the most the stage could give (5 points &times; every scoring shot,
          misses included).
        </TheMath>
        <p className="note-text">
          The accuracy half of your result: 90% of available points means you dropped 10% to charlies,
          deltas, misses, and penalties.
        </p>
        <Why>
          hit factor blends speed and accuracy; this pulls the accuracy out on its own, so you can see
          whether a low hit factor was dropped points or just a slow time.
        </Why>
        <OurRead />
        <p className="report-note">
          <strong>Rule of thumb (coaching guidance, NOT an official rule):</strong> many coaches aim for
          about 92% of available points at a match, and use &ldquo;95%+ &rarr; push harder, 85% or less
          &rarr; slow down&rdquo; as a dial. It varies by shooter — treat it as orientation, not a verdict.
        </p>
      </div>

      <div className="card">
        <h2>&ldquo;With all alphas&rdquo;</h2>
        <TheMath>
          (available points &minus; 10&times;(no-shoots + procedurals)) &divide; your time — i.e. every
          scoring hit turned into an alpha, at the same time you actually ran.
        </TheMath>
        <p className="note-text">
          The hit factor you&rsquo;d have posted with perfect hits — a clean way to see how much accuracy
          cost you on that stage.
        </p>
        <Why>
          it isolates the price of dropped points. It deliberately KEEPS any no-shoots and procedurals you
          committed, because those aren&rsquo;t accuracy mistakes — an &ldquo;all-alpha&rdquo; run
          can&rsquo;t erase them.
        </Why>
        <OurRead />
      </div>

      <div className="card">
        <h2>Toughest &amp; strongest stage</h2>
        <TheMath>
          we rank your stages by stage percent (if you entered them), or by hit factor when you
          didn&rsquo;t; the top-ranked is your <strong>strongest</strong>, the bottom one or two are your
          <strong> toughest</strong>.
        </TheMath>
        <p className="note-text">
          A quick read on where the match went well and where it hurt — only shown when at least two
          stages have the number to compare.
        </p>
        <Why>
          the useful post-match question is &ldquo;which stage cost me?&rdquo; This points you there. It is
          a <em>relative</em> read within one match — where you were strongest and weakest that day, not
          whether a stage was objectively good.
        </Why>
        <OurRead />
      </div>

      <div className="card" id="classification">
        <h2>Classification (USPSA)</h2>
        <TheMath>
          the average of your <strong>best 6 of your 8 most recent</strong> classifier percentages; when
          that average crosses a band, you move up.
        </TheMath>
        <div className="row"><span className="label">C</span><span className="value">40&ndash;59.9%</span></div>
        <div className="row"><span className="label">B</span><span className="value">60&ndash;74.9%</span></div>
        <div className="row"><span className="label">A</span><span className="value">75&ndash;84.9%</span></div>
        <div className="row"><span className="label">Master</span><span className="value">85&ndash;94.9%</span></div>
        <div className="row"><span className="label">Grand Master</span><span className="value">95%+</span></div>
        <Why>
          it&rsquo;s the sport&rsquo;s standard measure of where you are and what&rsquo;s next; best-6-of-8
          smooths out a single bad classifier, so one off day doesn&rsquo;t drop your class.
        </Why>
        {USPSA_CLASS_QUOTES.map((q) => (
          <RuleQuote key={q.section} quote={q.quote} section={q.section} />
        ))}
        <p className="report-note">
          Note: USPSA&rsquo;s own bracket lists Grand Master as &ldquo;95 to 110%&rdquo; — the top band runs
          past 100% because a classifier score can now exceed the reference hit factor. We show
          &ldquo;95%+&rdquo; as the plain-English band you cross to reach GM; the math is the same.
        </p>
      </div>

      <div className="card" id="steel">
        <h2>Steel Challenge (SCSA)</h2>
        <p className="note-text">
          Scored purely on <strong>time — lowest wins</strong>, the opposite of hit factor. No points, no
          power factor. Each <strong>string</strong>:
        </p>
        <div className="row"><span className="label">Your raw time</span><span className="value">as run</span></div>
        <div className="row"><span className="label">Each missed plate</span><span className="value">+3.00 s</span></div>
        <div className="row"><span className="label">String maximum</span><span className="value">30.00 s</span></div>
        <div className="row"><span className="label">Stop plate never hit</span><span className="value">scores 30.00 s</span></div>
        <TheMath>
          string = min(raw time + 3&times;misses, 30); stage = your <strong>best 4 of 5 strings</strong>
          (drop the slowest) — <strong>Outer Limits</strong> is 4 strings scored <strong>best 3 of
          4</strong> (also drop the slowest); match = sum of stage times, lowest wins.
        </TheMath>
        <Why>
          Steel is a pure speed game; dropping your slowest string means one fumble doesn&rsquo;t wreck a
          stage, and the 30-second cap keeps a disaster string from being unrecoverable.
        </Why>
        {STEEL_RULE_QUOTES.map((q) => (
          <RuleQuote key={q.section} quote={q.quote} section={q.section} />
        ))}
        <p className="report-note">
          When you enter your string times, your stage and match totals are derived from them, so they
          always match what you shot.
        </p>
      </div>

      <div className="card" id="idpa">
        <h2>IDPA (time-plus)</h2>
        <p className="note-text">
          Scored on <strong>time — lowest total wins</strong>, like Steel, but accuracy is folded in as
          added seconds instead of points. Points down (your accuracy cost):
        </p>
        <div className="row"><span className="label">A down-1 hit</span><span className="value">+1 s</span></div>
        <div className="row"><span className="label">A down-3 hit</span><span className="value">+3 s</span></div>
        <div className="row"><span className="label">A miss (scored &minus;5)</span><span className="value">+5 s</span></div>
        <p className="note-text">Penalties (added seconds):</p>
        <div className="row"><span className="label">Hit on a non-threat</span><span className="value">+5 s each</span></div>
        <div className="row"><span className="label">Procedural (PE)</span><span className="value">+3 s each</span></div>
        <div className="row"><span className="label">Flagrant penalty</span><span className="value">+10 s each</span></div>
        <div className="row"><span className="label">Failure to Do Right</span><span className="value">+20 s</span></div>
        <TheMath>stage = raw time + (points down &times; 1 s) + penalties; match = sum of stage times, lowest wins.</TheMath>
        <Why>
          it lets one sport score both speed and accuracy on the clock. Two things that trip people up, so
          they&rsquo;re handled for you: a <strong>hit on a non-threat is the 5-second penalty only</strong>
          — NOT also counted as points down, so it never double-counts. And there is <strong>no
          &ldquo;failure to neutralize&rdquo; penalty</strong> anymore — IDPA removed it; too few good hits
          just shows up as misses (&minus;5 each), plus a procedural if you fired too few rounds.
        </Why>
        {IDPA_RULE_QUOTES.map((q) => (
          <RuleQuote key={q.section} quote={q.quote} section={q.section} />
        ))}
        <p className="report-note">
          When you enter each stage&rsquo;s raw time, points down, and penalties, your totals are derived
          from them. (IDPA classification and moving up is coming — it needs the official brackets first, so
          it&rsquo;s not in the app yet.)
        </p>
      </div>

      <div className="card">
        <h2>Where these come from</h2>
        <p className="note-text">
          USPSA scoring — the official USPSA Competition Rules (rules.uspsa.org); USPSA classification — the
          USPSA Classification System document (uspsa.org); Steel Challenge — the official Steel Challenge
          Rules (rules.uspsa.org/scsa); IDPA — the 2026.2 IDPA Rulebook (idpa.com). Where a number is an
          official rule we show the rulebook&rsquo;s exact words, in quotes, with its section. Numbers marked
          as FirearmLog&rsquo;s own read are shown with their full math so you can check them, and a
          &ldquo;rule of thumb&rdquo; is coaching guidance from the shooting community, not an official rule.
        </p>
      </div>
    </div>
  );
}
