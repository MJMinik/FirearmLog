// Log or edit a session (spec §8.1): kind, date, guns with per-gun rounds,
// multiple drills via the context-aware picker, photos/videos, malfunctions,
// ratings, fee, notes. Removals are STAGED — cancel really cancels (rule F3).
import { useEffect, useMemo, useState } from 'react';
import type {
  Ammunition, AppSettings, ChecklistCustomItems, DrillDef, DrillResult, Firearm, GunCategory,
  Magazine, MalfunctionEntry, Media, Session, SessionChecklist
} from '../lib/types.ts';
import { deleteOne, getAll, getOne, getSettings, putOne, putSettings } from '../lib/db.ts';
import { formatDayKey, todayKey } from '../lib/dates.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { drillsForContext } from '../lib/drillFilter.ts';
import { inventoryAfterUsageChange } from '../lib/costing.ts';
import { MALF_TYPES, CLEAR_METHODS, mergeOptions, magazinesForFirearm, parseRoundCount } from '../lib/malfunctions.ts';
import { recentValues } from '../lib/suggest.ts';
import { suggestAmmoRow, sharedCaliber } from '../lib/ammoSuggest.ts';
import {
  buildChecklistPrintHtml, checklistItemsForCategory, checklistProgress, itemState, newChecklist,
  normalizeChecklist, normalizeCustomItems, setChecklistMode, setItemPacked, setItemTake,
  type ChecklistCategory, addCustomItem
} from '../lib/checklist.ts';
import { buildDrillReportHtml, type DrillReportItem } from '../lib/drillReport.ts';
import { activeOnly } from '../lib/softDelete.ts';
import { softDeleteSession } from './sessionDelete.ts';
import { buildReportHtml, type ReportSection } from '../lib/reports.ts';
import { reportImageUrls } from './reportImages.ts';
import { ammoLabel } from './AmmoScreens.tsx';
import { SuggestField, noAutofillProps } from './SuggestField.tsx';
import { ConfirmSheet, Sheet } from './Sheet.tsx';
import { MediaField, commitMedia } from './MediaField.tsx';
import type { StagedFile } from './MediaField.tsx';
import { FormProblem } from './FormProblem.tsx';
import { Reveal } from './Reveal.tsx';
import { pickableGuns } from '../lib/gunStatus.ts';
import { InfoTip } from './InfoTip.tsx';
import { DrillForm } from './DrillsScreen.tsx';

const KINDS = [
  { value: 'practice', label: 'Live practice' },
  { value: 'dry_fire', label: 'Dry fire' },
  { value: 'class', label: 'Class' }
];

interface DrillRow {
  name: string; distance: string; time: string; score: string; maxScore: string; notes: string;
}
interface MalfRow {
  firearmId: string; type: string; resolution: string; notes: string;
  // App 3a: optional context. Held as strings in the form; '' means "not set".
  ammoId: string; magazineId: string; roundCount: string;
  // App 2: transient (not saved) — true while typing a custom "Other" value.
  otherType?: boolean; otherRes?: boolean;
}
interface AmmoRow { ammoId: string; rounds: string; }

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
  const [magazines, setMagazines] = useState<Magazine[]>([]);
  const [ammoRows, setAmmoRows] = useState<AmmoRow[]>([]);
  // Once the shooter touches the Ammo Used section, the form stops auto-syncing
  // it to the gun rounds (so borrow/lend cases, where the numbers legitimately
  // differ, stick). recentAmmoIds drives the smart type default (most-recent
  // first, from past sessions).
  const [ammoTouched, setAmmoTouched] = useState(false);
  const [recentAmmoIds, setRecentAmmoIds] = useState<string[]>([]);
  const [pastLocations, setPastLocations] = useState<string[]>([]);

  const [kind, setKind] = useState('practice');
  const [date, setDate] = useState(initialDate ?? todayKey());
  const [location, setLocation] = useState('');
  const [planned, setPlanned] = useState(!editing && !!initialPlanned);
  const [instructors, setInstructors] = useState<string[]>([]);
  const [instructor, setInstructor] = useState('');
  const [rounds, setRounds] = useState<Record<string, string>>({});
  const [drills, setDrills] = useState<DrillRow[]>([]);
  const [malfs, setMalfs] = useState<MalfRow[]>([]);
  const [oldMalfIds, setOldMalfIds] = useState<string[]>([]);
  // App 2: custom malfunction types/methods the shooter has used before, so a
  // typed-in "Other" value reappears in the dropdown next time.
  const [savedMalfTypes, setSavedMalfTypes] = useState<string[]>([]);
  const [savedClearMethods, setSavedClearMethods] = useState<string[]>([]);
  const [existingMedia, setExistingMedia] = useState<Media[]>([]);
  const [removedMedia, setRemovedMedia] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<StagedFile[]>([]);
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
  // Inline quick-add a drill from inside the Pick Drills sheet: the lite form
  // (name only — gun type + fire come from the session context) and the
  // escalation to the full DrillForm editor for power users.
  const [quickAdding, setQuickAdding] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickProblem, setQuickProblem] = useState('');
  const [quickSaving, setQuickSaving] = useState(false);
  const [fullEditor, setFullEditor] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [f, dl, am, mags, allSessions, allMalf] = await Promise.all([
        getAll<Firearm>('firearms'), getAll<DrillDef>('drills'), getAll<Ammunition>('ammunition'),
        getAll<Magazine>('magazines'),
        getAll<Session>('sessions'), getAll<MalfunctionEntry>('malfunctions')
      ]);
      if (!alive) return;
      setFirearms(f.sort((a, b) => a.name.localeCompare(b.name)));
      setDrillLib(dl);
      setAmmoLib(am.sort((a, b) => ammoLabel(a).localeCompare(ammoLabel(b))));
      setMagazines(mags);
      setPastLocations(recentValues(activeOnly(allSessions).map((s) => ({ date: s.date, value: s.location }))));
      // Ammo types used before, most-recent first — feeds the smart default for
      // the auto Ammo Used row.
      const recentAmmo: string[] = [];
      for (const s of [...activeOnly(allSessions)].sort((a, b) => b.date.localeCompare(a.date))) {
        for (const u of s.ammoUsage ?? []) {
          if (u.ammoId && !recentAmmo.includes(u.ammoId)) recentAmmo.push(u.ammoId);
        }
      }
      setRecentAmmoIds(recentAmmo);
      setSavedMalfTypes([...new Set(allMalf.map((m) => m.type).filter(Boolean))]);
      setSavedClearMethods([...new Set(allMalf.map((m) => m.resolution).filter(Boolean))]);
      // Instructor suggestions = past sessions' instructors (most-recent first,
      // like the "Where" field) unioned with any names in the legacy instructors
      // meta list, so nothing previously saved is lost.
      const instructorRow = await getOne<{ key: string; value: string[] }>('meta', 'instructors');
      const sessionInstructors = recentValues(activeOnly(allSessions).map((s) => ({ date: s.date, value: s.instructor ?? '' })));
      if (alive) setInstructors([...new Set([...sessionInstructors, ...(instructorRow?.value ?? [])])]);
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
        // Editing/converting an existing session: never auto-overwrite its saved
        // ammo — treat the section as already user-managed.
        setAmmoTouched(true);
        setExistingMedia(allMedia.filter((m) => m.ownerType === 'session' && m.ownerId === id));
        const mine = allMalfs.filter((m) => m.sessionId === id);
        setOldMalfIds(mine.map((m) => m.id));
        setMalfs(mine.map((m) => ({
          firearmId: m.firearmId, type: m.type, resolution: m.resolution, notes: m.notes,
          ammoId: m.ammoId ?? '', magazineId: m.magazineId ?? '',
          roundCount: m.roundCount != null ? String(m.roundCount) : '',
          otherType: false, otherRes: false
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

  // Auto-default the "Ammo Used" row to match the gun rounds on a NEW session,
  // so logging rounds actually draws ammo off inventory instead of silently
  // doing nothing. Stops the instant the shooter touches the ammo section
  // (ammoTouched), and never runs for an existing session (editing/converting),
  // which keeps its saved ammo exactly as-is.
  useEffect(() => {
    if (id !== undefined || ammoTouched) return;
    if (kind === 'dry_fire') { setAmmoRows([]); return; }
    const gunRounds = firearms.map((f) => ({ caliber: f.caliber, rounds: Number(rounds[f.id]) || 0 }));
    const total = gunRounds.reduce((t, g) => t + g.rounds, 0);
    const row = suggestAmmoRow({
      totalRounds: total, caliber: sharedCaliber(gunRounds), ammoLib, recentAmmoIds,
    });
    setAmmoRows(row ? [row] : []);
  }, [id, ammoTouched, kind, rounds, firearms, ammoLib, recentAmmoIds]);

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

  // App 2: dropdown options = built-ins + custom values already saved (and any
  // committed in this form), so a typed-in "Other" sticks for next time.
  const mergedMalfTypes = useMemo(
    () => mergeOptions(MALF_TYPES, [...savedMalfTypes, ...malfs.filter((m) => !m.otherType && m.type).map((m) => m.type)]),
    [savedMalfTypes, malfs]
  );
  const mergedClearMethods = useMemo(
    () => mergeOptions(CLEAR_METHODS, [...savedClearMethods, ...malfs.filter((m) => !m.otherRes && m.resolution).map((m) => m.resolution)]),
    [savedClearMethods, malfs]
  );

  // Patch one malfunction row by index (review 4.2): replaces the repeated
  // `setMalfs((p) => p.map((x, n) => n === i ? { ...x, k: v } : x))` closures in
  // the row JSX with one named helper, so the rows read as intent not plumbing.
  const updateMalf = (i: number, patch: Partial<MalfRow>) =>
    setMalfs((p) => p.map((x, n) => (n === i ? { ...x, ...patch } : x)));

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
    // A score table for the session's drills: blank fill-in boxes for a planned
    // session, the recorded results for a logged one. fromRow() turns the form's
    // string fields into numbers (and a blank distance stays blank).
    const items: DrillReportItem[] = drills.map((row) => {
      const def = drillLib.find((d) => d.name === row.name);
      const r = fromRow(row);
      return {
        name: r.name,
        brief: def?.briefDescription ?? '',
        distance: r.distance,
        time: r.time,
        score: r.score,
        maxScore: r.maxScore,
      };
    });
    openPrintWindow(buildDrillReportHtml(items, { planned, date, location }));
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
      m.type || '—', firearms.find((f) => f.id === m.firearmId)?.name ?? '—',
      m.roundCount.trim() || '—', m.resolution || '', m.notes || ''
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
      ...(malfRows.length ? [{ heading: 'Malfunctions', table: { headers: ['Type', 'Gun', 'Round', 'Cleared', 'Notes'], rows: malfRows } }] : []),
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

  // Map the session's kind to the drill's `fire` value for the quick-add prefill.
  // A dry-fire session makes a dry drill; everything else (live practice, class)
  // makes a live drill. ('both' is only ever chosen deliberately in the full
  // editor — the fast path picks the single fire type that matches the session.)
  const contextFire: DrillDef['fire'] = kind === 'dry_fire' ? 'dry' : 'live';
  // Gun types for the quick-add: the session's selected categories, or a sensible
  // ['Pistol'] default when no gun is picked yet (mirrors DrillForm's default so
  // the drill still passes its "at least one gun type" check).
  const contextCats: GunCategory[] = selectedCategories.length ? selectedCategories : ['Pistol'];

  // Add a drill to the current session by name, but only once — sessions
  // reference drills BY NAME, so the same name twice would be a confusing
  // duplicate row. Case-insensitive guard.
  function addDrillToSessionByName(name: string) {
    setDrills((prev) => {
      if (prev.some((d) => d.name.trim().toLowerCase() === name.trim().toLowerCase())) return prev;
      return [...prev, { name, distance: '', time: '', score: '', maxScore: '', notes: '' }];
    });
  }

  // Lite quick-add: create a drill from just a name, with gun type + fire
  // pre-filled from the session context, then drop it straight onto the session.
  async function saveQuickDrill() {
    if (quickSaving) return;
    const name = quickName.trim();
    if (!name) { setQuickProblem('Give the drill a name.'); return; }
    setQuickSaving(true);
    try {
      // Name-collision: if a drill with this name already exists (case-insensitive),
      // REUSE it instead of creating a silent duplicate. Sessions reference drills
      // by name, so a duplicate definition would split that reference and is unsafe.
      const existing = drillLib.find((d) => d.name.trim().toLowerCase() === name.toLowerCase());
      if (existing) {
        addDrillToSessionByName(existing.name);
        setQuickAdding(false); setQuickName(''); setQuickProblem('');
        setPicking(false);
        return;
      }
      // Create exactly as DrillForm does: a 'drx-' id via stampNew, same field
      // shape (tags: []), so a re-import never clobbers it.
      const def = stampNew({
        name, fire: contextFire, gunCategories: contextCats,
        briefDescription: '', fullDescription: '', scoring: '', requiresHolster: false, tags: []
      }, newId('drx'), Date.now()) as DrillDef;
      await putOne('drills', def);
      setDrillLib((prev) => [...prev, def]); // refresh the in-memory library
      addDrillToSessionByName(def.name);
      setQuickAdding(false); setQuickName(''); setQuickProblem('');
      setPicking(false);
    } catch {
      // Rule 23 / zero-crash: a failed write must not strand the user on a blank
      // sheet. Surface a plain message and leave the lite form usable to retry.
      setQuickProblem('Could not save this drill — please try again.');
    } finally {
      setQuickSaving(false);
    }
  }

  // Power-user escalation: the full DrillForm saved a new drill. We don't get its
  // id back, so reload the library and diff against what we already had to find
  // the newly-created custom drill(s), then add them to the session by name.
  async function onFullEditorSaved() {
    try {
      const all = await getAll<DrillDef>('drills');
      const known = new Set(drillLib.map((d) => d.id));
      const added = all.filter((d) => !known.has(d.id));
      setDrillLib(all);
      for (const d of added) addDrillToSessionByName(d.name);
    } catch {
      // If the reload fails, the drill is still saved to the store; just refresh
      // on next open. Fail safe to a usable state rather than crashing the form.
    }
    setFullEditor(false);
    setQuickAdding(false); setQuickName(''); setQuickProblem('');
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
      const finalInstructor = kind === 'class' ? instructor.trim() : '';
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
      // (No separate instructor list to maintain — a class session's instructor
      // is sourced back as a suggestion from the saved sessions themselves.)

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
      await commitMedia('session', sid, newFiles, removedMedia, existingMedia.length);

      // Malfunctions: rewrite this session's set.
      for (const mid of oldMalfIds) await deleteOne('malfunctions', mid);
      for (const m of malfs) {
        // Keep a row if the shooter filled in ANYTHING — type, how-cleared, notes,
        // ammo, magazine, or round number. Only a completely blank row is skipped,
        // so partly-filled context (e.g. ammo + round but no type) is never silently
        // dropped (review 1.4). A blank type reads as "Other" downstream.
        const hasContent = m.type || m.resolution.trim() || m.notes.trim()
          || m.ammoId || m.magazineId || m.roundCount.trim();
        if (!hasContent) continue;
        await putOne('malfunctions', stampNew({
          sessionId: sid, date, firearmId: m.firearmId,
          type: m.type, resolution: m.resolution.trim(), notes: m.notes.trim(),
          // App 3a: optional context. '' → null so the record stays clean.
          ammoId: m.ammoId || null,
          magazineId: m.magazineId || null,
          roundCount: parseRoundCount(m.roundCount)
        }, newId('mf'), now));
      }

      onSaved(sid);
    } catch {
      // Review 7.1 / rule 23: a failed IndexedDB write (quota, locked txn, bad
      // record) must not fail silently. Surface a plain-language message through
      // the existing problem channel and leave the form usable to retry.
      setProblem('Could not save this session — please try again.');
    } finally {
      setSaving(false);
    }
  }

  // Delete is now a SOFT delete (App 7): the session moves to Recently Deleted
  // and is recoverable for 30 days, then purged. A real (non-planned) session's
  // ammo goes back on the can here; restoring re-deducts it. The shared helper
  // keeps this identical to a swipe-delete on the Log list. Its photos and
  // malfunctions are kept (they come back if it's restored) and only removed by
  // the purge / Delete Forever.
  async function reallyDelete() {
    if (!original) return;
    await softDeleteSession(original, ammoLib);
    onDeleted?.();
  }


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
          // One "creatable" field (same as Where): type a name or tap a past
          // instructor from the suggestions — whatever's in the box IS the
          // instructor, so a new name takes effect immediately with no separate
          // "add" step, and shows up as a suggestion next time. name="instructor"
          // (no "name" token) keeps iOS's contact AutoFill bar away.
          <SuggestField label="Instructor" value={instructor} onChange={setInstructor}
            suggestions={instructors} placeholder="Ben Stoeger" name="instructor" />
        )}
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
                onChange={(e) => { setAmmoTouched(true); setAmmoRows((p) => p.map((x, n) => n === i ? { ...x, ammoId: e.target.value } : x)); }}>
                <option value="">Pick ammo…</option>
                {ammoLib.map((a) => <option key={a.id} value={a.id}>{ammoLabel(a)}</option>)}
              </select>
              <input className="rounds-input" type="number" inputMode="numeric" min="0"
                placeholder="rounds" aria-label={`Rounds of ammo ${i + 1}`} value={r.rounds}
                onChange={(e) => { setAmmoTouched(true); setAmmoRows((p) => p.map((x, n) => n === i ? { ...x, rounds: e.target.value } : x)); }} />
              <button className="icon-btn" aria-label="Remove ammo row"
                onClick={() => { setAmmoTouched(true); setAmmoRows((prev) => prev.filter((_, x) => x !== i)); }}>✕</button>
            </div>
          ))}
          <button className="button secondary" onClick={() => { setAmmoTouched(true); setAmmoRows((prev) => [...prev, { ammoId: '', rounds: '' }]); }}>
            + Add Ammo
          </button>
          {(() => {
            const used = ammoRows.reduce((t, r) => t + (Number(r.rounds) || 0), 0);
            const shot = Object.values(rounds).reduce((t, v) => t + (Number(v) || 0), 0);
            // A row has rounds but no type picked: nothing will deduct until the
            // shooter chooses one — say so plainly (Michael's request).
            const needType = ammoRows.some((r) => (Number(r.rounds) || 0) > 0 && r.ammoId === '');
            if (needType) return (
              <p className="report-note warn">Pick an ammo type, or these rounds won't come off your inventory.</p>
            );
            if (used > 0 && shot > 0 && used !== shot) return (
              <p className="report-note warn">
                Heads up: ammo rows total {used.toLocaleString()} but the guns above total{' '}
                {shot.toLocaleString()}. You can still save — just check the numbers.
              </p>
            );
            return (
              <p className="report-note">Rounds come off the can when you save; fixing a number later puts the difference back.</p>
            );
          })()}
        </div>
      )}

      <div className="card">
        <h2>Drills <InfoTip title="Drills">Pick from your drill library below, or add a new drill right here — it saves to your library and lands on this session. Manage every drill (edit, delete, full details) under More &rarr; Drills.</InfoTip></h2>
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
          <button className="button secondary" style={{ marginTop: 12 }} onClick={printDrills}>
            Print Drills
          </button>
        )}
      </div>

      {!planned && (
      <>
      <MediaField heading="Targets, Photos & Videos" addLabel="+ Add Photos or Videos"
        ownerType="session" ownerId={original?.id ?? ''}
        existingMedia={existingMedia} setExistingMedia={setExistingMedia}
        removedMedia={removedMedia} setRemovedMedia={setRemovedMedia}
        newFiles={newFiles} setNewFiles={setNewFiles} />

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
              <select value={m.otherType ? 'Other' : m.type}
                onChange={(e) => { const v = e.target.value; updateMalf(i, { otherType: v === 'Other', type: v === 'Other' ? '' : v }); }}>
                <option value="">Pick one…</option>
                {mergedMalfTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                <option value="Other">Other…</option>
              </select>
            </label>
            {m.otherType && (
              <label className="field">Describe it
                <input value={m.type} placeholder="e.g. Brass over bolt" name="malfunction-desc" {...noAutofillProps}
                  onChange={(e) => updateMalf(i, { type: e.target.value })} />
              </label>
            )}
            <label className="field">Which gun
              <select value={m.firearmId}
                onChange={(e) => updateMalf(i, { firearmId: e.target.value })}>
                {(selectedGuns.length ? selectedGuns : firearms).map((f) =>
                  <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label className="field">How you cleared it
              <select value={m.otherRes ? 'Other' : m.resolution}
                onChange={(e) => { const v = e.target.value; updateMalf(i, { otherRes: v === 'Other', resolution: v === 'Other' ? '' : v }); }}>
                <option value="">Pick one…</option>
                {mergedClearMethods.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value="Other">Other…</option>
              </select>
            </label>
            {m.otherRes && (
              <label className="field">How did you clear it?
                <input value={m.resolution} placeholder="e.g. Stripped the mag and racked" name="malfunction-clear" {...noAutofillProps}
                  onChange={(e) => updateMalf(i, { resolution: e.target.value })} />
              </label>
            )}
            {ammoLib.length > 0 && (
              <label className="field">Ammo <span className="field-optional">(optional)</span>
                <select value={m.ammoId}
                  onChange={(e) => updateMalf(i, { ammoId: e.target.value })}>
                  <option value="">— Not sure —</option>
                  {ammoLib.map((a) => <option key={a.id} value={a.id}>{ammoLabel(a)}</option>)}
                </select>
              </label>
            )}
            {magazines.length > 0 && (
              <label className="field">Magazine <span className="field-optional">(optional)</span>
                <select value={m.magazineId}
                  onChange={(e) => updateMalf(i, { magazineId: e.target.value })}>
                  <option value="">— Not sure —</option>
                  {magazinesForFirearm(magazines, m.firearmId).map((mag) =>
                    <option key={mag.id} value={mag.id}>{mag.label}{mag.active === false ? ' (retired)' : ''}</option>)}
                </select>
              </label>
            )}
            <label className="field">Round number <span className="field-optional">(optional)</span>
              <input type="number" inputMode="numeric" min="0" value={m.roundCount} placeholder="e.g. 47"
                autoComplete="off"
                onChange={(e) => updateMalf(i, { roundCount: e.target.value })} />
            </label>
            <label className="field">Notes
              <input value={m.notes}
                onChange={(e) => updateMalf(i, { notes: e.target.value })} />
            </label>
          </div>
        ))}
        <button className="button secondary" onClick={() => setMalfs((prev) => [
          ...prev,
          { firearmId: (selectedGuns[0] ?? firearms[0])?.id ?? '', type: '', resolution: '', notes: '',
            ammoId: '', magazineId: '', roundCount: '' }
        ])}>+ Add Malfunction</button>
      </div>

      <div className="card">
        {/* Progressive disclosure: the self-ratings are reflection, not core capture —
            collapsed by default so a first log is kind-of-work + gun & rounds + save.
            Values live in `ratings` state, so an unopened block still saves "—". */}
        <Reveal label="Rate how it felt (1–10)">
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
        </Reveal>
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
          message="It moves to Recently Deleted and any ammo it used goes back on the can. You can restore it for 30 days from the Log screen — after that it's gone for good."
          confirmLabel="Delete Session"
          onConfirm={() => void reallyDelete()}
          onClose={() => setConfirming(false)}
        />
      )}

      {picking && (
        <Sheet title="Pick Drills" onClose={() => { setPicking(false); setQuickAdding(false); setQuickName(''); setQuickProblem(''); }}>
          {!quickAdding && pickable.length === 0 && (
            <>
              {/* Dead-end no more: the empty state's prominent call-to-action is to
                  create a drill right here. */}
              <p className="report-note">
                No drills fit this setup yet ({selectedCategories.join(', ') || 'no gun picked'} ·{' '}
                {kind === 'dry_fire' ? 'dry fire' : 'live fire'}) — create one.
              </p>
              <button className="button" onClick={() => { setQuickName(''); setQuickProblem(''); setQuickAdding(true); }}>
                + New drill
              </button>
            </>
          )}
          {!quickAdding && pickable.length > 0 && (
            <p className="report-note">Tap to select one or more, then Add — or make a new one below.</p>
          )}
          {!quickAdding && pickable.map((d) => {
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
          {!quickAdding && pickable.length > 0 && (
            <>
              <button className="button" style={{ marginTop: 12 }} disabled={picked.size === 0} onClick={addPickedDrills}>
                Add{picked.size > 0 ? ` ${picked.size}` : ''} {picked.size === 1 ? 'Drill' : 'Drills'}
              </button>
              <button className="button secondary" style={{ marginTop: 8 }}
                onClick={() => { setQuickName(''); setQuickProblem(''); setQuickAdding(true); }}>
                + New drill
              </button>
            </>
          )}

          {quickAdding && (
            // Lightweight quick-add: name only. Gun type + fire are pre-filled
            // from the session context and shown so the shooter knows what's set;
            // "More options" hands off to the full DrillForm editor.
            <>
              <FormProblem problem={quickProblem} />
              <label className="field">What this drill is called
                <input value={quickName} autoFocus placeholder="Bill Drill"
                  aria-label="Drill to add" {...noAutofillProps} name="quick-drill-title"
                  onChange={(e) => setQuickName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void saveQuickDrill(); }} />
              </label>
              <p className="report-note">
                Saved as <strong>{contextFire === 'dry' ? 'dry fire' : 'live fire'}</strong> for{' '}
                <strong>{contextCats.join(', ')}</strong>, from this session.
              </p>
              <button className="button" style={{ marginTop: 8 }} disabled={quickSaving} onClick={() => void saveQuickDrill()}>
                {quickSaving ? 'Saving…' : 'Save & Add to Session'}
              </button>
              <button className="button secondary" style={{ marginTop: 8 }} onClick={() => setFullEditor(true)}>
                More options / full editor
              </button>
              <button className="button secondary" style={{ marginTop: 8 }}
                onClick={() => { setQuickAdding(false); setQuickName(''); setQuickProblem(''); }}>
                Cancel
              </button>
            </>
          )}
        </Sheet>
      )}

      {fullEditor && (
        // Power-user path: reuse the full DrillForm editor in an overlay. On save
        // we reload the library, find the new drill, and add it to this session.
        <div className="screen-overlay">
          <DrillForm initialName={quickName} initialFire={contextFire} initialCats={contextCats}
            onSaved={() => void onFullEditorSaved()} onCancel={() => setFullEditor(false)} />
        </div>
      )}
    </div>
  );
}
