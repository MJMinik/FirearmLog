// A small, reusable search box for long list screens (audit #21 / backlog C4).
// Until now only the Log screen could be searched/filtered; growable lists
// (drills, ammo, magazines, parts, purchases, guns) had no way to narrow down.
// This is a plain controlled text input styled like the app's other fields —
// the screen owns the query state and does the filtering.
export function ListSearch({ value, onChange, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <input type="search" value={value} placeholder={placeholder ?? 'Search…'}
        aria-label={placeholder ?? 'Search this list'}
        onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Case-insensitive "do all typed words appear somewhere in the text?" match. */
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = fields.filter(Boolean).join(' ').toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}
