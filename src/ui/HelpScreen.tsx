// Help hub + Quick Tour + Full Tour (M9 — Help & Tour; spec §14, req. 30).
// The Quick Tour is a short, skippable orientation on the shared Sheet (Esc
// closes it, aria-modal, like every dialog — §3.5 A1–A5). The Full Tour is the
// exhaustive, section-by-section guide, built from native <details> so it's
// keyboard- and screen-reader-friendly with no custom JS. The Setup Wizard is
// reached from here too (re-runnable, spec §14.3).
import { useState } from 'react';
import type { View } from './nav.ts';
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
    body: 'Guns, optics, ammo, magazines, drills, costs, maintenance, parts, reference guides, reports, and Help all live here. It\'s also where you import your old Pistol Tracker data.',
  },
  {
    title: 'Your data stays yours',
    body: 'Everything is stored on your device — no account, no cloud. Use Sync to push or pull a single file between your phone and computer through iCloud Drive. That\'s it — go log a session!',
  },
];

interface GuideSection { title: string; paras: string[] }

const FULL_TOUR: GuideSection[] = [
  {
    title: 'Getting around',
    paras: [
      'On a phone, the bar along the bottom has Home, Log, Compete, and Progress, plus More for everything else. On a computer the same items become a sidebar down the left, with the gear-and-data sections listed out so they\'re one click away.',
      'Tap the search button in the bar to search across sessions, guns, drills, matches, and notes. Almost anything you see — a number, a chart bar, a list row — can be tapped to open the thing behind it.',
    ],
  },
  {
    title: 'Home',
    paras: [
      'Home is your dashboard. Up top are alerts: a gun that\'s due for cleaning, ammo running low, goals you\'re chasing. Tap an alert to jump to it.',
      'Below that you\'ll find recent sessions, quick stats, and a big Log Session button. The rounds-by-month chart is searchable and tappable — tap a month to see that month\'s sessions.',
    ],
  },
  {
    title: 'Logging a session',
    paras: [
      'From Home or the Log tab, start a session: set the date and place, pick the gun or guns you shot and how many rounds each, and choose live-fire or dry-fire.',
      'Add as many drills as you like — the drill picker only shows drills that fit the gun type and whether you\'re shooting live or dry. Record times, scores, and notes per drill.',
      'Log any malfunctions (what happened, which gun, how you cleared it), attach photos or videos (they show as thumbnails), enter a range fee, and add notes. A planned-session checklist helps you pack.',
      'Sessions are editable forever. Open one and change anything; a malfunction always stays attached to a gun that\'s actually in the session.',
    ],
  },
  {
    title: 'Drills',
    paras: [
      'The drill library lives under More → Drills. Each drill knows which gun types it\'s for and whether it\'s dry-fire, live-fire, or both, which is how the session picker filters them.',
      'A drill has a short description plus an expandable full description, a scoring type, and a par or max score. You can multi-select drills and print them, and print target references where they apply.',
    ],
  },
  {
    title: 'Compete — matches',
    paras: [
      'The Compete tab holds your matches and classifiers. Log a match with its type (USPSA Level 1/2/3, Section, State, Area, Nationals, IDPA tiers, Steel Challenge, local), division, power factor, gun, finishes, and stage-by-stage results.',
      'Attach stage videos (handy for GoPro clips) — they show as thumbnails on the match and in reports. The season view rolls up this year\'s matches, average finish, percent trend, and fees.',
    ],
  },
  {
    title: 'Compete — classifiers & classification',
    paras: [
      'Log classifier scores with their code, division, hit factor, and percent. The classification view tracks your current percent and what you need for the next class (your C-toward-B progress), using best-6-of-8 style math.',
    ],
  },
  {
    title: 'Importing match results (PractiScore)',
    paras: [
      'On Compete, tap "Import from PractiScore," then paste or load a match\'s exported results (or try the built-in sample). The whole field comes in, you tap which competitor is you, and you get a preview of your result.',
      'Pick the gun you shot and add an entry fee if you like, then Save — it becomes a normal match you can edit or delete. Nothing is written until you tap Save.',
    ],
  },
  {
    title: 'Progress — goals',
    paras: [
      'On the Progress tab, the Goals card lets you set targets like "Bill Drill under 2.0s." Add several in a row without leaving the form, check one off when you hit it, and edit or delete any goal later.',
    ],
  },
  {
    title: 'Progress — skill self-assessment',
    paras: [
      'Rate yourself 1–10 across the eight skill areas (Draw, Reload, Splits, Transitions, Accuracy, Movement, Mental Game, Recoil Control). Each dated assessment shows your latest snapshot and average, and a history you can tap into to edit.',
    ],
  },
  {
    title: 'Progress — trends & filters',
    paras: [
      'The Trends card charts your rounds over time and shows tiles for live + match rounds, dry-fire reps, your dry-to-live ratio, and malfunctions per 1,000 rounds. A legend under the chart explains the colors.',
      'Filter everything by gun type, individual gun, and a 6-, 12-, or 24-month span. Classification by division and personal records show here too.',
    ],
  },
  {
    title: 'Progress — heatmap & records',
    paras: [
      'The training heatmap is a grid of days, darker where you shot more — toggle 26 or 52 weeks, and press a square to see that day\'s count. Personal records list your best result per drill.',
    ],
  },
  {
    title: 'Guns',
    paras: [
      'Under More → Guns, each firearm carries its make, model, caliber, category, serial, date acquired, starting round count, recoil-spring interval, photos, and notes.',
      'Link a manufacturer Reference to a gun and its maintenance schedule comes along automatically — you can still customize the schedule per gun.',
    ],
  },
  {
    title: 'Optics, magazines & spare parts',
    paras: [
      'Optics, magazines, and spare parts each have their own section under More. Parts and optics you buy feed into Costs, and unassigned optics are grouped so you can see what\'s on the shelf.',
    ],
  },
  {
    title: 'Ammo & costs',
    paras: [
      'Ammo tracks your inventory with first-in-first-out cost basis, so the cost of rounds you shoot is figured from what you actually paid. Adding ammo can double as recording a purchase.',
      'Costs pulls everything together — ammo, range fees, match fees, gear, travel — by category and month, with cost per round and spend by gun. A match\'s entry fee and a session\'s range fee each live in one place, so nothing is counted twice.',
    ],
  },
  {
    title: 'Maintenance & reference',
    paras: [
      'Log cleaning and parts changes under Maintenance; schedules come from each gun\'s linked Reference or your own custom settings, and Home warns you when something\'s due.',
      'Reference holds manufacturer care guides (with Atlas-style detail) for popular pistol, rifle, and shotgun makers, and you can add your own.',
    ],
  },
  {
    title: 'Reports',
    paras: [
      'More → Reports has printable reports: round count, costs, competition season, training summary, malfunctions, maintenance history, and an insurance inventory with your guns\' photos. There\'s also a one-session report on each session.',
      'Each opens a clean printable page — use your browser\'s "Save as PDF" to keep a copy.',
    ],
  },
  {
    title: 'Sync — phone & desktop',
    paras: [
      'Sync moves a single file between your devices through iCloud Drive or the Files app. Push from the device you just used, pull on the other one. The app tells you plainly when one copy is newer.',
    ],
  },
  {
    title: 'Setup & importing old data',
    paras: [
      'The first time you open the app it offers to import your Pistol Tracker backup or start fresh. You can re-run that any time from here in Help — re-importing the same file simply re-applies the records, it won\'t double anything up.',
      'After an import, a verification report checks that every record and round count came across.',
    ],
  },
  {
    title: 'Your data & privacy',
    paras: [
      'Everything stays on your own devices — there\'s no account, no server, and no subscription. Photos and videos are stored right alongside the records they belong to, and your sync file is yours to keep or move.',
    ],
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

export function HelpScreen({ onBack, open }: { onBack: () => void; open: (v: View) => void }) {
  const [tour, setTour] = useState(false);
  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Help</h1>

      <div className="card">
        <h2>Quick Tour</h2>
        <p className="report-note">A {QUICK_TOUR.length}-step walk through the main screens. Stop any time.</p>
        <button className="button" onClick={() => setTour(true)}>▶ Start Quick Tour</button>
      </div>

      <div className="card">
        <h2>Set up &amp; import data</h2>
        <p className="report-note">Import your Pistol Tracker backup, or start fresh. You can re-run this any time.</p>
        <button className="button secondary" onClick={() => open({ kind: 'setup' })}>Open setup</button>
      </div>

      <div className="card">
        <h2>Full Tour — the complete guide</h2>
        <p className="report-note" style={{ marginBottom: 8 }}>Every part of the app, section by section. Tap a heading to open it.</p>
        {FULL_TOUR.map((s) => (
          <details className="guide-sec" key={s.title}>
            <summary>{s.title}</summary>
            {s.paras.map((p, i) => (
              <p className="report-note" key={i} style={{ lineHeight: 1.5, marginTop: 6 }}>{p}</p>
            ))}
          </details>
        ))}
      </div>

      {tour && <QuickTour onClose={() => setTour(false)} />}
    </div>
  );
}
