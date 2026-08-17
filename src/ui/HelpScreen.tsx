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
import { ClearAllSheet } from './ClearAllSheet.tsx';
import { APP_VERSION } from '../version.ts';

interface TourStep { title: string; body: string; view?: View }

/** True on the desktop layout — the EXACT media gate the sidebar and menu bar
 *  use (width and height): a landscape phone is wide but short, keeps the
 *  bottom tab bar, and must get the phone wording (audit #7). */
const DESKTOP_MQ = '(min-width: 900px) and (min-height: 500px)';
function useIsDesktop(): boolean {
  const [desk, setDesk] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_MQ).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MQ);
    const onChange = () => setDesk(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return desk;
}

const QUICK_TOUR: TourStep[] = [
  {
    title: 'Welcome to FirearmLog',
    body: 'Your range, match, and maintenance log — all on your own devices. Move around with the tabs along the bottom (on a computer they become a sidebar on the left, plus a menu bar across the top). Here\'s a quick lap around the main screens.',
  },
  {
    title: 'Home',
    body: 'Your dashboard. It flags what needs attention — cleaning coming due, ammo running low, goals — shows recent sessions and quick stats, and has a big button to log a new session.',
  },
  {
    title: 'Log',
    view: { kind: 'session-form' },
    body: 'Every range trip and dry-fire session, plus a calendar — tap a day to open it. Logging a session: pick the gun(s), add drills, rounds, timed skills, any malfunctions, photos or video, and notes. Tap any photo to caption it or draw labeled circles on it. You can edit anything later, forever — and to remove a session, swipe its row left in the list (it waits 30 days in Recently Deleted in case you change your mind).',
  },
  {
    title: 'Compete',
    view: { kind: 'match-form' },
    body: 'Matches and classifiers, your classification progress, and the season view. You can type a match in by hand or pull the results straight from a PractiScore export. Every score and number links to "How the numbers work" — the exact math behind it, and the official rule in its own words.',
  },
  {
    title: 'Progress',
    body: 'The big picture: rounds over time, your dry-to-live mix, goals you can check off, a skills check, a training grid, and your personal records. Filter any of it by gun or date range.',
  },
  {
    title: 'Your gear and data',
    view: { kind: 'guns' },
    body: 'Everything else is grouped into four sets: Your Gear (guns, optics, magazines, ammo, parts, care guides), Training (drills, how the numbers work), Records (maintenance, reminders, malfunctions, costs, reports), and App & Data (Tour & Setup, Settings, Sync & Backup, Free Up Space, Export as CSV, Import from CSV). On a phone they\'re under the More tab; on a computer they\'re down the sidebar.',
  },
  {
    title: 'Your data stays yours',
    body: 'Everything is stored on your device — no account, no cloud. Sync saves everything to a single file you then load on your other device through iCloud Drive. That\'s it — go log a session!',
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

  return [
    {
      title: 'Getting around',
      body: isDesktop
        ? 'On a computer, the left sidebar lists Home, Log, Compete, and Progress at the top, then your sections grouped into Your Gear, Training, Records, and App & Data — each one click away. Across the very top runs a menu bar with the commands: File holds New (session, match, classifier), Save to File, Load from File, your recent records, and the importers; Reports opens any report; Help is where these tours live. A few commands have keyboard shortcuts, shown right on their menu items. Want more room? View → Hide Sidebar tucks the sidebar away, and View → Show Sidebar brings it back. To search your log, open Log and click Search & Filter — it hunts across places, guns, drills, instructors, match names, and notes. Long lists elsewhere (drills, ammo, costs, and more) grow their own search box once they pass a handful of entries. Almost anything on screen — a number, a chart bar, a list row — can be clicked to open what\'s behind it.'
        : 'On a phone, the bar along the bottom has Home, Log, Compete, and Progress, plus More for everything else. To search your log, open Log and tap Search & Filter — it hunts across places, guns, drills, instructors, match names, and notes. Long lists elsewhere (drills, ammo, costs, and more) grow their own search box once they pass a handful of entries. Almost anything on screen — a number, a chart bar, a list row — can be tapped to open what\'s behind it.',
    },
    {
      title: 'Home',
      body: 'Home is your dashboard. Up top is Needs Attention — a gun due for cleaning, a reminder that\'s come due, ammo running low, goals you\'re chasing — and you can tap any item to jump to it. Just below sits Coming up: reminders you\'ve set that are near, like a battery swap or a spring change by round count. Below those are recent sessions, quick stats, and a big Log Session button. The Live-fire rounds and Sessions tiles have a range you can set to the last 6 or 12 months or all time. Tap a month on the rounds chart to see that month\'s sessions.',
    },
    {
      title: 'Logging a session',
      view: { kind: 'session-form' },
      body: 'Start a session from Home or the Log tab: set the date and place, pick the gun or guns and the rounds for each, and choose live-fire or dry-fire. If a gun has magazines linked to it, a Magazines line sits under it — pick the mags you ran and the gun\'s rounds split evenly across them, or tap a number to set the exact count; each mag\'s lifetime round count keeps itself from there, and skipping it changes nothing. Add drills (the picker only shows ones that fit the gun and dry/live). Under Timed Skills, tap "Add a timed-skills set" to log draws, reloads, splits, transitions, or a par drill — how many reps, your best time, and an optional typical time; mark it "cold" if it was your first work of the day with no warmup, and each skill\'s trend shows on the Progress tab. Record any malfunctions — you can note what happened, how you cleared it, and optionally which ammo and magazine were in play and the round number it happened on, so the Malfunctions report can show your patterns — attach photos or video, and add notes. A range fee and session notes live under Wrap-Up at the bottom; the range fee is the single place that fee counts toward Costs — it\'s never entered or counted twice. Sessions stay editable forever. On a phone or iPad, swipe a row left to remove it: a planned session goes straight to Recently Deleted, and a logged one shows you how (open it and tap Delete session). On a computer, planned sessions have a small delete icon on the row; for a logged session, open it and tap Delete session. Either way, deletions wait 30 days in Recently Deleted where you can restore them before they\'re gone for good.',
    },
    {
      title: 'Photos, captions & markup',
      body: 'Any photo or video you add — on a session, match, classifier, or gun — opens with a tap. Give it a caption (it shows under the photo everywhere) and notes. Tap the photo again in the panel to fill the screen with it (any labeled circles come along); tap the X or anywhere on the backdrop to close. On a photo, tap "Mark Up Photo" to draw labeled circles in different colors — say 1 "Bill Drill," 2 "Left hand only" — and the labels list underneath. The circles show on the thumbnails too, and they print on your reports. New photos shrink automatically so they don\'t fill up your phone.',
    },
    {
      title: 'Drills',
      view: { kind: 'drills' },
      body: `The drill library lives under ${at('Drills')}. FirearmLog starts you with a set of common pistol drills — Bill Drill, Dot Torture, El Presidente, and more — which you can edit, delete, or add to. Each drill knows which gun types it's for and whether it's dry-fire, live-fire, or both — that's how the session picker filters them. A drill has a short and an expandable full description, a scoring type, and a par or max score. When a session has drills, "Print Drills" makes a score sheet of them — a planned session prints blank boxes to fill in at the range, and a logged session prints the same table with your recorded results.`,
    },
    {
      title: 'Compete — matches',
      view: { kind: 'match-form' },
      body: 'The Compete tab holds your matches. Log a match with its type (USPSA Level 1/2/3, Section, State, Area, Nationals, IDPA tiers, Steel Challenge, local), division, power factor, gun, finishes, and stage-by-stage results, plus stage videos. Under the gun sits a Mags line — pick which mags ran the match, and once the match has a rounds-fired total, the rounds split across them for each mag\'s round count; until then it just stays pending. A mag that came back through sand, mud, or rain can be tagged so it flags as needing cleaning. The entry fee you enter is stored on the match itself; the Costs & Purchases screen reads it straight from there as the single source, so a match fee is never double-counted. The season view rolls up this year\'s matches, average finish, percent trend, and total fees. Open a logged match for a stage-by-stage breakdown that flags your weakest and strongest stages, and you can add each stage\'s A/C/D/miss breakdown to see what it would have scored with all A\'s. The debrief also shows a Speed & Accuracy read — your accuracy and your time as two separate numbers — and a "What it cost" card that turns the day\'s misses and penalties into points or seconds, with an all-A\'s what-if percent when every stage has its percent, hit breakdown, and time entered. A short coaching read says the debrief in one place — the stage that cost you the most, the points you kept, and an occasional question when a match was very clean (switch coaching remarks off in Settings to just see the numbers). Pick Steel Challenge as the match type and the stage entry switches to Steel scoring — you enter each string\'s time (and any missed plates), and FirearmLog keeps your best 4 of 5 strings and totals your time, lowest wins. Pick an IDPA match and it switches to IDPA time-plus scoring — enter each stage\'s raw time, points down, and any penalties, and FirearmLog adds them up (1 second per point down, plus the penalties) into a total where the lowest time wins.',
    },
    {
      title: 'Compete — classifiers',
      view: { kind: 'classifier-form' },
      body: 'Log classifier scores with their code, division, hit factor, and percent. You can attach photos and videos to a classifier too — handy if you film your run. The classification view shows every division you hold a class in at a glance — tap one to see its current percent and what you need for the next class (your C-toward-B progress), using best-6-of-8 style math. Tap "Show the scores that count" to see the actual window — which scores counted, which one drops with your next classifier, and the exact percent that would move you up.',
    },
    {
      title: 'Importing results (PractiScore, USPSA & Steel Challenge)',
      view: { kind: 'practiscore-import' },
      body: 'On Compete, tap "Import…" — there are two importers. "Import from PractiScore" brings in a match. PractiScore shows the results you need under "Old style results": tap Html Results, then Combined at the end of the TOP row, the one labelled Overall — Overall is the row\'s name rather than a button, and every row has a Combined. Then select the whole page and copy it; on a phone that means pressing and holding, then dragging down to the last shooter. Paste that in (or load a saved .csv or .txt file, or try the built-in sample), then tap which competitor is you. If you have put your name under Settings → Who you are, your own row is lifted to the top of that list — you still tap it yourself, and nothing is picked for you. Then preview your result, pick the gun you shot, and add an entry fee if you like. Division and power factor can be corrected before you save, and changing the division leaves your division finish blank, because it was worked out among the shooters the results put in that division. A Steel Challenge match comes in as a file instead. On practiscore.com, tap Scores, then the Steel Challenge box, search for your club, and open your match. At the bottom of the results table, under "Report for SCSA", tap SCSA Upload, then Make The File, and save the download. Those steps name the file SCSA_EventResults.csv; got at another way it can be a long name with no file ending, and either one is the right file. Load it with the same screen\'s "Load a file" button and the app recognises it and walks you through picking your entry. "Import USPSA Classifiers" brings your classifier scores in from USPSA the same way. Either way nothing is written until you tap Save, and what comes in is a normal match or classifier you can edit or delete.',
    },
    {
      title: 'Progress — goals',
      body: 'On the Progress tab, set targets like "Bill Drill under 2.0s." Add several in a row without leaving the form, check one off when you hit it, and edit or delete any goal later. Tap the star on a goal to make it your North Star — it pins to the top and shows on your Home screen.',
    },
    {
      title: 'Progress — skills check',
      body: 'Rate yourself 1–10 across the eight skill areas — Draw, Reload, Splits, Transitions, Accuracy, Movement, Mental Game, Recoil Control. Each dated check shows your latest snapshot and average, plus a history you can tap into to edit.',
    },
    {
      title: 'Progress — trends & filters',
      body: 'Trends charts your rounds over time with a color legend, and shows tiles for live + match rounds, dry-fire reps, your dry-to-live session ratio, and malfunctions per 1,000 rounds. Filter everything by gun type, individual gun, and a 6-, 12-, or 24-month span, or all time. Classification by division and personal records show here too — tap a record to open that drill\'s full history over time. An Accuracy across matches chart tracks your USPSA accuracy — the share of points you kept — over your matches, so you can read whether you\'re getting cleaner over a season. A Timed Skills card shows your best-time trend for any timed skill you\'ve logged — draw, reload, splits, transitions, par drill — with your personal record and a cold-vs-warmed-up comparison; cold sets show as a diamond on the chart instead of a dot.',
    },
    {
      title: 'Progress — training grid & records',
      body: 'The training grid shows a square per day, darker where you shot more — toggle 26 or 52 weeks, with the months labeled along the bottom. On a phone the squares are too small to tap one by one, so the grid is just to look at — tap a month below it for that month\'s totals. On a bigger screen, tap a square to open that day\'s session report — drills, notes, and target photos on one page (the checkbox switches to just the count). To change a session, open it from the Log. Personal records list your best result per drill.',
    },
    {
      title: 'Guns',
      view: { kind: 'guns' },
      body: `Your firearms live under ${at('Guns')}. Each carries its make, model, caliber, category, serial, date acquired, starting round count, recoil-spring interval, photos, and notes. Link a manufacturer Care Guide to a gun and its maintenance schedule comes along automatically — you can still customize it per gun. When a gun leaves the rotation, open it and choose Retire (still yours — kept for insurance, and you can un-retire any time) or "No longer own it" (sold, gifted, lost, stolen, or destroyed). Either way its past sessions and matches keep it on record, and its optic and magazines move to your inventory.`,
    },
    {
      title: 'Optics, magazines & spare parts',
      view: { kind: 'optics' },
      body: `Optics, magazines, and spare parts each have their own section — ${at('Optics')}, ${at('Magazines')}, and ${at('Parts')}. Parts and optics you buy feed into Costs & Purchases, and unassigned optics are grouped so you can see what's on the shelf. A magazine's round count is its starting count plus every round your logged sessions and matches attribute to it — pick the mags you ran when logging a session or a match and the counts keep themselves.`,
    },
    {
      title: 'Ammo & costs',
      view: { kind: 'ammo' },
      body: `Ammo (under ${at('Ammo')}) tracks your inventory with first-in-first-out cost basis, so the cost of rounds you shoot is figured from what you actually paid; when you add ammo you choose whether you're logging a purchase (it lands in Costs & Purchases) or just counting rounds you already own. ${at('Costs & Purchases')} pulls everything together — ammo, range fees, match fees, gear, travel — by category and month, with cost per round and spend by gun. Because a range fee lives on its session and a match fee lives on its match, each fee is stored in exactly one place and counted exactly once.`,
    },
    {
      title: 'Gun maintenance & care guides',
      view: { kind: 'maintenance' },
      body: `Log cleaning and parts changes under ${at('Gun Maintenance')}; schedules come from each gun's linked Care Guide or your own settings, and Home warns you when something's due. Care Guides (under ${at('Care Guides')}) holds manufacturer care guides for popular pistol, rifle, and shotgun makers, and you can add your own.`,
    },
    {
      title: 'Reminders',
      view: { kind: 'reminders' },
      body: `Reminders (under ${at('Reminders')}) nudge you about the things that run on a schedule — a red-dot battery once a year, a recoil spring by round count on a specific gun, a membership or classifier-currency renewal. Start from a template or write your own: set a date (it can repeat every year or every few months) or a round count on one gun, and add a note. There's no push notification while the app is closed, but a date reminder has an Add to Calendar button that hands it to your phone's calendar to do the alerting. What's near shows on Home under Coming up, and the full list here is grouped Overdue, Coming up, and Later. Mark one done and a repeating date rolls forward, a round-count one re-anchors to the gun's current rounds, and a one-off moves to Done.`,
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
      body: `Sync (under ${at('Sync & Backup')}) moves a single file between your devices through iCloud Drive or the Files app. Save to the file from the device you just used, then load it on the other one. The app tells you plainly when one copy is newer. ${at('Free Up Space')} makes smaller copies of older full-size photos when they're taking up room. ${at('Export as CSV')} saves your sessions, drill results, timed skills, guns, ammunition, costs and more as files you can open in Numbers, Excel or Google Sheets, or hand to another program. Each one saves separately, and the screen lists what it can do. A CSV holds numbers and words, so it is not a backup: Save to File is. ${at('Import from CSV')} goes the other way: pick a spreadsheet or another app's export, say which of your columns holds the date, the gun and the round count, see exactly what would be added, and take the whole import back out afterwards if it is not what you wanted.`,
    },
    {
      title: 'Setup & sample data',
      view: { kind: 'setup' },
      body: `The first time you open the app it walks you through setup in three steps — add a gun, pick a goal (or skip it), then log your first session from Home — or load a ready-made sample log so you can explore everything the app does. While the sample is loaded, "Start my own log" at the top of every screen clears it and starts yours; you can re-run setup any time from Tour & Setup.`,
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
        <button className="button secondary" style={{ marginBottom: 10, minHeight: 46 }} onClick={() => onGo(view)}>Take me there</button>
      )}
      <p className="report-note" aria-live="polite">Step {i + 1} of {steps.length}</p>
      {/* The advance button stays pinned: this row is the LAST element, and the
          sheet is bottom-anchored, so Next and (on the final step) Done sit in the
          identical spot every step — you can click straight through without moving
          the pointer. Back's slot is reserved on step 1 so the primary button
          never shifts sideways either. minHeight pins every tour button to one
          height so step 1 doesn't differ from the rest (audit F6). Mid-tour exit
          is the sheet's header ✕. */}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        {i > 0
          ? <button className="button secondary" style={{ flex: 1, minHeight: 46 }} onClick={() => setI(i - 1)}>‹ Back</button>
          : <span style={{ flex: 1 }} aria-hidden="true" />}
        {last
          ? <button className="button" style={{ flex: 1, minHeight: 46 }} onClick={onClose}>Done</button>
          : <button className="button" style={{ flex: 1, minHeight: 46 }} onClick={() => setI(i + 1)}>Next ›</button>}
      </div>
    </Sheet>
  );
}

export function HelpScreen({ onBack, open, initialTour }: {
  onBack: () => void; open: (v: View) => void;
  /** Start with a tour already running — how the desktop menu bar's Help >
   *  Quick/Full Tour items land here mid-tour instead of two clicks away.
   *  (App remounts this screen per request, so the initializer is enough.) */
  initialTour?: 'quick' | 'full';
}) {
  const isDesktop = useIsDesktop();
  const [active, setActive] = useState<null | 'quick' | 'full'>(initialTour ?? null);
  const [clearing, setClearing] = useState(false);
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
          section. Set Up walks you through adding your gear or loading sample data.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="button" style={{ flex: 1, minWidth: 100 }} onClick={() => setActive('quick')}>Quick Tour</button>
          <button className="button secondary" style={{ flex: 1, minWidth: 100 }} onClick={() => setActive('full')}>Full Tour</button>
          <button className="button secondary" style={{ flex: 1, minWidth: 100 }} onClick={() => open({ kind: 'setup' })}>Set Up</button>
        </div>
      </div>

      <div className="card">
        <h2>Keep a backup</h2>
        <p className="report-note">
          Your log lives only on your own devices — there's no account and no cloud copy. So your
          data is as safe as your backups: every so often, and before you switch phones or update,
          use <strong>Save to File</strong> (in {isDesktop ? 'Sync & Backup' : 'the More tab'}) to keep a
          copy in iCloud Drive or Files. That file is your safety net. The Home screen also reminds you
          once you've logged a fair bit since your last backup.
        </p>
      </div>

      <div className="card">
        <h2>Clear all data / Start over</h2>
        <p className="report-note" style={{ marginBottom: 10 }}>
          Erase everything on this device and begin from an empty log — handy once you've explored the
          sample data and want to start your own. It can't be undone, and your saved backup files
          aren't affected.
        </p>
        <button className="button danger" onClick={() => setClearing(true)}>Clear all data…</button>
      </div>

      <p className="report-note" style={{ textAlign: 'center', marginTop: 24 }}>
        FirearmLog v{APP_VERSION}
      </p>

      {active === 'quick' && <TourModal steps={QUICK_TOUR} onClose={() => setActive(null)} onGo={(v) => { setActive(null); open(v); }} />}
      {active === 'full' && <TourModal steps={fullSteps} onClose={() => setActive(null)} onGo={(v) => { setActive(null); open(v); }} />}
      {clearing && <ClearAllSheet onClose={() => setClearing(false)} />}
    </div>
  );
}
