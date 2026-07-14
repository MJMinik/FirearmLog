// Audit #D8: one consistent, tintable line-icon set to replace emoji glyphs.
// Monochrome SVG, stroke = currentColor, so icons inherit the active/dim color of
// whatever they sit in (fixes the broken active-tab tint and per-platform emoji).
import type { CSSProperties } from 'react';

export type IconName =
  | 'home' | 'log' | 'compete' | 'progress' | 'more'
  | 'gun' | 'optic' | 'ammo' | 'magazine' | 'drills'
  | 'costs' | 'maintenance' | 'parts' | 'reference' | 'reports' | 'help' | 'malfunction' | 'info'
  | 'sync' | 'cleanup' | 'settings' | 'shield'
  | 'close' | 'edit' | 'star' | 'starFilled' | 'external'
  | 'chevronRight' | 'chevronDown';

// 24x24 viewBox line paths.
const PATHS: Record<IconName, string> = {
  home:        'M3 11.5 12 4l9 7.5 M5.5 10v9.5h13V10 M10 19.5v-5h4v5',
  log:         'M4 6h16 M4 12h16 M4 18h16',
  compete:     'M7 4h10v3a5 5 0 0 1-10 0V4z M7 5H4.5v1.5A3.5 3.5 0 0 0 8 10 M17 5h2.5v1.5A3.5 3.5 0 0 1 16 10 M12 11.5V15 M9 19.5h6 M9.5 19.5 10 15h4l.5 4.5',
  progress:    'M4 17l5-5 4 4 7-7 M16 9h5v5',
  more:        'M6 12h.01 M12 12h.01 M18 12h.01',
  gun:         'M3 9h13l3 2.5h-3.5L14 14h-3v-2.5H9L8 16H5.5l.5-4H3z',
  optic:       'M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z M12 2.5v3.5 M12 18v3.5 M2.5 12H6 M18 12h3.5',
  ammo:        'M9 21V8.5l3-4 3 4V21z M9 12.5h6 M9 16h6',
  magazine:    'M9 3.5h6v15l-3 2-3-2z M9 8h6 M9 12h6 M9 16h6',
  drills:      'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 11.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1z',
  costs:       'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v10 M14.5 9.5C14.5 8.4 13.4 8 12 8s-2.5.6-2.5 1.8S10.6 11.7 12 12s2.5.7 2.5 2-1.1 2-2.5 2-2.5-.5-2.5-1.6',
  maintenance: 'M14.7 6.3a3.6 3.6 0 0 0-4.8 4.6L4 16.8 7.2 20l5.9-5.9a3.6 3.6 0 0 0 4.6-4.8l-2.3 2.3-2.1-2.1z',
  parts:       'M12 3 4 7v10l8 4 8-4V7z M4 7l8 4 8-4 M12 11v10',
  reference:   'M5 4.5h9.5a2 2 0 0 1 2 2V21H7a2 2 0 0 0-2 2z M16.5 6.5a2 2 0 0 1 2-2H21V19h-2.5a2 2 0 0 0-2 2',
  reports:     'M6 3.5h8l4 4V20.5H6z M14 3.5V8h4 M9 17v-3 M12 17v-6 M15 17v-4',
  help:        'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M9.6 9.2a2.5 2.5 0 0 1 4.9.6c0 1.6-2.4 1.9-2.4 3.4 M12 16.8h.01',
  malfunction: 'M12 4.5 20.5 19H3.5z M12 10v4 M12 16.8h.01',
  info:        'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11v5 M12 7.6h.01',
  sync:        'M20 11a8 8 0 0 0-13.7-5.3L4 8 M4 4v4h4 M4 13a8 8 0 0 0 13.7 5.3L20 16 M20 20v-4h-4',
  cleanup:     'M12 4l1.5 4L18 9.5l-4.5 1.5L12 15l-1.5-4L6 9.5l4.5-1.5z M18 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
  settings:    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M18.4 5.6l-2.1 2.1 M5.6 18.4l2.1-2.1',
  shield:      'M12 3l7 2.8V11c0 4.6-2.9 7.6-7 9.7-4.1-2.1-7-5.1-7-9.7V5.8z',
  close:       'M6 6l12 12 M18 6L6 18',
  edit:        'M4 20l.6-3.8L15.5 5.3a2 2 0 0 1 2.9 2.9L7.6 19.1 4 20z M13.7 7.1l3.1 3.1',
  star:        'M12 3.6l2.55 5.17 5.7.83-4.13 4.02.98 5.68L12 16.62l-5.1 2.68.98-5.68L3.75 9.6l5.7-.83z',
  starFilled:  'M12 3.6l2.55 5.17 5.7.83-4.13 4.02.98 5.68L12 16.62l-5.1 2.68.98-5.68L3.75 9.6l5.7-.83z',
  external:    'M14 4h6v6 M20 4L10 14 M18 13.5V17a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.5',
  chevronRight:'M9 5l7 7-7 7',
  chevronDown: 'M5 9l7 7 7-7',
};

// Icons drawn as a solid fill rather than a stroke.
const FILLED = new Set<IconName>(['starFilled']);

export function Icon({ name, size = 22, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  const filled = FILLED.has(name);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" style={style}>
      <path d={PATHS[name]} fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} />
    </svg>
  );
}
