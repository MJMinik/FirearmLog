// Help hub + Quick Tour (M9 — Help & Tour, chunk 1; spec §14).
// The Quick Tour is a short, skippable orientation to the main screens. It runs
// on the shared Sheet, so Esc closes it and it's screen-reader-labelled like
// every other dialog (spec §3.5 guardrails A1–A5). The exhaustive Full Tour and
// the first-run Setup Wizard are the next chunks of M9.
import { useState } from 'react';
import { Sheet } from './Sheet.tsx';

interface TourStep { title: string; body: string }

const QUICK_TOUR: TourStep[] = [
  {
    title: 'Welcome to FirearmLog',
    body: 'Your range, match, and maintenance log — all on your own devices. Move around with the tabs along the bottom (on a computer they become a sidebar on the left). Here\'s a quick lap around the main screens.',
  },
  {
    title: 'Home',
    body: 'Your dashboard. It flags what needs attention — cleaning coming due, ammo running low, goals — shows recent sessions and quick stats, and has a big button to log a new session.',
  },
  {
    title: 'Log',
    body: 'Every range trip and dry-fire session, plus a calendar — tap a day to open it. Logging a session: pick the gun(s), add drills, rounds, any malfunctions, photos or video, and notes. You can edit anything later, forever.',
  },
  {
    title: 'Compete',
    body: 'Matches and classifiers, your classification progress, and the season view. You can type a match in by hand or pull the results straight from a PractiScore export.',
  },
  {
    title: 'Progress',
    body: 'The big picture: rounds over time, your dry-to-live mix, goals you can check off, skill self-ratings, a training heatmap, and your personal records. Filter any of it by gun or date range.',
  },
  {
    title: 'More — your gear and data',
    body: 'Guns, optics, ammo, magazines, drills, costs, maintenance, parts, reference guides, and reports all live here. It\'s also where you import your old Pistol Tracker data.',
  },
  {
    title: 'Your data stays yours',
    body: 'Everything is stored on your device — no account, no cloud. Use Sync to push or pull a single file between your phone and computer through iCloud Drive. That\'s it — go log a session!',
  },
];

export function QuickTour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const step = QUICK_TOUR[i];
  const last = i === QUICK_TOUR.length - 1;
  return (
    <Sheet title={step.title} onClose={onClose}>
      <p className="report-note" style={{ marginBottom: 14, lineHeight: 1.5 }}>{step.body}</p>
      <p className="report-note" aria-live="polite">Step {i + 1} of {QUICK_TOUR.length}</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        {i > 0 && (
          <button className="button secondary" style={{ flex: 1 }} onClick={() => setI(i - 1)}>‹ Back</button>
        )}
        {last
          ? <button className="button" style={{ flex: 1 }} onClick={onClose}>Done</button>
          : <button className="button" style={{ flex: 1 }} onClick={() => setI(i + 1)}>Next ›</button>}
      </div>
      {!last && (
        <button className="button secondary" style={{ marginTop: 8 }} onClick={onClose}>Skip the tour</button>
      )}
    </Sheet>
  );
}

export function HelpScreen({ onBack }: { onBack: () => void }) {
  const [tour, setTour] = useState(false);
  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Help</h1>

      <div className="card">
        <h2>Take the tour</h2>
        <p className="report-note">A quick {QUICK_TOUR.length}-step walk through the main screens. Stop any time.</p>
        <button className="button" onClick={() => setTour(true)}>▶ Start Quick Tour</button>
      </div>

      <div className="card">
        <h2>Good to know</h2>
        <p className="report-note" style={{ lineHeight: 1.5 }}>
          • Sessions are editable forever — open one and change anything, anytime.<br />
          • Tap a number, chart bar, or list row to open the thing behind it.<br />
          • Costs come from one place each — a match's entry fee and a session's range fee aren't entered twice.<br />
          • Your data lives on your device; use Sync to move it between phone and computer.
        </p>
      </div>

      <div className="card">
        <h2>More help coming</h2>
        <p className="report-note">
          A full, section-by-section guide and a first-run setup wizard are on the way. Tell me what's
          confusing and I'll make sure the guide covers it.
        </p>
      </div>

      {tour && <QuickTour onClose={() => setTour(false)} />}
    </div>
  );
}
