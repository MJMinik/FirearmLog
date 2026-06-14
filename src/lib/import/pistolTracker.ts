// Pistol Tracker importer (spec §6). Pure logic — no IndexedDB, no DOM —
// so the exact same code runs in the app and in the automated tests (rule X2).
// Accepts both the old JSON backup and pistol-tracker-sync.json formats forever.

import type {
  Ammunition, Classifier, DataSet, DrillDef, Firearm, Goal, GunCategory,
  Magazine, MaintenanceEntry, Match, Media, Optic, Part, Purchase,
  Session, SessionGun, SkillAssessment, TrashItem
} from '../types.ts';
import { newId } from '../id.ts';
import { roundsForFirearm } from '../stats.ts';
import { normalizeChecklist } from '../checklist.ts';

// ---------- What the old file looks like (only what we rely on) ----------

interface OldFile {
  _lastModified?: number;
  firearms?: OldRecord[];
  sessions?: OldRecord[];
  drillLibrary?: OldRecord[];
  ammunition?: OldRecord[];
  purchases?: OldRecord[];
  maintenance?: OldRecord[];
  malfunctions?: OldRecord[];
  magazines?: OldRecord[];
  optics?: OldRecord[];
  parts?: OldRecord[];
  goals?: OldRecord[];
  skillAssessments?: OldRecord[];
  matches?: OldRecord[];
  classifiers?: OldRecord[];
  trash?: OldRecord[];
  settings?: Record<string, unknown>;
}

type OldRecord = Record<string, unknown>;

/** Throws a plain-language Error if this isn't a Pistol Tracker file. */
export function parseOldFile(text: string): OldFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't readable as a Pistol Tracker backup. Pick the JSON file Pistol Tracker saved.");
  }
  const obj = parsed as OldFile;
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.firearms) || !Array.isArray(obj.sessions)) {
    throw new Error("That file doesn't look like a Pistol Tracker backup — it's missing the guns and sessions data.");
  }
  return obj;
}

// ---------- Category guessing (spec §6.3) ----------

export function guessCategory(fa: OldRecord): GunCategory {
  const text = `${fa.manufacturer ?? ''} ${fa.model ?? ''} ${fa.name ?? ''}`.toLowerCase();
  if (/shotgun|870|mossberg|benelli|stoeger|a300|a400|1301|m2 field|sbe/.test(text)) return 'Shotgun';
  if (/\bpcc\b|mpx|scorpion|sub.?2000|cmmg|9mm carbine/.test(text)) return 'PCC';
  if (/revolver|python|anaconda|gp100|686|627|j.?frame/.test(text)) return 'Revolver';
  if (/rifle|ar.?15|ar.?10|m4\b|bcm|daniel defense|aero precision|carbine/.test(text)) return 'Rifle';
  return 'Pistol';
}

// ---------- Media ----------

function dataUrlToBytes(dataUrl: string): { buffer: ArrayBuffer; mime: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const mime = m[1];
  const binary = atob(m[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { buffer: bytes.buffer, mime };
}

// ---------- Small helpers ----------

/** Split an old record into the fields we map and a `legacy` bag of the rest (zero loss). */
function takeRest(old: OldRecord, mappedKeys: string[]): Record<string, unknown> | undefined {
  const rest: Record<string, unknown> = {};
  let any = false;
  for (const k of Object.keys(old)) {
    if (!mappedKeys.includes(k)) {
      rest[k] = old[k];
      any = true;
    }
  }
  return any ? rest : undefined;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function stamp<T extends object>(record: T, id: string, at: number): T & { id: string; createdAt: number; updatedAt: number } {
  return { ...record, id, createdAt: at, updatedAt: at };
}

// ---------- The verification math (spec §6.4) ----------
// This replicates the OLD app's firearmRoundCount(): starting count
// + per-session rounds (splits win over the single firearmId; planned
// sessions don't count) + match rounds. ONE deliberate change from the old
// app: dry-fire sessions are skipped on BOTH sides of the comparison —
// dry reps aren't rounds fired (Michael, June 11, 2026), and the new
// round math (stats.ts) excludes them too.

export function oldStyleRoundCount(old: OldFile, firearmId: string): number {
  const fa = (old.firearms ?? []).find(f => f.id === firearmId);
  if (!fa) return 0;
  let total = num(fa.startingRoundCount);
  for (const s of old.sessions ?? []) {
    if (s.planned || s.type === 'dry_fire') continue;
    const splits = arr(s.firearmSplits) as { firearmId?: string; rounds?: number }[];
    if (splits.length) {
      const split = splits.find(sp => sp.firearmId === firearmId);
      if (split) total += num(split.rounds);
    } else if (s.firearmId === firearmId) {
      total += num(s.totalRounds);
    }
  }
  for (const m of old.matches ?? []) {
    if (m.firearmId === firearmId && m.totalRounds) total += num(m.totalRounds);
  }
  return total;
}

/** Round count computed from the NEW records — must equal the old number. */
export function newStyleRoundCount(data: DataSet, firearmId: string): number {
  return roundsForFirearm(firearmId, data.firearms, data.sessions, data.matches);
}

export interface CountRow { label: string; inCount: number; outCount: number; ok: boolean; }
export interface GunRow { firearmId: string; name: string; oldRounds: number; newRounds: number; ok: boolean; }

export interface VerificationReport {
  counts: CountRow[];
  guns: GunRow[];
  imagesIn: number;
  imagesOut: number;
  imagesOk: boolean;
  allOk: boolean;
}

// ---------- The import itself ----------

export interface ImportResult {
  data: DataSet;
  settings: Record<string, unknown> | undefined;
  report: VerificationReport;
}

/**
 * Transform an old Pistol Tracker file into FirearmLog records.
 * `categories` is the user-confirmed category per firearm id (spec §6.3);
 * pass {} to accept the guesses.
 */
export function importPistolTracker(
  old: OldFile,
  categories: Record<string, GunCategory>,
  now: number
): ImportResult {
  const media: Media[] = [];

  const addMedia = (
    ownerType: Media['ownerType'], ownerId: string, dataUrl: unknown, name: string, seq: number
  ): string | null => {
    if (typeof dataUrl !== 'string') return null;
    const converted = dataUrlToBytes(dataUrl);
    if (!converted) return null;
    // Deterministic ID: importing the same file twice overwrites instead of duplicating.
    const rec: Media = stamp({
      ownerType, ownerId,
      kind: 'image' as const,
      name,
      annotations: [],
      mime: converted.mime,
      data: converted.buffer
    }, `md-${ownerId}-${seq}`, now);
    media.push(rec);
    return rec.id;
  };

  // Firearms — old IDs preserved so cross-references survive (spec §6.2).
  let imagesIn = 0;
  const firearms: Firearm[] = (old.firearms ?? []).map(f => {
    const id = String(f.id);
    const photos = arr(f.insurancePhotos);
    imagesIn += photos.length;
    const photoIds = photos
      .map((p, i) => addMedia('firearm', id, p, `${str(f.name)} — insurance photo ${i + 1}`, i))
      .filter((x): x is string => x !== null);
    const mapped = ['id', 'name', 'manufacturer', 'model', 'caliber', 'serialNumber', 'dateAcquired',
      'startingRoundCount', 'recoilSpringInterval', 'recoilSpringWeight', 'barrelName',
      'barrelInstallDate', 'barrelStartRounds', 'insurancePhotos', 'notes'];
    return stamp({
      name: str(f.name),
      manufacturer: str(f.manufacturer),
      model: str(f.model),
      caliber: str(f.caliber),
      category: categories[id] ?? guessCategory(f),
      serialNumber: typeof f.serialNumber === 'string' ? f.serialNumber : null,
      dateAcquired: str(f.dateAcquired),
      startingRoundCount: num(f.startingRoundCount),
      recoilSpringInterval: numOrNull(f.recoilSpringInterval),
      recoilSpringWeight: typeof f.recoilSpringWeight === 'string' ? f.recoilSpringWeight : null,
      deepCleanInterval: numOrNull(f.deepCleanInterval),
      barrelName: typeof f.barrelName === 'string' ? f.barrelName : null,
      barrelInstallDate: typeof f.barrelInstallDate === 'string' ? f.barrelInstallDate : null,
      barrelStartRounds: numOrNull(f.barrelStartRounds),
      photoIds,
      referenceId: null,
      notes: str(f.notes),
      legacy: takeRest(f, mapped)
    }, id, now);
  });

  // Sessions — firearmSplits (when present) win over the single firearmId,
  // exactly like the old app counted rounds.
  const sessions: Session[] = (old.sessions ?? []).map(s => {
    const id = String(s.id);
    const splits = arr(s.firearmSplits) as { firearmId?: unknown; rounds?: unknown }[];
    const guns: SessionGun[] = splits.length
      ? splits.map(sp => ({ firearmId: String(sp.firearmId), rounds: num(sp.rounds) }))
      : [{ firearmId: String(s.firearmId), rounds: num(s.totalRounds) }];
    const images = arr(s.targetImages);
    imagesIn += images.length;
    const targetMediaIds = images
      .map((p, i) => addMedia('session', id, p, `Target photo ${i + 1} — ${str(s.date)}`, i))
      .filter((x): x is string => x !== null);
    const mapped = ['id', 'date', 'type', 'firearmId', 'firearmSplits', 'multiFirearm', 'location',
      'distances', 'notes', 'ammoUsage', 'drills', 'targetImages', 'malfunctions', 'selfRating',
      'rangeFee', 'planned', 'checklist', 'totalRounds'];
    return stamp({
      date: str(s.date),
      type: str(s.type) || 'practice',
      guns,
      location: str(s.location),
      distances: str(s.distances),
      notes: str(s.notes),
      ammoUsage: (arr(s.ammoUsage) as { ammoId?: unknown; rounds?: unknown }[])
        .map(a => ({ ammoId: String(a.ammoId), rounds: num(a.rounds) })),
      drills: (arr(s.drills) as OldRecord[]).map(d => ({
        name: str(d.name),
        distance: str(d.distance),
        time: numOrNull(d.time),
        score: numOrNull(d.score),
        maxScore: numOrNull(d.maxScore),
        notes: str(d.notes)
      })),
      targetMediaIds,
      malfunctions: arr(s.malfunctions),
      selfRating: (s.selfRating && typeof s.selfRating === 'object') ? s.selfRating as Record<string, number> : null,
      rangeFee: numOrNull(s.rangeFee),
      planned: s.planned === true,
      checklist: normalizeChecklist(s.checklist),
      legacy: takeRest(s, mapped)
    }, id, now);
  });

  // Drill library — old drills have no IDs (name was the key), so each gets a
  // stable ID derived from its name: re-importing overwrites, never duplicates.
  // Pistol Tracker drills are pistol drills; user can broaden categories later.
  const drillId = (name: string) =>
    'dr-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const drills: DrillDef[] = (old.drillLibrary ?? []).map(d => {
    const live = d.liveCompatible !== false;
    const dry = d.dryCompatible === true;
    const mapped = ['name', 'description', 'scoring', 'requiresHolster', 'liveCompatible', 'dryCompatible', 'category'];
    return stamp({
      name: str(d.name),
      gunCategories: ['Pistol' as GunCategory],
      fire: (live && dry ? 'both' : dry ? 'dry' : 'live') as DrillDef['fire'],
      briefDescription: str(d.description),
      fullDescription: '',
      scoring: str(d.scoring),
      requiresHolster: d.requiresHolster === true,
      tags: typeof d.category === 'string' && d.category ? [d.category] : [],
      legacy: takeRest(d, mapped)
    }, drillId(str(d.name)), now);
  });

  const ammunition: Ammunition[] = (old.ammunition ?? []).map(a => stamp({
    brand: str(a.brand),
    caliber: str(a.caliber),
    grain: str(a.grain),
    bulletType: str(a.bulletType),
    quantity: num(a.quantity),
    costPerRound: num(a.costPerRound),
    notes: str(a.notes),
    legacy: takeRest(a, ['id', 'brand', 'caliber', 'grain', 'bulletType', 'quantity', 'costPerRound', 'notes'])
  }, String(a.id), now));

  const purchases: Purchase[] = (old.purchases ?? []).map(p => stamp({
    date: str(p.date),
    category: str(p.category),
    item: str(p.item),
    vendor: str(p.vendor),
    cost: num(p.cost),
    notes: str(p.notes),
    ammoId: typeof p.ammoId === 'string' && p.ammoId ? p.ammoId : null,
    rounds: numOrNull(p.rounds),
    addedToInventory: p.addToInventory === true,
    legacy: takeRest(p, ['id', 'date', 'category', 'item', 'vendor', 'cost', 'notes', 'ammoId', 'rounds', 'addToInventory'])
  }, String(p.id), now));

  const maintenance: MaintenanceEntry[] = (old.maintenance ?? []).map(m => stamp({
    date: str(m.date),
    firearmId: str(m.firearmId),
    type: str(m.type),
    performedBy: str(m.performedBy),
    partsReplaced: str(m.partsReplaced),
    notes: str(m.notes),
    legacy: takeRest(m, ['id', 'date', 'firearmId', 'type', 'performedBy', 'partsReplaced', 'notes'])
  }, String(m.id), now));

  const magazines: Magazine[] = (old.magazines ?? []).map(m => stamp({
    label: str(m.label),
    firearmIds: (arr(m.firearmIds)).map(String),
    active: m.active !== false,
    totalRounds: num(m.totalRounds),
    springHistory: arr(m.springHistory),
    notes: str(m.notes),
    legacy: takeRest(m, ['id', 'label', 'firearmIds', 'active', 'totalRounds', 'springHistory', 'notes'])
  }, String(m.id), now));

  const optics: Optic[] = (old.optics ?? []).map(o => stamp({
    firearmId: str(o.firearmId),
    make: str(o.make),
    model: str(o.model),
    installDate: str(o.installDate),
    dotSize: str(o.dotSize),
    zeroDist: str(o.zeroDist),
    mountHeight: str(o.mountHeight),
    torqueSpec: str(o.torqueSpec),
    settingsSnapshot: str(o.settingsSnapshot),
    batteryLog: arr(o.batteryLog),
    notes: str(o.notes),
    legacy: takeRest(o, ['id', 'firearmId', 'make', 'model', 'installDate', 'dotSize', 'zeroDist', 'mountHeight', 'torqueSpec', 'settingsSnapshot', 'batteryLog', 'notes'])
  }, String(o.id), now));

  const parts: Part[] = (old.parts ?? []).map(p => stamp({
    firearmId: str(p.firearmId),
    name: str(p.name),
    quantity: num(p.quantity),
    partNumber: str(p.partNumber),
    datePurchased: str(p.datePurchased),
    notes: str(p.notes),
    legacy: takeRest(p, ['id', 'firearmId', 'name', 'quantity', 'partNumber', 'datePurchased', 'notes'])
  }, String(p.id), now));

  // Generic carry-over for types FirearmLog formalizes in later milestones.
  const carry = (records: OldRecord[] | undefined, prefix: string) =>
    (records ?? []).map(r => stamp(
      { ...r, legacy: undefined },
      typeof r.id === 'string' && r.id ? String(r.id) : newId(prefix),
      now
    ));

  const goals = carry(old.goals, 'go') as unknown as Goal[];
  const skills = carry(old.skillAssessments, 'sk') as unknown as SkillAssessment[];
  const matches = carry(old.matches, 'mt') as unknown as Match[];
  const classifiers = carry(old.classifiers, 'cl') as unknown as Classifier[];

  const trash: TrashItem[] = (old.trash ?? []).map(t => stamp({
    recordType: str(t.type) || 'unknown',
    deletedAt: (typeof t.deletedAt === 'number' || typeof t.deletedAt === 'string') ? t.deletedAt : null,
    payload: t.data ?? t
  }, typeof t.id === 'string' && t.id ? `tr-${t.id}` : newId('tr'), now));

  const data: DataSet = {
    firearms, sessions, drills, ammunition, purchases, maintenance,
    malfunctions: carry(old.malfunctions, 'mf'),
    magazines, optics, parts, goals, skills, matches, classifiers,
    references: [], media, trash
  };

  // ----- Verification report (spec §6.4): import isn't done until this matches -----
  const countRow = (label: string, inCount: number, outCount: number): CountRow =>
    ({ label, inCount, outCount, ok: inCount === outCount });

  const counts: CountRow[] = [
    countRow('Guns', (old.firearms ?? []).length, firearms.length),
    countRow('Sessions', (old.sessions ?? []).length, sessions.length),
    countRow('Drills', (old.drillLibrary ?? []).length, drills.length),
    countRow('Ammo types', (old.ammunition ?? []).length, ammunition.length),
    countRow('Purchases', (old.purchases ?? []).length, purchases.length),
    countRow('Maintenance entries', (old.maintenance ?? []).length, maintenance.length),
    countRow('Malfunctions', (old.malfunctions ?? []).length, data.malfunctions.length),
    countRow('Magazines', (old.magazines ?? []).length, magazines.length),
    countRow('Optics', (old.optics ?? []).length, optics.length),
    countRow('Parts', (old.parts ?? []).length, parts.length),
    countRow('Goals', (old.goals ?? []).length, goals.length),
    countRow('Skill check-ins', (old.skillAssessments ?? []).length, skills.length),
    countRow('Matches', (old.matches ?? []).length, matches.length),
    countRow('Classifiers', (old.classifiers ?? []).length, classifiers.length),
    countRow('Trash items', (old.trash ?? []).length, trash.length)
  ];

  const guns: GunRow[] = firearms.map(f => {
    const oldRounds = oldStyleRoundCount(old, f.id);
    const newRounds = newStyleRoundCount(data, f.id);
    return { firearmId: f.id, name: f.name, oldRounds, newRounds, ok: oldRounds === newRounds };
  });

  const report: VerificationReport = {
    counts,
    guns,
    imagesIn,
    imagesOut: media.length,
    imagesOk: imagesIn === media.length,
    allOk: counts.every(c => c.ok) && guns.every(g => g.ok) && imagesIn === media.length
  };

  return { data, settings: old.settings, report };
}
