import { useEffect, useState } from 'react';
import { TabBar } from './ui/TabBar.tsx';
import type { TabId } from './ui/TabBar.tsx';
import type { View } from './ui/nav.ts';
import {
  HomeScreen, LogScreen, MoreScreen, GunsScreen
} from './ui/screens.tsx';
import { ProgressScreen } from './ui/ProgressScreen.tsx';
import { CompeteScreen, ClassifierForm } from './ui/CompeteScreen.tsx';
import { MatchDetail, MatchForm } from './ui/MatchScreens.tsx';
import { GunDetail } from './ui/GunDetail.tsx';
import { GunForm } from './ui/GunForm.tsx';
import { SessionForm } from './ui/SessionForm.tsx';
import { DrillsScreen, DrillForm } from './ui/DrillsScreen.tsx';
import { DrillHistoryScreen } from './ui/DrillHistoryScreen.tsx';
import { MagazinesScreen, MagazineForm } from './ui/MagazinesScreen.tsx';
import { ReferenceList, ReferenceDetail, ReferenceForm } from './ui/ReferenceScreens.tsx';
import { MaintenanceOverview, MaintenanceForm } from './ui/MaintenanceScreens.tsx';
import { MalfunctionsScreen } from './ui/MalfunctionsScreen.tsx';
import { AmmoScreen, AmmoForm } from './ui/AmmoScreens.tsx';
import { CostsScreen, PurchaseForm } from './ui/CostsScreen.tsx';
import { OpticsScreen, OpticForm } from './ui/OpticsScreen.tsx';
import { PartsScreen, PartForm } from './ui/PartsScreen.tsx';
import { ReportsScreen } from './ui/ReportsScreen.tsx';
import { PractiScoreImport } from './ui/PractiScoreImport.tsx';
import { UspsaImport } from './ui/UspsaImport.tsx';
import { HelpScreen } from './ui/HelpScreen.tsx';
import { NumbersGuide } from './ui/NumbersGuide.tsx';
import { SetupWizard } from './ui/SetupWizard.tsx';
import { SyncScreen, ImportScreen, FreeSpaceScreen } from './ui/AppDataScreens.tsx';
import { SettingsScreen } from './ui/SettingsScreen.tsx';
import { countAll } from './lib/db.ts';
import { ErrorBoundary } from './ui/ErrorBoundary.tsx';

export function App() {
  const [tab, setTabState] = useState<TabId>('home');
  const [view, setViewState] = useState<View | null>(null);
  // Bump this to make every screen re-read the database after a save/import.
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  // Opening a screen or switching tabs should land at the top, not wherever the
  // previous screen happened to be scrolled (the whole document scrolls, on
  // phone and desktop alike). rAF so it runs after the new screen has rendered.
  const scrollTop = () => requestAnimationFrame(() => window.scrollTo(0, 0));

  // Views live in browser history so Back works (and never blanks the app).
  const push = (v: View) => {
    history.pushState({ view: v }, '');
    setViewState(v);
    // A section-deep-linked wiki view scrolls itself to that section (NumbersGuide);
    // skipping the snap-to-top here removes the race that intermittently left the
    // deep-link stuck at the top of the page instead of on the section it targeted.
    if (v.kind === 'numbers' && v.section) return;
    scrollTop();
  };
  const replace = (v: View | null) => { history.replaceState({ view: v }, ''); setViewState(v); };
  const back = () => history.back();

  useEffect(() => {
    history.replaceState({ view: null }, '');
    const onPop = (e: PopStateEvent) => {
      const st = e.state as { view?: View | null } | null;
      setViewState(st?.view ?? null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Until there's at least one gun, every open lands on the Setup Wizard — an
  // empty log has nothing to attach sessions/optics/ammo to. Once a gun exists,
  // the app opens normally. (Re-presents each open; doesn't hard-trap mid-session.
  // Won't fire for Michael — he has guns; the wizard is also in Help → Set Up.)
  useEffect(() => {
    let alive = true;
    void (async () => {
      const guns = await countAll('firearms');
      if (alive && guns === 0) setViewState({ kind: 'setup' });
    })();
    return () => { alive = false; };
  }, []);

  // N2: announce each screen to assistive tech. On any navigation, update the
  // document title from the screen's heading and move focus to that <h1> so
  // VoiceOver/NVDA read the new context (WCAG 2.4.2/2.4.3). tabIndex=-1 makes the
  // heading programmatically focusable without adding it to the Tab order;
  // preventScroll leaves our own scroll-to-top untouched.
  useEffect(() => {
    const h1 = document.querySelector<HTMLElement>('.large-title, main h1, .screen h1');
    const label = h1?.textContent?.trim();
    document.title = label ? `FirearmLog — ${label}` : 'FirearmLog';
    if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
  }, [view, tab]);

  const setTab = (t: TabId) => { replace(null); setTabState(t); scrollTop(); };
  // Desktop sidebar section links (C1): re-clicking the open section is a no-op
  // so it can't stack duplicate history entries.
  const openSection = (v: View) => { if (view?.kind !== v.kind) push(v); };

  let content;
  if (view?.kind === 'guns') {
    content = <GunsScreen refreshKey={refreshKey} onBack={back} open={push} />;
  } else if (view?.kind === 'gun-detail') {
    const v = view;
    content = <GunDetail id={v.id} refreshKey={refreshKey}
      onBack={back}
      onEdit={() => push({ kind: 'gun-form', id: v.id })}
      onLogMaintenance={() => push({ kind: 'maint-form', gunId: v.id })}
      onEditMaintenance={(eid) => push({ kind: 'maint-form', gunId: v.id, id: eid })}
      onOpenReference={(rid) => push({ kind: 'reference-detail', id: rid })}
      onOpenOptic={(oid, fid) => push({ kind: 'optic-form', id: oid, firearmId: fid })}
      onRemoved={(deleted) => { refresh(); if (deleted) replace({ kind: 'guns' }); }} />;
  } else if (view?.kind === 'gun-form') {
    const v = view;
    content = <GunForm id={v.id}
      onCancel={back}
      onSaved={(gid) => { refresh(); replace({ kind: 'gun-detail', id: gid }); }} />;
  } else if (view?.kind === 'session-form') {
    const v = view;
    content = <SessionForm id={v.id} initialPlanned={v.planned} convert={v.convert} initialDate={v.date}
      onCancel={back}
      onConvert={() => push({ kind: 'session-form', id: v.id, convert: true })}
      onDeleted={() => { refresh(); setTab('log'); }}
      onSaved={() => { refresh(); setTab('log'); }} />;
  } else if (view?.kind === 'drills') {
    content = <DrillsScreen refreshKey={refreshKey}
      onBack={back}
      openForm={(did) => push({ kind: 'drill-form', id: did })}
      openHistory={(dname) => push({ kind: 'drill-history', name: dname })} />;
  } else if (view?.kind === 'drill-history') {
    content = <DrillHistoryScreen name={view.name} refreshKey={refreshKey}
      onBack={back} open={push} />;
  } else if (view?.kind === 'drill-form') {
    const v = view;
    content = <DrillForm id={v.id}
      onCancel={back}
      onSaved={() => { refresh(); replace({ kind: 'drills' }); }} />;
  } else if (view?.kind === 'magazines') {
    content = <MagazinesScreen refreshKey={refreshKey}
      onBack={back}
      openForm={(mid) => push({ kind: 'magazine-form', id: mid })} />;
  } else if (view?.kind === 'magazine-form') {
    const v = view;
    content = <MagazineForm id={v.id}
      onCancel={back}
      onSaved={() => { refresh(); replace({ kind: 'magazines' }); }} />;
  } else if (view?.kind === 'references') {
    content = <ReferenceList refreshKey={refreshKey}
      onBack={back}
      openDetail={(rid) => push({ kind: 'reference-detail', id: rid })}
      openForm={() => push({ kind: 'reference-form' })} />;
  } else if (view?.kind === 'reference-detail') {
    const v = view;
    content = <ReferenceDetail id={v.id} refreshKey={refreshKey}
      onBack={back}
      onEdit={() => push({ kind: 'reference-form', id: v.id })}
      onCopy={() => push({ kind: 'reference-form', copyFrom: v.id })}
      onDeleted={() => { refresh(); replace({ kind: 'references' }); }} />;
  } else if (view?.kind === 'reference-form') {
    const v = view;
    content = <ReferenceForm id={v.id} copyFrom={v.copyFrom}
      onCancel={back}
      onSaved={(rid) => { refresh(); replace({ kind: 'reference-detail', id: rid }); }} />;
  } else if (view?.kind === 'maintenance') {
    content = <MaintenanceOverview refreshKey={refreshKey}
      onBack={back}
      openGun={(gid) => push({ kind: 'gun-detail', id: gid })}
      logFor={(gid) => push({ kind: 'maint-form', gunId: gid })} />;
  } else if (view?.kind === 'maint-form') {
    const v = view;
    content = <MaintenanceForm gunId={v.gunId} id={v.id}
      onCancel={back}
      onSaved={() => { refresh(); replace({ kind: 'gun-detail', id: v.gunId }); }} />;
  } else if (view?.kind === 'malfunctions') {
    content = <MalfunctionsScreen refreshKey={refreshKey}
      onBack={back}
      openSession={(sid) => push({ kind: 'session-form', id: sid })} />;
  } else if (view?.kind === 'match-detail') {
    const v = view;
    content = <MatchDetail id={v.id} refreshKey={refreshKey} open={push}
      onBack={back}
      onEdit={() => push({ kind: 'match-form', id: v.id })}
      onDeleted={() => { refresh(); replace(null); }} />;
  } else if (view?.kind === 'match-form') {
    const v = view;
    content = <MatchForm id={v.id}
      onCancel={back}
      onSaved={(mid) => { refresh(); replace({ kind: 'match-detail', id: mid }); }} />;
  } else if (view?.kind === 'ammo') {
    content = <AmmoScreen refreshKey={refreshKey}
      onBack={back}
      openForm={(aid) => push({ kind: 'ammo-form', id: aid })} />;
  } else if (view?.kind === 'ammo-form') {
    const v = view;
    content = <AmmoForm id={v.id}
      onCancel={back}
      onSaved={() => { refresh(); replace({ kind: 'ammo' }); }} />;
  } else if (view?.kind === 'costs') {
    content = <CostsScreen refreshKey={refreshKey}
      onBack={back}
      openForm={(pid) => push({ kind: 'purchase-form', id: pid })}
      openPart={(pid) => push({ kind: 'part-form', id: pid })} />;
  } else if (view?.kind === 'purchase-form') {
    const v = view;
    content = <PurchaseForm id={v.id}
      onCancel={back}
      onSaved={() => { refresh(); replace({ kind: 'costs' }); }} />;
  } else if (view?.kind === 'optics') {
    content = <OpticsScreen refreshKey={refreshKey}
      onBack={back}
      openOpticForm={(oid) => push({ kind: 'optic-form', id: oid })} />;
  } else if (view?.kind === 'optic-form') {
    const v = view;
    content = <OpticForm id={v.id} firearmId={v.firearmId}
      onCancel={back}
      onSaved={() => { refresh(); replace(v.firearmId ? { kind: 'gun-detail', id: v.firearmId } : { kind: 'optics' }); }} />;
  } else if (view?.kind === 'parts') {
    content = <PartsScreen refreshKey={refreshKey}
      onBack={back}
      openPartForm={(pid) => push({ kind: 'part-form', id: pid })}
      openOpticForm={(oid) => push({ kind: 'optic-form', id: oid })} />;
  } else if (view?.kind === 'part-form') {
    const v = view;
    content = <PartForm id={v.id}
      onCancel={back}
      onSaved={() => { refresh(); replace({ kind: 'parts' }); }} />;
  } else if (view?.kind === 'reports') {
    content = <ReportsScreen refreshKey={refreshKey} onBack={back} />;
  } else if (view?.kind === 'classifier-form') {
    const v = view;
    content = <ClassifierForm id={v.id}
      onCancel={back}
      onSaved={() => { refresh(); replace(null); }} />;
  } else if (view?.kind === 'practiscore-import') {
    content = <PractiScoreImport
      onCancel={back}
      onSaved={(mid) => { refresh(); replace({ kind: 'match-detail', id: mid }); }} />;
  } else if (view?.kind === 'uspsa-import') {
    content = <UspsaImport
      onCancel={back}
      onDone={() => { refresh(); replace(null); }} />;
  } else if (view?.kind === 'help') {
    content = <HelpScreen onBack={back} open={push} />;
  } else if (view?.kind === 'numbers') {
    content = <NumbersGuide onBack={back} section={view.section} />;
  } else if (view?.kind === 'setup') {
    content = <SetupWizard
      onFinish={() => { refresh(); replace(null); }}
      onCancel={back} />;
  } else if (view?.kind === 'settings') {
    content = <SettingsScreen onBack={back} />;
  } else if (view?.kind === 'sync') {
    content = <SyncScreen onBack={back} onImported={refresh} />;
  } else if (view?.kind === 'import') {
    content = <ImportScreen onBack={back} onImported={refresh} />;
  } else if (view?.kind === 'free-space') {
    content = <FreeSpaceScreen onBack={back} />;
  } else if (tab === 'home') {
    content = <HomeScreen refreshKey={refreshKey} onImported={refresh} open={push} onGoBackup={() => push({ kind: 'sync' })} />;
  } else if (tab === 'log') {
    content = <LogScreen refreshKey={refreshKey} open={push} />;
  } else if (tab === 'compete') {
    content = <CompeteScreen refreshKey={refreshKey} open={push} />;
  } else if (tab === 'progress') {
    content = <ProgressScreen refreshKey={refreshKey} open={push} />;
  } else {
    content = <MoreScreen refreshKey={refreshKey} open={push} />;
  }

  // Key the error boundary to the current screen so navigating away from a
  // crashed screen remounts it fresh (auto-recovers) — pro-grade audit T1-2.
  const boundaryKey = view ? `${view.kind}:${(view as { id?: string }).id ?? ''}` : tab;

  return (
    <>
      {/* Audit #D5: a <main> landmark for screen readers (the nav landmark is the tab bar).
          Audit CR-17/#D16: an error boundary turns a render crash into a friendly reload.
          T1-2: keyed to the current view so navigation recovers from a crash. */}
      <main><ErrorBoundary key={boundaryKey}>{content}</ErrorBoundary></main>
      <TabBar active={tab} onChange={setTab} view={view} onOpen={openSection} />
    </>
  );
}
