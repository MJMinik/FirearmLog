// CSV export — what each table's columns actually are.
//
// The engine (lib/csvExport.ts) knows how to turn rows plus columns into a
// file. This module is the other half: which tables a shooter can export, what
// the columns are called in plain English, and how a stored record maps onto
// them. Pure, like the engine — it is handed the records and a lookup, and
// returns text.
//
// TWO DECISIONS RUN THROUGH THE WHOLE FILE, and both exist so the export can be
// read back in by the importer that follows it:
//
// 1. A REFERENCE EXPORTS AS A NAME, NEVER AS AN ID. A session's gun column says
//    "Apollo", not "f_8c1a...". Two reasons and the second is the load-bearing
//    one: an id means nothing to somebody reading a spreadsheet, and the import
//    side matches guns and ammunition BY NAME (design doc §3.3), so a file full
//    of ids would not survive its own round trip.
//
// 2. ONE ROW = ONE SESSION WITH ONE GUN. A session in this app can hold several
//    guns with their own round counts; a CSV row is flat. A two-gun day exports
//    as two rows carrying the same date, location and notes. That is Michael's
//    answer 2 of the CSV design, taken deliberately over the clever alternative
//    of merging: a wrong merge is invisible in a preview, and a split day is a
//    two-minute fix by hand.
//
// Drill results are their own table rather than being crushed into the session
// row. A shooter looking at a spreadsheet of times and scores wants one row per
// drill, and folding them into a session row would lose the times entirely.
//
// WHAT THIS FORMAT IS NOT: a backup. CSV is flat, so it carries no photos and
// no videos, and it does not cover every store: reminders and the built-in care
// guides have no table here on purpose (a reminder is a to-do rather than a
// record of shooting, and the care guides are content the app ships rather than
// anything the user logged). The .flog file is the complete one. The screen has
// to say that plainly rather than letting a user infer it — and it must not
// name a short list of exclusions in a way that implies the list is complete,
// which is how the first draft of that copy was wrong.

import type { CsvColumn } from './csvExport.ts';
import { toCsvText, joinCell } from './csvExport.ts';
import type {
  Firearm, Session, SessionGun, DrillResult, Ammunition, Purchase,
  MaintenanceEntry, MalfunctionEntry, Magazine, Optic, Part, Goal, Match,
  Classifier, DrillDef, SkillSet, SkillAssessment,
} from './types.ts';
import { activeMalfunctions, trashedIdSet } from './softDelete.ts';
import { SKILL_AREAS } from './skills.ts';
import { activeSkillSets, skillLabel } from './skillSets.ts';

/** Names for the ids a record points at. Built once, read by the columns. */
export interface CsvLookup {
  gunName: (id: string | null | undefined) => string;
  ammoName: (id: string | null | undefined) => string;
  magLabel: (id: string | null | undefined) => string;
}

/** A lookup that resolves nothing — used when a table needs no references. */
export const EMPTY_LOOKUP: CsvLookup = {
  gunName: () => '',
  ammoName: () => '',
  magLabel: () => '',
};

/**
 * Build the name lookups from the records themselves.
 *
 * An id with no matching record resolves to an empty cell rather than to the
 * raw id. A dangling reference is a fact about the log, and showing the user a
 * hex string in a column called "Gun" teaches them nothing; an empty cell reads
 * correctly as "this row does not name a gun". The row still exports.
 */
export function buildLookup(input: {
  firearms?: Firearm[]; ammunition?: Ammunition[]; magazines?: Magazine[];
}): CsvLookup {
  const guns = new Map(list(input.firearms).map((f) => [f.id, f.name]));
  const ammo = new Map(list(input.ammunition).map((a) => [a.id, ammoLabel(a)]));
  const mags = new Map(list(input.magazines).map((m) => [m.id, m.label]));
  return {
    gunName: (id) => (id ? guns.get(id) ?? '' : ''),
    ammoName: (id) => (id ? ammo.get(id) ?? '' : ''),
    magLabel: (id) => (id ? mags.get(id) ?? '' : ''),
  };
}

/** Ammunition has no single name field, so one is composed the way the app reads it. */
export function ammoLabel(a: Pick<Ammunition, 'brand' | 'grain' | 'bulletType' | 'caliber'>): string {
  return [a.brand, a.caliber, a.grain && `${a.grain}gr`, a.bulletType]
    .filter(Boolean).join(' ').trim();
}

/** A yes/no cell. Spreadsheets read these; true/false reads like code. */
const yesNo = (v: unknown): string => (v ? 'Yes' : 'No');

/**
 * One exportable table.
 *
 * `rows` turns the raw stores into the flat rows this table exports, which is
 * where the session-to-one-row-per-gun expansion happens.
 */
export interface CsvTable {
  key: string;
  /** What the user picks on the export screen. */
  label: string;
  /** One line under the label, saying what a row is. */
  describes: string;
  toText: (stores: CsvStores, lookup: CsvLookup) => string;
  count: (stores: CsvStores) => number;
}

/** Just the stores the export reads. Everything is optional so a partial log works. */
export interface CsvStores {
  firearms?: Firearm[];
  sessions?: Session[];
  drills?: DrillDef[];
  ammunition?: Ammunition[];
  purchases?: Purchase[];
  maintenance?: MaintenanceEntry[];
  malfunctions?: MalfunctionEntry[];
  magazines?: Magazine[];
  optics?: Optic[];
  parts?: Part[];
  goals?: Goal[];
  matches?: Match[];
  classifiers?: Classifier[];
  skillSets?: SkillSet[];
  skills?: SkillAssessment[];
}

/**
 * A record in the Trash is excluded from every export.
 *
 * It is excluded from every list, chart, cost total and round count in the app
 * (types.ts, the deletedAt tombstone), so exporting it would hand the user rows
 * they believe they deleted. Only Session carries the tombstone today; the
 * helper is written to cope with any record that grows one.
 */
function live<T extends { deletedAt?: number | null }>(rows: readonly T[] | undefined): T[] {
  return list(rows).filter((r) => !r.deletedAt);
}

/**
 * Every array this file reads comes back through here first.
 *
 * `?? []` defends against a field being MISSING. It does not defend against the
 * field being the wrong shape, and this app deliberately stores imported
 * records verbatim (db.ts: "a missing section means empty, never a crash"), so
 * a legacy or hand-edited record can hold an object where an array belongs.
 * Without this, one such record threw inside `count()` — which the screen calls
 * during render — and the error boundary replaced the WHOLE export screen, so a
 * single odd record made all fourteen tables unreachable. Found by a cold audit
 * before this shipped.
 *
 * Null and undefined ENTRIES are dropped for the same reason: a null in the
 * array is not a record, and every column accessor would throw on it.
 */
function list<T>(rows: readonly T[] | undefined | null): T[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r): r is T => r !== null && r !== undefined);
}

/**
 * Records that hang off a session inherit that session's trashed state.
 *
 * Deleting a session only tombstones the session; its malfunctions and its
 * timed-skill sets survive in their own stores until the purge, and the app
 * filters them out at read time (`activeMalfunctions`, `activeSkillSets`).
 * **Every store carrying a `sessionId` needs this, and the list is worth
 * checking against the data model rather than against memory** — the first fix
 * covered malfunctions and the very same change then added a skill-sets table
 * with the bug still in it, which a second cold pass caught.
 */
function liveMalfunctions(stores: CsvStores): MalfunctionEntry[] {
  return activeMalfunctions(list(stores.malfunctions), trashedIdSet(list(stores.sessions)));
}

function liveSkillSets(stores: CsvStores): SkillSet[] {
  return activeSkillSets(list(stores.skillSets), trashedIdSet(list(stores.sessions)));
}

// ---------------------------------------------------------------------------
// Sessions — one row per session PER GUN
// ---------------------------------------------------------------------------

export interface SessionRow {
  session: Session;
  gun: SessionGun;
  /** 1-based, so a two-gun day reads "1 of 2" and "2 of 2" rather than looking duplicated. */
  gunIndex: number;
  gunCount: number;
}

export function expandSessions(sessions: readonly Session[]): SessionRow[] {
  const out: SessionRow[] = [];
  for (const session of sessions) {
    const guns = list(session.guns);
    if (guns.length === 0) {
      // A session with no gun still happened. Exporting it with an empty gun
      // column is honest; dropping it would quietly lose a record the user can
      // see on their own Log screen.
      out.push({
        session,
        gun: { firearmId: '', rounds: 0 },
        gunIndex: 1,
        gunCount: 1,
      });
      continue;
    }
    guns.forEach((gun, i) => {
      out.push({ session, gun, gunIndex: i + 1, gunCount: guns.length });
    });
  }
  return out;
}

const sessionColumns = (lk: CsvLookup): CsvColumn<SessionRow>[] => [
  { header: 'Date', get: (r) => r.session.date },
  { header: 'Type', get: (r) => r.session.type },
  { header: 'Gun', get: (r) => lk.gunName(r.gun.firearmId) },
  { header: 'Rounds', get: (r) => r.gun.rounds },
  { header: 'Guns in session', get: (r) => (r.gunCount > 1 ? `${r.gunIndex} of ${r.gunCount}` : '') },
  { header: 'Location', get: (r) => r.session.location },
  { header: 'Distances', get: (r) => r.session.distances },
  { header: 'Drills', get: (r) => joinCell(list(r.session.drills).map((d) => d.name)) },
  {
    header: 'Ammo used',
    get: (r) => joinCell(list(r.session.ammoUsage)
      .map((u) => {
        const name = lk.ammoName(u.ammoId);
        // The ROUNDS survive even when the ammunition record has been deleted.
        // Dropping the whole cell used to lose them silently, so a session
        // firing 300 rounds could account for only 150 with nothing saying so —
        // and somebody reconciling ammo spend would simply get a wrong total.
        // This is the same rule the Gun column already follows: the name goes
        // missing, the fact does not.
        return name ? `${name} (${u.rounds})` : `(${u.rounds})`;
      })),
  },
  { header: 'Range fee', get: (r) => r.session.rangeFee },
  { header: 'Instructor', get: (r) => r.session.instructor ?? '' },
  { header: 'Planned', get: (r) => yesNo(r.session.planned) },
  { header: 'Notes', get: (r) => r.session.notes },
];

// ---------------------------------------------------------------------------
// Drill results — one row per drill inside a session
// ---------------------------------------------------------------------------

export interface DrillRow { session: Session; drill: DrillResult }

export function expandDrillResults(sessions: readonly Session[]): DrillRow[] {
  const out: DrillRow[] = [];
  for (const session of sessions) {
    for (const drill of list(session.drills)) out.push({ session, drill });
  }
  return out;
}

const drillResultColumns = (lk: CsvLookup): CsvColumn<DrillRow>[] => [
  { header: 'Date', get: (r) => r.session.date },
  { header: 'Session type', get: (r) => r.session.type },
  { header: 'Guns', get: (r) => joinCell(list(r.session.guns).map((g) => lk.gunName(g.firearmId))) },
  { header: 'Drill', get: (r) => r.drill.name },
  { header: 'Distance', get: (r) => r.drill.distance },
  { header: 'Time (sec)', get: (r) => r.drill.time },
  { header: 'Score', get: (r) => r.drill.score },
  { header: 'Max score', get: (r) => r.drill.maxScore },
  { header: 'Notes', get: (r) => r.drill.notes },
];

// ---------------------------------------------------------------------------
// The rest — one row per record
// ---------------------------------------------------------------------------

const firearmColumns: CsvColumn<Firearm>[] = [
  { header: 'Name', get: (f) => f.name },
  { header: 'Manufacturer', get: (f) => f.manufacturer },
  { header: 'Model', get: (f) => f.model },
  { header: 'Caliber', get: (f) => f.caliber },
  { header: 'Category', get: (f) => f.category },
  { header: 'Date acquired', get: (f) => f.dateAcquired },
  { header: 'Starting round count', get: (f) => f.startingRoundCount },
  { header: 'Barrel', get: (f) => f.barrelName ?? '' },
  { header: 'Barrel installed', get: (f) => f.barrelInstallDate ?? '' },
  { header: 'Recoil spring interval', get: (f) => f.recoilSpringInterval ?? '' },
  { header: 'Recoil spring weight', get: (f) => f.recoilSpringWeight ?? '' },
  { header: 'Status', get: (f) => f.status ?? 'active' },
  { header: 'Status reason', get: (f) => f.statusReason ?? '' },
  { header: 'Status date', get: (f) => f.statusDate ?? '' },
  { header: 'Notes', get: (f) => f.notes },
  // Serial number is DELIBERATELY ABSENT. It identifies a specific firearm, a
  // CSV is the format most likely to be mailed to somebody or dropped in a
  // shared folder, and nothing in an export needs it. It stays in the .flog,
  // which is the file that never leaves the user's own hands by default.
];

const ammoColumns: CsvColumn<Ammunition>[] = [
  { header: 'Brand', get: (a) => a.brand },
  { header: 'Caliber', get: (a) => a.caliber },
  { header: 'Grain', get: (a) => a.grain },
  { header: 'Bullet type', get: (a) => a.bulletType },
  { header: 'Quantity', get: (a) => a.quantity },
  { header: 'Cost per round', get: (a) => a.costPerRound },
  { header: 'Notes', get: (a) => a.notes },
];

const purchaseColumns: CsvColumn<Purchase>[] = [
  { header: 'Date', get: (p) => p.date },
  { header: 'Category', get: (p) => p.category },
  { header: 'Item', get: (p) => p.item },
  { header: 'Vendor', get: (p) => p.vendor },
  { header: 'Cost', get: (p) => p.cost },
  { header: 'Rounds', get: (p) => p.rounds ?? '' },
  { header: 'Notes', get: (p) => p.notes },
];

const maintenanceColumns = (lk: CsvLookup): CsvColumn<MaintenanceEntry>[] => [
  { header: 'Date', get: (m) => m.date },
  { header: 'Gun', get: (m) => lk.gunName(m.firearmId) },
  { header: 'Type', get: (m) => m.type },
  { header: 'Performed by', get: (m) => m.performedBy },
  { header: 'Parts replaced', get: (m) => m.partsReplaced },
  { header: 'Notes', get: (m) => m.notes },
];

const malfunctionColumns = (lk: CsvLookup): CsvColumn<MalfunctionEntry>[] => [
  { header: 'Date', get: (m) => m.date },
  { header: 'Gun', get: (m) => lk.gunName(m.firearmId) },
  { header: 'Type', get: (m) => m.type },
  { header: 'Ammo', get: (m) => lk.ammoName(m.ammoId) },
  { header: 'Magazine', get: (m) => lk.magLabel(m.magazineId) },
  { header: 'Round count', get: (m) => m.roundCount ?? '' },
  { header: 'Resolution', get: (m) => m.resolution },
  { header: 'Notes', get: (m) => m.notes },
];

const magazineColumns = (lk: CsvLookup): CsvColumn<Magazine>[] => [
  { header: 'Label', get: (m) => m.label },
  { header: 'Guns', get: (m) => joinCell(list(m.firearmIds).map((id) => lk.gunName(id))) },
  { header: 'In use', get: (m) => yesNo(m.active) },
  { header: 'Lifetime rounds', get: (m) => m.totalRounds },
  { header: 'Notes', get: (m) => m.notes },
];

const opticColumns = (lk: CsvLookup): CsvColumn<Optic>[] => [
  { header: 'Gun', get: (o) => lk.gunName(o.firearmId) },
  { header: 'Make', get: (o) => o.make },
  { header: 'Model', get: (o) => o.model },
  { header: 'Installed', get: (o) => o.installDate },
  { header: 'Dot size', get: (o) => o.dotSize },
  { header: 'Zero distance', get: (o) => o.zeroDist },
  { header: 'Mount height', get: (o) => o.mountHeight },
  { header: 'Torque spec', get: (o) => o.torqueSpec },
  { header: 'Settings', get: (o) => o.settingsSnapshot },
  { header: 'Notes', get: (o) => o.notes },
];

const partColumns = (lk: CsvLookup): CsvColumn<Part>[] => [
  { header: 'Name', get: (p) => p.name },
  { header: 'Gun', get: (p) => lk.gunName(p.firearmId) },
  { header: 'Quantity', get: (p) => p.quantity },
  { header: 'Part number', get: (p) => p.partNumber },
  { header: 'Date purchased', get: (p) => p.datePurchased },
  { header: 'Cost', get: (p) => p.cost ?? '' },
  { header: 'Vendor', get: (p) => p.vendor ?? '' },
  { header: 'Notes', get: (p) => p.notes },
];

const goalColumns: CsvColumn<Goal>[] = [
  { header: 'Goal', get: (g) => g.text },
  { header: 'Category', get: (g) => g.category },
  { header: 'Target', get: (g) => g.target },
  { header: 'Achieved', get: (g) => yesNo(g.achieved) },
  { header: 'Date set', get: (g) => g.dateSet },
  { header: 'Date achieved', get: (g) => g.dateAchieved },
];

const matchColumns = (lk: CsvLookup): CsvColumn<Match>[] => [
  { header: 'Date', get: (m) => m.date },
  { header: 'Match', get: (m) => m.name },
  { header: 'Match type', get: (m) => m.matchType },
  { header: 'Division', get: (m) => m.division },
  { header: 'Power factor', get: (m) => m.powerFactor },
  { header: 'Gun', get: (m) => lk.gunName(m.firearmId) },
  { header: 'Rounds', get: (m) => m.totalRounds },
  { header: 'Overall place', get: (m) => m.overallPlace },
  { header: 'Overall of', get: (m) => m.overallOf },
  { header: 'Division place', get: (m) => m.divisionPlace },
  { header: 'Division of', get: (m) => m.divisionOf },
  { header: 'Match percent', get: (m) => m.matchPercent },
  { header: 'Stages', get: (m) => list(m.stages).length },
  { header: 'Entry fee', get: (m) => m.entryFee },
  { header: 'PractiScore link', get: (m) => m.practiScoreUrl },
  { header: 'Notes', get: (m) => m.notes },
];

const classifierColumns: CsvColumn<Classifier>[] = [
  { header: 'Date', get: (c) => c.date },
  { header: 'Code', get: (c) => c.code },
  { header: 'Classifier', get: (c) => c.name },
  { header: 'Division', get: (c) => c.division },
  { header: 'Hit factor', get: (c) => c.hitFactor },
  { header: 'Percent', get: (c) => c.percent },
  { header: 'Notes', get: (c) => c.notes },
];

const skillSetColumns = (lk: CsvLookup): CsvColumn<SkillSet>[] => [
  { header: 'Date', get: (r) => r.date },
  { header: 'Skill', get: (r) => skillLabel(r.skill) },
  { header: 'Gun', get: (r) => lk.gunName(r.firearmId) },
  { header: 'Dry fire', get: (r) => yesNo(r.dryFire) },
  { header: 'Cold', get: (r) => yesNo(r.cold) },
  { header: 'Reps', get: (r) => r.count },
  { header: 'Best (sec)', get: (r) => r.bestSec },
  { header: 'Typical (sec)', get: (r) => r.typicalSec ?? '' },
  { header: 'Par (sec)', get: (r) => r.parSec ?? '' },
  // Every individual rep time, in one cell, semicolon separated. A shooter
  // charting their own draw times in a spreadsheet wants the raw reps, and a
  // best-and-typical pair throws away the distribution they came from.
  { header: 'Rep times (sec)', get: (r) => joinCell(list(r.repTimesSec)) },
  { header: 'Notes', get: (r) => r.notes },
];

// One column per skill area, so a rating is a NUMBER in its own column and the
// sheet can chart it. Squashing the eight ratings into one cell would make the
// most chartable data in the app unchartable.
const skillAssessmentColumns: CsvColumn<SkillAssessment>[] = [
  { header: 'Date', get: (a) => a.date },
  ...SKILL_AREAS.map((area) => ({
    header: area.label,
    get: (a: SkillAssessment) => a.ratings?.[area.key] ?? '',
  })),
  { header: 'Notes', get: (a) => a.notes },
];

const drillLibraryColumns: CsvColumn<DrillDef>[] = [
  { header: 'Drill', get: (d) => d.name },
  { header: 'Gun categories', get: (d) => joinCell(d.gunCategories) },
  { header: 'Live or dry', get: (d) => d.fire },
  { header: 'Scoring', get: (d) => d.scoring },
  { header: 'Holster required', get: (d) => yesNo(d.requiresHolster) },
  { header: 'Brief description', get: (d) => d.briefDescription },
  { header: 'Full description', get: (d) => d.fullDescription },
];

// ---------------------------------------------------------------------------
// The registry — the order the export screen lists them in
// ---------------------------------------------------------------------------

export const CSV_TABLES: CsvTable[] = [
  {
    key: 'sessions',
    label: 'Sessions',
    describes: 'One row per session. A session with two guns exports as two rows.',
    count: (s) => expandSessions(live(s.sessions)).length,
    toText: (s, lk) => toCsvText(expandSessions(live(s.sessions)), sessionColumns(lk)),
  },
  {
    key: 'drill-results',
    label: 'Drill results',
    describes: 'One row per drill you ran, with its time and score.',
    count: (s) => expandDrillResults(live(s.sessions)).length,
    toText: (s, lk) => toCsvText(expandDrillResults(live(s.sessions)), drillResultColumns(lk)),
  },
  {
    key: 'timed-skills',
    label: 'Timed skills',
    describes: 'One row per timed set: draws, reloads, splits, transitions, par.',
    count: (s) => liveSkillSets(s).length,
    toText: (s, lk) => toCsvText(liveSkillSets(s), skillSetColumns(lk)),
  },
  {
    key: 'skill-ratings',
    label: 'Skill ratings',
    describes: 'One row per self-assessment, one column per skill area.',
    count: (s) => list(s.skills).length,
    toText: (s) => toCsvText(list(s.skills), skillAssessmentColumns),
  },
  {
    key: 'firearms',
    label: 'Guns',
    describes: 'One row per gun. Serial numbers are not included.',
    count: (s) => list(s.firearms).length,
    toText: (s) => toCsvText(list(s.firearms), firearmColumns),
  },
  {
    key: 'ammunition',
    label: 'Ammunition',
    describes: 'One row per ammunition entry, with stock and cost.',
    count: (s) => list(s.ammunition).length,
    toText: (s) => toCsvText(list(s.ammunition), ammoColumns),
  },
  {
    key: 'purchases',
    label: 'Costs',
    describes: 'One row per purchase, fee or expense.',
    count: (s) => list(s.purchases).length,
    toText: (s) => toCsvText(list(s.purchases), purchaseColumns),
  },
  {
    key: 'maintenance',
    label: 'Maintenance',
    describes: 'One row per maintenance entry.',
    count: (s) => list(s.maintenance).length,
    toText: (s, lk) => toCsvText(list(s.maintenance), maintenanceColumns(lk)),
  },
  {
    key: 'malfunctions',
    label: 'Malfunctions',
    describes: 'One row per malfunction, with the gun, ammo and magazine.',
    count: (s) => liveMalfunctions(s).length,
    toText: (s, lk) => toCsvText(liveMalfunctions(s), malfunctionColumns(lk)),
  },
  {
    key: 'magazines',
    label: 'Magazines',
    describes: 'One row per magazine, with its lifetime round count.',
    count: (s) => list(s.magazines).length,
    toText: (s, lk) => toCsvText(list(s.magazines), magazineColumns(lk)),
  },
  {
    key: 'optics',
    label: 'Optics',
    describes: 'One row per optic.',
    count: (s) => list(s.optics).length,
    toText: (s, lk) => toCsvText(list(s.optics), opticColumns(lk)),
  },
  {
    key: 'parts',
    label: 'Parts',
    describes: 'One row per part.',
    count: (s) => list(s.parts).length,
    toText: (s, lk) => toCsvText(list(s.parts), partColumns(lk)),
  },
  {
    key: 'matches',
    label: 'Matches',
    describes: 'One row per match, with your placings.',
    count: (s) => list(s.matches).length,
    toText: (s, lk) => toCsvText(list(s.matches), matchColumns(lk)),
  },
  {
    key: 'classifiers',
    label: 'Classifiers',
    describes: 'One row per classifier score.',
    count: (s) => list(s.classifiers).length,
    toText: (s) => toCsvText(list(s.classifiers), classifierColumns),
  },
  {
    key: 'goals',
    label: 'Goals',
    describes: 'One row per goal.',
    count: (s) => list(s.goals).length,
    toText: (s) => toCsvText(list(s.goals), goalColumns),
  },
  {
    key: 'drills',
    label: 'Drill library',
    describes: 'One row per drill in your library, not the ones you have run.',
    count: (s) => list(s.drills).length,
    toText: (s) => toCsvText(list(s.drills), drillLibraryColumns),
  },
];

/** Find a table by key. Returns undefined rather than throwing. */
export function csvTable(key: string): CsvTable | undefined {
  return CSV_TABLES.find((t) => t.key === key);
}
