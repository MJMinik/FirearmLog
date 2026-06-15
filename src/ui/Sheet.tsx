// THE shared modal sheet and confirm-before-delete (rules R3/R5/A1):
// every dialog in the app goes through these two components.
// The backdrop only closes when a tap BEGINS and ENDS on it — so dragging
// out of a text field can never throw your edits away.
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export function Sheet({ title, onClose, children }: {
  title: string; onClose: () => void; children: ReactNode;
}) {
  const downOnBackdrop = useRef(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="sheet-backdrop"
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onTouchStart={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdrop.current) onClose();
        downOnBackdrop.current = false;
      }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmSheet({ title, message, confirmLabel, onConfirm, onClose }: {
  title: string; message: string; confirmLabel: string;
  onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <p className="report-note" style={{ marginBottom: 14 }}>{message}</p>
      {/* Audit #1: the safe choice (Cancel) comes first and is the easy default;
          the destructive action sits below so it isn't the reflex tap. */}
      <button className="button" onClick={onClose}>Cancel</button>
      <div style={{ height: 8 }} />
      <button className="button danger" onClick={onConfirm}>{confirmLabel}</button>
    </Sheet>
  );
}
