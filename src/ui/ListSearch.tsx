// A small, reusable search box for long list screens (audit #21 / backlog C4).
// Until now only the Log screen could be searched/filtered; growable lists
// (drills, ammo, magazines, parts, purchases, guns) had no way to narrow down.
// This is a plain controlled text input styled like the app's other fields —
// the screen owns the query state and does the filtering.
//
// matchesQuery itself now lives in matchQuery.ts (see that file for why) —
// re-exported here so every existing `import { matchesQuery } from
// './ListSearch.tsx'` keeps working unchanged.
import { matchesQuery } from './matchQuery.ts';
export { matchesQuery };

export function ListSearch({ value, onChange, placeholder, inputRef, onKeyDown }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Lets a caller (the Find-a-screen box) focus this input programmatically. */
  inputRef?: React.Ref<HTMLInputElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  return (
    <label className="field">
      <input ref={inputRef} type="search" value={value} placeholder={placeholder ?? 'Search…'}
        aria-label={placeholder ?? 'Search this list'} enterKeyHint="search"
        onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} />
    </label>
  );
}
