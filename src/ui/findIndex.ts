// The ONE table behind "Find a screen" (decision 75, 12 Sep 2026), the sidebar
// groups (TabBar) and the "Where do I find…" index on Tour & Setup. Three
// surfaces, one list — so none of them can name a screen the others don't have.
//
// Two kinds of entry. `kind: 'screen'` is a real destination the More tab and
// the sidebar list (one per screen, in the same four groups). `kind: 'inside'`
// is a named thing that lives INSIDE a screen — the training grid on Progress,
// Manage lists under Settings — the case that produced the feature: a shooter
// knows it exists and cannot recall which screen holds it. Both kinds jump.
//
// `words` is the column that does the work: the plain words a shooter would
// actually type, in range language, not the code's vocabulary (rule 44).
// Matching is `matchesQuery` — every typed word must appear somewhere in
// name + words (+ the group name for the four real groups; the composite
// 'Home, Log, Compete & Progress' label is NOT searched, or "compete" would
// match all twenty-odd rows in it). A word listed here is a word that finds
// the row. Keep them lowercase; keep them the shooter's.
//
// `landing` is the exact title text of the screen the jump lands on (its
// large-title / h1). The E2E suite types each entry's first word, taps the
// first result, and asserts this text — a stale or wrong row fails the build.
import type { View } from './nav.ts';
import type { IconName } from './Icon.tsx';
import { telemetryState } from '../lib/telemetry.ts';

/** The four main tabs a result can switch to (the phone's More tab is never a destination). */
export type MainTab = 'home' | 'log' | 'compete' | 'progress';

export type FindGroupLabel =
  | 'Home, Log, Compete & Progress'
  | 'Your Gear'
  | 'Training'
  | 'Records'
  | 'App & Data';

export type FindTarget = { tab: MainTab } | { view: View };

export interface FindEntry {
  /** Stable id, used by tests and as the React key. */
  id: string;
  /** What the result row says. */
  name: string;
  /** Plain words a shooter might type — lowercase, the shooter's language. */
  words: string[];
  group: FindGroupLabel;
  kind: 'screen' | 'inside';
  go: FindTarget;
  /** The path lines the "Where do I find…" index shows. The More tab shows
   *  `phone` under each result; the desktop sidebar derives its own grey
   *  line from `desktop` via `sidebarPathFor` (findSearch.ts, decision 76),
   *  which strips the leading "sidebar → " and the group name — so keep
   *  that "sidebar → <group> → …" shape on every `inside` row. */
  phone: string;
  desktop: string;
  /** Exact title text on the screen the jump lands on (asserted by E2E). */
  landing: string;
  /** Screen rows only: the sidebar's icon and the other View kinds it highlights for. */
  icon?: IconName;
  also?: View['kind'][];
  /** Screen rows only: a shorter label for the dense desktop sidebar (the More
   *  tab and the index keep the full name). */
  short?: string;
  /** Screen rows only: the one-line description the "Where do I find…" index shows under the name. */
  sub?: string;
  /** Inside rows only: the id of the screen entry this thing lives on — its icon
   *  is the one the sidebar shows for the row. */
  parent?: string;
  /** Render only while true (checked each render). Mirrors TabBar's own gate. */
  when?: () => boolean;
}

const G = {
  main: 'Home, Log, Compete & Progress' as const,
  gear: 'Your Gear' as const,
  training: 'Training' as const,
  records: 'Records' as const,
  app: 'App & Data' as const,
};

export const FIND_INDEX: FindEntry[] = [
  // ── The four main tabs ─────────────────────────────────────────────────────
  { id: 'home', kind: 'screen', name: 'Home', group: G.main, go: { tab: 'home' }, icon: 'home',
    words: ['home', 'start', 'front page', 'dashboard', 'summary', 'today', 'overview'],
    phone: 'tab bar → Home', desktop: 'sidebar → Home', landing: 'FirearmLog' },
  { id: 'log', kind: 'screen', name: 'Log', group: G.main, go: { tab: 'log' }, icon: 'log',
    words: ['log', 'sessions', 'range trips', 'history of sessions', 'calendar', 'what i shot', 'log a session', 'new session', 'dry fire', 'live fire'],
    phone: 'tab bar → Log', desktop: 'sidebar → Log', landing: 'Log' },
  { id: 'compete', kind: 'screen', name: 'Compete', group: G.main, go: { tab: 'compete' }, icon: 'compete',
    words: ['compete', 'matches', 'competition', 'uspsa', 'idpa', 'steel challenge', 'scores', 'stages', 'log a match', 'match results'],
    phone: 'tab bar → Compete', desktop: 'sidebar → Compete', landing: 'Compete' },
  { id: 'progress', kind: 'screen', name: 'Progress', group: G.main, go: { tab: 'progress' }, icon: 'progress',
    words: ['progress', 'charts', 'trends', 'am i improving', 'getting better', 'stats', 'statistics', 'graphs', 'numbers over time'],
    phone: 'tab bar → Progress', desktop: 'sidebar → Progress', landing: 'Progress' },

  // ── Inside Home / Log / Compete / Progress ────────────────────────────────
  { id: 'log-search', kind: 'inside', parent: 'log', name: 'Search & Filter your log', group: G.main, go: { tab: 'log' },
    words: ['search', 'filter', 'find a session', 'search my log', 'search notes', 'find by gun', 'find by drill', 'find by place', 'find by instructor', 'look up a session'],
    phone: 'tab bar → Log → Search & Filter', desktop: 'sidebar → Log → Search & Filter', landing: 'Log' },
  { id: 'log-deleted', kind: 'inside', parent: 'log', name: 'Recently Deleted sessions', group: G.main, go: { tab: 'log' },
    words: ['deleted', 'recently deleted', 'trash', 'restore', 'undo delete', 'get a session back', 'undelete', 'bin'],
    phone: 'tab bar → Log → scroll to Recently Deleted', desktop: 'sidebar → Log → scroll to Recently Deleted', landing: 'Log' },
  { id: 'log-planned', kind: 'inside', parent: 'log', name: 'Plan a session', group: G.main, go: { tab: 'log' },
    words: ['plan', 'planned session', 'schedule a session', 'upcoming', 'next range day', 'plan session', 'coming up'],
    phone: 'tab bar → Log → + Plan Session', desktop: 'sidebar → Log → + Plan Session', landing: 'Log' },
  { id: 'progress-grid', kind: 'inside', parent: 'progress', name: 'Training grid', group: G.main, go: { tab: 'progress' },
    words: ['training grid', 'heatmap', 'heat map', 'calendar squares', 'squares', 'days i shot', 'streak', 'green squares', 'activity grid', 'rounds by day', 'consistency'],
    phone: 'tab bar → Progress → Training grid', desktop: 'sidebar → Progress → Training grid', landing: 'Progress' },
  { id: 'progress-goals', kind: 'inside', parent: 'progress', name: 'Goals & your North Star', group: G.main, go: { tab: 'progress' },
    words: ['goals', 'goal', 'north star', 'target', 'targets i set', 'what am i working toward', 'add a goal', 'edit goal', 'check off a goal'],
    phone: 'tab bar → Progress → Goals', desktop: 'sidebar → Progress → Goals', landing: 'Progress' },
  { id: 'progress-timed', kind: 'inside', parent: 'progress', name: 'Timed Skills', group: G.main, go: { tab: 'progress' },
    words: ['timed skills', 'draw time', 'draws', 'reloads', 'splits', 'transitions', 'par time', 'par drills', 'timer', 'best times', 'cold', 'personal records', 'prs', 'fastest'],
    phone: 'tab bar → Progress → Timed Skills', desktop: 'sidebar → Progress → Timed Skills', landing: 'Progress' },
  { id: 'progress-drill-history', kind: 'inside', parent: 'progress', name: 'Drill History', group: G.main, go: { tab: 'progress' },
    words: ['drill history', 'history of a drill', 'one drill over time', 'bill drill history', 'how a drill is trending', 'measured', 'drill trend'],
    phone: 'tab bar → Progress → Personal Records → tap a drill', desktop: 'sidebar → Progress → Personal Records → click a drill', landing: 'Progress' },
  { id: 'progress-skills-check', kind: 'inside', parent: 'progress', name: 'Skills Check & Rating trends', group: G.main, go: { tab: 'progress' },
    words: ['skills check', 'rate yourself', 'self rating', 'ratings', 'rating trends', 'assessment', 'how i rate', 'eight areas', 'self assessment'],
    phone: 'tab bar → Progress → Skills Check', desktop: 'sidebar → Progress → Skills Check', landing: 'Progress' },
  { id: 'progress-trends', kind: 'inside', parent: 'progress', name: 'Trends (rounds, reps, dry : live)', group: G.main, go: { tab: 'progress' },
    words: ['trends', 'rounds per month', 'rounds fired', 'round count over time', 'dry to live', 'dry fire ratio', 'malfunctions per 1000', 'stoppage rate', 'reps'],
    phone: 'tab bar → Progress → Trends', desktop: 'sidebar → Progress → Trends', landing: 'Progress' },
  { id: 'progress-accuracy', kind: 'inside', parent: 'progress', name: 'Accuracy across matches', group: G.main, go: { tab: 'progress' },
    words: ['accuracy', 'points kept', 'match accuracy', 'hits', 'alphas', 'accuracy trend', 'points percentage'],
    phone: 'tab bar → Progress → Accuracy across matches', desktop: 'sidebar → Progress → Accuracy across matches', landing: 'Progress' },
  { id: 'compete-classification', kind: 'inside', parent: 'compete', name: 'Classification (your class)', group: G.main, go: { tab: 'compete' },
    words: ['classification', 'my class', 'class', 'classifiers', 'classifier scores', 'best 6 of 8', 'unclassified', 'a class', 'b class', 'c class', 'd class', 'grand master', 'division', 'classification grid', 'ladder', 'how close to next class'],
    phone: 'tab bar → Compete → Classification', desktop: 'sidebar → Compete → Classification', landing: 'Compete' },
  { id: 'compete-log-classifier', kind: 'inside', parent: 'compete', name: 'Log a classifier', group: G.main, go: { view: { kind: 'classifier-form' } },
    words: ['log classifier', 'add classifier', 'enter a classifier score', 'classifier', 'hit factor', 'new classifier'],
    phone: 'tab bar → Compete → + Log Classifier', desktop: 'sidebar → Compete → + Log Classifier', landing: 'Log Classifier' },
  { id: 'compete-log-match', kind: 'inside', parent: 'compete', name: 'Log a match', group: G.main, go: { view: { kind: 'match-form' } },
    words: ['log match', 'add match', 'new match', 'enter match', 'record a match', 'match', 'stage scores', 'match fee'],
    phone: 'tab bar → Compete → + Log Match', desktop: 'sidebar → Compete → + Log Match', landing: 'Log Match' },
  { id: 'compete-practiscore', kind: 'inside', parent: 'compete', name: 'Import from PractiScore', group: G.main, go: { view: { kind: 'practiscore-import' } },
    words: ['practiscore', 'import match', 'import results', 'match import', 'bring in match results', 'import scores'],
    phone: 'tab bar → Compete → Import → PractiScore', desktop: 'sidebar → Compete → Import → PractiScore', landing: 'Import from PractiScore' },
  { id: 'compete-uspsa-import', kind: 'inside', parent: 'compete', name: 'Import USPSA classifier records', group: G.main, go: { view: { kind: 'uspsa-import' } },
    words: ['uspsa import', 'import classifiers', 'classifier records', 'member number', 'uspsa records', 'import my classification'],
    phone: 'tab bar → Compete → Import → USPSA', desktop: 'sidebar → Compete → Import → USPSA', landing: 'Import USPSA Classifiers' },
  { id: 'home-attention', kind: 'inside', parent: 'home', name: 'Needs Attention (nudges & reminders due)', group: G.main, go: { tab: 'home' },
    words: ['needs attention', 'nudge', 'nudges', 'what needs doing', 'overdue', 'due', 'clean magazines', 'reminders due', 'battery due', 'alerts'],
    phone: 'tab bar → Home → Needs Attention', desktop: 'sidebar → Home → Needs Attention', landing: 'FirearmLog' },
  { id: 'home-status', kind: 'inside', parent: 'home', name: 'Firearm Status', group: G.main, go: { tab: 'home' },
    words: ['firearm status', 'gun status', 'rounds since cleaning', 'when did i last clean', 'which gun needs cleaning', 'status'],
    phone: 'tab bar → Home → Firearm Status', desktop: 'sidebar → Home → Firearm Status', landing: 'FirearmLog' },

  // ── Your Gear ─────────────────────────────────────────────────────────────
  { id: 'guns', kind: 'screen', name: 'Guns', group: G.gear, go: { view: { kind: 'guns' } }, icon: 'gun', also: ['gun-detail', 'gun-form'],
    words: ['guns', 'gun', 'firearms', 'pistols', 'rifles', 'my guns', 'add a gun', 'serial number', 'round count per gun', 'lifetime rounds', 'gun photos', 'retire a gun', 'sold a gun'],
    phone: 'More → Guns', desktop: 'sidebar → Your Gear → Guns', landing: 'Guns' },
  { id: 'optics', kind: 'screen', name: 'Optics', group: G.gear, go: { view: { kind: 'optics' } }, icon: 'optic', also: ['optic-form'],
    words: ['optics', 'optic', 'red dot', 'dot', 'sight', 'sights', 'scope', 'battery', 'battery log', 'change battery', 'rmr', 'holosun', 'zero'],
    phone: 'More → Optics', desktop: 'sidebar → Your Gear → Optics', landing: 'Optics' },
  { id: 'magazines', kind: 'screen', name: 'Magazines', group: G.gear, go: { view: { kind: 'magazines' } }, icon: 'magazine', also: ['magazine-form'],
    words: ['magazines', 'mags', 'mag', 'magazine', 'mag springs', 'which mags need cleaning', 'mag condition', 'muddy mags', 'used with', 'base pads'],
    phone: 'More → Magazines', desktop: 'sidebar → Your Gear → Magazines', landing: 'Magazines' },
  { id: 'ammo', kind: 'screen', name: 'Ammo', group: G.gear, go: { view: { kind: 'ammo' } }, icon: 'ammo', also: ['ammo-form'],
    words: ['ammo', 'ammunition', 'rounds on hand', 'how much ammo do i have', 'cost per round', 'bought ammo', 'add ammo', 'caliber', 'grain', 'bullets', 'on the shelf', 'ammo can'],
    phone: 'More → Ammo', desktop: 'sidebar → Your Gear → Ammo', landing: 'Ammo' },
  { id: 'parts', kind: 'screen', name: 'Parts', group: G.gear, go: { view: { kind: 'parts' } }, icon: 'parts', also: ['part-form'],
    words: ['parts', 'spare parts', 'springs', 'recoil spring', 'extractor', 'firing pin', 'replacement parts', 'part life', 'when to replace'],
    phone: 'More → Parts', desktop: 'sidebar → Your Gear → Parts', landing: 'Parts' },
  { id: 'references', kind: 'screen', name: 'Care Guides', group: G.gear, go: { view: { kind: 'references' } }, icon: 'reference', also: ['reference-detail', 'reference-form'],
    words: ['care guides', 'care guide', 'cleaning guide', 'how to clean', 'maintenance guide', 'cleaning checklist', 'suggested schedule', 'manufacturer', 'manual', 'lubrication', 'oil', 'field strip'],
    phone: 'More → Care Guides', desktop: 'sidebar → Your Gear → Care Guides', landing: 'Care Guides' },

  // ── Training ──────────────────────────────────────────────────────────────
  { id: 'drills', kind: 'screen', name: 'Drills', group: G.training, go: { view: { kind: 'drills' } }, icon: 'drills', also: ['drill-form'],
    words: ['drills', 'drill', 'drill library', 'bill drill', 'el presidente', 'dot torture', 'steel challenge stages', 'smoke and hope', 'add a drill', 'my drills', 'drills by skill', 'movement drills', 'what to practice'],
    phone: 'More → Drills', desktop: 'sidebar → Training → Drills', landing: 'Drills' },
  { id: 'numbers', kind: 'screen', name: 'How the numbers work', short: 'The numbers', group: G.training, go: { view: { kind: 'numbers' } }, icon: 'info', also: [],
    words: ['the numbers', 'how the numbers work', 'how is this calculated', 'hit factor explained', 'what does this mean', 'formulas', 'wiki', 'explain', 'definitions', 'how classification works'],
    phone: 'More → The numbers', desktop: 'sidebar → Training → The numbers, or the Help menu', landing: 'How the numbers work' },

  // ── Records ───────────────────────────────────────────────────────────────
  { id: 'maintenance', kind: 'screen', name: 'Gun Maintenance', group: G.records, go: { view: { kind: 'maintenance' } }, icon: 'maintenance', also: [],
    words: ['maintenance', 'gun maintenance', 'cleaning', 'cleaned', 'log a cleaning', 'i cleaned my gun', 'upkeep', 'service', 'gunsmith', 'work done', 'recent work'],
    phone: 'More → Gun Maintenance', desktop: 'sidebar → Records → Gun Maintenance', landing: 'Gun Maintenance' },
  { id: 'reminders', kind: 'screen', name: 'Reminders', group: G.records, go: { view: { kind: 'reminders' } }, icon: 'reminder', also: ['reminder-form'],
    words: ['reminders', 'reminder', 'remind me', 'overdue', 'due dates', 'schedule', 'standard reminders', 'clean every', 'battery reminder', 'coming up', 'later'],
    phone: 'More → Reminders', desktop: 'sidebar → Records → Reminders', landing: 'Reminders' },
  { id: 'malfunctions', kind: 'screen', name: 'Malfunctions', group: G.records, go: { view: { kind: 'malfunctions' } }, icon: 'malfunction', also: [],
    words: ['malfunctions', 'malfunction', 'stoppages', 'jams', 'jam', 'failure to feed', 'failure to eject', 'light strike', 'hammer down', 'double feed', 'problems with a gun', 'misfire'],
    phone: 'More → Malfunctions', desktop: 'sidebar → Records → Malfunctions', landing: 'Malfunctions' },
  { id: 'costs', kind: 'screen', name: 'Costs & Purchases', group: G.records, go: { view: { kind: 'costs' } }, icon: 'costs', also: ['purchase-form'],
    words: ['costs', 'purchases', 'spending', 'money', 'how much have i spent', 'cost per round', 'range fees', 'match fees', 'gun and gear cost', 'what did i pay', 'budget', 'receipts'],
    phone: 'More → Costs & Purchases', desktop: 'sidebar → Records → Costs & Purchases', landing: 'Costs & Purchases' },
  { id: 'costs-purchase', kind: 'inside', parent: 'costs', name: 'Log a purchase (gear, fees, parts)', group: G.records, go: { view: { kind: 'purchase-form' } },
    words: ['log a purchase', 'add purchase', 'bought', 'i bought', 'new purchase', 'gear purchase', 'range fee', 'match fee', 'holster', 'belt', 'bought a gun', 'firearm purchase', 'expense'],
    phone: 'More → Costs & Purchases → + Purchase', desktop: 'sidebar → Records → Costs & Purchases → + Purchase', landing: 'Add Purchase' },
  { id: 'reports', kind: 'screen', name: 'Reports', group: G.records, go: { view: { kind: 'reports' } }, icon: 'reports', also: [],
    words: ['reports', 'report', 'print', 'printable', 'pdf', 'save as pdf', 'round count report', 'costs report', 'competition season', 'training summary', 'maintenance history', 'insurance inventory', 'insurance', 'parts report', 'session report'],
    phone: 'More → Reports', desktop: "sidebar → Records → Reports, or the menu bar's Reports menu", landing: 'Reports' },

  // ── App & Data ────────────────────────────────────────────────────────────
  { id: 'help', kind: 'screen', name: 'Tour & Setup', group: G.app, go: { view: { kind: 'help' } }, icon: 'help', also: ['setup'],
    words: ['tour', 'help', 'quick tour', 'full tour', 'setup', 'set up', 'sample log', 'sample data', 'demo', 'where do i find', 'index', 'how do i', 'getting started', 'start over'],
    phone: 'More → Tour & Setup', desktop: 'sidebar → App & Data → Tour & Setup', landing: 'Tour & Setup' },
  { id: 'setup', kind: 'inside', parent: 'help', name: 'Set up your log (three steps)', group: G.app, go: { view: { kind: 'setup' } },
    words: ['set up my log', 'setup wizard', 'first gun', 'first goal', 'three steps', 'run setup again', 'new log'],
    phone: 'More → Tour & Setup → Set Up', desktop: 'sidebar → App & Data → Tour & Setup → Set Up', landing: 'Set up your log' },
  { id: 'settings', kind: 'screen', name: 'Settings', group: G.app, go: { view: { kind: 'settings' } }, icon: 'settings', also: [], sub: 'Coaching remarks, who you are, Manage lists',
    words: ['settings', 'preferences', 'options', 'who you are', 'my name', 'member number', 'uspsa number', 'idpa number', 'coaching remarks', 'coaching', 'turn off coaching', 'clear all data', 'delete everything', 'start over'],
    phone: 'More → Settings', desktop: 'sidebar → App & Data → Settings, or ⌘,', landing: 'Settings' },
  { id: 'manage-lists', kind: 'inside', parent: 'settings', name: 'Manage lists (places, brands, vendors)', group: G.app, go: { view: { kind: 'manage-lists' } },
    words: ['manage lists', 'lists', 'rename a range', 'places', 'locations', 'ranges', 'brands', 'vendors', 'suggestions', 'fix a misspelled range', 'tidy names', 'instructors list'],
    phone: 'More → Settings → Manage lists', desktop: 'sidebar → App & Data → Settings → Manage lists', landing: 'Manage lists' },
  { id: 'sync', kind: 'screen', name: 'Sync & Backup', group: G.app, go: { view: { kind: 'sync' } }, icon: 'sync', also: [],
    words: ['sync', 'backup', 'back up', 'save to file', 'load from file', 'flog', 'phone to computer', 'move my log', 'transfer', 'icloud', 'files app', 'restore a backup', 'copy my log', 'last backup'],
    phone: 'More → Sync & Backup', desktop: 'sidebar → App & Data → Sync & Backup', landing: 'Sync & Backup' },
  { id: 'sync-compress', kind: 'inside', parent: 'sync', name: 'Compress Photos (free up space)', group: G.app, go: { view: { kind: 'sync' } },
    words: ['compress photos', 'free up space', 'photos too big', 'shrink photos', 'storage', 'backup too large', 'file size', 'space', 'videos too big'],
    phone: 'More → Sync & Backup → Compress Photos', desktop: 'sidebar → App & Data → Sync & Backup → Compress Photos', landing: 'Sync & Backup' },
  { id: 'export-csv', kind: 'screen', name: 'Export as CSV', group: G.app, go: { view: { kind: 'export-csv' } }, icon: 'reports', also: [],
    words: ['export', 'csv', 'spreadsheet', 'excel', 'numbers app', 'google sheets', 'get my data out', 'download my data', 'export sessions'],
    phone: 'More → Export as CSV', desktop: 'sidebar → App & Data → Export as CSV', landing: 'Export as CSV' },
  { id: 'import-csv', kind: 'screen', name: 'Import from CSV', group: G.app, go: { view: { kind: 'import-csv' } }, icon: 'reports', also: [],
    words: ['import', 'import csv', 'bring in a spreadsheet', 'import from another app', 'import sessions', 'upload a spreadsheet', 'migrate', 'move from another app'],
    phone: 'More → Import from CSV', desktop: 'sidebar → App & Data → Import from CSV', landing: 'Import from CSV' },
  { id: 'your-data', kind: 'screen', name: 'Your Data', group: G.app, go: { view: { kind: 'your-data' } }, icon: 'shield', also: [], when: () => telemetryState().wired,
    words: ['your data', 'privacy', 'what is collected', 'usage stats', 'crash reports', 'opt out', 'compare with shooters like you', 'anonymous'],
    phone: 'More → Your Data', desktop: 'sidebar → App & Data → Your Data', landing: 'Your Data' },
];

/** Entries that should render right now (the `when` gate applied). */
export function findEntries(): FindEntry[] {
  return FIND_INDEX.filter((e) => !e.when || e.when());
}

/** The order groups appear in, everywhere the index is shown. */
export const FIND_GROUP_ORDER: FindGroupLabel[] = [
  'Home, Log, Compete & Progress', 'Your Gear', 'Training', 'Records', 'App & Data',
];
