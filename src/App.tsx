import { useCallback, useEffect, useRef, useState } from 'react';
import { TabBar } from './ui/TabBar.tsx';
import { MenuBar } from './ui/MenuBar.tsx';
import { DiscardChangesSheet } from './ui/Sheet.tsx';
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
import { SyncScreen, FreeSpaceScreen } from './ui/AppDataScreens.tsx';
import { SettingsScreen } from './ui/SettingsScreen.tsx';
import { countAll, getSettings, probeDb } from './lib/db.ts';
import { BootErrorScreen } from './ui/BootErrorScreen.tsx';
import { ensureStockDrills } from './lib/stockDrills.ts';
import { syncTelemetryEnabled } from './lib/telemetry.ts';
import type { AppSettings } from './lib/types.ts';
import { ErrorBoundary } from './ui/ErrorBoundary.tsx';

export function App() {
  const [tab, setTabState] = useState<TabId>('home');
  const [view, setViewState] = useState<View | null>(null);
  // F3: the popstate handler is registered once, so it can't read `view` from
  // React state (it would be stale). This ref always mirrors the current view;
  // setView is the single writer that keeps state and ref in step.
  const viewRef = useRef<View | null>(null);
  const setView = (v: View | null) => { viewRef.current = v; setViewState(v); };

  // F3: the unsaved-edits guard for the exits App owns. The record forms
  // (SessionForm, MatchForm, ClassifierForm) report their dirty state into this
  // ref (a ref, not state — navigation handlers need the CURRENT value
  // synchronously, and a flag change must not re-render the app). Only one form
  // is ever mounted at a time, and each clears the flag on unmount, so a single
  // shared ref is safe. When a guarded navigation hits a dirty form, the
  // navigation is parked in pendingNav and the shared Discard-changes? sheet asks first.
  const formDirty = useRef(false);
  const [pendingNav, setPendingNav] = useState<null | (() => void)>(null);
  const guardNav = (go: () => void) => {
    if (formDirty.current) setPendingNav(() => go);
    else go();
  };
  // Stable identity so the forms' dirty-sync effects don't re-run per render.
  const reportFormDirty = useCallback((d: boolean) => { formDirty.current = d; }, []);
  // Bump this to make every screen re-read the database after a save/import.
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  // F1 boot guard: if the database can't open (stale tab holding a connection,
  // a pending delete queued ahead of the open), every screen's load would hang
  // on a spinner forever. Probe once at startup; on failure, replace the whole
  // app with a plain-language recovery screen instead. The healthy path costs
  // nothing — the probe shares the same cached open every screen uses anyway.
  const [bootFailed, setBootFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void probeDb().catch(() => { if (alive) setBootFailed(true); });
    return () => { alive = false; };
  }, []);

  // Opening a screen or switching tabs should land at the top, not wherever the
  // previous screen happened to be scrolled (the whole document scrolls, on
  // phone and desktop alike). rAF so it runs after the new screen has rendered.
  const scrollTop = () => requestAnimationFrame(() => window.scrollTo(0, 0));

  // Views live in browser history so Back works (and never blanks the app).
  const push = (v: View) => {
    history.pushState({ view: v }, '');
    setView(v);
    // A section-deep-linked wiki view scrolls itself to that section (NumbersGuide);
    // skipping the snap-to-top here removes the race that intermittently left the
    // deep-link stuck at the top of the page instead of on the section it targeted.
    if (v.kind === 'numbers' && v.section) return;
    scrollTop();
  };
  const replace = (v: View | null) => { history.replaceState({ view: v }, ''); setView(v); };
  const back = () => history.back();

  useEffect(() => {
    history.replaceState({ view: null }, '');
    const onPop = (e: PopStateEvent) => {
      // F3: browser Back with unsaved session edits. The pop has already
      // happened by the time this fires, so first push the CURRENT view back
      // on (neutralizing the pop — the screen never changes), then ask. On
      // Discard the guard is disarmed and Back is replayed for real; the
      // replay lands in the branch below and navigates normally.
      if (formDirty.current) {
        history.pushState({ view: viewRef.current }, '');
        setPendingNav(() => () => { formDirty.current = false; history.back(); });
        return;
      }
      const st = e.state as { view?: View | null } | null;
      const v = st?.view ?? null;
      // (F11: the retired Import screen's history special-case is gone with
      // its view kind — a stale history entry with an unknown kind simply
      // falls through the route chain and renders the active tab. Safe.)
      setView(v);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Until there's at least one gun, every open lands on the Setup Wizard — an
  // empty log has nothing to attach sessions/optics/ammo to. Once a gun exists,
  // the app opens normally. (Re-presents each open; doesn't hard-trap mid-session.
  // Won't fire for Michael — he has guns; the wizard is also in Help → Set Up.)
  useEffect(() => {
    // While the recovery screen owns the app, don't touch the database at all.
    // Re-opening here would start a doomed open that gets CACHED — and Try
    // Again would then join that in-flight failure instead of getting a fresh
    // attempt (the exact bug E2E run #175 caught on the first Try Again click).
    if (bootFailed) return;
    let alive = true;
    void (async () => {
      const guns = await countAll('firearms');
      if (alive && guns === 0) setView({ kind: 'setup' });
    })().catch(() => { /* DB down — the F1 boot guard owns this failure. */ });
    return () => { alive = false; };
    // Keyed to bootFailed (not refreshKey) so a recovery from the F1 error
    // screen re-checks and presents the wizard, while mid-session refreshes
    // still never re-trap the user. On a healthy boot this runs exactly once.
  }, [bootFailed]);

  // F10 (session 55): the boot-time North Star auto-seed is GONE. The starter
  // goal is now ASKED in the Setup Wizard's goal step (lib/northStar.ts) —
  // nothing is pinned to anyone unasked, ever. Existing installs keep whatever
  // they have; the wizard's own guard (northStarSeeded) keeps re-runs quiet.

  // F4: the stock drill library seeds once the log is real (≥1 gun) — see
  // lib/stockDrills.ts for the rules (once per install; an existing library
  // is respected, never duplicated; Clear All re-seeds). Self-guarding and
  // fail-safe, so running it on every data change is cheap and idempotent; it
  // returns true only the single time it writes — one refresh then shows the
  // library on Drills and in the session form's picker immediately.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const created = await ensureStockDrills();
      if (alive && created) setRefreshKey((k) => k + 1);
    })();
    return () => { alive = false; };
  }, [refreshKey]);

  // Keep the telemetry gate in step with the stored opt-out: on start and after
  // any data change (a toggle, Load-from-File, an import, Clear All all bump
  // refreshKey), so the cache can't go stale against what's on disk (R-4). Inert
  // today — nothing is sent until the step-4 wiring registers a provider.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const settings = await getSettings<AppSettings>();
      if (alive) syncTelemetryEnabled(settings);
    })().catch(() => { /* DB down — the F1 boot guard owns this failure. */ });
    return () => { alive = false; };
  }, [refreshKey]);

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

  // F3: both in-app exits (phone tab bar, desktop sidebar) route through
  // guardNav so a dirty session form gets the Discard-changes? sheet instead of
  // silently losing its edits.
  const setTab = (t: TabId) => guardNav(() => { replace(null); setTabState(t); scrollTop(); });
  // Desktop sidebar section links (C1): re-clicking the open section is a no-op
  // so it can't stack duplicate history entries.
  const openSection = (v: View) => { if (view?.kind !== v.kind) guardNav(() => push(v)); };

  // Desktop menu bar (MENUBAR_SPEC.md). Menu items navigate through the SAME
  // guard as the sidebar and tab bar, so a dirty form still gets its
  // Discard-changes? sheet (F3 parity). Opening the kind that's already on
  // screen replaces instead of pushing (mirrors openSection's no-stacking rule)
  // but still applies the new view's params — so Help > Quick Tour works from
  // the Tour & Setup screen itself.
  const tourSeq = useRef(0);
  const menuOpen = (v: View) => {
    if (v.kind === 'help' && v.tour) tourSeq.current += 1;
    guardNav(() => {
      if (view?.kind === v.kind) replace(v); else push(v);
      // One-shot params (a tour launch, the pop-ups-blocked note) stay OUT of
      // browser history: Back-then-Forward must re-show the screen, not replay
      // the moment (audit #6).
      if ((v.kind === 'help' && v.tour) || (v.kind === 'reports' && v.blocked)) {
        history.replaceState({ view: { kind: v.kind } }, '');
      }
    });
  };

  // View > Hide Sidebar (desktop). A device-local UI preference — remembered in
  // localStorage (Michael's decision #6, July 10 2026), deliberately NOT in the
  // app's settings store: it's about this screen, not the log, and it must never
  // ride along in a sync file. Guarded — some private-browsing modes throw.
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try { return localStorage.getItem('flog-sidebar-hidden') === '1'; } catch { return false; }
  });
  const toggleSidebar = () => setSidebarHidden((h) => {
    const next = !h;
    try { localStorage.setItem('flog-sidebar-hidden', next ? '1' : '0'); } catch { /* preference just won't stick */ }
    return next;
  });

  // F1: a failed boot replaces everything — there is nothing useful to render
  // when no screen can reach its data. Recovery re-checks the wizard/goal
  // effects' work via refresh so the app resumes exactly as a normal open.
  if (bootFailed) {
    return <BootErrorScreen onRecovered={() => { setBootFailed(false); refresh(); }} />;
  }

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
      onDeleted={() => { refresh(); setTab('log'); }}
      onSaved={() => { refresh(); setTab('log'); }}
      onDirtyChange={reportFormDirty} />;
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
      onSaved={(mid) => { refresh(); replace({ kind: 'match-detail', id: mid }); }}
      onDirtyChange={reportFormDirty} />;
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
    content = <ReportsScreen refreshKey={refreshKey} onBack={back} popupBlocked={view.blocked} />;
  } else if (view?.kind === 'classifier-form') {
    const v = view;
    content = <ClassifierForm id={v.id}
      onCancel={back}
      onSaved={() => { refresh(); replace(null); }}
      onDirtyChange={reportFormDirty} />;
  } else if (view?.kind === 'practiscore-import') {
    content = <PractiScoreImport
      onCancel={back}
      onSaved={(mid) => { refresh(); replace({ kind: 'match-detail', id: mid }); }} />;
  } else if (view?.kind === 'uspsa-import') {
    content = <UspsaImport
      onCancel={back}
      onDone={() => { refresh(); replace(null); }} />;
  } else if (view?.kind === 'help') {
    // Keyed per tour request so Help > Quick Tour re-launches even when the
    // Tour & Setup screen is already open (a fresh mount re-reads initialTour).
    content = <HelpScreen key={view.tour ? `${view.tour}-${tourSeq.current}` : ''}
      onBack={back} open={push} initialTour={view.tour} />;
  } else if (view?.kind === 'numbers') {
    content = <NumbersGuide onBack={back} section={view.section} />;
  } else if (view?.kind === 'setup') {
    // Finishing setup lands on HOME — the wizard's stated contract ("mark
    // setup done + return to Home"). Before this, replace(null) dropped the
    // user onto whatever TAB sat underneath (Progress, More…) when the wizard
    // was re-run from Help — caught by the hardened E2E heading waits, which
    // had been passing vacuously on a "FirearmLog" substring match.
    content = <SetupWizard
      onFinish={() => { refresh(); setTabState('home'); replace(null); scrollTop(); }}
      onCancel={back} />;
  } else if (view?.kind === 'settings') {
    content = <SettingsScreen onBack={back} />;
  } else if (view?.kind === 'sync') {
    content = <SyncScreen onBack={back} onImported={refresh} />;
  } else if (view?.kind === 'free-space') {
    content = <FreeSpaceScreen onBack={back} />;
  } else if (tab === 'home') {
    content = <HomeScreen refreshKey={refreshKey} open={push} onGoBackup={() => push({ kind: 'sync' })} />;
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
    <div className={`app-shell${sidebarHidden ? ' sidebar-hidden' : ''}`}>
      {/* Desktop-only menu bar. Hidden by CSS below the desktop breakpoint, and
          its shortcut listener re-checks the same media gate per keystroke —
          so even a hardware keyboard on a small viewport stays untouched. */}
      <MenuBar onGoTab={setTab} onOpenView={menuOpen}
        sidebarHidden={sidebarHidden} onToggleSidebar={toggleSidebar} />
      {/* Audit #D5: a <main> landmark for screen readers (the nav landmark is the tab bar).
          Audit CR-17/#D16: an error boundary turns a render crash into a friendly reload.
          T1-2: keyed to the current view so navigation recovers from a crash. */}
      <main><ErrorBoundary key={boundaryKey}>{content}</ErrorBoundary></main>
      <TabBar active={tab} onChange={setTab} view={view} onOpen={openSection} />
      {/* F3: the parked navigation's Discard-changes? sheet — same component
          and wording as the form's own Cancel guard. Keep editing stays put;
          Discard disarms the guard and runs the parked navigation. */}
      {pendingNav && (
        <DiscardChangesSheet
          onConfirm={() => { formDirty.current = false; const go = pendingNav; setPendingNav(null); go(); }}
          onClose={() => setPendingNav(null)} />
      )}
    </div>
  );
}
