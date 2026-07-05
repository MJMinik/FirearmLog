// A labeled progressive-disclosure section: a text toggle that reveals its children on
// demand. Keeps capture/analysis a newcomer doesn't need out of the default view (the
// locked "minimal by default, depth on demand" spine) while staying one tap away. The
// toggle reuses the app's existing link-btn affordance; children are unmounted while
// collapsed (form values live in parent state, so nothing is lost — an unopened section
// simply saves its defaults, exactly as before the demotion).
import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Reveal({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // L13: when a caller learns (often after an async load) that the section is
  // already populated, `defaultOpen` flips to true — open the section then. We
  // only ever force it OPEN, never closed, so the user can still collapse it, and
  // callers that never pass defaultOpen (the default false) are unaffected.
  useEffect(() => { if (defaultOpen) setOpen(true); }, [defaultOpen]);
  return (
    <div className="reveal">
      <button
        type="button"
        className="link-btn reveal-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label} <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} style={{ verticalAlign: 'middle' }} />
      </button>
      {open && <div className="reveal-body">{children}</div>}
    </div>
  );
}
