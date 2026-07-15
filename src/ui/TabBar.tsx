// Phone: bottom tab bar (Apple HIG). Desktop ≥900px: the SAME component lays
// out as a full sidebar with every section visible — feedback C1, spec §4.2.
// One component, two layouts via CSS; nothing is built twice.
//
// The sidebar sections are grouped to match the phone More screen: Your Gear /
// Training / Records / App & Data (Tour & Setup, Settings, Sync & Backup, Free
// Up Space), each a direct sidebar entry on desktop and a row under More on the
// phone. The phone-only "More" tab opens that grouped menu; on desktop the
// sidebar IS the menu, so the More button is hidden. Phone and desktop tell the
// same story.
import { Fragment } from 'react';
import type { View } from './nav.ts';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';
import { telemetryState } from '../lib/telemetry.ts';

export type TabId = 'home' | 'log' | 'compete' | 'progress' | 'more';

const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'log', label: 'Log', icon: 'log' },
  { id: 'compete', label: 'Compete', icon: 'compete' },
  { id: 'progress', label: 'Progress', icon: 'progress' }
];

type SectionDef = {
  target: View; label: string; icon: IconName; also: View['kind'][];
  /** Render this entry only when the condition holds (checked each render).
   *  Used by the Rung-1 "Your Data" row so the desktop sidebar matches the
   *  phone More screen: hidden while telemetry ships dark, present once a
   *  provider is wired — the required transparency surface (DATA_MOAT_SPEC
   *  §6a) must be reachable from BOTH nav layouts. */
  when?: () => boolean;
};

// Desktop-only direct links to the sections that live under More on the phone,
// grouped exactly like the phone More screen. Nothing is removed vs. the old
// flat list; the numbers wiki is here too for phone/desktop parity (shown as the
// short "The numbers" in this dense sidebar; the phone More screen keeps the full
// "How the numbers work"). — L4
const GROUPS: { label: string; sections: SectionDef[] }[] = [
  {
    label: 'Your Gear',
    sections: [
      { target: { kind: 'guns' }, label: 'Guns', icon: 'gun', also: ['gun-detail', 'gun-form'] },
      { target: { kind: 'optics' }, label: 'Optics', icon: 'optic', also: ['optic-form'] },
      { target: { kind: 'magazines' }, label: 'Magazines', icon: 'magazine', also: ['magazine-form'] },
      { target: { kind: 'ammo' }, label: 'Ammo', icon: 'ammo', also: ['ammo-form'] },
      { target: { kind: 'parts' }, label: 'Parts', icon: 'parts', also: ['part-form'] },
      { target: { kind: 'references' }, label: 'Care Guides', icon: 'reference', also: ['reference-detail', 'reference-form'] }
    ]
  },
  {
    label: 'Training',
    sections: [
      { target: { kind: 'drills' }, label: 'Drills', icon: 'drills', also: ['drill-form'] },
      { target: { kind: 'numbers' }, label: 'The numbers', icon: 'info', also: [] }
    ]
  },
  {
    label: 'Records',
    sections: [
      { target: { kind: 'maintenance' }, label: 'Gun Maintenance', icon: 'maintenance', also: [] },
      { target: { kind: 'reminders' }, label: 'Reminders', icon: 'reminder', also: ['reminder-form'] },
      { target: { kind: 'malfunctions' }, label: 'Malfunctions', icon: 'malfunction', also: [] },
      { target: { kind: 'costs' }, label: 'Costs & Purchases', icon: 'costs', also: ['purchase-form'] },
      { target: { kind: 'reports' }, label: 'Reports', icon: 'reports', also: [] }
    ]
  },
  {
    label: 'App & Data',
    sections: [
      { target: { kind: 'help' }, label: 'Tour & Setup', icon: 'help', also: ['setup'] },
      { target: { kind: 'settings' }, label: 'Settings', icon: 'settings', also: [] },
      { target: { kind: 'sync' }, label: 'Sync & Backup', icon: 'sync', also: [] },
      { target: { kind: 'free-space' }, label: 'Free Up Space', icon: 'cleanup', also: [] },
      { target: { kind: 'your-data' }, label: 'Your Data', icon: 'shield', also: [], when: () => telemetryState().wired }
    ]
  }
];

const ALL_SECTIONS: SectionDef[] = GROUPS.flatMap((g) => g.sections);

export function TabBar({ active, onChange, view, onOpen }: {
  active: TabId; onChange: (t: TabId) => void;
  view: View | null; onOpen: (v: View) => void;
}) {
  const sectionOn = (s: SectionDef) =>
    !!view && (view.kind === s.target.kind || s.also.includes(view.kind));
  // While a sidebar section is open (Tour & Setup, Sync & Backup, etc. now live
  // in the App & Data group), that is the highlighted thing, not whatever tab
  // happens to be underneath it.
  const anySectionOn = ALL_SECTIONS.some(sectionOn);

  const tabButton = (t: { id: TabId; label: string; icon: IconName }, extraClass = '') => (
    <button
      key={t.id}
      className={[extraClass, active === t.id && !anySectionOn ? 'active' : ''].filter(Boolean).join(' ')}
      aria-current={active === t.id && !anySectionOn ? 'page' : undefined}
      onClick={() => onChange(t.id)}
    >
      <span className="glyph" aria-hidden="true"><Icon name={t.icon} /></span>
      {t.label}
    </button>
  );

  return (
    <nav className="tabbar" aria-label="Main">
      <div className="side-title" aria-hidden="true">FirearmLog</div>
      {TABS.map((t) => tabButton(t))}
      {GROUPS.map((g) => (
        <Fragment key={g.label}>
          <div className="nav-group-label" aria-hidden="true">{g.label}</div>
          {g.sections.filter((s) => !s.when || s.when()).map((s) => (
            <button key={s.target.kind} className={`sidebar-only ${sectionOn(s) ? 'active' : ''}`}
              aria-current={sectionOn(s) ? 'page' : undefined}
              onClick={() => onOpen(s.target)}>
              <span className="glyph" aria-hidden="true"><Icon name={s.icon} /></span>
              {s.label}
            </button>
          ))}
        </Fragment>
      ))}
      {tabButton({ id: 'more', label: 'More', icon: 'more' }, 'phone-only')}
    </nav>
  );
}
