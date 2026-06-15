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
import { MagazinesScreen, MagazineForm } from './ui/MagazinesScreen.tsx';
import { ReferenceList, ReferenceDetail, ReferenceForm } from './ui/ReferenceScreens.tsx';
import { MaintenanceOverview, MaintenanceForm } from './ui/MaintenanceScreens.tsx';
import { AmmoScreen, AmmoForm } from './ui/AmmoScreens.tsx';
import { CostsScreen, PurchaseForm } from './ui/CostsScreen.tsx';
import { OpticsScreen, OpticForm } from './ui/OpticsScreen.tsx';
import { PartsScreen, PartForm } from './ui/PartsScreen.tsx';
import { ReportsScreen } from './ui/ReportsScreen.tsx';
import { PractiScoreImport } from './ui/PractiScoreImport.tsx';
import { UspsaImport } from './ui/UspsaImport.tsx';
import { HelpScreen } from './ui/HelpScreen.tsx';
import { SetupWizard } from './ui/SetupWizard.tsx';
import { countAll } from './lib/db.ts';

export function App() {
  const [tab, setTabState] = useState<TabId>('home');
  const [view, setViewState] = useState<View | null>(null);
  // Bump this to make every screen re-read the database after a save/import.
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  // Views live in browser history so Back works (and never blanks the app).
  const push = (v: View) => { history.pushState({ view: v }, ''); setViewState(v); };
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

  const setTab = (t: TabId) => { replace(null); setTabState(t); };
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
      openForm={(did) => push({ kind: 'drill-form', id: did })} />;
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
  } else if (view?.kind === 'match-detail') {
    const v = view;
    content = <MatchDetail id={v.id} refreshKey={refreshKey}
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
  } else if (view?.kind === 'setup') {
    content = <SetupWizard
      onFinish={() => { refresh(); replace(null); }}
      onCancel={back} />;
  } else if (tab === 'home') {
    content = <HomeScreen refreshKey={refreshKey} onImported={refresh} open={push} />;
  } else if (tab === 'log') {
    content = <LogScreen refreshKey={refreshKey} open={push} />;
  } else if (tab === 'compete') {
    content = <CompeteScreen refreshKey={refreshKey} open={push} />;
  } else if (tab === 'progress') {
    content = <ProgressScreen refreshKey={refreshKey} />;
  } else {
    content = <MoreScreen refreshKey={refreshKey} onImported={refresh} open={push} />;
  }

  return (
    <>
      {content}
      <TabBar active={tab} onChange={setTab} view={view} onOpen={openSection} />
    </>
  );
}
