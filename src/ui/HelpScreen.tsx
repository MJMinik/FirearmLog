// Help hub + Quick Tour + Full Tour (M9 — Help & Tour; spec §14, req. 30).
// Both tours present the same way: a stepped, skippable card on the shared Sheet
// (Esc closes it, aria-modal — §3.5 A1–A5). The Full Tour is exhaustive and
// comes in TWO versions — phone vs. desktop — because navigation differs (e.g.
// the gear sections live under "More" on a phone but in the sidebar on a
// computer). One builder produces both so the prose stays in one place (DRY).
import { useEffect, useMemo, useState } from 'react';
import type { View } from './nav.ts';
import { Sheet } from './Sheet.tsx';
import { InstallCard } from './InstallCard.tsx';
import { APP_VERSION } from '../version.ts';

interface TourStep { title: string; body: string; view?: View }

/** True on the ≥900px desktop layout (matches the sidebar breakpoint). */
function useIsDesktop(): boolean {
  const [desk, setDesk] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const onChange = () => setDesk(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return desk;
}

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
    view: { kind: 'session-form' },
    body: 'Every range trip and dry-fire session, plus a calendar — tap a day to open it. Logging a session: pick the gun(s), add drills, rounds, any malfunctions, photos or video, and notes. Tap any photo to caption it or draw labeled circles on it. You can edit anything later, forever — and to remove a session, swipe its row left in the list (it waits 30 days in Recently Deleted in case you change your mind).',
  },
  {
    title: 'Compete',
    view: { kind: 'match-form' },
    body: 'Matches and classifiers, your classification progress, and the season view. You can type a match in by hand or pull the results straight from a PractiScore export.',
  },
  {
    title: 'Progress',
    body: 'The big picture: rounds over time, your dry-to-live mix, goals you can check off, skill self-ratings, a training heatmap, and your personal records. Filter any of it by gun or date range.',
  },
  {
    title: 'Your gear and data',
    view: { kind: 'guns' },
    body: 'Guns, optics, ammo, magazines, drills, costs, maintenance, malfunctions, parts, reference guides, and reports. Tour & Setup sits just below them. On a phone they\'re under the More tab; on a computer they\'re listed down the sidebar.',
  },
  {
    title: 'Your data stays yours',
    body: 'Everything is stored on your device — no account, no cloud. Use Sync to push or pull a single file between your phone and computer through iCloud Drive. That\'s it — go log a session!',
  },
];

/**
 * The exhaustive Full Tour. `isDesktop` switches the navigation wording: gear
 * sections are reached via "More" on a phone and the sidebar on a computer.
 */
function buildFullTour(isDesktop: boolean): TourStep[] {
  // Where a gear/data section lives, phrased for the current layout.
  const at = (section: string) =>
    isDesktop ? `the ${section} section in the sidebar` : `More → ${section}`;
  // The catch-all screen that holds Sync, import, and Help.
  const hub = isDesktop ? 'the Gear & Data screen (bottom of the sidebar)' : 'the More tab';

  return [
    {
      title: 'Getting around',
      body: isDesktop
        ? 'On a computer, the left sidebar lists Home, Log, Compete, and Progress at the top, then a "Data & Gear" group with every section — Guns, Optics, Ammo, Drills, Costs, and the rest — each one click away. Use the search button to search across sessions, guns, drills, matches, and notes. Almost anything on screen — a number, a chart bar, a list row — can be clicked to open what\'s behind it.'
        : 'On a phone, the bar along the bottom has Home, Log, Compete, and Progress, plus More for everything else. Use the search button to search across sessions, guns, drills, matches, and notes. Almost anything on screen — a number, a chart bar, a list row — can be tapped to open what\'s behind it.',
    },
    {
      title: 'Home',
      body: 'Home is your dashboard. Up top are alerts — a gun due for cleaning, ammo running low, goals you\'re chasing — and you can tap any alert to jump to it. Below are recent sessions, quick stats, and a big Log Session button. Tap a month on the rounds chart to see that month\'s sessions.',
    },
    {
      title: 'Logging a session',
      view: { kind: 'session-form' },
      body: 'Start a session from Home or the Log tab: set the date and place, pick the gun or guns and the rounds for each, and choose live-fire or dry-fire. Add drills (the picker only shows ones that fit the gun and dry/live), record any malfunctions — you can note what happened, how you cleared it, and optionally which ammo and magazine were in play and the round number it happened on, so the Malfunctions report can show your patterns — attach photos or video, and add notes. A range fee you enter here is stored on the session itself and is the single place that fee counts toward Costs — it\'s never entered or counted twice. Sessions stay editable forever. On a phone or iPad, swipe a row left to remove it: a planned session goes straight to Recently Deleted, and a logged one shows you how (open it and tap Delete Session). On a computer, planned sessions have a small delete icon on the row; for a logged session, open it and tap Delete Session. Either way, deletions wait 30 days in Recently Deleted where you can restore them before they\'re gone for good.',
    },
    {
      title: 'Photos, captions & markup',
      body: 'Any photo or video you add — on a session, match, classifier, or gun — opens with a tap. Give it a caption (it shows under the photo everywhere) and notes. On a photo, tap "Mark Up Photo" to draw labeled circles in different colors — say 1 "Bill Drill," 2 "Left hand only" — and the labels list underneath. The circles show on the thumbnails too, and they print on your reports. New photos shrink automatically so they don\'t fill up your phone.',
    },
    {
      title: 'Drills',
      view: { kind: 'drills' },
      body: `The drill library lives under ${at('Drills')}. Each drill knows which gun types it's for and whether it's dry-fire, live-fire, or both — that's how the session picker filters them. A drill has a short and an expandable full description, a scoring type, and a par or max score. When a session has drills, "Print Drills" makes a score sheet of them — a planned session prints blank boxes to fill in at the range, and a logged session prints the same table with your recorded results.`,
    },
    {
      title: 'Compete — matches',
      view: { kind: 'match-form' },
      body: 'The Compete tab holds your matches. Log a match with its type (USPSA Level 1/2/3, Section, State, Area, Nationals, IDPA tiers, Steel Challenge, local), division, power factor, gun, finishes, and stage-by-stage results, plus stage videos. The entry fee you enter is stored on the match itself; the Costs screen reads it straight from there as the single source, so a match fee is never double-counted. The season view rolls up this year\'s matches, average finish, percent trend, and total fees.',
    },
    {
      title: 'Compete — classifiers',
      view: { kind: 'classifier-form' },
      body: 'Log classifier scores with their code, division, hit factor, and percent. You can attach photos and videos to a classifier too — handy if you film your run. The classification view tracks your current percent and what you need for the next class — your C-toward-B progress — using best-6-of-8 style math.',
    },
    {
      title: 'Importing results (PractiScore & USPSA)',
      view: { kind: 'practiscore-import' },
      body: 'On Compete, tap "Import…" — there are two importers. "Import from PractiScore" brings in a match: paste or load its exported results (or try the built-in sample), then search for and tap which competitor is you, preview your result, pick the gun you shot, and add an entry fee if you like. "Import USPSA Classifiers" brings your classifier scores in from USPSA the same way. Either way nothing is written until you tap Save, and what comes in is a normal match or classifier you can edit or delete.',
    },
    {
      title: 'Progress — goals',
      body: 'On the Progress tab, set targets like "Bill Drill under 2.0s." Add several in a row without leaving the form, check one off when you hit it, and edit or delete any goal later.',
    },
    {
      title: 'Progress — skill self-assessment',
      body: 'Rate yourself 1–10 across the eight skill areas — Draw, Reload, Splits, Transitions, Accuracy, Movement, Mental Game, Recoil Control. Each dated assessment shows your latest snapshot and average, plus a history you can tap into to edit.',
    },
    {
      title: 'Progress — trends & filters',
      body: 'Trends charts your rounds over time with a color legend, and shows tiles for live + match rounds, dry-fire reps, your dry-to-live ratio, and malfunctions per 1,000 rounds. Filter everything by gun type, individual gun, and a 6-, 12-, or 24-month span. Classification by division and personal records show here too.',
    },
    {
      title: 'Progress — heatmap & records',
      body: 'The training heatmap is a grid of days, darker where you shot more — toggle 26 or 52 weeks, with the months labeled along the bottom, and press a square to see that day\'s count — or flip on "Tap a day to open its session" to jump straight into that day\'s log. Personal records list your best result per drill.',
    },
    {
      title: 'Guns',
      view: { kind: 'guns' },
      body: `Your firearms live under ${at('Guns')}. Each carries its make, model, caliber, category, serial, date acquired, starting round count, recoil-spring interval, photos, and notes. Link a manufacturer Reference to a gun and its maintenance schedule comes along automatically — you can still customize it per gun. When a gun leaves the rotation, open it and choose Retire (still yours — kept for insurance, and you can un-retire any time) or "No longer own it" (sold, gifted, lost, stolen, or destroyed). Either way its past sessions and matches keep it on record, and its optic and magazines move to your inventory.`,
    },
    {
      title: 'Optics, magazines & spare parts',
      view: { kind: 'optics' },
      body: `Optics, magazines, and spare parts each have their own section — ${at('Optics')}, ${at('Magazines')}, and ${at('Spare Parts & Inventory')}. Parts and optics you buy feed into Costs, and unassigned optics are grouped so you can see what's on the shelf.`,
    },
    {
      title: 'Ammo & costs',
      view: { kind: 'ammo' },
      body: `Ammo (under ${at('Ammo')}) tracks your inventory with first-in-first-out cost basis, so the cost of rounds you shoot is figured from what you actually paid; when you add ammo you choose whether you're logging a purchase (it lands in Costs) or just counting rounds you already own. Costs (under ${at('Costs & Purchases')}) pulls everything together — ammo, range fees, match fees, gear, travel — by category and month, with cost per round and spend by gun. Because a range fee lives on its session and a match fee lives on its match, each fee is stored in exactly one place and counted exactly once.`,
    },
    {
      title: 'Maintenance & reference',
      view: { kind: 'maintenance' },
      body: `Log cleaning and parts changes under ${at('Maintenance')}; schedules come from each gun's linked Reference or your own settings, and Home warns you when something's due. Reference (under ${at('Reference')}) holds manufacturer care guides for popular pistol, rifle, and shotgun makers, and you can add your own.`,
    },
    {
      title: 'Malfunctions',
      view: { kind: 'malfunctions' },
      body: `Every malfunction you record while logging a session collects under ${at('Malfunctions')} — newest first. Search by any word, or filter by gun, type, ammo, magazine, or date range to spot patterns, like a magazine or a batch of ammo that jams more than the rest, and tap any one to jump to the session it happened in. The Malfunctions report (under Reports) totals them up by gun, type, ammo, and magazine.`,
    },
    {
      title: 'Reports',
      view: { kind: 'reports' },
      body: `You'll find printable reports under ${at('Reports')}: round count, costs, competition season, training summary, malfunctions, maintenance history, and an insurance inventory with your guns' photos. There's also a one-session report on each session. Each opens a clean printable page — use your browser's "Save as PDF" to keep a copy.`,
    },
    {
      title: 'Sync — phone & desktop',
      body: `Sync (on ${hub}) moves a single file between your devices through iCloud Drive or the Files app. Push from the device you just used, pull on the other one. The app tells you plainly when one copy is newer. On that same screen, Free Up Space appears when older full-size photos are taking up room — tap it to shrink them.`,
    },
    {
      title: 'Setup & sample data',
      view: { kind: 'setup' },
      body: `The first time you open the app it offers to start fresh — add your guns and gear right then — or load a ready-made sample log so you can explore everything the app does. You can re-run either any time from Tour & Setup, and clear the sample whenever you like by starting fresh.`,
    },
    {
      title: 'Your data & privacy',
      body: 'Everything stays on your own devices — no account, no server, no subscription. Photos and videos are stored right alongside the records they belong to, and your sync file is yours to keep or move.',
    },
  ];
}

function TourModal({ steps, onClose, onGo }: { steps: TourStep[]; onClose: () => void; onGo: (v: View) => void }) {
  const [i, setI] = useState(0);
  const step = steps[i];
  const view = step.view;
  const last = i === steps.length - 1;
  return (
    <Sheet title={step.title} onClose={onClose}>
      <p className="report-note" style={{ marginBottom: 14, lineHeight: 1.5 }}>{step.body}</p>
      {view && (
        <button className="button secondary" style={{ marginBottom: 10 }} onClick={() => onGo(view)}>Take me there</button>
      )}
      <p className="report-note" aria-live="polite">Step {i + 1} of {steps.length}</p>
      {/* The advance button stays pinned: this row is the LAST element, and the
          sheet is bottom-anchored, so Next and (on the final step) Done sit in the
          identical spot every step — you can click straight through without moving
          the pointer. Back's slot is reserved on step 1 so the primary button
          never shifts sideways either. Mid-tour exit is the sheet's header ✕. */}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        {i > 0
          ? <button className="button secondary" style={{ flex: 1 }} onClick={() => setI(i - 1)}>‹ Back</button>
          : <span style={{ flex: 1 }} aria-hidden="true" />}
        {last
          ? <button className="button" style={{ flex: 1 }} onClick={onClose}>Done</button>
          : <button className="button" style={{ flex: 1 }} onClick={() => setI(i + 1)}>Next ›</button>}
      </div>
    </Sheet>
  );
}

export function HelpScreen({ onBack, open }: { onBack: () => void; open: (v: View) => void }) {
  const isDesktop = useIsDesktop();
  const [active, setActive] = useState<null | 'quick' | 'full'>(null);
  const fullSteps = useMemo(() => buildFullTour(isDesktop), [isDesktop]);

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Tour &amp; Setup</h1>

      <InstallCard />

      <div className="card">
        <h2>Tours &amp; setup</h2>
        <p className="report-note" style={{ marginBottom: 10 }}>
          The Quick Tour is a fast lap around the app. The Full Tour is the complete guide, section by
          section. Set Up imports your old data or starts you fresh.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="button" style={{ flex: 1, minWidth: 100 }} onClick={() => setActive('quick')}>Quick Tour</button>
          <button className="button" style={{ flex: 1, minWidth: 100 }} onClick={() => setActive('full')}>Full Tour</button>
          <button className="button secondary" style={{ flex: 1, minWidth: 100 }} onClick={() => open({ kind: 'setup' })}>Set Up</button>
        </div>
      </div>

      <div className="card">
        <h2>Keep a backup</h2>
        <p className="report-note">
          Your log lives only on your own devices — there's no account and no cloud copy. So your
          data is as safe as your backups: every so often, and before you switch phones or update,
          use <strong>Push to File</strong> (in {isDesktop ? 'Gear & Data' : 'the More tab'}) to save a
          copy to iCloud Drive or Files. That file is your safety net. The Home screen also reminds you
          once you've logged a fair bit since your last backup.
        </p>
      </div>

      <p className="report-note" style={{ textAlign: 'center', marginTop: 24 }}>
        FirearmLog v{APP_VERSION}
      </p>

      {active === 'quick' && <TourModal steps={QUICK_TOUR} onClose={() => setActive(null)} onGo={(v) => { setActive(null); open(v); }} />}
      {active === 'full' && <TourModal steps={fullSteps} onClose={() => setActive(null)} onGo={(v) => { setActive(null); open(v); }} />}
    </div>
  );
}
