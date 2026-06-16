// FirearmLog data model — spec §5.
// Plain TypeScript types only (no enums/classes) so these files also run
// under Node's type-stripping for tests.

export type GunCategory = 'Pistol' | 'Rifle' | 'Shotgun' | 'PCC' | 'Revolver' | 'Other';

export const GUN_CATEGORIES: GunCategory[] = ['Pistol', 'Rifle', 'Shotgun', 'PCC', 'Revolver', 'Other'];

/** Every record carries these — spec §3.2.3. */
export interface BaseRecord {
  id: string;
  createdAt: number; // ms epoch
  updatedAt: number; // ms epoch
}

/**
 * Fields from an imported record that the current model doesn't formally map
 * yet are preserved verbatim here — the zero-loss guarantee (spec §6).
 */
export interface Imported {
  legacy?: Record<string, unknown>;
}

export interface Firearm extends BaseRecord, Imported {
  name: string;
  manufacturer: string;
  model: string;
  caliber: string;
  category: GunCategory;
  serialNumber: string | null;
  dateAcquired: string; // YYYY-MM-DD or ''
  startingRoundCount: number;
  recoilSpringInterval?: number | null;
  recoilSpringWeight?: string | null;
  deepCleanInterval?: number | null; // per-gun override; null = use Reference/default
  barrelName?: string | null;
  barrelInstallDate?: string | null;
  barrelStartRounds?: number | null;
  photoIds: string[]; // Media records
  referenceId: string | null; // linked Reference (spec §9)
  notes: string;
  // Gun lifecycle (audit #10). Field absent ⇒ 'active' — so existing and imported
  // guns need no migration. 'retired' = still owned, benched. 'former' = no longer
  // owned (sold/gifted/lost/stolen/destroyed). Nothing is hard-deleted while it has
  // history, so past sessions/matches always resolve to a real gun.
  status?: 'active' | 'retired' | 'former';
  statusReason?: string; // 'former' only: Sold | Gifted | Lost | Stolen | Destroyed
  statusDate?: string;   // YYYY-MM-DD the gun was retired / removed
}

export interface SessionGun {
  firearmId: string;
  rounds: number;
}

/** A single gear-checklist item (default or custom). */
export interface ChecklistItem {
  id: string;
  label: string;
}

/** Per-item take/packed state, keyed by item id (firearms use `f_${firearmId}`). */
export interface ChecklistItemState {
  take?: boolean;
  packed?: boolean;
}

/** A session's gear checklist — spec for Gear Checklist feature. */
export interface SessionChecklist {
  nightMode: boolean;
  tacticalMode: boolean;
  items: Record<string, ChecklistItemState>;
}

/** User-added gear items, saved for all future sessions. */
export interface ChecklistCustomItems {
  essentials: ChecklistItem[];
  night: ChecklistItem[];
  tactical: ChecklistItem[];
}

export interface DrillResult {
  name: string; // references DrillDef.name (old-app convention, kept on import)
  distance: string;
  time: number | null;
  score: number | null;
  maxScore: number | null;
  notes: string;
}

export interface Session extends BaseRecord, Imported {
  date: string; // YYYY-MM-DD
  type: string; // 'practice' | 'dry_fire' | 'class' (old values kept verbatim)
  guns: SessionGun[]; // one or more, with per-gun round splits (spec §5.2)
  location: string;
  distances: string;
  notes: string;
  ammoUsage: { ammoId: string; rounds: number }[];
  drills: DrillResult[];
  targetMediaIds: string[];
  malfunctions: unknown[]; // formalized in M2
  selfRating: Record<string, number> | null;
  rangeFee: number | null; // first-class cost source (spec §12.2)
  planned: boolean;
  instructor?: string | null; // for Class sessions
  checklist: SessionChecklist | null;
}

export interface DrillDef extends BaseRecord, Imported {
  name: string;
  gunCategories: GunCategory[]; // spec req. 19
  fire: 'live' | 'dry' | 'both'; // spec req. 19
  briefDescription: string;
  fullDescription: string; // expandable (req. 20)
  scoring: string;
  requiresHolster: boolean;
  tags: string[];
}

export interface Ammunition extends BaseRecord, Imported {
  brand: string;
  caliber: string;
  grain: string;
  bulletType: string;
  quantity: number;
  costPerRound: number;
  notes: string;
}

export interface Purchase extends BaseRecord, Imported {
  date: string;
  category: string; // 'Ammo Purchase' | 'Range Fee' | 'Gear / Equipment' | 'Service / Repair' | 'Training / Class' | 'Travel' | 'Other'
  item: string;
  vendor: string;
  cost: number;
  notes: string;
  /** Ammo Purchase only: which can this fed (drives FIFO costing — spec §12). */
  ammoId?: string | null;
  /** Ammo Purchase only: rounds in the lot. */
  rounds?: number | null;
  /** True if saving this purchase bumped the can's on-hand count (so edits/deletes can undo it). */
  addedToInventory?: boolean;
}

export interface MaintenanceEntry extends BaseRecord, Imported {
  date: string;
  firearmId: string;
  type: string;
  performedBy: string;
  partsReplaced: string;
  notes: string;
}

export interface MalfunctionEntry extends BaseRecord, Imported {
  sessionId: string | null;
  date: string;
  firearmId: string;
  type: string;       // plain language, e.g. "Failure to feed"
  resolution: string; // what cleared it
  notes: string;
}

export interface Magazine extends BaseRecord, Imported {
  label: string;
  firearmIds: string[];
  active: boolean;
  totalRounds: number;
  springHistory: unknown[];
  notes: string;
}

export interface Optic extends BaseRecord, Imported {
  firearmId: string;
  make: string;
  model: string;
  installDate: string;
  dotSize: string;
  zeroDist: string;
  mountHeight: string;
  torqueSpec: string;
  settingsSnapshot: string;
  batteryLog: unknown[];
  notes: string;
}

export interface Part extends BaseRecord, Imported {
  firearmId: string;
  name: string;
  quantity: number;
  partNumber: string;
  datePurchased: string;
  notes: string;
  /** What you paid for this part (total). Feeds Costs & Purchases (spec §12). */
  cost?: number | null;
  vendor?: string;
}

export interface Goal extends BaseRecord, Imported {
  text: string;          // the goal, e.g. "Bill Drill under 2.0s"
  category: string;      // optional grouping, e.g. "Speed"
  target: string;        // optional target metric text
  achieved: boolean;
  dateSet: string;       // YYYY-MM-DD
  dateAchieved: string;  // '' until achieved
}

export interface SkillAssessment extends BaseRecord, Imported {
  date: string;                    // YYYY-MM-DD
  ratings: Record<string, number>; // skill-area key → 1–10
  notes: string;
}

export interface MatchStage {
  number: number;
  points: number | null;
  time: number | null;
  percent: number | null;
  notes: string;
}

export interface Match extends BaseRecord, Imported {
  date: string;
  name: string;
  matchType: string;
  division: string;
  powerFactor: string;
  firearmId: string;
  totalRounds: number | null;
  overallPlace: number | null;
  overallOf: number | null;
  divisionPlace: number | null;
  divisionOf: number | null;
  matchPercent: number | null;
  stages: MatchStage[];
  entryFee: number | null; // first-class cost source (spec §12.2)
  practiScoreUrl: string;
  notes: string;
}

export interface Classifier extends BaseRecord, Imported {
  date: string;
  code: string;
  name: string;
  division: string;
  hitFactor: number | null;
  percent: number | null;
  notes: string;
}

/** A user-made care guide (built-in guides live in code, not here). */
export interface Reference extends BaseRecord {
  name: string;
  category: GunCategory;
  deepCleanRounds: number;
  recoilSpringRounds: number | null;
  checklist: string[];
  guidance: string;
  links: { label: string; url: string }[];
}

/** Every image/video has a name and annotations — spec §5.15, req. 29. */
export interface Media extends BaseRecord {
  ownerType: 'firearm' | 'session' | 'match' | 'drill' | 'maintenance' | 'classifier';
  ownerId: string;
  kind: 'image' | 'video';
  name: string;
  annotations: string[];
  mime: string;
  /** Raw image/video bytes. ArrayBuffer (not Blob) — iPhone Safari saves these reliably. */
  data: ArrayBuffer;
  /** Drawn circle markups on the image (optional). Coordinates are 0..1 of the image. */
  marks?: Mark[];
}

/** A labeled circle drawn on a photo. Position/size are fractions (0..1) of the
 *  image, so they scale to any display size and stay put. */
export interface Mark {
  id: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  color: string;
  label: string;
}

/** Old-app trash items, carried over so nothing is lost (Q7). */
export interface TrashItem extends BaseRecord {
  recordType: string;
  deletedAt: number | string | null;
  payload: unknown;
}

export interface AppSettings {
  ownerName: string;
  theme: string;
  checklistCustomItems: ChecklistCustomItems;
  legacy?: Record<string, unknown>;
}

/** Everything the importer produces, keyed by object store. */
export interface DataSet {
  firearms: Firearm[];
  sessions: Session[];
  drills: DrillDef[];
  ammunition: Ammunition[];
  purchases: Purchase[];
  maintenance: MaintenanceEntry[];
  malfunctions: BaseRecord[];
  magazines: Magazine[];
  optics: Optic[];
  parts: Part[];
  goals: Goal[];
  skills: SkillAssessment[];
  matches: Match[];
  classifiers: Classifier[];
  references: Reference[];
  media: Media[];
  trash: TrashItem[];
}
