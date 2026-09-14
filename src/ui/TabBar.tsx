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
//
// TABS and GROUPS are DERIVED from FIND_INDEX (decision 75, 12 Sep 2026, build
// 2), not kept as a second hand-written table: the four main tabs are
// FIND_INDEX's `kind: 'screen'` entries with a `go.tab`, and each sidebar
// section is a `kind: 'screen'` entry with a `go.view`, grouped by
// FIND_GROUP_ORDER. This is the ONE table the Find box, the sidebar, and the
// Tour & Setup index all read — the layout and behavior below are unchanged
// from before the refactor when the new Find box is empty.
import { Fragment, useEffect, useState } from 'react';
import type { View } from './nav.ts';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';
import { FIND_INDEX, FIND_GROUP_ORDER, findEntries } from './findIndex.ts';
import type { FindEntry, FindGroupLabel } from './findIndex.ts';
import { FindBox } from './FindBox.tsx';
import { goToFindTarget, matchesEntry, parentIconFor, MAIN_GROUP } from './findSearch.ts';

export type TabId = 'home' | 'log' | 'compete' | 'progress' | 'more';

const SCREEN_ENTRIES = FIND_INDEX.filter((e) => e.kind === 'screen');

// H1 (cold audit, session 79): `short` is the sidebar's own shorter label
// (the numbers -> "The numbers") — the More tab and the Help index still
// read `name` in full, straight off FIND_INDEX, so only this file needs it.
const TABS: { id: TabId; label: string; icon: IconName; entry: FindEntry }[] = SCREEN_ENTRIES
  .filter((e) => e.group === MAIN_GROUP && 'tab' in e.go)
  .map((e) => ({ id: (e.go as { tab: TabId }).tab, label: e.short ?? e.name, icon: e.icon as IconName, entry: e }));

type SectionDef = {
  target: View; label: string; icon: IconName; also: View['kind'][];
  /** Render this entry only when the condition holds (checked each render).
   *  Used by the Rung-1 "Your Data" row so the desktop sidebar matches the
   *  phone More screen: hidden while telemetry ships dark, present once a
   *  provider is wired — the required transparency surface (DATA_MOAT_SPEC
   *  §6a) must be reachable from BOTH nav layouts. */
  when?: () => boolean;
  entry: FindEntry;
};

// Desktop-only direct links to the sections that live under More on the phone,
// grouped exactly like the phone More screen — read straight from FIND_INDEX
// so this can never list a screen the More screen or the Find box don't have.
const GROUPS: { label: FindGroupLabel; sections: SectionDef[] }[] = FIND_GROUP_ORDER
  .filter((label) => label !== MAIN_GROUP)
  .map((label) => ({
    label,
    sections: SCREEN_ENTRIES
      .filter((e) => e.group === label && 'view' in e.go)
      .map((e) => ({
        target: (e.go as { view: View }).view,
        label: e.short ?? e.name,
        icon: e.icon as IconName,
        also: e.also ?? [],
        when: e.when,
        entry: e,
      })),
  }));

const ALL_SECTIONS: SectionDef[] = GROUPS.flatMap((g) => g.sections);

/** The "inside" entries the sidebar's Find box can surface as extra buttons,
 *  grouped the same way GROUPS is. */
const INSIDE_BY_GROUP: Map<FindGroupLabel, FindEntry[]> = new Map(
  FIND_GROUP_ORDER.map((label) => [label, FIND_INDEX.filter((e) => e.kind === 'inside' && e.group === label)])
);

export function TabBar({ active, onChange, view, onOpen, findInputRef }: {
  active: TabId; onChange: (t: TabId) => void;
  view: View | null; onOpen: (v: View) => void;
  /** Lets the desktop menu bar's Help > Find a Screen… focus this box. */
  findInputRef?: React.Ref<HTMLInputElement>;
}) {
  const [q, setQ] = useState('');
  const query = q.trim();
  // L1 (cold audit, session 79): a click used to clear the box synchronously,
  // before the click's own guarded navigation had actually run — a dirty
  // form parks the navigation behind the Discard-changes? sheet, and "Keep
  // editing" left the box empty even though nothing moved. Clearing it here
  // instead, keyed on the navigation actually landing (`active`/`view`
  // changing), means a cancelled navigation leaves the query exactly as
  // typed, and a real one still clears it same as before.
  useEffect(() => { setQ(''); }, [active, view]);
  const gated = findEntries(); // the "Your Data" gate applied, same as everywhere else

  const sectionOn = (s: SectionDef) =>
    !!view && (view.kind === s.target.kind || s.also.includes(view.kind));
  // While a sidebar section is open (Tour & Setup, Sync & Backup, etc. now live
  // in the App & Data group), that is the highlighted thing, not whatever tab
  // happens to be underneath it.
  const anySectionOn = ALL_SECTIONS.some(sectionOn);

  const gatedIds = new Set(gated.map((e) => e.id));
  const visibleTabs = TABS.filter((t) => gatedIds.has(t.entry.id) && (!query || matchesEntry(query, t.entry)));
  // The four main tabs carry no group label of their own in the sidebar (they
  // sit as bare top buttons, unlike Your Gear/Training/Records/App & Data), so
  // their "inside" entries (the training grid, Search & Filter, Log a Match…)
  // render right below the tabs instead of under a label — still reachable by
  // search on the sidebar, exactly as they already are in the phone More box.
  const mainInsideMatches = query
    ? (INSIDE_BY_GROUP.get(MAIN_GROUP) ?? []).filter((e) => (!e.when || e.when()) && matchesEntry(query, e))
    : [];
  const groupsView = GROUPS.map((g) => {
    const visibleSections = g.sections.filter((s) =>
      gatedIds.has(s.entry.id) && (!query || matchesEntry(query, s.entry)));
    const insideMatches = query
      ? (INSIDE_BY_GROUP.get(g.label) ?? []).filter((e) => (!e.when || e.when()) && matchesEntry(query, e))
      : [];
    return { label: g.label, visibleSections, insideMatches };
  });
  const resultCount = query
    ? visibleTabs.length + mainInsideMatches.length
      + groupsView.reduce((n, g) => n + g.visibleSections.length + g.insideMatches.length, 0)
    : 0;

  // L1: no setQ('') here — the box clears itself once the effect above sees
  // the navigation actually land, not before.
  const jump = (entry: FindEntry) => {
    // If the target is already the current screen, nothing below will change
    // and the effect above never fires, so clear here (audit residual, s146).
    const already = 'tab' in entry.go
      ? active === entry.go.tab && !view
      : !!view && view.kind === entry.go.view.kind;
    goToFindTarget(entry.go, onOpen, onChange);
    if (already) setQ('');
  };

  const tabButton = (t: { id: TabId; label: string; icon: IconName; entry?: FindEntry }, extraClass = '') => (
    <button
      key={t.id}
      data-find-id={t.entry?.id}
      className={[extraClass, active === t.id && !anySectionOn ? 'active' : ''].filter(Boolean).join(' ')}
      aria-current={active === t.id && !anySectionOn ? 'page' : undefined}
      onClick={() => onChange(t.id)}>
      <span className="glyph" aria-hidden="true"><Icon name={t.icon} /></span>
      {t.label}
    </button>
  );

  return (
    <nav className="tabbar" aria-label="Main">
      <div className="side-title" aria-hidden="true">FirearmLog</div>
      <FindBox query={q} onChange={setQ} resultCount={resultCount} inputRef={findInputRef} visibleCount />
      {visibleTabs.map((t) => tabButton(t))}
      {mainInsideMatches.map((e) => (
        <button key={e.id} data-find-id={e.id} className="sidebar-only"
          onClick={() => jump(e)}>
          <span className="glyph" aria-hidden="true">
            <Icon name={parentIconFor(e) ?? 'chevronRight'} />
          </span>
          {e.name}
        </button>
      ))}
      {groupsView.map((g) => {
        if (g.visibleSections.length === 0 && g.insideMatches.length === 0) return null;
        return (
          <Fragment key={g.label}>
            <div className="nav-group-label" aria-hidden="true">{g.label}</div>
            {g.visibleSections.map((s) => (
              <button key={s.target.kind} data-find-id={s.entry.id}
                className={`sidebar-only ${sectionOn(s) ? 'active' : ''}`}
                aria-current={sectionOn(s) ? 'page' : undefined}
                onClick={() => onOpen(s.target)}>
                <span className="glyph" aria-hidden="true"><Icon name={s.icon} /></span>
                {s.label}
              </button>
            ))}
            {g.insideMatches.map((e) => (
              <button key={e.id} data-find-id={e.id} className="sidebar-only"
                onClick={() => jump(e)}>
                <span className="glyph" aria-hidden="true">
                  <Icon name={parentIconFor(e) ?? 'chevronRight'} />
                </span>
                {e.name}
              </button>
            ))}
          </Fragment>
        );
      })}
      {tabButton({ id: 'more', label: 'More', icon: 'more' }, 'phone-only')}
    </nav>
  );
}
