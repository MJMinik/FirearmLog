// B6 — the Search & Filter button + sheet for the Log screen (list AND calendar).
// This is the start of the app-wide standard search component (feedback C4):
// From/To dates, gun type or individual gun, what-kind chips, planned handling,
// and a global search box, per Michael's "Searchable" definition.
import { useState } from 'react';
import type { Firearm } from '../lib/types.ts';
import { GUN_CATEGORIES } from '../lib/types.ts';
import type { GunCategory } from '../lib/types.ts';
import { LOG_KINDS, emptyLogFilter, filterCount } from '../lib/searchFilter.ts';
import type { LogFilter, LogKind } from '../lib/searchFilter.ts';
import { competeFilterCount, emptyCompeteFilter } from '../lib/competeFilter.ts';
import type { CompeteFilter } from '../lib/competeFilter.ts';
import { Sheet } from './Sheet.tsx';

export function LogFilterBar({ value, onChange, firearms, shown, total }: {
  value: LogFilter;
  onChange: (f: LogFilter) => void;
  firearms: Firearm[];
  /** How many items survive the filter, out of how many — shown when narrowing. */
  shown: number;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const active = filterCount(value);

  function set<K extends keyof LogFilter>(key: K, v: LogFilter[K]) {
    onChange({ ...value, [key]: v });
  }

  function toggleKind(kind: LogKind) {
    const on = value.kinds.includes(kind);
    set('kinds', on ? value.kinds.filter((k) => k !== kind) : [...value.kinds, kind]);
  }

  return (
    <>
      <div className="filter-bar">
        <button className="button secondary" onClick={() => setOpen(true)}>
          Search &amp; Filter{active > 0 ? ` (${active})` : ''}
        </button>
        {active > 0 && (
          <button className="button secondary" onClick={() => onChange(emptyLogFilter())}>
            Clear
          </button>
        )}
      </div>
      {active > 0 && (
        <p className="report-note" style={{ marginTop: 4 }}>
          Showing {shown.toLocaleString()} of {total.toLocaleString()}.
        </p>
      )}
      {open && (
        <Sheet title="Search & Filter" onClose={() => setOpen(false)}>
          <label className="field">Search everything — places, guns, drills, instructors, match names, notes
            <input type="search" value={value.query} placeholder="Type to search" enterKeyHint="search"
              onChange={(e) => set('query', e.target.value)} />
          </label>
          <div className="field-row">
            <label className="field small">From
              <input type="date" value={value.from} onChange={(e) => set('from', e.target.value)} />
            </label>
            <label className="field small">To
              <input type="date" value={value.to} onChange={(e) => set('to', e.target.value)} />
            </label>
          </div>
          <p className="field" style={{ marginBottom: 6 }}>What to show (all of it, if none are picked)</p>
          <div className="chip-row" role="group" aria-label="What to show">
            {LOG_KINDS.map(({ kind, label }) => (
              <button key={kind} className={`chip ${value.kinds.includes(kind) ? 'on' : ''}`}
                aria-pressed={value.kinds.includes(kind)} onClick={() => toggleKind(kind)}>
                {label}
              </button>
            ))}
          </div>
          <label className="field">Gun type
            <select value={value.category} disabled={!!value.firearmId}
              onChange={(e) => set('category', e.target.value as GunCategory | '')}>
              <option value="">All types</option>
              {GUN_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="field">One gun
            <select value={value.firearmId} onChange={(e) => set('firearmId', e.target.value)}>
              <option value="">All guns</option>
              {firearms.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <label className="field">Planned sessions
            <select value={value.planned}
              onChange={(e) => set('planned', e.target.value as LogFilter['planned'])}>
              <option value="show">Show along with everything else</option>
              <option value="only">Planned only</option>
              <option value="hide">Hide planned</option>
            </select>
          </label>
          <div className="field-row" style={{ marginTop: 4 }}>
            <button className="button" onClick={() => setOpen(false)}>Done</button>
            <button className="button secondary"
              onClick={() => { onChange(emptyLogFilter()); setOpen(false); }}>
              Clear all
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

// A3 (batch 2): the Compete tab's Search & Filter — the same Sheet + count-line
// pattern as the Log filter above, so the two read as one system. Match type,
// division, and gun use dropdowns (like the Log filter's gun pickers) because
// each holds many values; a From/To date range rounds it out. Read-only over the
// matches already stored.
export function CompeteFilterBar({ value, onChange, firearms, matchTypes, divisions, shown, total }: {
  value: CompeteFilter;
  onChange: (f: CompeteFilter) => void;
  firearms: Firearm[];
  matchTypes: string[];
  divisions: string[];
  /** How many matches survive the filter, out of how many — shown when narrowing. */
  shown: number;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const active = competeFilterCount(value);

  function set<K extends keyof CompeteFilter>(key: K, v: CompeteFilter[K]) {
    onChange({ ...value, [key]: v });
  }

  return (
    <>
      <div className="filter-bar">
        {/* "Filter", not "Search & Filter": this sheet has no free-text search
            field (unlike the Log's), so it must not promise one. */}
        <button className="button secondary" onClick={() => setOpen(true)}>
          Filter{active > 0 ? ` (${active})` : ''}
        </button>
        {active > 0 && (
          <button className="button secondary" onClick={() => onChange(emptyCompeteFilter())}>
            Clear
          </button>
        )}
      </div>
      {active > 0 && (
        <p className="report-note" style={{ marginTop: 4 }}>
          Showing {shown.toLocaleString()} of {total.toLocaleString()}.
        </p>
      )}
      {open && (
        <Sheet title="Filter" onClose={() => setOpen(false)}>
          <div className="field-row">
            <label className="field small">From
              <input type="date" value={value.from} onChange={(e) => set('from', e.target.value)} />
            </label>
            <label className="field small">To
              <input type="date" value={value.to} onChange={(e) => set('to', e.target.value)} />
            </label>
          </div>
          <label className="field">Match type
            <select value={value.matchType} onChange={(e) => set('matchType', e.target.value)}>
              <option value="">All types</option>
              {matchTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="field">Division
            <select value={value.division} onChange={(e) => set('division', e.target.value)}>
              <option value="">All divisions</option>
              {divisions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="field">Gun
            <select value={value.firearmId} onChange={(e) => set('firearmId', e.target.value)}>
              <option value="">All guns</option>
              {firearms.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <div className="field-row" style={{ marginTop: 4 }}>
            <button className="button" onClick={() => setOpen(false)}>Done</button>
            <button className="button secondary"
              onClick={() => { onChange(emptyCompeteFilter()); setOpen(false); }}>
              Clear all
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
