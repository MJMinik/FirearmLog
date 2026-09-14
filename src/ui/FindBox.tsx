// The "Find a screen" box (decision 75, 12 Sep 2026, build 2): the same small
// component sits atop the phone More tab, the desktop sidebar, and Tour &
// Setup's "Where do I find…" index. Each surface owns its own query state
// and does its own filtering/results (they behave differently — see
// MoreScreen, TabBar, and HelpScreen), but the input itself, its accessible
// wrapper, and the live result-count announcement are one piece so all three
// read and behave identically.
import { ListSearch } from './ListSearch.tsx';

export function FindBox({ query, onChange, resultCount, inputRef, label = 'Find a screen', visibleCount = false }: {
  query: string;
  onChange: (v: string) => void;
  /** How many results are showing right now, for the aria-live announcement. */
  resultCount: number;
  inputRef?: React.Ref<HTMLInputElement>;
  /** L5 (cold audit, session 79): the `role="search"` landmark's accessible
   *  name. Tour & Setup shows this box AND the sidebar's own at the same
   *  time on desktop, so the two need distinct names — the Help screen
   *  passes "Find in this index"; every other surface keeps the default. */
  label?: string;
  /** The unlabeled cold-audit fix (session 79): while the SIDEBAR has a
   *  query, an empty sidebar reads as "it vanished" rather than "nothing
   *  matched" — this renders the same count as a small, visible line under
   *  the box (dim text, "N screens found · Esc to clear") instead of
   *  leaving it screen-reader-only. It still IS the aria-live region here;
   *  the phone card and the Help index keep the sr-only version, since a
   *  visible line there would just repeat what the rows below already show. */
  visibleCount?: boolean;
}) {
  const text = query.trim()
    ? `${resultCount} screen${resultCount === 1 ? '' : 's'} found${visibleCount ? ' · Esc to clear' : ''}`
    : '';
  return (
    <div role="search" aria-label={label} className="find-box">
      <ListSearch value={query} onChange={onChange} placeholder="Find a screen…" inputRef={inputRef}
        onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); onChange(''); } }} />
      {/* Spec: "announces N screens found (singular '1 screen found') as the
          query changes"; silent while the box is empty, since there's
          nothing to announce yet. */}
      <p className={visibleCount ? 'find-count' : 'sr-only'} aria-live="polite">{text}</p>
    </div>
  );
}
