// Session 59 (Michael's tap-test findings): first-run guidance as ANCHORED
// coach marks — a small amber callout with an arrow, sitting in the flow right
// beside the control it teaches — chosen deliberately over modal popups. The
// reasoning, recorded so it isn't relitigated: the users these marks exist for
// are the ones who don't read screens, and those same users reflex-dismiss a
// modal without reading it — after which its guidance is gone forever. An
// anchored mark can't be lost that way: it points instead of describing, stays
// until the user acts (or explicitly closes it), and never blocks the screen.
// (Dismissal persistence lives in lib/coachMarks.ts.)

import type { ReactNode } from 'react';

/** The callout itself. `arrow` names the edge the pointer sits on — 'down'
 *  points at content below the mark, 'up-right' points up at a navbar action. */
export function CoachMark({ arrow, onDismiss, children }: {
  arrow: 'down' | 'up-right';
  onDismiss: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`coach-mark coach-mark-${arrow}`} role="note">
      <span className="coach-mark-text">{children}</span>
      <button className="coach-mark-x" aria-label="Dismiss tip" onClick={onDismiss}>✕</button>
    </div>
  );
}
