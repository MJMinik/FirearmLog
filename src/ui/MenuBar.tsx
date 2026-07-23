// The desktop menu bar (MENUBAR_SPEC.md, July 2026). Desktop ≥900px only — the
// phone never sees it (CSS hides it; the shortcut listener also lives here, so
// mounting is gated the same way in App).
//
// The hybrid model (spec §8, resolved session 55/56): this bar carries COMMANDS
// — FirearmLog · File · Go (thin: the four tabs) · View · Reports · Help — and
// the sidebar stays the one navigator of the full tree. Every item invokes the
// SAME function as its existing on-screen control (spec §0: no forked logic):
// navigation goes through App's guarded open/setTab (so a dirty form still gets
// its Discard-changes? sheet — F3 parity), and the Reports menu launches the
// same report builders the Reports screen uses (reportLaunch.ts).
//
// Keyboard shortcuts (spec §2, verified July 10 2026 — the final table lives in
// MENUBAR_SPEC.md): browser-safe combos only. ⌘N/⌘⇧-letter combos are stolen by
// the browsers themselves and would feel broken, so phase 1 ships exactly:
//   ⌥⌘N Log Session · ⌘S Save to File · ⌘O Load from File · ⌘, Settings · Esc.
// Letters are matched on e.code (KeyN), not e.key — with Option held, e.key is
// a special character ("ñ" dead key) and would never match.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TabId } from './TabBar.tsx';
import type { View } from './nav.ts';
import type { Match, Session } from '../lib/types.ts';
import { getAll } from '../lib/db.ts';
import { activeOnly } from '../lib/softDelete.ts';
import { formatDayKey } from '../lib/dates.ts';
import { REPORTS, launchReport } from './reportLaunch.ts';
import { Sheet } from './Sheet.tsx';
import { APP_VERSION } from '../version.ts';

type Action = { label: string; hint?: string; keyshortcuts?: string; onSelect: () => void; disabled?: boolean };
type Item = Action | { submenu: string; items: Item[] } | 'divider';

// Platform split (audit #2): on a Mac the shortcuts are ⌘-based; everywhere
// else (Windows/Linux) Meta is the OS key and mostly never reaches the page,
// so the SAME actions ride Ctrl instead — and the hints advertise whichever
// set actually works here. (iPadOS reports itself as MacIntel — correct: an
// attached keyboard there is Apple-labelled.)
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const HINTS = IS_MAC
  ? { newSession: '⌥⌘N', save: '⌘S', load: '⌘O', settings: '⌘,' }
  : { newSession: 'Ctrl+Alt+N', save: 'Ctrl+S', load: 'Ctrl+O', settings: 'Ctrl+,' };
const KEYS = IS_MAC
  ? { newSession: 'Alt+Meta+N', save: 'Meta+S', load: 'Meta+O', settings: 'Meta+Comma' }
  : { newSession: 'Control+Alt+N', save: 'Control+S', load: 'Control+O', settings: 'Control+Comma' };

/** The desktop shell's exact media gate — the shortcut layer only lives where
 *  the menu bar is actually on screen (audit #1: an iPad below 900px with a
 *  hardware keyboard must keep its browser's own ⌘S). */
const desktopShellActive = () =>
  typeof window !== 'undefined' && window.matchMedia('(min-width: 900px) and (min-height: 500px)').matches;

const isDivider = (it: Item): it is 'divider' => it === 'divider';
const isSubmenu = (it: Item): it is { submenu: string; items: Item[] } =>
  typeof it === 'object' && 'submenu' in it;

function sessionLabel(s: Session): string {
  const kind = s.type === 'dry_fire' ? 'Dry fire' : s.type === 'class' ? 'Class' : 'Live fire';
  return `${formatDayKey(s.date)} — ${kind}`;
}

export function MenuBar({ onGoTab, onOpenView, sidebarHidden, onToggleSidebar }: {
  onGoTab: (t: TabId) => void;
  onOpenView: (v: View) => void;
  sidebarHidden: boolean;
  onToggleSidebar: () => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [subOpen, setSubOpen] = useState<string | null>(null);
  const [about, setAbout] = useState(false);
  // Open Recent (File menu): the last few logged sessions and matches — loaded
  // fresh each time the File menu opens (read-only; trashed sessions excluded).
  const [recent, setRecent] = useState<Action[] | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  // Safari doesn't focus a button on mousedown, so a mouse click landing on a
  // menu item while keyboard focus sits on another item fires a focusout with
  // relatedTarget null — which must NOT close the menu before the click lands.
  // This flag marks "a press inside the bar is in flight".
  const pressingInside = useRef(false);

  const close = useCallback(() => { setOpen(null); setSubOpen(null); }, []);

  // Run an item's action: close first so the menu never lingers over the new
  // screen, then hand focus back to the menu's top-level button (audit #9 — a
  // non-navigating action like Hide Sidebar must not drop focus to <body>; on
  // navigation the app's announce-the-screen effect moves focus to the new h1
  // right after, so this never fights it).
  const act = useCallback((fn: () => void) => {
    const i = open;
    close();
    fn();
    if (i !== null) barRef.current?.querySelectorAll<HTMLElement>('.menubar-btn')[i]?.focus();
  }, [close, open]);

  const newSession = useCallback(() => onOpenView({ kind: 'session-form' }), [onOpenView]);
  const openSync = useCallback(() => onOpenView({ kind: 'sync' }), [onOpenView]);
  const openSettings = useCallback(() => onOpenView({ kind: 'settings' }), [onOpenView]);

  // ---- Global shortcuts. The component mounts everywhere (CSS hides it on a
  // phone), so the handler re-checks the desktop media gate on every keystroke
  // — a hardware keyboard on a small viewport keeps its browser behavior. ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The platform's primary modifier, exclusively: ⌘ (not Ctrl) on a Mac,
      // Ctrl (not Meta) elsewhere — see IS_MAC above.
      const primary = IS_MAC ? (e.metaKey && !e.ctrlKey) : (e.ctrlKey && !e.metaKey);
      if (!primary) return;
      if (!desktopShellActive()) return;
      // Never fire while the focus is in a text field (spec §2 handler rule):
      // a keystroke mid-note must never navigate the app.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      // Never fire under an open modal sheet (audit #3): a Discard-changes?
      // sheet has a parked navigation; a shortcut must not swap it mid-question.
      if (document.querySelector('.sheet-backdrop')) return;
      if (e.altKey && !e.shiftKey && e.code === 'KeyN') { e.preventDefault(); act(newSession); }
      else if (!e.altKey && !e.shiftKey && e.code === 'KeyS') { e.preventDefault(); act(openSync); }
      else if (!e.altKey && !e.shiftKey && e.code === 'KeyO') { e.preventDefault(); act(openSync); }
      else if (!e.altKey && !e.shiftKey && e.code === 'Comma') { e.preventDefault(); act(openSettings); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, newSession, openSync, openSettings]);

  // ---- Click outside closes. ----
  useEffect(() => {
    if (open === null) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, close]);

  // ---- Menu definitions. ----
  const fileMenu: Item[] = [
    { submenu: 'New', items: [
      { label: 'Session', hint: HINTS.newSession, keyshortcuts: KEYS.newSession, onSelect: () => onOpenView({ kind: 'session-form' }) },
      { label: 'Match', onSelect: () => onOpenView({ kind: 'match-form' }) },
      { label: 'Classifier', onSelect: () => onOpenView({ kind: 'classifier-form' }) },
      { label: 'Planned Session', onSelect: () => onOpenView({ kind: 'session-form', planned: true }) }
    ] },
    'divider',
    { label: 'Save to File…', hint: HINTS.save, keyshortcuts: KEYS.save, onSelect: openSync },
    { label: 'Load from File…', hint: HINTS.load, keyshortcuts: KEYS.load, onSelect: openSync },
    'divider',
    { submenu: 'Open Recent', items: recent ?? [{ label: 'Loading…', onSelect: () => {}, disabled: true }] },
    'divider',
    { submenu: 'Import', items: [
      { label: 'From PractiScore…', onSelect: () => onOpenView({ kind: 'practiscore-import' }) },
      { label: 'USPSA Classifiers…', onSelect: () => onOpenView({ kind: 'uspsa-import' }) }
    ] }
  ];

  const menus: { label: string; items: Item[] }[] = [
    { label: 'FirearmLog', items: [
      { label: 'About FirearmLog', onSelect: () => setAbout(true) },
      'divider',
      { label: 'Settings…', hint: HINTS.settings, keyshortcuts: KEYS.settings, onSelect: openSettings }
    ] },
    { label: 'File', items: fileMenu },
    { label: 'Go', items: [
      { label: 'Home', onSelect: () => onGoTab('home') },
      { label: 'Log', onSelect: () => onGoTab('log') },
      { label: 'Compete', onSelect: () => onGoTab('compete') },
      { label: 'Progress', onSelect: () => onGoTab('progress') }
    ] },
    { label: 'View', items: [
      { label: sidebarHidden ? 'Show Sidebar' : 'Hide Sidebar', onSelect: onToggleSidebar }
    ] },
    { label: 'Reports', items: [
      ...REPORTS.map((r): Item => ({ label: r.label, onSelect: () => {
        // The menu click is the user gesture, so the window opens inside it; if
        // a blocker still refuses, land on the Reports screen with the
        // pop-ups-blocked message already showing (audit #4 — never a dead end).
        if (!launchReport(r.build)) onOpenView({ kind: 'reports', blocked: true });
      } })),
      'divider',
      { label: 'All Reports…', onSelect: () => onOpenView({ kind: 'reports' }) }
    ] },
    { label: 'Help', items: [
      { label: 'Quick Tour', onSelect: () => onOpenView({ kind: 'help', tour: 'quick' }) },
      { label: 'Full Tour', onSelect: () => onOpenView({ kind: 'help', tour: 'full' }) },
      { label: 'Set Up…', onSelect: () => onOpenView({ kind: 'setup' }) },
      'divider',
      { label: 'How the numbers work', onSelect: () => onOpenView({ kind: 'numbers' }) },
      { label: 'Care Guides', onSelect: () => onOpenView({ kind: 'references' }) }
    ] }
  ];

  const openMenu = (i: number) => {
    setSubOpen(null);
    setOpen(i);
    if (menus[i].label === 'File') {
      // Refresh Open Recent on every open — cheap reads, always current.
      // Sorted by updatedAt (recently saved/edited), NOT record date — owner
      // decision session 75 (July 23 2026): macOS's Open Recent convention is
      // "what you last touched," not "what's dated newest." The date shown in
      // the label is still the record's date — only the ORDER is recency of
      // touch. Matches carry no trash/deletedAt concept (types.ts), so they
      // aren't filtered here — mirrors the pre-existing treatment.
      setRecent(null);
      void (async () => {
        const [sessions, matches] = await Promise.all([getAll<Session>('sessions'), getAll<Match>('matches')]);
        const rows: { updatedAt: number; a: Action }[] = [
          ...activeOnly(sessions).filter((s) => !s.planned).map((s) => ({
            updatedAt: s.updatedAt || 0, a: { label: sessionLabel(s), onSelect: () => onOpenView({ kind: 'session-form', id: s.id }) } as Action
          })),
          ...matches.map((m) => ({
            updatedAt: m.updatedAt || 0, a: { label: `${formatDayKey(m.date)} — ${m.name || 'Match'}`, onSelect: () => onOpenView({ kind: 'match-detail', id: m.id }) } as Action
          }))
        ];
        rows.sort((x, y) => y.updatedAt - x.updatedAt);
        const top = rows.slice(0, 5).map((r) => r.a);
        setRecent(top.length ? top : [{ label: 'No records yet', onSelect: () => {}, disabled: true }]);
      })().catch(() => setRecent([{ label: 'Could not read your records', onSelect: () => {}, disabled: true }]));
    }
  };

  // ---- Keyboard navigation (WAI-ARIA menubar pattern). ----
  // Focus is moved between real DOM elements; the browser's focus IS the state.
  const focusables = (root: HTMLElement | null): HTMLElement[] =>
    root ? Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')) : [];

  const move = (list: HTMLElement[], delta: number) => {
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    const next = i < 0 ? (delta > 0 ? 0 : list.length - 1) : (i + delta + list.length) % list.length;
    list[next].focus();
  };

  const onBarKey = (e: React.KeyboardEvent) => {
    const bar = barRef.current;
    if (!bar) return;
    const inSub = subOpen !== null && (e.target as HTMLElement).closest('.menu-sub') !== null;
    const menuPanel = bar.querySelector<HTMLElement>('.menu-panel');
    const subPanel = bar.querySelector<HTMLElement>('.menu-sub');
    const topButtons = Array.from(bar.querySelectorAll<HTMLElement>('.menubar-btn'));

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        if (subOpen !== null) { setSubOpen(null); menuPanel?.querySelector<HTMLElement>('[aria-expanded="true"]')?.focus(); }
        else if (open !== null) { const i = open; close(); topButtons[i]?.focus(); }
        return;
      case 'ArrowRight':
      case 'ArrowLeft': {
        const onSubParent = (document.activeElement as HTMLElement)?.getAttribute('aria-haspopup') === 'menu'
          && (document.activeElement as HTMLElement)?.closest('.menu-panel') !== null;
        if (e.key === 'ArrowRight' && onSubParent && !inSub) {
          e.preventDefault();
          setSubOpen((document.activeElement as HTMLElement).dataset.submenu ?? null);
          // Focus lands on the submenu's first item once it renders.
          requestAnimationFrame(() => focusables(bar.querySelector<HTMLElement>('.menu-sub'))[0]?.focus());
          return;
        }
        if (e.key === 'ArrowLeft' && inSub) {
          e.preventDefault();
          const parent = menuPanel?.querySelector<HTMLElement>('[aria-expanded="true"]');
          setSubOpen(null); parent?.focus();
          return;
        }
        // Otherwise: move along the menubar, keeping a menu open if one is.
        e.preventDefault();
        if (open !== null) {
          const next = (open + (e.key === 'ArrowRight' ? 1 : -1) + menus.length) % menus.length;
          openMenu(next);
          requestAnimationFrame(() => topButtons[next]?.focus());
        } else move(topButtons, e.key === 'ArrowRight' ? 1 : -1);
        return;
      }
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        const focusedTop = topButtons.includes(document.activeElement as HTMLElement);
        if (focusedTop) {
          const i = topButtons.indexOf(document.activeElement as HTMLElement);
          if (open !== i) openMenu(i);
          requestAnimationFrame(() => {
            const list = focusables(bar.querySelector<HTMLElement>('.menu-panel'));
            (e.key === 'ArrowDown' ? list[0] : list[list.length - 1])?.focus();
          });
        } else move(focusables(inSub ? subPanel : menuPanel), e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      case 'Home': case 'End': {
        if (open === null) return;
        e.preventDefault();
        const list = focusables(inSub ? subPanel : menuPanel);
        (e.key === 'Home' ? list[0] : list[list.length - 1])?.focus();
        return;
      }
      case 'Enter': case ' ': {
        const el = document.activeElement as HTMLElement;
        if (el?.getAttribute('role') === 'menuitem' && el.getAttribute('aria-haspopup') === 'menu' && el.closest('.menu-panel')) {
          e.preventDefault();
          setSubOpen(el.dataset.submenu ?? null);
          requestAnimationFrame(() => focusables(bar.querySelector<HTMLElement>('.menu-sub'))[0]?.focus());
        }
        // Plain action items are real <button>s — Enter/Space click them natively.
        return;
      }
    }
  };

  const renderItems = (items: Item[], depth: 0 | 1) => items.map((it, idx) => {
    if (isDivider(it)) return <div key={`d${idx}`} role="separator" className="menu-divider" />;
    if (isSubmenu(it)) {
      const openNow = subOpen === it.submenu;
      return (
        <div key={it.submenu} className="menu-subwrap"
          onMouseEnter={() => setSubOpen(it.submenu)}>
          {/* Click OPENS only (never toggles closed): hover has usually opened
              the submenu already, so a toggle would flicker it shut under the
              very click that meant to use it — the Mac behavior is open-only. */}
          <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={openNow}
            data-submenu={it.submenu} className="menu-item" tabIndex={-1}
            onClick={() => setSubOpen(it.submenu)}>
            <span>{it.submenu}</span><span className="menu-hint" aria-hidden="true">▸</span>
          </button>
          {openNow && (
            <div role="menu" aria-label={it.submenu} className="menu-panel menu-sub">
              {renderItems(it.items, 1)}
            </div>
          )}
        </div>
      );
    }
    return (
      <button key={it.label} type="button" role="menuitem" className="menu-item" tabIndex={-1}
        aria-disabled={it.disabled || undefined}
        aria-keyshortcuts={it.keyshortcuts}
        onMouseEnter={depth === 0 ? () => setSubOpen(null) : undefined}
        onClick={() => { if (!it.disabled) act(it.onSelect); }}>
        <span>{it.label}</span>
        {it.hint && <span className="menu-hint" aria-hidden="true">{it.hint}</span>}
      </button>
    );
  });

  return (
    <>
      {/* The first menu IS the app name (the macOS pattern) — bold via CSS,
          no separate wordmark, so "FirearmLog" appears exactly once. */}
      <div ref={barRef} className="menubar" role="menubar" aria-label="FirearmLog menu bar" onKeyDown={onBarKey}
        onMouseDownCapture={() => {
          pressingInside.current = true;
          // Cleared on the next tick after mouseup anywhere — a click that
          // leaves the bar is then handled by the document mousedown closer.
          window.addEventListener('mouseup', () => {
            setTimeout(() => { pressingInside.current = false; }, 0);
          }, { once: true });
        }}
        onBlur={(e) => {
          // APG menubar behavior (audit #5): when keyboard focus leaves the bar
          // (Tab out, or the window loses focus), an open menu closes rather
          // than lingering over the content it can no longer be driven from.
          // Skipped while a press inside the bar is in flight (Safari blurs on
          // mousedown without focusing the pressed button — the click must land).
          if (pressingInside.current) return;
          if (open !== null && !barRef.current?.contains(e.relatedTarget as Node)) close();
        }}>
        {menus.map((m, i) => (
          <div key={m.label} className="menubar-slot">
            <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open === i}
              className={`menubar-btn${i === 0 ? ' app-name' : ''}${open === i ? ' open' : ''}`}
              tabIndex={i === 0 ? 0 : -1}
              onClick={() => (open === i ? close() : openMenu(i))}
              onMouseEnter={() => { if (open !== null && open !== i) openMenu(i); }}>
              {m.label}
            </button>
            {open === i && (
              <div role="menu" aria-label={m.label} className="menu-panel">
                {renderItems(m.items, 0)}
              </div>
            )}
          </div>
        ))}
      </div>
      {about && (
        <Sheet title="About FirearmLog" onClose={() => setAbout(false)}>
          <p className="report-note" style={{ marginBottom: 10 }}>
            FirearmLog v{APP_VERSION}
          </p>
          <p className="report-note" style={{ marginBottom: 10 }}>
            Your training, competition, and maintenance log — stored on your own devices.
          </p>
          <p className="report-note">
            Updates install on their own: when a new version is ready, this window offers a
            one-tap Reload, and a fresh open always starts on the newest version.
          </p>
        </Sheet>
      )}
    </>
  );
}
