// App 3b — the dedicated Malfunctions list (spec §4.1 "Malfunctions" under More,
// §4.3 "everything drills down"). Every malfunction you've logged, searchable and
// filterable by gun, type, ammo, magazine, and date — tap one to open its
// session. Read-only: it only displays existing records, never writes.
import { useEffect, useMemo, useState } from 'react';
import type { Ammunition, Firearm, Magazine, MalfunctionEntry, Session } from '../lib/types.ts';
import { getAll } from '../lib/db.ts';
import { activeMalfunctions, trashedIdSet } from '../lib/softDelete.ts';
import { formatDayKey } from '../lib/dates.ts';
import { ammoLabel } from './AmmoScreens.tsx';
import { Sheet } from './Sheet.tsx';
import { InfoTip } from './InfoTip.tsx';
import {
  emptyMalfFilter, malfFilterCount, filterMalfunctions, distinctTypes, type MalfFilter
} from '../lib/malfunctionFilter.ts';
import { labelOrRemoved } from '../lib/lookup.ts';

export function MalfunctionsScreen({ refreshKey, onBack, openSession }: {
  refreshKey: number;
  onBack: () => void;
  openSession: (sessionId: string) => void;
}) {
  const [malfs, setMalfs] = useState<MalfunctionEntry[]>([]);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [ammo, setAmmo] = useState<Ammunition[]>([]);
  const [magazines, setMagazines] = useState<Magazine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<MalfFilter>(emptyMalfFilter());
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [mf, sessions, f, am, mags] = await Promise.all([
          getAll<MalfunctionEntry>('malfunctions'), getAll<Session>('sessions'),
          getAll<Firearm>('firearms'), getAll<Ammunition>('ammunition'), getAll<Magazine>('magazines')
        ]);
        if (!alive) return;
        // App 7: a malfunction filed against a trashed session is hidden too.
        setMalfs(activeMalfunctions(mf, trashedIdSet(sessions)));
        setFirearms(f);
        setAmmo(am.sort((a, b) => ammoLabel(a).localeCompare(ammoLabel(b))));
        setMagazines(mags);
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, [refreshKey]);

  const filtered = useMemo(() => filterMalfunctions(malfs, filter), [malfs, filter]);
  const types = useMemo(() => distinctTypes(malfs), [malfs]);
  const active = malfFilterCount(filter);

  // Crash-safe name lookups — a since-deleted ammo/magazine reads as "(removed)";
  // no id reads as empty here (inline subtitle omits the bit). See lib/lookup.ts.
  const gunName = (id: string) => firearms.find((g) => g.id === id)?.name ?? '—';
  const ammoName = (id?: string | null) => labelOrRemoved(ammo, id, ammoLabel);
  const magName = (id?: string | null) => labelOrRemoved(magazines, id, (m) => m.label);

  function setField<K extends keyof MalfFilter>(key: K, v: MalfFilter[K]) {
    setFilter((prev) => ({ ...prev, [key]: v }));
  }

  if (!loaded) return <div className="screen" />;

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
      </div>
      <h1 className="large-title">Malfunctions <InfoTip title="Malfunctions">Every malfunction you've logged, newest first. Search or filter by gun, type, ammo, or magazine to spot patterns — like a magazine or ammo that jams more than the rest. Tap one to open the session it happened in.</InfoTip></h1>

      {malfs.length > 0 && (
        <div className="filter-bar">
          <button className="button secondary" onClick={() => setSheetOpen(true)}>
            Search &amp; Filter{active > 0 ? ` (${active})` : ''}
          </button>
          {active > 0 && (
            <button className="button secondary" onClick={() => setFilter(emptyMalfFilter())}>Clear</button>
          )}
        </div>
      )}
      {active > 0 && (
        <p className="report-note" style={{ marginTop: 4 }}>
          Showing {filtered.length.toLocaleString()} of {malfs.length.toLocaleString()}.
        </p>
      )}

      {malfs.length === 0 ? (
        <p className="empty">No malfunctions logged yet. When you record one while logging a session, it shows up here so you can spot patterns. (None is a good thing.)</p>
      ) : filtered.length === 0 ? (
        <p className="empty">No malfunctions match these filters. <button className="link-btn" onClick={() => setFilter(emptyMalfFilter())}>Clear filters</button></p>
      ) : (
        <div className="card" style={{ marginTop: 12 }}>
          {filtered.map((m) => {
            const sub = [ammoName(m.ammoId), magName(m.magazineId), m.roundCount != null ? `round ${m.roundCount}` : '']
              .filter(Boolean).join(' · ');
            const canOpen = !!m.sessionId;
            return (
              <button className="row-tap" key={m.id} disabled={!canOpen}
                onClick={() => { if (m.sessionId) openSession(m.sessionId); }}>
                <span className="label">
                  {m.type || 'Malfunction'}
                  <div className="row-sub">
                    {(m.date ? formatDayKey(m.date) : 'No date')} · {gunName(m.firearmId)}
                    {sub && <><br />{sub}</>}
                  </div>
                </span>
                <span className="value">{canOpen ? '›' : ''}</span>
              </button>
            );
          })}
        </div>
      )}

      {sheetOpen && (
        <Sheet title="Search & Filter" onClose={() => setSheetOpen(false)}>
          <label className="field">Search the malfunction's words — type, how you cleared it, notes
            <input type="search" value={filter.query} placeholder="Type to search"
              onChange={(e) => setField('query', e.target.value)} />
          </label>
          <div className="field-row">
            <label className="field small">From
              <input type="date" value={filter.from} onChange={(e) => setField('from', e.target.value)} />
            </label>
            <label className="field small">To
              <input type="date" value={filter.to} onChange={(e) => setField('to', e.target.value)} />
            </label>
          </div>
          <label className="field">Gun
            <select value={filter.firearmId} onChange={(e) => setField('firearmId', e.target.value)}>
              <option value="">All guns</option>
              {firearms.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <label className="field">Type
            <select value={filter.type} onChange={(e) => setField('type', e.target.value)}>
              <option value="">All types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          {ammo.length > 0 && (
            <label className="field">Ammo
              <select value={filter.ammoId} onChange={(e) => setField('ammoId', e.target.value)}>
                <option value="">All ammo</option>
                {ammo.map((a) => <option key={a.id} value={a.id}>{ammoLabel(a)}</option>)}
              </select>
            </label>
          )}
          {magazines.length > 0 && (
            <label className="field">Magazine
              <select value={filter.magazineId} onChange={(e) => setField('magazineId', e.target.value)}>
                <option value="">All magazines</option>
                {magazines.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
          )}
          <div className="field-row" style={{ marginTop: 4 }}>
            <button className="button" onClick={() => setSheetOpen(false)}>Done</button>
            <button className="button secondary"
              onClick={() => { setFilter(emptyMalfFilter()); setSheetOpen(false); }}>Clear All</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
