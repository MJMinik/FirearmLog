// Tap-to-reveal inline help (M9 — phone tooltips; spec §14, §3.5 A-series).
// A small info (i) button next to a label or heading that toggles a short help
// bubble on tap — no hover, since phones don't have one. It's a real <button>
// with aria-expanded and a 44px touch target (the icon stays small via padding +
// negative margin so it doesn't bloat headings). The glyph is an SVG from the
// shared icon set (audit F4), so it tints/sizes cleanly. Reusable everywhere.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';

export function InfoTip({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="infotip">
      <button
        type="button"
        className="infotip-btn"
        aria-expanded={open}
        aria-label={open ? `Hide help for ${title}` : `Help for ${title}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="info" size={18} />
      </button>
      {open && <span className="infotip-bubble" role="note">{children}</span>}
    </span>
  );
}
