// THE shared modal sheet and confirm-before-delete (rules R3/R5/A1):
// every dialog in the app goes through these two components.
// The backdrop only closes when a tap BEGINS and ENDS on it — so dragging
// out of a text field can never throw your edits away.
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';

// N1: a module-level stack of the currently-open sheets. Each Sheet listens for
// Escape on `window`, so without this a ConfirmSheet nested inside an edit Sheet
// would fire BOTH onClose handlers on a single Esc — silently discarding the
// parent's context. Only the TOP-most sheet responds to keyboard events; the
// sheets beneath it stand down until they're on top again.
const sheetStack: symbol[] = [];

export function Sheet({ title, onClose, children }: {
  title: string; onClose: () => void; children: ReactNode;
}) {
  const downOnBackdrop = useRef(false);
  const sheetRef = useRef<HTMLDivElement>(null);
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
      if (e.key === 'Escape') { onClose(); return; }
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
  }, [onClose]);
  return (
    <div className="sheet-backdrop"
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onTouchStart={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdrop.current) onClose();
        downOnBackdrop.current = false;
      }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={sheetRef} tabIndex={-1}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmSheet({ title, message, confirmLabel, cancelLabel = 'Cancel', onConfirm, onClose }: {
  title: string; message: string; confirmLabel: string; cancelLabel?: string;
  onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <p className="report-note" style={{ marginBottom: 14 }}>{message}</p>
      {/* Audit #1: the safe choice comes first and is the easy default; the
          destructive action sits below so it isn't the reflex tap. */}
      <button className="button" onClick={onClose}>{cancelLabel}</button>
      <div style={{ height: 8 }} />
      <button className="button danger" onClick={onConfirm}>{confirmLabel}</button>
    </Sheet>
  );
}
