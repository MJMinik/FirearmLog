// Phone: bottom tab bar (Apple HIG). Desktop ≥900px: the SAME component lays
// out as a full sidebar with every section visible — feedback C1, spec §4.2.
// One component, two layouts via CSS; nothing is built twice.
import type { View } from './nav.ts';

export type TabId = 'home' | 'log' | 'compete' | 'progress' | 'more';

const TABS: { id: TabId; label: string; glyph: string }[] = [
  { id: 'home', label: 'Home', glyph: '⌂' },
  { id: 'log', label: 'Log', glyph: '☰' },
  { id: 'compete', label: 'Compete', glyph: '🏆' },
  { id: 'progress', label: 'Progress', glyph: '📈' }
];

// Desktop-only direct links to the sections that live under More on the phone.
// Order + "Data & Gear" grouping per Michael's June 14 layout.
const SECTIONS: { target: View; label: string; glyph: string; also: View['kind'][] }[] = [
  { target: { kind: 'guns' }, label: 'Guns', glyph: '🔫', also: ['gun-detail', 'gun-form'] },
  { target: { kind: 'optics' }, label: 'Optics', glyph: '🔭', also: ['optic-form'] },
  { target: { kind: 'ammo' }, label: 'Ammo', glyph: '◉', also: ['ammo-form'] },
  { target: { kind: 'magazines' }, label: 'Magazines', glyph: '▤', also: ['magazine-form'] },
  { target: { kind: 'drills' }, label: 'Drills', glyph: '🎯', also: ['drill-form'] },
  { target: { kind: 'costs' }, label: 'Costs & Purchases', glyph: '$', also: ['purchase-form'] },
  { target: { kind: 'maintenance' }, label: 'Maintenance', glyph: '🛠', also: [] },
  { target: { kind: 'parts' }, label: 'Spare Parts & Inventory', glyph: '🔩', also: ['part-form'] },
  { target: { kind: 'references' }, label: 'Reference', glyph: '📖', also: ['reference-detail', 'reference-form'] },
  { target: { kind: 'reports' }, label: 'Reports', glyph: '📊', also: [] },
  { target: { kind: 'help' }, label: 'Help & Tour', glyph: '❓', also: ['setup'] }
];

export function TabBar({ active, onChange, view, onOpen }: {
  active: TabId; onChange: (t: TabId) => void;
  view: View | null; onOpen: (v: View) => void;
}) {
  const sectionOn = (s: typeof SECTIONS[number]) =>
    !!view && (view.kind === s.target.kind || s.also.includes(view.kind));
  // While a sidebar section is open, the section is the highlighted thing,
  // not whatever tab happens to be underneath it.
  const anySectionOn = SECTIONS.some(sectionOn);

  const tabButton = (t: { id: TabId; label: string; glyph: string }) => (
    <button
      key={t.id}
      className={active === t.id && !anySectionOn ? 'active' : ''}
      aria-current={active === t.id && !anySectionOn ? 'page' : undefined}
      onClick={() => onChange(t.id)}
    >
      <span className="glyph" aria-hidden="true">{t.glyph}</span>
      {t.id === 'more'
        ? <><span className="label-phone">More</span><span className="label-desk">Gear &amp; Data</span></>
        : t.label}
    </button>
  );

  return (
    <nav className="tabbar" aria-label="Main">
      <div className="side-title" aria-hidden="true">FirearmLog</div>
      {TABS.map(tabButton)}
      <div className="nav-group-label" aria-hidden="true">Data &amp; Gear</div>
      {SECTIONS.map((s) => (
        <button key={s.target.kind} className={`sidebar-only ${sectionOn(s) ? 'active' : ''}`}
          aria-current={sectionOn(s) ? 'page' : undefined}
          onClick={() => onOpen(s.target)}>
          <span className="glyph" aria-hidden="true">{s.glyph}</span>
          {s.label}
        </button>
      ))}
      <div className="nav-divider" aria-hidden="true" />
      {tabButton({ id: 'more', label: 'More', glyph: '⋯' })}
    </nav>
  );
}
