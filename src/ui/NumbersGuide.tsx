// "How the numbers work" -- the in-app wiki/explainer: exactly how FirearmLog
// computes every number on the match debrief, with the source of each rule and
// honest flags where a figure is a community rule of thumb vs. an official rule.
// Read-only; no data, no storage.

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
          Official USPSA scoring (USPSA rulebook). When you enter a stage's A/C/D breakdown,
          FirearmLog derives the points from these values — so your points can never disagree with
          your hits.
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
        <p className="report-note">Official USPSA classification (USPSA rulebook).</p>
      </div>

      <div className="card">
        <h2>Where these come from</h2>
        <p className="note-text">
          The scoring and classification rules are from the official USPSA rulebook, now searchable
          online at rules.uspsa.org. Anything labeled a "rule of thumb" is common coaching guidance
          from the shooting community, not an official rule — we flag those so you always know the
          difference.
        </p>
      </div>
    </div>
  );
}
