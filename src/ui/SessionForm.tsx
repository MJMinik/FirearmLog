// Log or edit a session (spec §8.1): kind, date, guns with per-gun rounds,
// multiple drills via the context-aware picker, photos/videos, malfunctions,
// ratings, fee, notes. Removals are STAGED — cancel really cancels (rule F3).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Ammunition, AppSettings, ChecklistCustomItems, DrillDef, DrillResult, Firearm, GunCategory,
  Magazine, MalfunctionEntry, Media, Session, SessionChecklist, SessionGun, SkillSet, TimedSkill
} from '../lib/types.ts';
import { splitRounds } from '../lib/mags.ts';
import { deleteOne, getAll, getOne, getSettings, putOne, putSettings, rewriteSessionSkillSets } from '../lib/db.ts';
import { dayKey, todayKey } from '../lib/dates.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { drillsForContext } from '../lib/drillFilter.ts';
import { inventoryAfterUsageChange } from '../lib/costing.ts';
import { MALF_TYPES, CLEAR_METHODS, mergeOptions, magazinesForFirearm, parseRoundCount } from '../lib/malfunctions.ts';
import { recentValues } from '../lib/suggest.ts';
import { filterHidden } from '../lib/listEdits.ts';
import { suggestAmmoRow, sharedCaliber } from '../lib/ammoSuggest.ts';
import {
  buildChecklistPrintHtml, checklistItemsForCategory, checklistProgress, itemState, newChecklist,
  normalizeChecklist, normalizeCustomItems, setChecklistMode, setItemPacked, setItemTake,
  type ChecklistCategory, addCustomItem
} from '../lib/checklist.ts';
import { buildDrillReportHtml, type DrillReportItem } from '../lib/drillReport.ts';
import { activeOnly } from '../lib/softDelete.ts';
import { softDeleteSession } from './sessionDelete.ts';
import { openSessionReport } from './sessionReport.ts';
import { ammoLabel } from './AmmoScreens.tsx';
import { SuggestField, noAutofillProps } from './SuggestField.tsx';
import { ConfirmSheet, DiscardChangesSheet, Sheet } from './Sheet.tsx';
import { Icon } from './Icon.tsx';
import { MediaField, commitMedia } from './MediaField.tsx';
import type { StagedFile } from './MediaField.tsx';
import { FieldProblem, type SaveProblem } from './FieldProblem.tsx';
import { FormProblem } from './FormProblem.tsx';
import { Reveal } from './Reveal.tsx';
import { pickableGuns } from '../lib/gunStatus.ts';
import { InfoTip } from './InfoTip.tsx';
import { DrillForm } from './DrillsScreen.tsx';
import { TIMED_SKILLS, formatSec, parseRepTimes, formatRepTimes } from '../lib/skillSets.ts';
import { Stepper } from './Stepper.tsx';
import { useDirtyTracker } from './useDirtyTracker.ts';

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

// Cold-audit fix (session 78): the ONE predicate for "this row is worth
// keeping" — a row counts (and saves) if the shooter filled in ANYTHING:
// type, how-cleared, notes, ammo, magazine, or round number. A completely
// blank row (the state right after tapping "+ Add Malfunction") does not.
// Shared by the save path and the summary count, so the count on screen can
// never claim more rows than doPersist() actually writes.
function malfHasContent(m: MalfRow): boolean {
  return !!(m.type || m.resolution.trim() || m.notes.trim()
    || m.ammoId || m.magazineId || m.roundCount.trim());
}
interface AmmoRow { ammoId: string; rounds: string; }

// T3-1: one timed-skill SET per row — held as strings in the form, same
// convention as DrillRow/MalfRow. `repTimes` is the free-text entry field
// ("1.42, 1.51, 1.38…"); it's parsed to repTimesSec only at save time.
interface SkillSetRow {
  skill: TimedSkill; firearmId: string; dryFire: boolean;
  count: string; bestSec: string; typicalSec: string; parSec: string;
  cold: boolean; repTimes: string; notes: string;
}

function blankSkillSetRow(firearmId: string, dryFire: boolean): SkillSetRow {
  return { skill: 'draw', firearmId, dryFire, count: '', bestSec: '', typicalSec: '', parSec: '', cold: false, repTimes: '', notes: '' };
}

// Cold-audit fix (High): a PLANNED session's stored rounds:0 is a database
// COERCION of a blank box (planned rounds are optional — saveProblem() lets
// a plan save with nothing typed, and the record stores 0), not a typed
// zero. Converting a plan straight to logged used to carry that 0 into
// `rounds` as the string "0" — which is NOT blank, so the App 1a check right
// above never fired, and Save could silently persist a live session with 0
// rounds and no warning (the exact silent-0 path 1a exists to close).
// On convert there is no way to tell a coerced 0 from a shooter who really
// did type 0 while planning (both are stored identically) — so this treats
// EVERY 0 as coerced and re-seeds it blank, forcing the 1a check to fire and
// make the shooter confirm. The cost is one extra "0" keystroke for the rare
// case of a plan that genuinely called for zero rounds on a gun (e.g. a
// support gun carried but not planned to be fired); the benefit is closing
// the silent-0 path, which is the more dangerous failure.
function seedConvertRounds(r: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(r).map(([fid, v]) => [fid, v === '0' ? '' : v]));
}

const toSkillSetRow = (s: SkillSet): SkillSetRow => ({
  skill: s.skill, firearmId: s.firearmId, dryFire: s.dryFire,
  count: String(s.count), bestSec: String(s.bestSec),
  typicalSec: s.typicalSec != null ? String(s.typicalSec) : '',
  parSec: s.parSec != null ? String(s.parSec) : '',
  cold: s.cold, repTimes: formatRepTimes(s.repTimesSec), notes: s.notes
});

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

export function SessionForm({ id, initialPlanned, convert, initialDate, onSaved, onCancel, onDeleted, onDirtyChange, onSaverChange }: {
  id?: string; initialPlanned?: boolean; convert?: boolean; initialDate?: string;
  onSaved: (sessionId: string) => void; onCancel: () => void;
  onDeleted?: () => void;
  // F3: reports the form's unsaved-edits state up to App, so the exits App owns
  // (tab bar, sidebar, browser Back) can show the same Discard-changes? guard
  // this form's own Cancel button uses. Must be reference-stable (useCallback).
  onDirtyChange?: (dirty: boolean) => void;
  // Save-from-discard: reports a persist function when the form is valid, null
  // when invalid or unmounted, so App's DiscardChangesSheet can show Save.
  onSaverChange?: (fn: (() => Promise<boolean>) | null) => void;
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
  const [hiddenSuggestions, setHiddenSuggestions] = useState<Record<string, string[]>>({});

  const [kind, setKind] = useState('practice');
  const [date, setDate] = useState(initialDate ?? todayKey());
  const [location, setLocation] = useState('');
  const [planned, setPlanned] = useState(!editing && !!initialPlanned);
  const [instructors, setInstructors] = useState<string[]>([]);
  const [instructor, setInstructor] = useState('');
  const [rounds, setRounds] = useState<Record<string, string>>({});
  // Per-session magazine tracking (spec July 22 2026). All keyed by firearmId.
  // magPick = mags chosen for that gun; magOverride = per-mag round counts as
  // typed, present ONLY once the shooter edits a number (absent = even split,
  // derived live); magOpen = the disclosure state; lastMags = that gun's mags
  // from its most recent logged session, OFFERED by the "Same mags as last
  // time" button and never applied on its own (see magSuggestion).
  const [magPick, setMagPick] = useState<Record<string, string[]>>({});
  const [magOverride, setMagOverride] = useState<Record<string, Record<string, string>>>({});
  const [magOpen, setMagOpen] = useState<Record<string, boolean>>({});
  const [lastMags, setLastMags] = useState<Record<string, string[]>>({});
  const [drills, setDrills] = useState<DrillRow[]>([]);
  const [malfs, setMalfs] = useState<MalfRow[]>([]);
  const [oldMalfIds, setOldMalfIds] = useState<string[]>([]);
  // T3-1: timed-skill sets. Same rewrite-the-whole-set pattern as malfunctions —
  // oldSkillSetIds tracks what's saved so save() can delete-then-recreate.
  // skillSheetIdx: null = sheet closed, -1 = adding a new set, >=0 = editing
  // that index in `skillSets`.
  const [skillSets, setSkillSets] = useState<SkillSetRow[]>([]);
  const [oldSkillSetIds, setOldSkillSetIds] = useState<string[]>([]);
  const [skillSheetIdx, setSkillSheetIdx] = useState<number | null>(null);
  // App 2: custom malfunction types/methods the shooter has used before, so a
  // typed-in "Other" value reappears in the dropdown next time.
  const [savedMalfTypes, setSavedMalfTypes] = useState<string[]>([]);
  const [savedClearMethods, setSavedClearMethods] = useState<string[]>([]);
  const [existingMedia, setExistingMedia] = useState<Media[]>([]);
  const [removedMedia, setRemovedMedia] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<StagedFile[]>([]);
  // Tester-2 F4 (July 16 2026): a NEW session starts UNRATED (empty), not a
  // pre-filled 5/5/5 — an untouched form must not be indistinguishable from a
  // real rated-5 session (a data-integrity leak). The save path already omits
  // any rating left empty, so an unopened block stores no selfRating at all.
  const [ratings, setRatings] = useState<Record<string, string>>(
    { focus: '', fundamentals: '', satisfaction: '' }
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
  // Change 1 / H-1: Guns & Rounds collapsible. A NEW session starts open and
  // STAYS open through the whole gun pick — picking a gun and typing rounds
  // is one motion (see syncGun below for why the old auto-collapse was
  // removed). An EXISTING session loads collapsed on open (summary shows the
  // saved selection; one tap opens it) — see the load effect below.
  const [gunsOpen, setGunsOpen] = useState(true);
  // Drills collapsible. New sessions start open (adding drills is the point).
  // Existing sessions with drills load collapsed (summary shows count; one tap opens).
  const [drillsOpen, setDrillsOpen] = useState(true);
  // App 5a: this drives the "Range fee" Reveal specifically (Notes is always
  // visible now, outside any Reveal) — flips true when a loaded session
  // already has a fee, or when a rangeFee error fires so the hidden field
  // becomes visible (mirrors gunsOpen pattern).
  const [wrapUpOpen, setWrapUpOpen] = useState(false);
  // Cold-audit fix (session 78, High): wrapUpOpen only forces the Reveal open
  // the FIRST time it flips true — once it's already true, a second failed
  // save that sets it to true again is a no-op (same value), so a
  // manually-collapsed Range fee Reveal stayed collapsed on every save after
  // the first, hiding the rangeFee error entirely (it's excluded from the top
  // banner) with Cancel offering only Discard. This counter bumps on every
  // failed save that targets rangeFee, giving Reveal's forceOpenKey a fresh
  // value to react to no matter how many times the section was collapsed.
  const [wrapUpForceKey, setWrapUpForceKey] = useState(0);
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
  const [problem, setProblem] = useState<SaveProblem>(null);
  const dateFieldRef = useRef<HTMLInputElement>(null);
  const gunsCardRef = useRef<HTMLDivElement>(null);
  const drillsCardRef = useRef<HTMLDivElement>(null);
  const ammoCardRef = useRef<HTMLDivElement>(null);
  const rangeFeeFieldRef = useRef<HTMLInputElement>(null);
  // App 1a: per-gun rounds inputs, keyed by firearmId, so a blank-rounds
  // validation problem can focus/scroll the ONE offending input instead of
  // just the card (mirrors dateFieldRef/rangeFeeFieldRef's single-target
  // pattern, but this field repeats per gun so it needs a map).
  const roundsInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // M4: this form is large and full of arrays (drills, ammo, malfunctions,
  // checklist), so instead of a field signature we watch for any user edit via a
  // bubbled change event. Programmatic loads don't fire input events, so `touched`
  // flips true only on a real edit. F3 closed the button-only blind spot: every
  // click-only mutator (add/remove rows, pickers, staged-media changes) now also
  // calls setTouched(true) explicitly, so no edit path can slip past the guard.
  const [touched, setTouched] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  // Convert-to-logged is an IN-PLACE mode switch, not a navigation: the old
  // onConvert flow pushed a fresh convert view, which remounted the form,
  // reloaded the saved record, and silently threw away any unsaved edits. The
  // local flag keeps every edit on screen; nothing is persisted until Save, so
  // backing out (guarded — converting counts as an unsaved change) leaves the
  // plan exactly as it was. The `convert` prop stays supported: a history entry
  // from the old flow still restores as a convert view.
  const [convertingNow, setConvertingNow] = useState(false);
  const converting = !!convert || convertingNow;

  // F3: keep App's dirty flag in step with `touched`, and clear it on unmount so
  // a stale flag can never guard a navigation after this form is gone.
  useEffect(() => {
    onDirtyChange?.(touched);
    return () => onDirtyChange?.(false);
  }, [touched, onDirtyChange]);

  // F3: last-resort guard for exits the app can't intercept — closing the tab,
  // a reload, typing a new URL. The browser shows its own generic prompt.
  // Honest limits: iOS Safari (and the installed PWA) often skip beforeunload,
  // so on the phone this is best-effort; the in-app exits above are the real fix.
  useEffect(() => {
    if (!touched) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [touched]);

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
      // Each gun's mags from its most recent LOGGED session that attributed
      // any (most-recent first, mirroring the ammo default). Planned sessions
      // are intent, not history — skip them. This feeds the "Same mags as
      // last time" offer; it is never applied without the shooter's tap.
      const last: Record<string, string[]> = {};
      for (const s of [...activeOnly(allSessions)].sort((a, b) => b.date.localeCompare(a.date))) {
        if (s.planned) continue;
        for (const g of s.guns ?? []) {
          if (!last[g.firearmId] && g.magIds?.length) last[g.firearmId] = g.magIds;
        }
      }
      setLastMags(last);
      setSavedMalfTypes([...new Set(allMalf.map((m) => m.type).filter(Boolean))]);
      setSavedClearMethods([...new Set(allMalf.map((m) => m.resolution).filter(Boolean))]);
      // Instructor suggestions = past sessions' instructors (most-recent first,
      // like the "Where" field) unioned with any names in the legacy instructors
      // meta list, so nothing previously saved is lost.
      const instructorRow = await getOne<{ key: string; value: string[] }>('meta', 'instructors');
      const sessionInstructors = recentValues(activeOnly(allSessions).map((s) => ({ date: s.date, value: s.instructor ?? '' })));
      if (alive) setInstructors([...new Set([...sessionInstructors, ...(instructorRow?.value ?? [])])]);
      const settings = await getSettings<AppSettings & { hiddenSuggestions?: Record<string, string[]> }>();
      if (alive) {
        setCustomItems(normalizeCustomItems(settings?.checklistCustomItems));
        setHiddenSuggestions(settings?.hiddenSuggestions ?? {});
      }
      if (id !== undefined) {
        const [s, allMedia, allMalfs, allSkillSets] = await Promise.all([
          getOne<Session>('sessions', id),
          getAll<Media>('media'),
          getAll<MalfunctionEntry>('malfunctions'),
          getAll<SkillSet>('skillSets')
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
        // Cold-audit fix (High): loading straight into convert mode (the
        // `convert` prop — a history entry from the old convert flow) must
        // re-seed any coerced 0 as blank too. See seedConvertRounds above.
        setRounds(convert ? seedConvertRounds(r) : r);
        // Seed saved mag attributions, but the sections load COLLAPSED — the
        // disclosure's summary row lists the saved mags, and opening is one
        // tap (owner decision, session 75, July 23 2026; supersedes the
        // earlier "mirrors the ratings Reveal defaultOpen" choice).
        const mp: Record<string, string[]> = {};
        const mo: Record<string, Record<string, string>> = {};
        for (const g of s.guns) {
          if (!g.magIds?.length) continue;
          mp[g.firearmId] = g.magIds;
          if (g.magOverrides?.length) {
            mo[g.firearmId] = Object.fromEntries(g.magOverrides.map((o) => [o.magId, String(o.rounds)]));
          }
        }
        setMagPick(mp); setMagOverride(mo);
        // Change 1: existing session loads Guns & Rounds collapsed — summary
        // shows the selection; one tap opens it (mirrors the Magazines choice).
        setGunsOpen(false);
        setDrills(s.drills.map(toRow));
        // Drills collapse on load when the session already has drills —
        // summary shows the count; one tap opens (mirrors gunsOpen pattern).
        if (s.drills.length > 0) setDrillsOpen(false);
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
        const loadedFee = s.rangeFee === null ? '' : String(s.rangeFee);
        setRangeFee(loadedFee);
        setNotes(s.notes);
        // App 5a: open the Range fee reveal only when the existing session
        // already has a fee — Notes is always visible now, so it no longer
        // factors into this decision.
        if (loadedFee !== '') setWrapUpOpen(true);
        setChecklist(normalizeChecklist(s.checklist));
        const mySets = allSkillSets.filter((ss) => ss.sessionId === id);
        setOldSkillSetIds(mySets.map((ss) => ss.id));
        setSkillSets(mySets.map(toSkillSetRow));
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

  // ---- Per-session magazine tracking (spec July 22 2026) ----
  // Mags offered for a gun: its linked, in-service mags, plus any already on
  // this session even if since retired (the pickableGuns precedent).
  const magsForGun = (fid: string) => magazines
    .filter((m) => m.firearmIds.includes(fid) && (m.active || (magPick[fid] ?? []).includes(m.id)))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

  // The live even split for a gun's picked mags, as input-ready strings.
  const evenSplitFor = (fid: string): Record<string, string> => {
    const ids = magPick[fid] ?? [];
    const parts = splitRounds(Number(rounds[fid]) || 0, ids.length);
    return Object.fromEntries(ids.map((id, i) => [id, String(parts[i])]));
  };

  const magCount = (fid: string, magId: string): string =>
    magOverride[fid]?.[magId] ?? evenSplitFor(fid)[magId] ?? '0';

  // Opening the section changes NOTHING — it is inspection, not an
  // assertion. It used to silently check this gun's last-used mags, which
  // wrote an attribution the shooter had never made and contradicted the
  // July-22 spec's own "untouched section = nothing stored" (owner decision,
  // session 100, after Michael opened Magazines on a real log and found it
  // filled in). It also keeps session 75's fix true by construction: merely
  // opening can no longer dirty the form, so no phantom discard sheet.
  const toggleMagSection = (fid: string) => {
    setMagOpen((p) => ({ ...p, [fid]: !p[fid] }));
  };

  /**
   * The mags this gun ran last time, OFFERED as a one-tap suggestion. Empty
   * (so nothing renders) once anything is picked, and on an already-saved
   * session — a saved session's history is never backfilled from habit
   * (owner decision, session 75), though a plan being converted to a log
   * still counts as new. Only mags still linked AND in service qualify: a
   * since-retired mag must not be attributed by habit. That filter is
   * unchanged from the preselect it replaces.
   */
  const magSuggestion = (fid: string): string[] => {
    if (magPick[fid]?.length || (original && !converting)) return [];
    return (lastMags[fid] ?? [])
      .filter((id) => magazines.some((m) => m.id === id && m.firearmIds.includes(fid) && m.active));
  };

  // The tap that records the loadout. It IS a real edit, so it sets `touched`
  // — cancelling afterwards correctly raises the discard sheet.
  const applyMagSuggestion = (fid: string) => {
    const seed = magSuggestion(fid);
    if (!seed.length) return;
    setTouched(true);
    setMagPick((p) => ({ ...p, [fid]: seed }));
    if (problem?.field === 'mags') setProblem(null);
  };

  const toggleMag = (fid: string, magId: string) => {
    setTouched(true);
    setMagPick((p) => {
      const cur = p[fid] ?? [];
      return { ...p, [fid]: cur.includes(magId) ? cur.filter((x) => x !== magId) : [...cur, magId] };
    });
    // Changing WHICH mags resets any custom counts — old numbers can't line
    // up with a different set; the visible values update to the even split.
    setMagOverride((p) => {
      if (!p[fid]) return p;
      const next = { ...p }; delete next[fid]; return next;
    });
    if (problem?.field === 'mags') setProblem(null);
  };

  const editMagCount = (fid: string, magId: string, value: string) => {
    setTouched(true);
    setMagOverride((p) => ({ ...p, [fid]: { ...(p[fid] ?? evenSplitFor(fid)), [magId]: value } }));
    if (problem?.field === 'mags') setProblem(null);
  };

  const resetMagSplit = (fid: string) => {
    setTouched(true);
    setMagOverride((p) => { const next = { ...p }; delete next[fid]; return next; });
    if (problem?.field === 'mags') setProblem(null);
  };
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

  // M3 (audit): same policy as the malfunctions effect just above, for the
  // same reason — a timed-skill set left pointing at a gun that's no longer
  // in this session must be re-pointed to a gun that IS, not silently keep
  // referencing the absent one while the "Which gun" dropdown shows something
  // else. Mirrors the malfs effect exactly (re-point to selectedGuns[0]).
  useEffect(() => {
    if (!selectedGuns.length) return;
    const inSession = new Set(selectedGuns.map((f) => f.id));
    setSkillSets((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (inSession.has(s.firearmId)) return s;
        changed = true;
        return { ...s, firearmId: selectedGuns[0].id };
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
    // H-1 (session 78 audit): a NEW session's Guns & Rounds stays OPEN while
    // the shooter works in it — picking a gun and typing rounds is one
    // motion, and auto-collapsing mid-pick unmounted the rounds input right
    // under their finger (sessions were saved with 0 rounds, silently). An
    // EXISTING session still loads collapsed — see the load effect above
    // (its own setGunsOpen(false)), which is correct and unchanged: that
    // summary-then-one-tap pattern is fine once the shooter is just reviewing
    // or editing a record, not actively building one.
    if (!on) {
      // Removing a gun drops its rounds (above), so its mag picks and custom
      // counts go with them — re-adding the gun starts clean, same as rounds.
      setMagPick((p) => { const next = { ...p }; delete next[fid]; return next; });
      setMagOverride((p) => { const next = { ...p }; delete next[fid]; return next; });
      setMagOpen((p) => { const next = { ...p }; delete next[fid]; return next; });
    }
    setChecklist((cl) => setItemTake(cl, `f_${fid}`, on));
    if (problem?.field === 'guns') setProblem(null);
  }

  const checklistProgressInfo = useMemo(
    () => checklistProgress(checklist, firearms, customItems),
    [checklist, firearms, customItems]
  );

  async function addChecklistItem(cat: ChecklistCategory) {
    const label = newItemText[cat].trim();
    if (!label) return;
    setTouched(true); // F3: click-only path (typing lands in local state, not the form)
    const next = addCustomItem(customItems, cat, newId('ci'), label);
    setCustomItems(next);
    setNewItemText((prev) => ({ ...prev, [cat]: '' }));
    setAddingItem((prev) => ({ ...prev, [cat]: false }));
    await putSettings<AppSettings>({ checklistCustomItems: next });
  }

  function openPrintWindow(html: string) {
    const win = window.open('', '_blank');
    if (!win) { setProblem({ field: 'print', message: 'Pop-ups blocked — please allow pop-ups and try again.' }); return; }
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
    // Shared opener (also used by the Progress training grid). It opens the
    // window inside the tap and builds the page from the SAVED session, then
    // hands off to the print dialog.
    const trouble = await openSessionReport(original, { autoPrint: true });
    if (trouble) setProblem({ field: 'print', message: trouble });
  }

  function addPickedDrills() {
    setTouched(true); // F3: click-only path
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
    // F3: the single funnel for quick-add and the full editor — one setTouched
    // here covers both click-only paths.
    setTouched(true);
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
              aria-label={`New ${title} item name`} enterKeyHint="done"
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


  function saveProblem(): SaveProblem {
    const guns = Object.entries(rounds).map(([, text]) => ({
      rounds: text.trim() === '' ? 0 : Number(text)
    }));
    if (!date) return { field: 'date', message: 'Pick a date.' };
    if (Object.keys(rounds).length === 0) return { field: 'guns', message: 'Pick at least one gun.' };
    // App 1a: a blank rounds box used to save silently as 0 rounds with no
    // ammo deducted and no warning. A NON-PLANNED session now blocks on a
    // blank box (planned rounds stay optional — a plan is intent, not a
    // count). A typed "0" is explicitly valid — the copy says so, so the
    // shooter always knows the escape hatch (type 0, or remove the gun).
    if (!planned) {
      const blankGun = selectedGuns.find((f) => (rounds[f.id] ?? '').trim() === '');
      if (blankGun) {
        // Cold-audit fix (Medium): a dry-fire session labels the box "reps",
        // not "rounds" — the error must speak the same word the field does,
        // and "fire" is wrong for reps that were never live rounds.
        const message = kind === 'dry_fire'
          ? `Enter reps for ${blankGun.name} — type 0 if you skipped it, or remove it from this session.`
          : `Enter rounds for ${blankGun.name} — type 0 if you didn't fire it, or remove it from this session.`;
        return { field: 'guns', gunId: blankGun.id, message };
      }
    }
    if (guns.some((g) => !Number.isFinite(g.rounds) || g.rounds < 0 || !Number.isInteger(g.rounds))) {
      // Whole numbers only — rounds don't come in halves, and a decimal total
      // would make a custom mag split impossible to sum (whole mag counts can
      // never equal 50.5).
      return { field: 'guns', message: 'Rounds need to be plain whole numbers.' };
    }
    // Mag overrides must sum to their GUN's rounds (spec decision 5). The even
    // split needs no check — it sums exactly by construction. An untouched mag
    // section blocks nothing.
    if (kind !== 'dry_fire') {
      for (const [fid, ids] of Object.entries(magPick)) {
        if (rounds[fid] === undefined || !ids.length) continue;
        const ov = magOverride[fid];
        if (!ov) continue;
        const gunTotal = rounds[fid].trim() === '' ? 0 : Number(rounds[fid]);
        let sum = 0;
        for (const magId of ids) {
          const v = (ov[magId] ?? '').trim();
          const n = v === '' ? 0 : Number(v);
          if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) {
            return { field: 'mags', gunId: fid, message: 'Mag rounds need to be plain whole numbers.' };
          }
          sum += n;
        }
        if (sum !== gunTotal) {
          const name = firearms.find((f) => f.id === fid)?.name ?? 'this gun';
          return {
            field: 'mags',
            gunId: fid,
            message: `Mag rounds for ${name} total ${sum.toLocaleString()}, but the gun logged ${gunTotal.toLocaleString()} — match them to save.`
          };
        }
      }
    }
    const badDrill = drills.map(fromRow).find((d) =>
      (d.time !== null && !Number.isFinite(d.time)) ||
      (d.score !== null && !Number.isFinite(d.score)) ||
      (d.maxScore !== null && !Number.isFinite(d.maxScore)));
    if (badDrill) return { field: 'drills', message: `Check the numbers on "${badDrill.name}".` };
    const ammoUsage = ammoRows
      .filter((r) => r.ammoId !== '')
      .map((r) => ({ rounds: r.rounds.trim() === '' ? 0 : Number(r.rounds) }));
    if (ammoUsage.some((u) => !Number.isFinite(u.rounds) || u.rounds < 0)) {
      return { field: 'ammo', message: 'Ammo rounds need to be plain numbers.' };
    }
    const fee = rangeFee.trim() === '' ? null : Number(rangeFee);
    if (fee !== null && (!Number.isFinite(fee) || fee < 0)) {
      // M-3 (audit): a negative fee used to save and SUBTRACT from lifetime
      // Costs — block it here, same field/error path a bad number already used.
      // Cold-audit fix (Low): $0 is a valid fee (a free session) — say so
      // exactly, rather than "positive" which reads as excluding zero.
      return { field: 'rangeFee', message: 'Enter the fee as a dollar amount (zero or more), or leave it blank.' };
    }
    return null;
  }

  // doPersist: the full validate+write core. Returns the session id on success,
  // null on validation failure or write error. Does NOT call onSaved — save()
  // owns navigation so the guard path (persistForm) can't double-navigate.
  async function doPersist(): Promise<string | null> {
    if (saving) return null;
    const guns = Object.entries(rounds).map(([firearmId, text]) => {
      const g: SessionGun = { firearmId, rounds: text.trim() === '' ? 0 : Number(text) };
      // Mag attribution rides on the gun (optional + additive). Overrides are
      // stored only when they differ from the even split, so a hand-typed
      // match keeps redistributing if the rounds change later.
      const ids = kind === 'dry_fire' ? [] : (magPick[firearmId] ?? []);
      if (ids.length) {
        g.magIds = ids;
        const ov = magOverride[firearmId];
        if (ov) {
          const counts = ids.map((magId) => ({ magId, rounds: Number(ov[magId]) || 0 }));
          const even = splitRounds(g.rounds, ids.length);
          if (!counts.every((c, i) => c.rounds === even[i])) g.magOverrides = counts;
        }
      }
      return g;
    });
    const sp = saveProblem();
    if (sp) {
      setProblem(sp);
      // The collapsed-by-default Magazines section (session 75) must open
      // itself when its own validation blocks the save, so the mag-rounds
      // inputs the message refers to aren't hidden behind Show.
      if (sp.field === 'mags' && sp.gunId) {
        setMagOpen((p) => ({ ...p, [sp.gunId!]: true }));
      }
      // Change 1: force Guns & Rounds open when validation targets it so the
      // inputs the error message refers to aren't hidden.
      if (sp.field === 'guns' || sp.field === 'mags') setGunsOpen(true);
      // App 5a: force the Range fee Reveal open when a rangeFee error fires
      // so the field isn't hidden inside the collapsed Reveal. setWrapUpForceKey
      // always bumps (even when wrapUpOpen was already true) so a Range fee
      // reveal the shooter re-collapsed after an earlier failed save still
      // reopens.
      if (sp.field === 'rangeFee') { setWrapUpOpen(true); setWrapUpForceKey((k) => k + 1); }
      const scrollTarget =
        sp.field === 'date' ? dateFieldRef.current :
        sp.field === 'rangeFee' ? rangeFeeFieldRef.current :
        sp.field === 'drills' ? drillsCardRef.current :
        sp.field === 'ammo' ? ammoCardRef.current :
        gunsCardRef.current;
      setTimeout(() => {
        // App 1a: a blank-rounds problem carries the offending gun's id —
        // once Guns & Rounds has just been forced open (above), target that
        // specific rounds input instead of just the card. Read the ref only
        // here, inside the timeout, so it reflects the DOM AFTER the
        // just-forced-open section has actually rendered (a synchronous read
        // right after setGunsOpen(true) could still see the pre-render null
        // for a session that loaded collapsed).
        const roundsTarget = sp.field === 'guns' && sp.gunId ? roundsInputRefs.current[sp.gunId] : null;
        (roundsTarget ?? scrollTarget)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (sp.field === 'date') dateFieldRef.current?.focus();
        else if (sp.field === 'rangeFee') rangeFeeFieldRef.current?.focus();
        else if (roundsTarget) roundsTarget.focus();
      }, 0);
      return null;
    }
    const ammoUsage = ammoRows
      .filter((r) => r.ammoId !== '')
      .map((r) => ({ ammoId: r.ammoId, rounds: r.rounds.trim() === '' ? 0 : Number(r.rounds) }));
    const ratingEntries = Object.entries(ratings).filter(([, v]) => v !== '');
    const selfRating = ratingEntries.length
      ? Object.fromEntries(ratingEntries.map(([k, v]) => [k, Number(v)]))
      : null;
    const fee = rangeFee.trim() === '' ? null : Number(rangeFee);

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
        // Keep a row if the shooter filled in ANYTHING (malfHasContent) — a
        // completely blank row is skipped, so partly-filled context (e.g.
        // ammo + round but no type) is never silently dropped (review 1.4).
        // A blank type reads as "Other" downstream.
        if (!malfHasContent(m)) continue;
        await putOne('malfunctions', stampNew({
          sessionId: sid, date, firearmId: m.firearmId,
          type: m.type, resolution: m.resolution.trim(), notes: m.notes.trim(),
          // App 3a: optional context. '' → null so the record stays clean.
          ammoId: m.ammoId || null,
          magazineId: m.magazineId || null,
          roundCount: parseRoundCount(m.roundCount)
        }, newId('mf'), now));
      }

      // T3-1: timed-skill sets — rewrite this session's set in ONE atomic
      // transaction (M2 audit fix: db.ts's rewriteSessionSkillSets, same
      // shape as applyAmmoMerge/commitClassifiers), so a crash between the
      // old rows' delete and the new rows' put can no longer leave a session
      // with its timed-skill work gone and nothing written back.
      // Rows are validated before they ever land in `skillSets` (the add/edit
      // sheet blocks a bad save) — but a row that's ALREADY stored malformed
      // (e.g. from a future importer, or hand-edited data) must not be
      // silently dropped here either (L2 audit fix): it's written back as-is,
      // NaN and all, rather than skipped. The row-summary above and the
      // Session Report (sessionReport.ts) both render '—' for a non-finite
      // number instead of "NaN" or "undefined", so a malformed set is visible
      // and fixable, never a silent data loss.
      const newSkillSetRows = skillSets.map((row) => {
        const count = Number(row.count);
        const bestSec = Number(row.bestSec);
        const typicalSec = row.typicalSec.trim() === '' ? null : Number(row.typicalSec);
        const parSec = row.parSec.trim() === '' ? null : Number(row.parSec);
        const repTimesSec = parseRepTimes(row.repTimes);
        return stampNew({
          sessionId: sid, date, skill: row.skill, firearmId: row.firearmId, dryFire: row.dryFire,
          count, bestSec,
          typicalSec: typicalSec != null && Number.isFinite(typicalSec) ? typicalSec : null,
          parSec: parSec != null && Number.isFinite(parSec) ? parSec : null,
          cold: row.cold,
          repTimesSec: repTimesSec.length ? repTimesSec : null,
          notes: row.notes.trim()
        }, newId('ss'), now);
      });
      await rewriteSessionSkillSets(oldSkillSetIds, newSkillSetRows);

      // F3: the edits are saved — nothing left to guard. Clear the dirty flag
      // before onSaved navigates (its setTab would otherwise hit App's guard).
      onDirtyChange?.(false);
      return sid;
    } catch {
      // Review 7.1 / rule 23: a failed IndexedDB write (quota, locked txn, bad
      // record) must not fail silently. Surface a plain-language message through
      // the existing problem channel and leave the form usable to retry.
      setProblem({ field: 'save', message: 'Could not save this session — please try again.' });
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function persistForm(): Promise<boolean> { return (await doPersist()) !== null; }

  async function save() { const sid = await doPersist(); if (sid) onSaved(sid); }

  // Delete is now a SOFT delete (App 7): the session moves to Recently Deleted
  // and is recoverable for 30 days, then purged. A real (non-planned) session's
  // ammo goes back on the can here; restoring re-deducts it. The shared helper
  // keeps this identical to a swipe-delete on the Log list. Its photos and
  // malfunctions are kept (they come back if it's restored) and only removed by
  // the purge / Delete Forever.
  async function reallyDelete() {
    if (!original) return;
    await softDeleteSession(original, ammoLib);
    // F3: deleting the session makes any unsaved edits moot — clear the dirty
    // flag so onDeleted's navigation isn't stopped by App's guard.
    onDirtyChange?.(false);
    onDeleted?.();
  }

  // Always-fresh saver: the ref holds the LATEST persistForm (re-pointed after
  // every render), and the reported wrapper is reference-stable so App's ref
  // write never churns. This replaces a hand-maintained dep list that could — and
  // did — go stale and save old values.
  const persistRef = useRef(persistForm);
  useEffect(() => { persistRef.current = persistForm; });
  const stablePersist = useCallback(() => persistRef.current(), []);

  // Report after every render (cheap: App just writes a ref) so the reported
  // validity can never lag the form state. Saver present ⟺ touched AND valid.
  // The `touched` guard mirrors MatchForm: a new session form is always
  // technically valid (date defaults to today), so without this guard every
  // fresh form would show "Save" in the discard sheet.
  useEffect(() => {
    onSaverChange?.(touched && saveProblem() === null ? stablePersist : null);
  });
  useEffect(() => () => onSaverChange?.(null), [onSaverChange]);


  return (
    <div className="screen" onChange={() => setTouched(true)}>
      <div className="navbar">
        <button className="back-btn" onClick={() => (touched ? setDiscarding(true) : onCancel())}>‹ Cancel</button>
        <button className="navbar-action" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <h1 className="large-title">{converting ? 'Log Session (from Plan)' : editing ? 'Edit Session' : planned ? 'Plan Session' : 'Log Session'}</h1>
      {problem && !['date', 'guns', 'drills', 'ammo', 'rangeFee'].includes(problem.field) && (
        <p className="form-problem" role="alert">{problem.message}</p>
      )}
      {discarding && (
        <DiscardChangesSheet
          // Clear App's dirty flag BEFORE leaving: onCancel is history.back(),
          // which fires popstate — without this, App's own F3 guard would see a
          // still-dirty form and show a SECOND sheet on top of this one.
          onConfirm={() => { onDirtyChange?.(false); onCancel(); }}
          onClose={() => setDiscarding(false)}
          // Local ‹ Cancel sheet uses full save() so post-save navigation runs.
          onSave={saveProblem() === null ? () => void save() : undefined} />
      )}

      {editing && original?.planned && !converting && (
        <button className="button"
          onClick={() => {
            setConvertingNow(true); setPlanned(false); setTouched(true);
            // Cold-audit fix (High): the in-place convert button flips
            // planned→false on an ALREADY-LOADED form, so the rounds map
            // must be re-seeded here too (see seedConvertRounds above) —
            // the load-time seed above only covers the `convert` PROP path.
            setRounds((prev) => seedConvertRounds(prev));
          }}>
          <span aria-hidden="true">✓</span> Convert to logged session</button>
      )}
      {editing && original && (
        <button className="button secondary" onClick={() => void printSessionReport()}>Session Report</button>
      )}

      <div className="card">
        <h2>What Kind of Work</h2>
        <div className="seg" role="group" aria-label="Session kind">
          {KINDS.map((k) => (
            <button key={k.value} type="button" aria-pressed={kind === k.value}
              className={kind === k.value ? 'on' : ''} onClick={() => { setKind(k.value); setTouched(true); }}>
              {k.label}
            </button>
          ))}
        </div>
        <label className={`field${problem?.field === 'date' ? ' invalid' : ''}`}>Date <span className="field-required-marker">(required)</span>
          <input
            ref={dateFieldRef}
            id="session-date-input"
            type="date"
            min="2000-01-01"
            max={dayKey(new Date(new Date().setFullYear(new Date().getFullYear() + 1)))}
            value={date}
            onChange={(e) => { setDate(e.target.value); if (problem?.field === 'date') setProblem(null); }}
            aria-invalid={problem?.field === 'date' || undefined}
            aria-describedby={problem?.field === 'date' ? 'session-date-err' : undefined} />
          <FieldProblem id="session-date-err" problem={problem} field="date" />
        </label>
        {/* F3: tapping a suggestion sets the value by click alone (no change
            event bubbles), so these two SuggestFields flip `touched` directly. */}
        <SuggestField label="Where" value={location} onChange={(v) => { setLocation(v); setTouched(true); }}
          suggestions={filterHidden(pastLocations, hiddenSuggestions, 'locations')} placeholder="Shoot Straight: University" />
        {kind === 'class' && (
          // One "creatable" field (same as Where): type a name or tap a past
          // instructor from the suggestions — whatever's in the box IS the
          // instructor, so a new name takes effect immediately with no separate
          // "add" step, and shows up as a suggestion next time. name="instructor"
          // (no "name" token) keeps iOS's contact AutoFill bar away.
          <SuggestField label="Instructor" value={instructor} onChange={(v) => { setInstructor(v); setTouched(true); }}
            suggestions={filterHidden(instructors, hiddenSuggestions, 'instructors')} placeholder="Ben Stoeger" name="instructor" />
        )}
      </div>

      <div className="card" ref={gunsCardRef} data-testid="session-guns-card">
        {/* Change 1: collapsible header mirrors the Gear Checklist pattern.
            App 2a: a real <h2> wraps the toggle button (heading OUTSIDE,
            button inside — the standard WAI-ARIA accordion pattern) so
            VoiceOver's heading navigation finds this section; .disclosure-h2
            is styled to add nothing visually. */}
        <h2 className="disclosure-h2">
          <button className="checklist-disclosure" data-testid="session-guns-disclosure" aria-expanded={gunsOpen}
            aria-controls={gunsOpen ? 'session-guns-body' : undefined} onClick={() => setGunsOpen((v) => !v)}>
            <span className="checklist-disclosure-title">Guns &amp; Rounds <span className="field-required-marker">(required)</span></span>
            <span className="checklist-disclosure-toggle">{gunsOpen ? 'Hide' : 'Show'} <Icon name={gunsOpen ? 'chevronDown' : 'chevronRight'} size={14} style={{ verticalAlign: 'middle' }} /></span>
          </button>
        </h2>
        {/* Always-visible summary line: shows selected guns + rounds (and mag
            count when applicable) whether the body is open or closed. */}
        {selectedGuns.length > 0 ? (
          <p className="report-note">
            {selectedGuns.map((f) => {
              const r = rounds[f.id];
              const rStr = r && r.trim() !== '' ? `${r} rds` : '— rds';
              const mCount = (magPick[f.id] ?? []).length;
              return `${f.name} · ${rStr}${mCount > 0 ? ` · ${mCount} mag${mCount === 1 ? '' : 's'}` : ''}`;
            }).join(' | ')}
          </p>
        ) : (
          !gunsOpen && (() => {
            const n = Object.keys(rounds).length;
            return <p className="report-note">{n === 0 ? 'No gun selected yet.' : `${n} gun${n === 1 ? '' : 's'} selected`}</p>;
          })()
        )}
        <FieldProblem id="session-guns-err" problem={problem} field="guns" />
        <FieldProblem id="session-mags-err" problem={problem} field="mags" />
        {gunsOpen && (
          <div id="session-guns-body">
            {firearms.length === 0 && <p className="report-note">No guns yet — add one from the Guns screen.</p>}
            {/* Audit #10: active guns, plus any already on this session (so a since-retired gun still shows on its own record). */}
            {pickableGuns(firearms, Object.keys(rounds)).map((f) => {
              const on = rounds[f.id] !== undefined;
              // Per-session magazine tracking: a quiet per-gun disclosure, shown
              // only for live-fire guns that have linked mags — hidden the same
              // way ammo and drills are, and never a nag (spec decision 3).
              const gunMags = on && kind !== 'dry_fire' ? magsForGun(f.id) : [];
              const picked = magPick[f.id] ?? [];
              // Ghosts: mags this session saved that have since been deleted or
              // unlinked from the gun. They must stay VISIBLE — an invisible pick
              // would still re-save and still soak up a share of the split — so
              // they render as removable rows instead of vanishing.
              const ghostIds = on && kind !== 'dry_fire'
                ? picked.filter((id) => !gunMags.some((m) => m.id === id)) : [];
              const open = !!magOpen[f.id];
              // Offered, never applied — see magSuggestion.
              const suggested = open && kind !== 'dry_fire' ? magSuggestion(f.id) : [];
              return (
                <Fragment key={f.id}>
                  <div className="row">
                    <button className={`gun-toggle ${on ? 'on' : ''}`} aria-pressed={on}
                      onClick={() => { syncGun(f.id, rounds[f.id] === undefined); setTouched(true); }}>
                      {f.name}
                    </button>
                    {on && (
                      <input className="rounds-input" type="number" inputMode="numeric" min="0"
                        ref={(el) => { roundsInputRefs.current[f.id] = el; }}
                        placeholder={planned ? 'planned rounds' : kind === 'dry_fire' ? 'reps' : 'rounds'}
                        aria-label={`Rounds for ${f.name}`}
                        aria-invalid={(problem?.field === 'guns' && problem.gunId === f.id) || undefined}
                        aria-describedby={(problem?.field === 'guns' && problem.gunId === f.id) ? 'session-guns-err' : undefined}
                        value={rounds[f.id]}
                        onChange={(e) => { setRounds((prev) => ({ ...prev, [f.id]: e.target.value })); if (problem?.field === 'guns') setProblem(null); }} />
                    )}
                  </div>
                  {(gunMags.length > 0 || ghostIds.length > 0) && (
                    <div className="session-mags">
                      <button className="checklist-disclosure" aria-expanded={open}
                        onClick={() => toggleMagSection(f.id)}>
                        <span className="checklist-disclosure-title">
                          Magazines{picked.length > 0 && !open
                            ? ` — ${picked.map((id) => magazines.find((m) => m.id === id)?.label ?? '—').join(', ')}`
                            : ''}
                        </span>
                        <span className="checklist-disclosure-toggle">{open ? 'Hide' : 'Show'} <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} style={{ verticalAlign: 'middle' }} /></span>
                      </button>
                      {open && (
                        <>
                          {suggested.length > 0 && (
                            <div className="mag-suggest-wrap">
                              <button className="mag-suggest"
                                aria-describedby={`mag-suggest-list-${f.id}`}
                                onClick={() => applyMagSuggestion(f.id)}>
                                Same mags as last time
                              </button>
                              {/* The labels sit OUTSIDE the button on purpose: inside, they
                                  would join its accessible name and collide with the mag
                                  toggles' own names. aria-describedby still announces them. */}
                              <p className="mag-suggest-list" id={`mag-suggest-list-${f.id}`}>
                                {suggested.map((id) => magazines.find((m) => m.id === id)?.label ?? '—').join(', ')}
                              </p>
                            </div>
                          )}
                          {gunMags.map((m) => {
                            const magOn = picked.includes(m.id);
                            return (
                              <div className="row" key={m.id}>
                                <button className={`gun-toggle ${magOn ? 'on' : ''}`} aria-pressed={magOn}
                                  onClick={() => toggleMag(f.id, m.id)}>
                                  {m.label}{m.active ? '' : ' (retired)'}
                                </button>
                                {magOn && (
                                  <input className="rounds-input" type="number" inputMode="numeric" min="0"
                                    aria-label={`Rounds through ${m.label} with ${f.name}`}
                                    value={magCount(f.id, m.id)}
                                    onChange={(e) => editMagCount(f.id, m.id, e.target.value)} />
                                )}
                              </div>
                            );
                          })}
                          {ghostIds.map((id) => {
                            const m = magazines.find((x) => x.id === id);
                            const label = m ? `${m.label} (no longer linked)` : 'Deleted magazine';
                            return (
                              <div className="row" key={id}>
                                <button className="gun-toggle on" aria-pressed={true}
                                  onClick={() => toggleMag(f.id, id)}>
                                  {label}
                                </button>
                                <input className="rounds-input" type="number" inputMode="numeric" min="0"
                                  aria-label={`Rounds through ${m?.label ?? 'a deleted magazine'} with ${f.name}`}
                                  value={magCount(f.id, id)}
                                  onChange={(e) => editMagCount(f.id, id, e.target.value)} />
                              </div>
                            );
                          })}
                          {picked.length > 0 && (magOverride[f.id] ? (
                            <>
                              {(() => {
                                const ov = magOverride[f.id] ?? {};
                                const sum = picked.reduce((t, id) => t + (Number(ov[id]) || 0), 0);
                                const gunTotal = Number(rounds[f.id]) || 0;
                                if (sum !== gunTotal) return (
                                  <p className="report-note warn">
                                    These mag rounds total {sum.toLocaleString()}, but {f.name} logged{' '}
                                    {gunTotal.toLocaleString()} — match them to save.
                                  </p>
                                );
                                return <p className="report-note">Custom split — each mag&rsquo;s lifetime count uses these numbers.</p>;
                              })()}
                              <button className="button secondary" onClick={() => resetMagSplit(f.id)}>Reset to even split</button>
                            </>
                          ) : (
                            <p className="report-note">Rounds split evenly across the mags you pick — tap a number to adjust.</p>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        )}
      </div>

      {/* Change 2: Ammo Used moved up — immediately after Guns & Rounds, since
          the auto-sync and mismatch warning tie them together. */}

      {/* First-run discoverability (Michael's fresh-eyes find, session 55):
          with an empty ammo library this card used to vanish entirely, so a
          new user never learned it existed. Keep the card, teach the door. */}
      {kind !== 'dry_fire' && ammoLib.length === 0 && (
        <div className="card">
          <h2>Ammo Used</h2>
          <p className="report-note">Add your ammo under More → Ammo to track rounds used here.</p>
        </div>
      )}

      {kind !== 'dry_fire' && ammoLib.length > 0 && (
        <div className="card" ref={ammoCardRef}>
          <h2>Ammo Used</h2>
          <FieldProblem id="session-ammo-err" problem={problem} field="ammo" />
          {ammoRows.map((r, i) => (
            <div className="row" key={i}>
              <select className="category-pick ammo-pick" aria-label={`Ammo ${i + 1}`} value={r.ammoId}
                onChange={(e) => { setAmmoTouched(true); setAmmoRows((p) => p.map((x, n) => n === i ? { ...x, ammoId: e.target.value } : x)); if (problem?.field === 'ammo') setProblem(null); }}>
                <option value="">Pick ammo…</option>
                {ammoLib.map((a) => <option key={a.id} value={a.id}>{ammoLabel(a)}</option>)}
              </select>
              <input className="rounds-input" type="number" inputMode="numeric" min="0"
                placeholder="rounds" aria-label={`Rounds of ammo ${i + 1}`} value={r.rounds}
                onChange={(e) => { setAmmoTouched(true); setAmmoRows((p) => p.map((x, n) => n === i ? { ...x, rounds: e.target.value } : x)); if (problem?.field === 'ammo') setProblem(null); }} />
              <button className="icon-btn" aria-label="Remove ammo row"
                onClick={() => { setTouched(true); setAmmoTouched(true); setAmmoRows((prev) => prev.filter((_, x) => x !== i)); }}><Icon name="close" size={18} /></button>
            </div>
          ))}
          <button className="button secondary" onClick={() => { setTouched(true); setAmmoTouched(true); setAmmoRows((prev) => [...prev, { ammoId: '', rounds: '' }]); }}>
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

      <div className="card" ref={drillsCardRef} data-testid="session-drills-card">
        {/* Drills collapsible — mirrors Guns & Rounds pattern. Starts open on
            a new session (adding drills is the point); loads collapsed for
            existing sessions that already have drills (summary shows count). */}
        <div className="disclosure-row">
          {/* App 2a: real <h2> outside the toggle button, same accordion
              pattern as Guns & Rounds — the InfoTip stays a heading-free
              sibling in the row (M-2: it must not nest inside the button). */}
          <h2 className="disclosure-h2">
            <button className="checklist-disclosure" data-testid="session-drills-disclosure" aria-expanded={drillsOpen}
              aria-controls={drillsOpen ? 'session-drills-body' : undefined} onClick={() => setDrillsOpen((v) => !v)}>
              <span className="checklist-disclosure-title">Drills</span>
              <span className="checklist-disclosure-toggle">{drillsOpen ? 'Hide' : 'Show'} <Icon name={drillsOpen ? 'chevronDown' : 'chevronRight'} size={14} style={{ verticalAlign: 'middle' }} /></span>
            </button>
          </h2>
          <InfoTip title="Drills">Pick from your drill library, or add a new drill right here — it saves to your library and lands on this session. Manage every drill (edit, delete, full details) under More &rarr; Drills.</InfoTip>
        </div>
        {/* Always-visible summary line — visible whether the body is open or
            closed. Shows count when drills exist, otherwise a plain "none yet." */}
        <p className="report-note">
          {drills.length > 0
            ? `${drills.length} drill${drills.length === 1 ? '' : 's'} ${planned ? 'planned' : 'added'}`
            : 'No drills yet.'}
        </p>
        <FieldProblem id="session-drills-err" problem={problem} field="drills" />
        {drillsOpen && (
          <div id="session-drills-body">
            {drills.map((d, i) => (
              <div className="drill-edit" key={i}>
                <div className="drill-edit-head">
                  <strong>{d.name}</strong>
                  <button className="icon-btn" aria-label={`Remove ${d.name}`}
                    onClick={() => { setTouched(true); setDrills((prev) => prev.filter((_, x) => x !== i)); }}><Icon name="close" size={18} /></button>
                </div>
                <div className="drill-edit-fields">
                  <label className="field small">Distance
                    <input value={d.distance} placeholder="7 yd"
                      onChange={(e) => setDrills((p) => p.map((x, n) => n === i ? { ...x, distance: e.target.value } : x))} />
                  </label>
                  <label className="field small">Time (s)
                    <input type="number" inputMode="decimal" value={d.time}
                      onChange={(e) => { setDrills((p) => p.map((x, n) => n === i ? { ...x, time: e.target.value } : x)); if (problem?.field === 'drills') setProblem(null); }} />
                  </label>
                  <label className="field small">Score
                    <input type="number" inputMode="decimal" value={d.score}
                      onChange={(e) => { setDrills((p) => p.map((x, n) => n === i ? { ...x, score: e.target.value } : x)); if (problem?.field === 'drills') setProblem(null); }} />
                  </label>
                  <label className="field small">Out of
                    <input type="number" inputMode="decimal" value={d.maxScore}
                      onChange={(e) => { setDrills((p) => p.map((x, n) => n === i ? { ...x, maxScore: e.target.value } : x)); if (problem?.field === 'drills') setProblem(null); }} />
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
        )}
      </div>

      {!planned && (
      <>
      {/* F3: MediaField's remove buttons mutate staged state by click alone, so
          the setters are wrapped to flip `touched` — otherwise removing a photo
          and backing out would discard the removal with no warning. */}
      <MediaField heading="Targets, Photos & Videos" addLabel="+ Add Photos or Videos"
        ownerType="session" ownerId={original?.id ?? ''}
        existingMedia={existingMedia} setExistingMedia={setExistingMedia}
        removedMedia={removedMedia} setRemovedMedia={(fn) => { setTouched(true); setRemovedMedia(fn); }}
        newFiles={newFiles} setNewFiles={(fn) => { setTouched(true); setNewFiles(fn); }} />

      {/* Change 4a: Timed Skills gets a real section heading so it reads as a
          section like the others. The Reveal stays collapsed by default. */}
      <div className="card">
        <h2>Timed Skills</h2>
        {/* T3-1: progressive disclosure — timed skill work (draws, reloads,
            splits, transitions, par drills) is capture-after-the-fact ("10
            draws, best 1.42, generally recorded when I get home"), so it
            stays collapsed and out of a newcomer's default view (charter §7 /
            DESIGN_DIRECTION §7). Opens itself once a set exists on an
            existing session, same rule the ratings Reveal below uses. */}
        <Reveal label="Add a timed-skills set" defaultOpen={editing && skillSets.length > 0}>
          <p className="report-note" style={{ marginTop: 0 }}>
            One entry per set — how many, your best time, and whether it was your first work of
            the day with no warmup (cold).
          </p>
          {skillSets.map((row, i) => {
            const gunName = firearms.find((f) => f.id === row.firearmId)?.name ?? '—';
            const label = TIMED_SKILLS.find((s) => s.key === row.skill)?.label ?? row.skill;
            // L2 (audit): reuse M1's Number.isFinite-guarded fallback here too —
            // a malformed count/bestSec (preserved rather than dropped on save,
            // see the save path below) must read as '—', never "undefined reps"
            // or "best NaNs".
            const countN = Number(row.count);
            const bestN = Number(row.bestSec);
            const summary = [
              `${Number.isFinite(countN) && countN > 0 ? countN : '—'} rep${countN === 1 ? '' : 's'}`,
              `best ${Number.isFinite(bestN) && bestN > 0 ? formatSec(bestN) : '—'}`,
              gunName
            ].join(' · ');
            return (
              <button className="row-tap" key={i} onClick={() => setSkillSheetIdx(i)}>
                <span className="label">
                  {label}{row.cold ? ' · Cold' : ''}
                  <div className="row-sub">{summary}</div>
                </span>
                <span className="value">›</span>
              </button>
            );
          })}
          {/* Change 3: when the user taps "+ Add Set" with no gun selected,
              also open Guns & Rounds so the required section is visible. */}
          <button className="button secondary" onClick={() => {
            if (!selectedGuns.length) {
              setGunsOpen(true);
              // Michael's tap-test finding (session 80): the jump to Guns &
              // Rounds landed with NO explanation at the destination — the
              // note under + Add Set is off-screen by the time you arrive.
              // Say why IN the guns card, via the existing error line; picking
              // a gun clears it (the standing guns-problem reset on toggle).
              setProblem({ field: 'guns', message: 'Pick a gun first — a timed-skills set attaches to one gun.' });
              gunsCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              // Cold-audit fix (session 78): move focus to the now-open Guns &
              // Rounds disclosure too — scrollIntoView alone is a silent no-op
              // for keyboard/VoiceOver users, who need the focus move itself
              // to get an announcement of where they landed and why.
              (gunsCardRef.current?.querySelector('.checklist-disclosure') as HTMLElement | null)?.focus();
              return;
            }
            setSkillSheetIdx(-1);
          }}>
            + Add Set
          </button>
          {/* Change 3: plain, specific copy that names the section and explains why. */}
          {!selectedGuns.length && (
            <p className="report-note"><Icon name="info" size={18} style={{ verticalAlign: 'middle', marginRight: 4 }} />Choose a gun in Guns &amp; Rounds first — a timed-skills set attaches to one gun.</p>
          )}
        </Reveal>
      </div>

      {/* Change 4b: Malfunctions — collapsed by default on a new session with no
          content; opens automatically when the session already has malfunctions. */}
      <div className="card" data-testid="session-malfs-card">
        <h2>Malfunctions</h2>
        <p className="report-note">
          {(() => {
            // Cold-audit fix (session 78): count only rows doPersist() will
            // actually write (malfHasContent) — a freshly-added blank row
            // used to inflate this to "1 malfunction added" while save()
            // stored zero.
            // App 3a: "added", not "logged" — the old verb pre-claimed an
            // unsaved row as already on the record.
            const n = malfs.filter(malfHasContent).length;
            return n > 0 ? `${n} malfunction${n === 1 ? '' : 's'} added` : 'No malfunctions yet.';
          })()}
        </p>
        <Reveal label="Log a malfunction" defaultOpen={editing && malfs.length > 0}>
          {malfs.map((m, i) => (
            <div className="drill-edit" key={i}>
              <div className="drill-edit-head">
                <strong>{m.type || 'New malfunction'}</strong>
                <button className="icon-btn" aria-label="Remove malfunction"
                  onClick={() => { setTouched(true); setMalfs((prev) => prev.filter((_, x) => x !== i)); }}><Icon name="close" size={18} /></button>
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
          <button className="button secondary" onClick={() => { setTouched(true); setMalfs((prev) => [
            ...prev,
            { firearmId: (selectedGuns[0] ?? firearms[0])?.id ?? '', type: '', resolution: '', notes: '',
              ammoId: '', magazineId: '', roundCount: '' }
          ]); }}>+ Add Malfunction</button>
        </Reveal>
      </div>

      <div className="card">
        {/* Progressive disclosure: the self-ratings are reflection, not core capture —
            collapsed by default so a first log is kind-of-work + gun & rounds + save.
            Values live in `ratings` state, so an unopened block still saves "—". */}
        <Reveal defaultOpen={editing && Object.values(ratings).some((v) => v !== '')}
          label="Rate how it felt (1–10)">
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

      {/* Change 2: Gear Checklist moved down — it's a pre-range planning tool
          and belongs near the end of a post-range logging form. */}
      <div className="card">
        {/* App 2a: same real-<h2> accordion wrap as Guns & Rounds and Drills. */}
        <h2 className="disclosure-h2">
          <button className="checklist-disclosure" aria-expanded={checklistOpen}
            aria-controls={checklistOpen ? 'session-checklist-body' : undefined} onClick={() => setChecklistOpen((v) => !v)}>
            <span className="checklist-disclosure-title">Gear Checklist</span>
            <span className="checklist-disclosure-toggle">{checklistOpen ? 'Hide' : 'Show'} <Icon name={checklistOpen ? 'chevronDown' : 'chevronRight'} size={14} style={{ verticalAlign: 'middle' }} /></span>
          </button>
        </h2>
        {checklistProgressInfo.toTake > 0 && (
          <>
            <div className="dc-bar-wrap">
              <div className="dc-bar-fill" style={{ width: `${checklistProgressInfo.pct}%` }} />
            </div>
            <p className="report-note">
              {checklistProgressInfo.packed === checklistProgressInfo.toTake
                ? <><span aria-hidden="true">✓</span> All packed ({checklistProgressInfo.packed}/{checklistProgressInfo.toTake})</>
                : `${checklistProgressInfo.packed} / ${checklistProgressInfo.toTake} packed`}
            </p>
          </>
        )}

        {checklistOpen && (
          <div id="session-checklist-body">
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
                onClick={() => { setChecklist((cl) => setChecklistMode(cl, 'night', !cl.nightMode, customItems)); setTouched(true); }}>
                Include night-session gear in this checklist
              </button>
            </div>
            {checklist.nightMode && checklistSection('night', 'Night Session')}

            <div className="row">
              <button className={`gun-toggle ${checklist.tacticalMode ? 'on' : ''}`} aria-pressed={checklist.tacticalMode}
                onClick={() => { setChecklist((cl) => setChecklistMode(cl, 'tactical', !cl.tacticalMode, customItems)); setTouched(true); }}>
                Include class / force-on-force gear in this checklist
              </button>
            </div>
            {checklist.tacticalMode && checklistSection('tactical', 'Class / force-on-force gear')}

            {checklistProgressInfo.toTake > 0 && (
              <button className="button secondary" onClick={printChecklist}>Print Checklist</button>
            )}
          </div>
        )}
      </div>

      {/* App 5a: Wrap-Up re-layout (owner decision) — a real <h2> heading
          (consistent with 2a's outline), Notes ALWAYS visible (no extra tap
          to record a note), and only the range fee tucked behind a Reveal
          labeled "Range fee". The Reveal keeps its exact prior behaviors:
          defaultOpen when a loaded session already has a fee (notes no
          longer factor in — Notes is visible regardless), and forceOpenKey
          bumps on every failed save targeting rangeFee so a manually
          re-collapsed fee field still reopens with its error (session 78
          cold-audit fix — see wrapUpForceKey above). */}
      <div className="card">
        <h2>Wrap-Up</h2>
        <label className="field">Notes
          <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <Reveal label="Range fee" defaultOpen={wrapUpOpen} forceOpenKey={wrapUpForceKey}>
          <label className={`field${problem?.field === 'rangeFee' ? ' invalid' : ''}`}>Range fee ($)
            <input
              ref={rangeFeeFieldRef}
              id="session-rangefee-input"
              type="number" inputMode="decimal" min="0"
              value={rangeFee}
              onChange={(e) => { setRangeFee(e.target.value); if (problem?.field === 'rangeFee') setProblem(null); }}
              aria-invalid={problem?.field === 'rangeFee' || undefined}
              aria-describedby={problem?.field === 'rangeFee' ? 'session-rangefee-err' : undefined} />
            <FieldProblem id="session-rangefee-err" problem={problem} field="rangeFee" />
          </label>
        </Reveal>
      </div>

      <button className="button" disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : converting ? 'Log Session' : editing ? 'Save changes' : 'Save session'}
      </button>

      {editing && original && (
        <button className="button danger" style={{ marginTop: 8 }} onClick={() => setConfirming(true)}>
          Delete session
        </button>
      )}
      {confirming && (
        <ConfirmSheet
          title="Delete this session?"
          message="It moves to Recently Deleted and any ammo it used goes back on the can. You can restore it for 30 days from the Log screen — after that it's gone for good."
          confirmLabel="Delete session"
          onConfirm={() => void reallyDelete()}
          onClose={() => setConfirming(false)}
        />
      )}

      {picking && (
        <Sheet title="Pick Drills" onClose={() => { setPicking(false); setQuickAdding(false); setQuickName(''); setQuickProblem(''); }}
          dirty={picked.size > 0 || quickName.trim() !== '' || quickProblem.trim() !== ''}
          // Save-from-guard: when drills are selected, "Save" means "Add them".
          // Only valid when at least one drill is actually picked (not during the
          // quick-add flow, where the saver is the quick-add save button itself).
          onSaveRequest={picked.size > 0 && !quickAdding ? () => addPickedDrills() : undefined}>
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
                onClick={() => { setTouched(true); setPicked((prev) => {
                  const next = new Set(prev);
                  if (next.has(d.id)) next.delete(d.id); else next.add(d.id);
                  return next;
                }); }}>
                <strong><span aria-hidden="true">{on ? '☑' : '☐'}</span> {d.name}</strong>
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
                  aria-label="Drill to add" {...noAutofillProps} name="quick-drill-title" enterKeyHint="done"
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

      {skillSheetIdx !== null && (
        <SkillSetSheet
          // M3 (audit): keyed on the row's (re-pointed) firearmId so the sheet
          // REMOUNTS with fresh initial state when the M3 effect above
          // re-points it out from under an open sheet — otherwise the
          // sheet's own useState would keep showing the removed gun's id
          // (a stale "Pick a gun…") since `initial` only seeds state on
          // mount, not on every render.
          key={`${skillSheetIdx}:${skillSheetIdx === -1 ? (selectedGuns[0]?.id ?? '') : (skillSets[skillSheetIdx]?.firearmId ?? '')}`}
          initial={skillSheetIdx === -1
            ? blankSkillSetRow(selectedGuns[0]?.id ?? '', kind === 'dry_fire')
            : skillSets[skillSheetIdx]}
          guns={selectedGuns}
          editing={skillSheetIdx !== -1}
          onSave={(row) => {
            setTouched(true);
            setSkillSets((prev) => skillSheetIdx === -1
              ? [...prev, row]
              : prev.map((r, i) => (i === skillSheetIdx ? row : r)));
            setSkillSheetIdx(null);
          }}
          onDelete={skillSheetIdx !== -1 ? () => {
            setTouched(true);
            setSkillSets((prev) => prev.filter((_, i) => i !== skillSheetIdx));
            setSkillSheetIdx(null);
          } : undefined}
          onClose={() => setSkillSheetIdx(null)}
        />
      )}
    </div>
  );
}

// T3-1: the add/edit sheet for one timed-skill set — skill picker, gun, reps
// (thumb-first Stepper — mobile wins the tie), best time, optional typical
// and (par-drill-only) par time, the cold flag, an optional rep-times entry
// (F-Universal — collapsed, feeds the future CSV importer's repTimesSec), and
// notes. Validated here so a save() can trust every row it writes.
function SkillSetSheet({ initial, guns, editing, onSave, onDelete, onClose }: {
  initial: SkillSetRow;
  guns: Firearm[];
  editing: boolean;
  onSave: (row: SkillSetRow) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [skill, setSkill] = useState<TimedSkill>(initial.skill);
  const [firearmId, setFirearmId] = useState(initial.firearmId);
  const [dryFire, setDryFire] = useState(initial.dryFire);
  const [count, setCount] = useState(initial.count);
  const [bestSec, setBestSec] = useState(initial.bestSec);
  const [typicalSec, setTypicalSec] = useState(initial.typicalSec);
  const [parSec, setParSec] = useState(initial.parSec);
  const [cold, setCold] = useState(initial.cold);
  const [repTimes, setRepTimes] = useState(initial.repTimes);
  const [notes, setNotes] = useState(initial.notes);
  const [problem, setProblem] = useState('');
  const dirty = useDirtyTracker({ skill, firearmId, dryFire, count, bestSec, typicalSec, parSec, cold, repTimes, notes });

  function validate(): string | null {
    if (!firearmId) return 'Pick a gun.';
    const countNum = Number(count);
    if (!Number.isFinite(countNum) || countNum <= 0 || !Number.isInteger(countNum)) {
      return 'Reps need to be a whole number greater than 0.';
    }
    const bestNum = Number(bestSec);
    if (!Number.isFinite(bestNum) || bestNum <= 0) return 'Best time needs to be a number greater than 0.';
    if (typicalSec.trim() !== '' && (!Number.isFinite(Number(typicalSec)) || Number(typicalSec) <= 0)) {
      return 'Typical time needs to be a number greater than 0.';
    }
    if (parSec.trim() !== '' && (!Number.isFinite(Number(parSec)) || Number(parSec) <= 0)) {
      return 'Par time needs to be a number greater than 0.';
    }
    return null;
  }

  function save() {
    const v = validate();
    if (v) { setProblem(v); return; }
    setProblem('');
    onSave({ skill, firearmId, dryFire, count, bestSec, typicalSec, parSec, cold, repTimes, notes });
  }

  return (
    <Sheet title={editing ? 'Edit Set' : 'Add Set'} onClose={onClose} dirty={dirty}
      onSaveRequest={validate() === null ? save : undefined}>
      <FormProblem problem={problem} />
      <label className="field">Skill
        <select value={skill} onChange={(e) => setSkill(e.target.value as TimedSkill)}>
          {TIMED_SKILLS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </label>
      <label className="field">Gun
        <select value={firearmId} onChange={(e) => setFirearmId(e.target.value)}>
          <option value="">Pick a gun…</option>
          {guns.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </label>
      <Stepper label="Reps in this set" value={count} onChange={setCount} />
      <div className="drill-edit-fields">
        <label className="field small">Best (sec)
          <input type="number" inputMode="decimal" min="0" step="0.01" value={bestSec}
            onChange={(e) => setBestSec(e.target.value)} />
        </label>
        <label className="field small">Typical (sec)
          <input type="number" inputMode="decimal" min="0" step="0.01" value={typicalSec}
            placeholder="optional"
            onChange={(e) => setTypicalSec(e.target.value)} />
        </label>
        {skill === 'par' && (
          <label className="field small">Par (sec)
            <input type="number" inputMode="decimal" min="0" step="0.01" value={parSec}
              placeholder="optional"
              onChange={(e) => setParSec(e.target.value)} />
          </label>
        )}
      </div>
      <div className="row">
        <button type="button" className={`gun-toggle ${dryFire ? 'on' : ''}`} aria-pressed={dryFire}
          onClick={() => setDryFire((v) => !v)}>Dry fire</button>
      </div>
      <div className="row">
        <button type="button" className={`gun-toggle ${cold ? 'on' : ''}`} aria-pressed={cold}
          onClick={() => setCold((v) => !v)}>Cold (first work of the day, no warmup)</button>
      </div>
      <Reveal label="Rep times (optional)">
        <label className="field">Each rep&rsquo;s time, separated by commas or spaces
          <input value={repTimes} placeholder="1.42, 1.51, 1.38…" inputMode="decimal"
            onChange={(e) => setRepTimes(e.target.value)} />
        </label>
      </Reveal>
      <label className="field">Notes
        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <button className="button" onClick={save}>{editing ? 'Save changes' : 'Add Set'}</button>
      {onDelete && (
        <button className="button danger" style={{ marginTop: 8 }} onClick={onDelete}>Remove set</button>
      )}
    </Sheet>
  );
}
