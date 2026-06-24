// Shared list-row affordance (atomic component, reused across screens).
// A list row you can swipe left (on a phone) to reveal a red Delete button —
// the iOS Mail/Reminders pattern. We reveal a button you then tap, rather than
// deleting the instant you swipe, so a stray swipe can never delete by accident
// (the zero-data-loss bar). On a desktop (a device with a real hover) the same
// Delete button fades in when you hover the row. Tapping anywhere on an open row
// just closes it. The gesture only engages on a clearly horizontal drag, so it
// never fights the page's vertical scroll.
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';

export function SwipeRow({ onDelete, deleteLabel = 'Delete', desktopButton = false, children }: {
  onDelete?: () => void; deleteLabel?: string; desktopButton?: boolean; children: ReactNode;
}) {
  const REVEAL = 104; // wider than the 76px button so the row's value clears it
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(0);
  const sx = useRef<number | null>(null);
  const sy = useRef<number | null>(null);
  const axis = useRef<'h' | 'v' | null>(null);

  // No delete handler (e.g. Home's glance list) → render a plain, static row.
  if (!onDelete) return <>{children}</>;

  const tx = Math.max(-REVEAL, Math.min(0, (open ? -REVEAL : 0) + drag));

  return (
    <div className={`swipe-row${desktopButton ? ' has-desk-del' : ''}`}>
      <button className="swipe-delete" tabIndex={open ? 0 : -1} aria-hidden={!open}
        onClick={(e) => { e.stopPropagation(); setOpen(false); setDrag(0); onDelete(); }}>
        {deleteLabel}
      </button>
      {/* Desktop-only delete control — a small trash icon (dim at rest, red on
          hover). Shown ONLY where a click cleanly deletes: planned sessions. On
          touch, everything is handled by the swipe instead. */}
      {desktopButton && (
        <button className="swipe-hover-del" aria-label={deleteLabel}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 7h16 M10 11v6 M14 11v6 M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13 M9 7V4h6v3" />
          </svg>
        </button>
      )}
      <div className="swipe-front"
        style={{ transform: `translateX(${tx}px)`, transition: drag !== 0 ? 'none' : 'transform 0.2s ease' }}
        onClickCapture={(e) => { if (open) { e.stopPropagation(); e.preventDefault(); setOpen(false); setDrag(0); } }}
        onTouchStart={(e) => {
          sx.current = e.touches[0].clientX; sy.current = e.touches[0].clientY; axis.current = null;
        }}
        onTouchMove={(e) => {
          if (sx.current == null || sy.current == null) return;
          const dX = e.touches[0].clientX - sx.current;
          const dY = e.touches[0].clientY - sy.current;
          if (axis.current == null && (Math.abs(dX) > 8 || Math.abs(dY) > 8)) {
            axis.current = Math.abs(dX) > Math.abs(dY) ? 'h' : 'v';
          }
          if (axis.current === 'h') { e.preventDefault(); setDrag(dX); }
        }}
        onTouchEnd={() => {
          if (axis.current === 'h') setOpen((open ? -REVEAL : 0) + drag < -REVEAL / 2);
          sx.current = null; sy.current = null; axis.current = null; setDrag(0);
        }}>
        {children}
      </div>
    </div>
  );
}
