// Phone: bottom tab bar (Apple HIG). Desktop ≥900px: the SAME component lays
// out as a full sidebar with every section visible — feedback C1, spec §4.2.
// One component, two layouts via CSS; nothing is built twice.
//
// The sidebar sections are grouped to match the phone More screen (July 1 2026):
// Your Gear / Training / Records, then an App & Data group with Tour & Setup and
// the Sync & Backup screen. Phone and desktop tell the same story.
import { Fragment } from 'react';
import type { View } from './nav.ts';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';

export type TabId = 'home' | 'log' | 'compete' | 'progress' | 'more';

const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'log', label: 'Log', icon: 'log' },
  { id: 'compete', label: 'Compete', icon: 'compete' },
  { id: 'progress', label: 'Progress', icon: 'progress' }
];

type SectionDef = { target: View; label: string; icon: IconName; also: View['kind'][] };

// Desktop-only direct links to the sections that live under More on the phone,
// grouped exactly like the phone More screen. Nothing is removed vs. the old
// flat list; "How the numbers work" is added here for phone/desktop parity.
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
      { target: { kind: 'numbers' }, label: 'How the numbers work', icon: 'info', also: [] }
    ]
  },
  {
    label: 'Records',
    sections: [
      { target: { kind: 'maintenance' }, label: 'Maintenance', icon: 'maintenance', also: [] },
      { target: { kind: 'malfunctions' }, label: 'Malfunctions', icon: 'malfunction', also: [] },
      { target: { kind: 'costs' }, label: 'Costs & Purchases', icon: 'costs', also: ['purchase-form'] },
      { target: { kind: 'reports' }, label: 'Reports', icon: 'reports', also: [] }
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
  // The Tour & Setup screen (and the setup wizard it launches) highlight their
  // own sidebar entry, in the App & Data group.
  const tourOn = !!view && (view.kind === 'help' || view.kind === 'setup');
  // While a sidebar section (or Tour & Setup) is open, that is the highlighted
  // thing, not whatever tab happens to be underneath it.
  const anySectionOn = ALL_SECTIONS.some(sectionOn) || tourOn;

  const tabButton = (t: { id: TabId; label: string; icon: IconName }) => (
    <button
      key={t.id}
      className={active === t.id && !anySectionOn ? 'active' : ''}
      aria-current={active === t.id && !anySectionOn ? 'page' : undefined}
      onClick={() => onChange(t.id)}
    >
      <span className="glyph" aria-hidden="true"><Icon name={t.icon} /></span>
      {t.id === 'more'
        ? <><span className="label-phone">More</span><span className="label-desk">Sync &amp; Backup</span></>
        : t.label}
    </button>
  );

  return (
    <nav className="tabbar" aria-label="Main">
      <div className="side-title" aria-hidden="true">FirearmLog</div>
      {TABS.map(tabButton)}
      {GROUPS.map((g) => (
        <Fragment key={g.label}>
          <div className="nav-group-label" aria-hidden="true">{g.label}</div>
          {g.sections.map((s) => (
            <button key={s.target.kind} className={`sidebar-only ${sectionOn(s) ? 'active' : ''}`}
              aria-current={sectionOn(s) ? 'page' : undefined}
              onClick={() => onOpen(s.target)}>
              <span className="glyph" aria-hidden="true"><Icon name={s.icon} /></span>
              {s.label}
            </button>
          ))}
        </Fragment>
      ))}
      <div className="nav-group-label" aria-hidden="true">App &amp; Data</div>
      <button className={`sidebar-only ${tourOn ? 'active' : ''}`}
        aria-current={tourOn ? 'page' : undefined}
        onClick={() => onOpen({ kind: 'help' })}>
        <span className="glyph" aria-hidden="true"><Icon name="help" /></span>
        Tour &amp; Setup
      </button>
      {tabButton({ id: 'more', label: 'More', icon: 'more' })}
    </nav>
  );
}
