// Log or edit a session (spec §8.1): kind, date, guns with per-gun rounds,
// multiple drills via the context-aware picker, photos/videos, malfunctions,
// ratings, fee, notes. Removals are STAGED — cancel really cancels (rule F3).
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  Ammunition, AppSettings, ChecklistCustomItems, DrillDef, DrillResult, Firearm, GunCategory,
  MalfunctionEntry, Media, Session, SessionChecklist
} from '../lib/types.ts';
import { deleteOne, getAll, getOne, getSettings, putOne, putSettings } from '../lib/db.ts';
import { prepareUploadBytes } from './shrinkImage.ts';
import { formatDayKey, todayKey } from '../lib/dates.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { drillsForContext } from '../lib/drillFilter.ts';
import { inventoryAfterUsageChange } from '../lib/costing.ts';
import { recentValues } from '../lib/suggest.ts';
import {
  buildChecklistPrintHtml, checklistItemsForCategory, checklistProgress, itemState, newChecklist,
  normalizeChecklist, normalizeCustomItems, setChecklistMode, setItemPacked, setItemTake,
  type ChecklistCategory, addCustomItem
} from '../lib/checklist.ts';
import { buildDrillReportHtml } from '../lib/drillReport.ts';
import { buildReportHtml, type ReportSection } from '../lib/reports.ts';
import { reportImageUrls } from './reportImages.ts';
import { ammoLabel } from './AmmoScreens.tsx';
import { SuggestField } from './SuggestField.tsx';
import { ConfirmSheet, Sheet } from './Sheet.tsx';
import { PhotoSheet } from './PhotoSheet.tsx';
import { NewPhotoSheet } from './NewPhotoSheet.tsx';
import type { Mark } from '../lib/types.ts';
import { mediaUrl } from './media.ts';
import { FormProblem } from './FormProblem.tsx';
import { pickableGuns } from '../lib/gunStatus.ts';

const KINDS = [
  { value: 'practice', label: 'Live practice' },
  { value: 'dry_fire', label: 'Dry fire' },
  { value: 'class', label: 'Class' }
];

const MALF_TYPES = [
  'Failure to feed', 'Failure to fire', 'Failure to eject', 'Failure to extract',
  'Double feed', 'Stovepipe', 'Light strike', 'Other'
];

// PT's clearing methods, carried over verbatim.
const CLEAR_METHODS = [
  'Tap-Rack-Bang', 'Tap-Rack-Reassess', 'Mortar (double feed)', 'Manual clear',
  'Disassembly required', 'Mag swap', 'Resolved itself', 'Other'
];

interface DrillRow {
  name: string; distance: string; time: string; score: string; maxScore: string; notes: string;
}
interface MalfRow { firearmId: string; type: string; resolution: string; notes: string; }
interface AmmoRow { ammoId: string; rounds: string; }
interface NewFile { file: File; url: string; kind: 'image' | 'video'; name?: string; notes?: string; marks?: Mark[]; }

const toRow = (d: DrillResult): DrillRow => ({
  name: d.name, distance: d.distance,
  time: d.time === null ? '' : String(d.time),
  score: d.score === null ? '' : String(d.score),
  maxScore: d.maxScore === null ? '' : String(d.maxScore),
  notes: d.notes
});

const fromRow = (r: DrillRow): DrillResult => ({
  name: r.name, distance: r.distance.trim(),
  time: r.time.trim() === '' ? null : Number(r.time),
  score: r.score.trim() === '' ? null : Number(r.score),
  maxScore: r.maxScore.trim() === '' ? null : Number(r.maxScore),
  notes: r.notes.trim()
});

export function SessionForm({ id, initialPlanned, convert, initialDate, onSaved, onCancel, onConvert, onDeleted }: {
  id?: string; initialPlanned?: boolean; convert?: boolean; initialDate?: string;
  onSaved: (sessionId: string) => void; onCancel: () => void;
  onConvert?: () => void; onDeleted?: () => void;
}) {
  const editing = id !== undefined;
  const [original, setOriginal] = useState<Session | null>(null);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [drillLib, setDrillLib] = useState<DrillDef[]>([]);
  const [ammoLib, setAmmoLib] = useState<Ammunition[]>([]);
  const [ammoRows, setAmmoRows] = useState<AmmoRow[]>([]);
  const [pastLocations, setPastLocations] = useState<string[]>([]);

  const [kind, setKind] = useState('practice');
  const [date, setDate] = useState(initialDate ?? todayKey());
  const [location, setLocation] = useState('');
  const [planned, setPlanned] = useState(!editing && !!initialPlanned);
  const [instructors, setInstructors] = useState<string[]>([]);
  const [instructor, setInstructor] = useState('');
  const [newInstructor, setNewInstructor] = useState('');
  const [rounds, setRounds] = useState<Record<string, string>>({});
  const [drills, setDrills] = useState<DrillRow[]>([]);
  const [malfs, setMalfs] = useState<MalfRow[]>([]);
  const [oldMalfIds, setOldMalfIds] = useState<string[]>([]);
  const [existingMedia, setExistingMedia] = useState<Media[]>([]);
  const [removedMedia, setRemovedMedia] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<NewFile[]>([]);
  const [editingNew, setEditingNew] = useState<number | null>(null);
  const [ratings, setRatings] = useState<Record<string, string>>(
    editing ? { focus: '', fundamentals: '', satisfaction: '' } : { focus: '5', fundamentals: '5', satisfaction: '5' }
  );
  const [rangeFee, setRangeFee] = useState('');
  const [notes, setNotes] = useState('');
  const [checklist, setChecklist] = useState<SessionChecklist>(newChecklist());
  const [customItems, setCustomItems] = useState<ChecklistCustomItems>(normalizeCustomItems(undefined));
  const [newItemText, setNewItemText] = useState<Record<ChecklistCategory, string>>({
    essentials: '', night: '', tactical: ''
  });
  const [addingItem, setAddingItem] = useState<Record<ChecklistCategory, boolean>>({
    essentials: false, night: false, tactical: false
  });
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [includeScoring, setIncludeScoring] = useState(true);
  const [viewing, setViewing] = useState<Media | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [f, dl, am, allSessions] = await Promise.all([
        getAll<Firearm>('firearms'), getAll<DrillDef>('drills'), getAll<Ammunition>('ammunition'),
        getAll<Session>('sessions')
      ]);
      if (!alive) return;
      setFirearms(f.sort((a, b) => a.name.localeCompare(b.name)));
      setDrillLib(dl);
      setAmmoLib(am.sort((a, b) => ammoLabel(a).localeCompare(ammoLabel(b))));
      setPastLocations(recentValues(allSessions.map((s) => ({ date: s.date, value: s.location }))));
      const instructorRow = await getOne<{ key: string; value: string[] }>('meta', 'instructors');
      if (alive) setInstructors(instructorRow?.value ?? []);
      const settings = await getSettings<AppSettings>();
      if (alive) setCustomItems(normalizeCustomItems(settings?.checklistCustomItems));
      if (id !== undefined) {
        const [s, allMedia, allMalfs] = await Promise.all([
          getOne<Session>('sessions', id),
          getAll<Media>('media'),
          getAll<MalfunctionEntry>('malfunctions')
        ]);
        if (!alive || !s) return;
        setOriginal(s);
        setKind(s.type); setDate(s.date); setLocation(s.location);
        // Converting a plan to a logged session: start unplanned so save()
        // deducts ammo and the form behaves like logging a real session.
        setPlanned(convert ? false : s.planned);
        setInstructor(s.instructor ?? '');
        const r: Record<string, string> = {};
        for (const g of s.guns) r[g.firearmId] = String(g.rounds);
        setRounds(r);
        setDrills(s.drills.map(toRow));
        setAmmoRows((s.ammoUsage ?? []).map((u) => ({ ammoId: u.ammoId, rounds: String(u.rounds) })));
        setExistingMedia(allMedia.filter((m) => m.ownerType === 'session' && m.ownerId === id));
        const mine = allMalfs.filter((m) => m.sessionId === id);
        setOldMalfIds(mine.map((m) => m.id));
        setMalfs(mine.map((m) => ({
          firearmId: m.firearmId, type: m.type, resolution: m.resolution, notes: m.notes
        })));
        setRatings({
          focus: s.selfRating?.focus !== undefined ? String(s.selfRating.focus) : '',
          fundamentals: s.selfRating?.fundamentals !== undefined ? String(s.selfRating.fundamentals) : '',
          satisfaction: s.selfRating?.satisfaction !== undefined ? String(s.selfRating.satisfaction) : ''
        });
        setRangeFee(s.rangeFee === null ? '' : String(s.rangeFee));
        setNotes(s.notes);
        setChecklist(normalizeChecklist(s.checklist));
      }
    })();
    return () => { alive = false; };
  }, [editing, id, convert]);

  const selectedGuns = useMemo(
    () => firearms.filter((f) => rounds[f.id] !== undefined),
    [firearms, rounds]
  );
  const selectedCategories = useMemo(() => {
    const cats = new Set<GunCategory>();
    for (const f of selectedGuns) cats.add(f.category);
    return [...cats];
  }, [selectedGuns]);

  // Keep each malfunction pinned to a gun that's actually in this session. If a
  // gun is removed after a malfunction was logged against it, the malfunction
  // would otherwise keep pointing at the absent gun while the "Which gun"
  // dropdown silently showed a different one — and that wrong gun is what got
  // saved (how an Erebus-session malfunction ended up filed under the Eos).
  // Re-point any stranded malfunction to the first gun still in the session, so
  // what you see in the dropdown is always what gets saved.
  useEffect(() => {
    if (!selectedGuns.length) return;
    const inSession = new Set(selectedGuns.map((f) => f.id));
    setMalfs((prev) => {
      let changed = false;
      const next = prev.map((m) => {
        if (inSession.has(m.firearmId)) return m;
        changed = true;
        return { ...m, firearmId: selectedGuns[0].id };
      });
      return changed ? next : prev;
    });
  }, [selectedGuns]);

  const pickable = useMemo(
    () => drillsForContext(drillLib, selectedCategories, kind),
    [drillLib, selectedCategories, kind]
  );

  // Guns & Rounds and the Gear Checklist's Firearms list stay in lockstep
  // (Michael's June 14 request): turning a gun on or off in EITHER place
  // adds or removes it in the other. Removing also clears its "packed" mark
  // (setItemTake(..., false) does that). Heads-up: removing a gun this way
  // drops any rounds already typed for it — that's the two-way behavior asked
  // for, so removal is intentional, not a slip.
  function syncGun(fid: string, on: boolean) {
    setRounds((prev) => {
      const next = { ...prev };
      if (on) { if (next[fid] === undefined) next[fid] = ''; }
      else delete next[fid];
      return next;
    });
    setChecklist((cl) => setItemTake(cl, `f_${fid}`, on));
  }

  const checklistProgressInfo = useMemo(
    () => checklistProgress(checklist, firearms, customItems),
    [checklist, firearms, customItems]
  );

  async function addChecklistItem(cat: ChecklistCategory) {
    const label = newItemText[cat].trim();
    if (!label) return;
    const next = addCustomItem(customItems, cat, newId('ci'), label);
    setCustomItems(next);
    setNewItemText((prev) => ({ ...prev, [cat]: '' }));
    setAddingItem((prev) => ({ ...prev, [cat]: false }));
    await putSettings<AppSettings>({ checklistCustomItems: next });
  }

  function openPrintWindow(html: string) {
    const win = window.open('', '_blank');
    if (!win) { setProblem('Pop-ups blocked — please allow pop-ups and try again.'); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  }

  function printChecklist() {
    openPrintWindow(buildChecklistPrintHtml({ date, location, notes, checklist, custom: customItems, firearms }));
  }

  function printDrills() {
    const items = drills.map((row) => {
      const def = drillLib.find((d) => d.name === row.name);
      return {
        name: row.name,
        fire: def?.fire ?? 'live',
        gunCategories: def?.gunCategories ?? [],
        brief: def?.briefDescription ?? '',
        full: def?.fullDescription ?? '',
        scoring: def?.scoring ?? '',
        requiresHolster: def?.requiresHolster ?? false,
        distance: row.distance
      };
    });
    openPrintWindow(buildDrillReportHtml(items, { includeScoring, date, location }));
  }

  async function printSessionReport() {
    if (!original) return;
    // Open the window inside the tap (so iOS doesn't block it), show a holding
    // note, then write the page once photos are downscaled. Full-size target
    // photos would otherwise crash mobile Safari (same fix as the reports hub).
    const win = window.open('', '_blank');
    if (!win) { setProblem('Pop-ups blocked — please allow pop-ups and try again.'); return; }
    win.document.write('<!doctype html><meta charset="utf-8"><body style="font:15px -apple-system,Arial,sans-serif;padding:40px;color:#555">Preparing report…</body>');
    try {
    const reps = original.type === 'dry_fire';
    const gunRows = original.guns.map((g) => ({
      label: firearms.find((f) => f.id === g.firearmId)?.name ?? '—',
      value: `${g.rounds} ${reps ? 'reps' : 'rds'}`
    }));
    const drillRows = original.drills.map((dr) => [
      dr.name, dr.distance || '—',
      dr.time != null ? `${dr.time}s` : '—',
      dr.score != null ? `${dr.score}${dr.maxScore != null ? '/' + dr.maxScore : ''}` : '—'
    ]);
    const malfRows = malfs.map((m) => [
      m.type || '—', firearms.find((f) => f.id === m.firearmId)?.name ?? '—', m.resolution || '', m.notes || ''
    ]);
    const photos = await reportImageUrls(existingMedia, 'session', original.id);
    const sections: ReportSection[] = [
      { heading: 'Session', rows: [
        { label: 'Date', value: formatDayKey(original.date) },
        { label: 'Kind', value: KINDS.find((k) => k.value === original.type)?.label ?? original.type },
        ...(original.location ? [{ label: 'Where', value: original.location }] : []),
        ...(original.instructor ? [{ label: 'Instructor', value: original.instructor }] : []),
        ...(original.rangeFee != null ? [{ label: 'Range fee', value: '$' + original.rangeFee.toFixed(2) }] : [])
      ] },
      { heading: 'Guns', rows: gunRows },
      ...(drillRows.length ? [{ heading: 'Drills', table: { headers: ['Drill', 'Distance', 'Time', 'Score'], rows: drillRows } }] : []),
      ...(malfRows.length ? [{ heading: 'Malfunctions', table: { headers: ['Type', 'Gun', 'Cleared', 'Notes'], rows: malfRows } }] : []),
      ...(original.notes ? [{ heading: 'Notes', rows: [{ label: '', value: original.notes }] }] : []),
      ...(photos.length ? [{ heading: 'Photos', images: photos }] : [])
    ];
    win.document.open();
    win.document.write(buildReportHtml(`Session — ${formatDayKey(original.date)}`, original.location || '', sections));
    win.document.close(); win.focus();
    setTimeout(() => win.print(), 400);
    } catch {
      try { win.document.body.textContent = 'Sorry — could not build this report. Please try again.'; } catch { /* window already closed */ }
    }
  }

  function addPickedDrills() {
    const toAdd = pickable.filter((d) => picked.has(d.id));
    setDrills((prev) => [
      ...prev,
      ...toAdd.map((d) => ({ name: d.name, distance: '', time: '', score: '', maxScore: '', notes: '' }))
    ]);
    setPicking(false);
  }

  function checklistSection(cat: ChecklistCategory, title: string) {
    return (
      <div className="checklist-section">
        <h3 className="checklist-section-title">{title}</h3>
        {checklistItemsForCategory(cat, customItems).map((item) => {
          const state = itemState(checklist, item.id);
          return (
            <div className="checklist-item" key={item.id}>
              <label className="checklist-take">
                <input type="checkbox" checked={!!state.take}
                  onChange={(e) => setChecklist((cl) => setItemTake(cl, item.id, e.target.checked))} />
                {item.label}
              </label>
              {state.take && (
                <label className="checklist-packed">
                  <input type="checkbox" checked={!!state.packed}
                    onChange={(e) => setChecklist((cl) => setItemPacked(cl, item.id, e.target.checked))} />
                  Packed
                </label>
              )}
            </div>
          );
        })}
        {addingItem[cat] ? (
          <div className="checklist-add">
            <input value={newItemText[cat]} placeholder="Item name — saves for future sessions" autoFocus
              aria-label={`New ${title} item name`}
              onChange={(e) => setNewItemText((prev) => ({ ...prev, [cat]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') void addChecklistItem(cat); }} />
            <button className="button secondary" onClick={() => void addChecklistItem(cat)}>Add</button>
            <button className="button secondary" onClick={() => {
              setAddingItem((prev) => ({ ...prev, [cat]: false }));
              setNewItemText((prev) => ({ ...prev, [cat]: '' }));
            }}>Cancel</button>
          </div>
        ) : (
          <button className="button secondary" onClick={() => setAddingItem((prev) => ({ ...prev, [cat]: true }))}>
            + Add a gear item
          </button>
        )}
      </div>
    );
  }

  function filesPicked(list: FileList | null) {
    if (!list) return;
    const added: NewFile[] = [];
    for (const file of Array.from(list)) {
      added.push({
        file,
        url: URL.createObjectURL(file),
        kind: file.type.startsWith('video') ? 'video' : 'image'
      });
    }
    setNewFiles((prev) => [...prev, ...added]);
  }

  async function save() {
    if (saving) return;
    const guns = Object.entries(rounds).map(([firearmId, text]) => ({
      firearmId, rounds: text.trim() === '' ? 0 : Number(text)
    }));
    if (!date) { setProblem('Pick a date.'); return; }
    if (guns.length === 0) { setProblem('Pick at least one gun.'); return; }
    if (guns.some((g) => !Number.isFinite(g.rounds) || g.rounds < 0)) {
      setProblem('Rounds need to be plain numbers.'); return;
    }
    const badDrill = drills.map(fromRow).find((d) =>
      (d.time !== null && !Number.isFinite(d.time)) ||
      (d.score !== null && !Number.isFinite(d.score)) ||
      (d.maxScore !== null && !Number.isFinite(d.maxScore)));
    if (badDrill) { setProblem(`Check the numbers on "${badDrill.name}".`); return; }

    const ammoUsage = ammoRows
      .filter((r) => r.ammoId !== '')
      .map((r) => ({ ammoId: r.ammoId, rounds: r.rounds.trim() === '' ? 0 : Number(r.rounds) }));
    if (ammoUsage.some((u) => !Number.isFinite(u.rounds) || u.rounds < 0)) {
      setProblem('Ammo rounds need to be plain numbers.'); return;
    }

    const ratingEntries = Object.entries(ratings).filter(([, v]) => v !== '');
    const selfRating = ratingEntries.length
      ? Object.fromEntries(ratingEntries.map(([k, v]) => [k, Number(v)]))
      : null;
    const fee = rangeFee.trim() === '' ? null : Number(rangeFee);
    if (fee !== null && !Number.isFinite(fee)) { setProblem('Range fee needs to be a number.'); return; }

    setSaving(true);
    try {
      const sid = original ? original.id : newId('se');
      const now = Date.now();
      const finalInstructor = kind === 'class' ? (newInstructor.trim() || instructor.trim()) : '';
      const fields = {
        date, type: kind, guns, location: location.trim(), notes: notes.trim(),
        drills: drills.map(fromRow), selfRating, rangeFee: fee, ammoUsage,
        planned, instructor: finalInstructor || null, checklist
      };
      if (original) {
        await putOne('sessions', stampUpdate({ ...original, ...fields }, now));
      } else {
        await putOne('sessions', stampNew({
          ...fields, distances: '', targetMediaIds: [], malfunctions: []
        }, sid, now));
      }
      if (finalInstructor && !instructors.includes(finalInstructor)) {
        await putOne('meta', { key: 'instructors', value: [...instructors, finalInstructor].sort() });
      }

      // Ammo comes off the cans — only the CHANGE, so edits never double-deduct.
      // Planned sessions never move stock: their usage baseline/target is empty,
      // so marking a planned session as shot deducts exactly once, and flipping
      // a real session back to planned returns the rounds.
      const baselineUsage = original && !original.planned ? (original.ammoUsage ?? []) : [];
      const targetUsage = planned ? [] : ammoUsage;
      const changes = inventoryAfterUsageChange(ammoLib, baselineUsage, targetUsage);
      for (const [ammoId, quantity] of changes) {
        const can = ammoLib.find((a) => a.id === ammoId);
        if (can) await putOne('ammunition', stampUpdate({ ...can, quantity }, now));
      }

      // Staged photo/video changes commit only now (rule F3).
      for (const mid of removedMedia) await deleteOne('media', mid);
      let seq = existingMedia.length;
      for (const nf of newFiles) {
        seq += 1;
        const { data: buf, mime } = await prepareUploadBytes(nf.file);
        await putOne('media', stampNew({
          ownerType: 'session' as const, ownerId: sid,
          kind: nf.kind, name: nf.name?.trim() || `${nf.kind === 'video' ? 'Video' : 'Photo'} ${seq} — ${date}`,
          annotations: nf.notes ? nf.notes.split('\n').map((s) => s.trim()).filter(Boolean) : [],
          marks: nf.marks ?? [],
          mime, data: buf
        }, newId('md'), now));
      }

      // Malfunctions: rewrite this session's set.
      for (const mid of oldMalfIds) await deleteOne('malfunctions', mid);
      for (const m of malfs) {
        if (!m.type) continue;
        await putOne('malfunctions', stampNew({
          sessionId: sid, date, firearmId: m.firearmId,
          type: m.type, resolution: m.resolution.trim(), notes: m.notes.trim()
        }, newId('mf'), now));
      }

      onSaved(sid);
    } finally {
      setSaving(false);
    }
  }

  // Delete lives on the edit screen now (the read-only detail screen was
  // retired). Removes the session, its photos, and its malfunctions; a real
  // (non-planned) session's ammo goes back on the can. Planned sessions never
  // moved stock, so nothing to return there.
  async function reallyDelete() {
    if (!original) return;
    if (!original.planned) {
      const changes = inventoryAfterUsageChange(ammoLib, original.ammoUsage ?? [], []);
      for (const [ammoId, quantity] of changes) {
        const can = ammoLib.find((a) => a.id === ammoId);
        if (can) await putOne('ammunition', stampUpdate({ ...can, quantity }, Date.now()));
      }
    }
    for (const m of existingMedia) await deleteOne('media', m.id);
    for (const mid of oldMalfIds) await deleteOne('malfunctions', mid);
    await deleteOne('sessions', original.id);
    onDeleted?.();
  }

  const visibleExisting = existingMedia.filter((m) => !removedMedia.includes(m.id));

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onCancel}>‹ Cancel</button>
        <button className="navbar-action" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <h1 className="large-title">{convert ? 'Log Session (from Plan)' : editing ? 'Edit Session' : planned ? 'Plan Session' : 'Log Session'}</h1>
      <FormProblem problem={problem} />

      {editing && original?.planned && !convert && onConvert && (
        <button className="button" onClick={onConvert}>✓ Convert to Logged Session</button>
      )}
      {editing && original && (
        <button className="button secondary" onClick={() => void printSessionReport()}>Session Report</button>
      )}

      <div className="card">
        <h2>What Kind of Work</h2>
        <div className="seg" role="radiogroup" aria-label="Session kind">
          {KINDS.map((k) => (
            <button key={k.value} role="radio" aria-checked={kind === k.value}
              className={kind === k.value ? 'on' : ''} onClick={() => setKind(k.value)}>
              {k.label}
            </button>
          ))}
        </div>
        <label className="field">Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <SuggestField label="Where" value={location} onChange={setLocation}
          suggestions={pastLocations} placeholder="Shoot Straight: University" />
        {kind === 'class' && (
          <>
            <label className="field">Instructor
              <select value={instructor} onChange={(e) => { setInstructor(e.target.value); setNewInstructor(''); }}>
                <option value="">—</option>
                {instructors.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="field">…or add a new instructor
              <input value={newInstructor} onChange={(e) => setNewInstructor(e.target.value)} placeholder="Ben Stoeger" />
            </label>
          </>
        )}
        <div className="row">
          <button className={`gun-toggle ${planned ? 'on' : ''}`} aria-pressed={planned}
            onClick={() => setPlanned(!planned)}>
            Planned session (hasn't happened yet — nothing counts until it does)
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Guns &amp; Rounds</h2>
        {firearms.length === 0 && <p className="report-note">No guns yet — add one from the Guns screen.</p>}
        {/* Audit #10: active guns, plus any already on this session (so a since-retired gun still shows on its own record). */}
        {pickableGuns(firearms, Object.keys(rounds)).map((f) => {
          const on = rounds[f.id] !== undefined;
          return (
            <div className="row" key={f.id}>
              <button className={`gun-toggle ${on ? 'on' : ''}`} aria-pressed={on}
                onClick={() => syncGun(f.id, rounds[f.id] === undefined)}>
                {f.name}
              </button>
              {on && (
                <input className="rounds-input" type="number" inputMode="numeric" min="0"
                  placeholder={planned ? 'planned rounds' : kind === 'dry_fire' ? 'reps' : 'rounds'}
                  aria-label={`Rounds for ${f.name}`}
                  value={rounds[f.id]}
                  onChange={(e) => setRounds((prev) => ({ ...prev, [f.id]: e.target.value }))} />
              )}
            </div>
          );
        })}
      </div>

      <div className="card">
        <button className="checklist-disclosure" aria-expanded={checklistOpen}
          onClick={() => setChecklistOpen((v) => !v)}>
          <span className="checklist-disclosure-title">Gear Checklist</span>
          <span className="checklist-disclosure-toggle">{checklistOpen ? 'Hide ▾' : 'Show ▸'}</span>
        </button>
        {checklistProgressInfo.toTake > 0 && (
          <>
            <div className="dc-bar-wrap">
              <div className="dc-bar-fill" style={{ width: `${checklistProgressInfo.pct}%` }} />
            </div>
            <p className="report-note">
              {checklistProgressInfo.packed === checklistProgressInfo.toTake
                ? `✓ All packed (${checklistProgressInfo.packed}/${checklistProgressInfo.toTake})`
                : `${checklistProgressInfo.packed} / ${checklistProgressInfo.toTake} packed`}
            </p>
          </>
        )}

        {checklistOpen && (
          <>
            <p className="report-note">Check items you plan to bring, then mark each as packed when ready.</p>

            {firearms.length > 0 && (
              <div className="checklist-section">
                <h3 className="checklist-section-title">Firearms</h3>
                {pickableGuns(firearms, Object.keys(rounds)).map((f) => {
                  const itemId = `f_${f.id}`;
                  const state = itemState(checklist, itemId);
                  return (
                    <div className="checklist-item" key={f.id}>
                      <label className="checklist-take">
                        <input type="checkbox" checked={!!state.take}
                          onChange={(e) => syncGun(f.id, e.target.checked)} />
                        {f.name}
                      </label>
                      {state.take && (
                        <label className="checklist-packed">
                          <input type="checkbox" checked={!!state.packed}
                            onChange={(e) => setChecklist((cl) => setItemPacked(cl, itemId, e.target.checked))} />
                          Packed
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {checklistSection('essentials', 'Range Essentials')}

            <div className="row">
              <button className={`gun-toggle ${checklist.nightMode ? 'on' : ''}`} aria-pressed={checklist.nightMode}
                onClick={() => setChecklist((cl) => setChecklistMode(cl, 'night', !cl.nightMode, customItems))}>
                Include night-session gear in this checklist
              </button>
            </div>
            {checklist.nightMode && checklistSection('night', 'Night Session')}

            <div className="row">
              <button className={`gun-toggle ${checklist.tacticalMode ? 'on' : ''}`} aria-pressed={checklist.tacticalMode}
                onClick={() => setChecklist((cl) => setChecklistMode(cl, 'tactical', !cl.tacticalMode, customItems))}>
                Include tactical gear in this checklist
              </button>
            </div>
            {checklist.tacticalMode && checklistSection('tactical', 'Tactical')}

            {checklistProgressInfo.toTake > 0 && (
              <button className="button secondary" onClick={printChecklist}>Print Checklist</button>
            )}
          </>
        )}
      </div>

      {kind !== 'dry_fire' && ammoLib.length > 0 && (
        <div className="card">
          <h2>Ammo Used</h2>
          {ammoRows.map((r, i) => (
            <div className="row" key={i}>
              <select className="category-pick ammo-pick" aria-label={`Ammo ${i + 1}`} value={r.ammoId}
                onChange={(e) => setAmmoRows((p) => p.map((x, n) => n === i ? { ...x, ammoId: e.target.value } : x))}>
                <option value="">Pick ammo…</option>
                {ammoLib.map((a) => <option key={a.id} value={a.id}>{ammoLabel(a)}</option>)}
              </select>
              <input className="rounds-input" type="number" inputMode="numeric" min="0"
                placeholder="rounds" aria-label={`Rounds of ammo ${i + 1}`} value={r.rounds}
                onChange={(e) => setAmmoRows((p) => p.map((x, n) => n === i ? { ...x, rounds: e.target.value } : x))} />
              <button className="icon-btn" aria-label="Remove ammo row"
                onClick={() => setAmmoRows((prev) => prev.filter((_, x) => x !== i))}>✕</button>
            </div>
          ))}
          <button className="button secondary" onClick={() => setAmmoRows((prev) => [...prev, { ammoId: '', rounds: '' }])}>
            + Add Ammo
          </button>
          {(() => {
            const used = ammoRows.reduce((t, r) => t + (Number(r.rounds) || 0), 0);
            const shot = Object.values(rounds).reduce((t, v) => t + (Number(v) || 0), 0);
            return used > 0 && shot > 0 && used !== shot ? (
              <p className="report-note">
                Heads up: ammo rows total {used.toLocaleString()} but the guns above total{' '}
                {shot.toLocaleString()}. You can still save — just check the numbers.
              </p>
            ) : (
              <p className="report-note">Rounds come off the can when you save; fixing a number later puts the difference back.</p>
            );
          })()}
        </div>
      )}

      <div className="card">
        <h2>Drills</h2>
        {drills.map((d, i) => (
          <div className="drill-edit" key={i}>
            <div className="drill-edit-head">
              <strong>{d.name}</strong>
              <button className="icon-btn" aria-label={`Remove ${d.name}`}
                onClick={() => setDrills((prev) => prev.filter((_, x) => x !== i))}>✕</button>
            </div>
            <div className="drill-edit-fields">
              <label className="field small">Distance
                <input value={d.distance} placeholder="7 yd"
                  onChange={(e) => setDrills((p) => p.map((x, n) => n === i ? { ...x, distance: e.target.value } : x))} />
              </label>
              <label className="field small">Time (s)
                <input type="number" inputMode="decimal" value={d.time}
                  onChange={(e) => setDrills((p) => p.map((x, n) => n === i ? { ...x, time: e.target.value } : x))} />
              </label>
              <label className="field small">Score
                <input type="number" inputMode="decimal" value={d.score}
                  onChange={(e) => setDrills((p) => p.map((x, n) => n === i ? { ...x, score: e.target.value } : x))} />
              </label>
              <label className="field small">Out of
                <input type="number" inputMode="decimal" value={d.maxScore}
                  onChange={(e) => setDrills((p) => p.map((x, n) => n === i ? { ...x, maxScore: e.target.value } : x))} />
              </label>
            </div>
            <label className="field">Drill notes
              <input value={d.notes}
                onChange={(e) => setDrills((p) => p.map((x, n) => n === i ? { ...x, notes: e.target.value } : x))} />
            </label>
          </div>
        ))}
        <button className="button secondary" onClick={() => { setPicked(new Set()); setPicking(true); }}>+ Add Drill</button>

        {drills.length > 0 && (
          <>
            <label className="checklist-take" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={includeScoring}
                onChange={(e) => setIncludeScoring(e.target.checked)} />
              Include scoring on the Print Drills report
            </label>
            <button className="button secondary" style={{ marginTop: 8 }} onClick={printDrills}>
              Print Drills
            </button>
          </>
        )}
      </div>

      {!planned && (
      <>
      <div className="card">
        <h2>Targets, Photos &amp; Videos</h2>
        {(visibleExisting.length > 0 || newFiles.length > 0) && (
          <div className="photo-grid" style={{ marginBottom: 12 }}>
            {visibleExisting.map((m) => (
              <div className="thumb-wrap" key={m.id}>
                <button className="thumb-tap" onClick={() => setViewing(m)} aria-label={`Open ${m.name}`}>
                  {m.kind === 'video'
                    ? <video src={mediaUrl(m)} preload="metadata" muted playsInline />
                    : <img src={mediaUrl(m)} alt={m.name} loading="lazy" />}
                </button>
                <button className="thumb-x" aria-label={`Remove ${m.name}`}
                  onClick={() => setRemovedMedia((prev) => [...prev, m.id])}>✕</button>
                <span className="thumb-caption">{m.name}</span>
              </div>
            ))}
            {newFiles.map((nf, i) => (
              <div className="thumb-wrap" key={nf.url}>
                <button className="thumb-tap" onClick={() => setEditingNew(i)} aria-label="Name this new file">
                  {nf.kind === 'video'
                    ? <video src={nf.url} preload="metadata" muted playsInline />
                    : <img src={nf.url} alt="New photo" />}
                </button>
                <button className="thumb-x" aria-label="Remove new file"
                  onClick={() => setNewFiles((prev) => prev.filter((_, x) => x !== i))}>✕</button>
                <span className="thumb-caption">{nf.name || 'Tap to name'}</span>
              </div>
            ))}
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
          onChange={(e) => { filesPicked(e.target.files); e.target.value = ''; }} />
        <button className="button secondary" onClick={() => fileRef.current?.click()}>+ Add Photos or Videos</button>
        <p className="report-note">Tap a photo to name it or jot notes. Removals only happen when you Save — Cancel really cancels.</p>
      </div>

      <div className="card">
        <h2>Malfunctions</h2>
        {malfs.map((m, i) => (
          <div className="drill-edit" key={i}>
            <div className="drill-edit-head">
              <strong>{m.type || 'New malfunction'}</strong>
              <button className="icon-btn" aria-label="Remove malfunction"
                onClick={() => setMalfs((prev) => prev.filter((_, x) => x !== i))}>✕</button>
            </div>
            <label className="field">What happened
              <select value={m.type}
                onChange={(e) => setMalfs((p) => p.map((x, n) => n === i ? { ...x, type: e.target.value } : x))}>
                <option value="">Pick one…</option>
                {MALF_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="field">Which gun
              <select value={m.firearmId}
                onChange={(e) => setMalfs((p) => p.map((x, n) => n === i ? { ...x, firearmId: e.target.value } : x))}>
                {(selectedGuns.length ? selectedGuns : firearms).map((f) =>
                  <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label className="field">How you cleared it
              <select value={CLEAR_METHODS.includes(m.resolution) || m.resolution === '' ? m.resolution : 'Other'}
                onChange={(e) => setMalfs((p) => p.map((x, n) => n === i ? { ...x, resolution: e.target.value } : x))}>
                <option value="">Pick one…</option>
                {CLEAR_METHODS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="field">Notes
              <input value={m.notes}
                onChange={(e) => setMalfs((p) => p.map((x, n) => n === i ? { ...x, notes: e.target.value } : x))} />
            </label>
          </div>
        ))}
        <button className="button secondary" onClick={() => setMalfs((prev) => [
          ...prev,
          { firearmId: (selectedGuns[0] ?? firearms[0])?.id ?? '', type: '', resolution: '', notes: '' }
        ])}>+ Add Malfunction</button>
      </div>

      <div className="card">
        <h2>How It Felt (1–10)</h2>
        {(['focus', 'fundamentals', 'satisfaction'] as const).map((k) => (
          <div className="row" key={k}>
            <span className="label" style={{ textTransform: 'capitalize' }}>{k}</span>
            <select className="category-pick" aria-label={k} value={ratings[k]}
              onChange={(e) => setRatings((prev) => ({ ...prev, [k]: e.target.value }))}>
              <option value="">—</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        ))}
      </div>
      </>
      )}

      <div className="card">
        <h2>Wrap-Up</h2>
        <label className="field">Range fee ($)
          <input type="number" inputMode="decimal" min="0" value={rangeFee} onChange={(e) => setRangeFee(e.target.value)} />
        </label>
        <label className="field">Notes
          <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>

      <button className="button" disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : convert ? 'Log Session' : editing ? 'Save Changes' : 'Save Session'}
      </button>

      {editing && original && (
        <button className="button danger" style={{ marginTop: 8 }} onClick={() => setConfirming(true)}>
          Delete Session
        </button>
      )}
      {confirming && (
        <ConfirmSheet
          title="Delete this session?"
          message="This removes the session, its photos, and its round counts. Ammo it used goes back on the can. There's no undo."
          confirmLabel="Delete Session"
          onConfirm={() => void reallyDelete()}
          onClose={() => setConfirming(false)}
        />
      )}

      {viewing && (
        <PhotoSheet media={viewing} allowDelete={false} onClose={() => setViewing(null)}
          onChanged={async () => {
            const allMedia = await getAll<Media>('media');
            setExistingMedia(allMedia.filter((m) => m.ownerType === 'session' && m.ownerId === (original?.id ?? '')));
          }} />
      )}
      {editingNew !== null && newFiles[editingNew] && (
        <NewPhotoSheet
          file={newFiles[editingNew]}
          onSave={(nm, nt, mk) => setNewFiles((prev) => prev.map((f, x) => (x === editingNew ? { ...f, name: nm, notes: nt, marks: mk } : f)))}
          onClose={() => setEditingNew(null)}
        />
      )}
      {picking && (
        <Sheet title="Pick Drills" onClose={() => setPicking(false)}>
          {pickable.length === 0 && (
            <p className="report-note">
              No drills fit this setup yet ({selectedCategories.join(', ') || 'no gun picked'} ·{' '}
              {kind === 'dry_fire' ? 'dry fire' : 'live fire'}).
            </p>
          )}
          {pickable.length > 0 && (
            <p className="report-note">Tap to select one or more, then Add.</p>
          )}
          {pickable.map((d) => {
            const on = picked.has(d.id);
            return (
              <button key={d.id} className={`drill-pick-row ${on ? 'on' : ''}`} aria-pressed={on}
                onClick={() => setPicked((prev) => {
                  const next = new Set(prev);
                  if (next.has(d.id)) next.delete(d.id); else next.add(d.id);
                  return next;
                })}>
                <strong>{on ? '☑' : '☐'} {d.name}</strong>
                {d.briefDescription && <span>{d.briefDescription}</span>}
              </button>
            );
          })}
          {pickable.length > 0 && (
            <button className="button" style={{ marginTop: 12 }} disabled={picked.size === 0} onClick={addPickedDrills}>
              Add{picked.size > 0 ? ` ${picked.size}` : ''} {picked.size === 1 ? 'Drill' : 'Drills'}
            </button>
          )}
        </Sheet>
      )}
    </div>
  );
}
