// THE shared modal sheet and confirm-before-delete (rules R3/R5/A1):
// every dialog in the app goes through these two components.
// The backdrop only closes when a tap BEGINS and ENDS on it — so dragging
// out of a text field can never throw your edits away.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';

// N1: a module-level stack of the currently-open sheets. Each Sheet listens for
// Escape on `window`, so without this a ConfirmSheet nested inside an edit Sheet
// would fire BOTH onClose handlers on a single Esc — silently discarding the
// parent's context. Only the TOP-most sheet responds to keyboard events; the
// sheets beneath it stand down until they're on top again.
//
// AUDIT FIX (July 20 2026): non-Sheet overlays that also need "Esc closes only
// the topmost thing" (e.g. PhotoLightbox) can push a token onto this stack via
// pushSheetToken / popSheetToken. The invariant: while any non-Sheet overlay
// is on top of the stack, this Sheet's keydown listener stands down (its
// isTop() check returns false), so Esc dismisses the overlay first and the
// sheet behind it is untouched. That replaces the older capture-phase +
// stopPropagation dance the lightbox used, which was fragile (a sibling
// listener on window could still race). Genuine top-of-stack, not first-to-fire.
const sheetStack: symbol[] = [];

/** Push a token onto the shared modal stack. Overlays that also listen for
 *  Escape on `window` (e.g. PhotoLightbox) use this so the topmost thing —
 *  and only that — handles the key. Returns the token to pop on unmount. */
export function pushSheetToken(): symbol {
  const token = Symbol('overlay');
  sheetStack.push(token);
  return token;
}
export function popSheetToken(token: symbol): void {
  const i = sheetStack.indexOf(token);
  if (i >= 0) sheetStack.splice(i, 1);
}
export function isTopmost(token: symbol): boolean {
  return sheetStack[sheetStack.length - 1] === token;
}

export function Sheet({ title, onClose, children, dirty = false }: {
  title: string; onClose: () => void; children: ReactNode;
  // F-Universal-Guard (July 20 2026): when true, ANY dismiss gesture (backdrop
  // tap, Escape, X close button) first asks "Discard changes?" via the shared
  // DiscardChangesSheet — one policy on every form surface. Undirtied sheets
  // keep instant dismissal so a plain viewer never asks a question it doesn't
  // need to. Callers pass `dirty` and get the confirm-before-close for free.
  dirty?: boolean;
}) {
  const downOnBackdrop = useRef(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  // Tester-2 F1 (July 16 2026): hold the LATEST onClose in a ref so the
  // focus-trap effect can run ONCE per mount (`[]` deps) instead of re-running
  // whenever a caller passes a fresh arrow-function onClose each render. The old
  // `[onClose]` deps tore the trap down and back up on every parent re-render
  // (e.g. each keystroke in FilterBar's search box updated filter state), which
  // yanked focus off the input to the sheet's first focusable — closing the iOS
  // keyboard on every keystroke. The keydown handler reads onCloseRef.current.
  const onCloseRef = useRef(onClose);
  // F-Universal-Guard: mirror `dirty` into a ref too, so the once-per-mount
  // keydown handler always sees the LATEST value without re-binding the listener.
  const dirtyRef = useRef(dirty);
  const [confirming, setConfirming] = useState(false);
  // Tester-2 F1 (July 16 2026): sync the ref in an effect, not during render —
  // a render-phase mutation is unsafe under concurrent rendering (a render can
  // be discarded). No deps array, so it re-syncs after every committed render.
  useEffect(() => { onCloseRef.current = onClose; });
  useEffect(() => { dirtyRef.current = dirty; });
  // A11y (pro-grade audit T1-9): trap keyboard focus inside the open sheet and
  // restore it to whatever was focused before (the trigger) on close, so a
  // keyboard/VoiceOver user can't Tab onto the page behind the "modal". Escape
  // still closes it (so the trap is always escapable — WCAG 2.1.2).
  useEffect(() => {
    const token = Symbol('sheet');
    sheetStack.push(token);
    const isTop = () => sheetStack[sheetStack.length - 1] === token;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = (): HTMLElement[] => {
      const el = sheetRef.current;
      if (!el) return [];
      return Array.from(
        el.querySelectorAll<HTMLElement>(
          'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((n) => !n.hasAttribute('disabled'));
    };
    (focusables()[0] ?? sheetRef.current)?.focus();
    const h = (e: KeyboardEvent) => {
      if (!isTop()) return; // only the top-most sheet handles the keyboard
      if (e.key === 'Escape') {
        // F-Universal-Guard: route Esc through the same discard confirm the
        // backdrop and X use, so all three dismiss gestures ask the same
        // question when there are unsaved edits.
        if (dirtyRef.current) setConfirming(true);
        else onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', h);
    return () => {
      const i = sheetStack.indexOf(token);
      if (i >= 0) sheetStack.splice(i, 1);
      window.removeEventListener('keydown', h);
      previouslyFocused?.focus?.();
    };
    // Tester-2 F1 (July 16 2026): run once per mount — see onCloseRef above.
  }, []);
  // F-Universal-Guard: the single funnel every dismiss gesture uses. Dirty →
  // show the confirm; clean → close instantly.
  const requestClose = () => {
    if (dirtyRef.current) setConfirming(true);
    else onClose();
  };
  return (
    <div className="sheet-backdrop"
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onTouchStart={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdrop.current) requestClose();
        downOnBackdrop.current = false;
      }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={sheetRef} tabIndex={-1}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={requestClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
      {/* F-Universal-Guard: the shared "Discard changes?" confirm — same
          component and wording as the screen-form ‹ Cancel button and App's
          own nav guard. Keep editing stays put; Discard closes the sheet. */}
      {confirming && (
        <DiscardChangesSheet
          onConfirm={() => { setConfirming(false); onClose(); }}
          onClose={() => setConfirming(false)} />
      )}
    </div>
  );
}

export function ConfirmSheet({ title, message, confirmLabel, cancelLabel = 'Cancel', onConfirm, onClose }: {
  title: string; message: string; confirmLabel: string; cancelLabel?: string;
  onConfirm: () => void; onClose: () => void;
}) {
  // AUDIT FIX (July 20 2026): dirty is deliberately NOT passed through — a
  // ConfirmSheet (including the DiscardChangesSheet built on it) MUST never
  // spawn a discard sheet from itself. Hardcoded false + the DiscardChangesSheet
  // prop-type omission close the recursion door at compile time.
  return (
    <Sheet title={title} onClose={onClose} dirty={false}>
      <p className="report-note" style={{ marginBottom: 14 }}>{message}</p>
      {/* Audit #1: the safe choice comes first and is the easy default; the
          destructive action sits below so it isn't the reflex tap. */}
      <button className="button" onClick={onClose}>{cancelLabel}</button>
      <div style={{ height: 8 }} />
      <button className="button danger" onClick={onConfirm}>{confirmLabel}</button>
    </Sheet>
  );
}

// F3: THE one "unsaved edits" confirm, with its wording defined exactly once.
// Every place a dirty form can be abandoned — a form's ‹ Cancel button, a
// tab-bar or sidebar tap, the browser's Back, and now every Sheet-hosted form
// (backdrop tap / Esc / X) via the `dirty` prop — shows this same sheet, so
// the user meets one consistent question no matter which door they leave through.
//
// AUDIT FIX (July 20 2026): the recursion door. This helper renders a Sheet,
// so a future edit that tried to pass `dirty` to it would spawn a discard sheet
// FROM a discard sheet — the user would meet the same question about their
// answer. The prop type explicitly forbids `dirty` (Omit) and the inner Sheet
// hardcodes dirty=false, so the recursion is impossible by construction.
export function DiscardChangesSheet({ onConfirm, onClose }: {
  onConfirm: () => void; onClose: () => void;
}) {
  return (
    <ConfirmSheet title="Discard changes?" message="Your edits on this screen will be lost."
      cancelLabel="Keep editing" confirmLabel="Discard"
      onConfirm={onConfirm} onClose={onClose} />
  );
}
