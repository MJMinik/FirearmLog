// Groups the drill library by the skill each drill trains, for the Drills
// screen (board memo DRILL_GROUPING_BOARD_MEMO_2026-09-10, decisions 1-5 all
// (a)). Seven built-in sections, in the order the memo's §1 table gives them,
// plus an eighth "Custom" section shown last and only when it actually holds
// a drill.
//
// The built-in 22's section is looked up here from each drill's fixed,
// permanent `drs-` id — nothing is stored on the built-in records themselves
// (decision 4). A custom drill's section comes from its own optional
// DrillDef.skill field (decision 2), defaulting to Custom when that field is
// blank or names a skill the app doesn't recognize.
import { stockDrillId } from './stockDrills.ts';
import type { DrillDef, DrillSkill } from './types.ts';

interface SkillGroupInfo { label: string; sub: string }

/** Labels and sub-lines, the memo's §1 table verbatim (board memo 10 Sep
 *  2026) plus Movement (session 145). Words a newcomer already half-knows from the range (Seat 9's point,
 *  §4), never house terms invented for this screen. */
export const SKILL_GROUPS: Readonly<Record<DrillSkill, SkillGroupInfo>> = {
  draw: { label: 'Draw', sub: 'First shot off the beep' },
  reloads: { label: 'Reloads', sub: 'Keeping the gun fed' },
  transitions: { label: 'Transitions', sub: 'Target to target, fast and clean' },
  movement: { label: 'Movement', sub: 'Into and out of positions' },
  recoilSplits: { label: 'Recoil control / Splits', sub: 'Follow-up shots, flat and fast' },
  accuracyTrigger: { label: 'Accuracy / Trigger control', sub: 'Fundamentals under pressure' },
  stageSkills: { label: 'Stage skills / Match simulation', sub: 'Putting it all together' },
  steelChallenge: { label: 'Steel Challenge stages', sub: 'The eight official plate stages' },
};

/** Section order, decision 5: the board's seven, with Movement (added 11 Sep
 *  2026, session 145, Michael's "3a": his library has a footwork drill, so the
 *  section the board dropped for lack of one exists after all) slotted after
 *  Transitions, moving the gun then moving the shooter. Custom (below) is
 *  always shown after these, never among them. None of the built-in 22 maps
 *  to Movement, so a fresh install still shows seven sections. */
export const SKILL_ORDER: readonly DrillSkill[] = [
  'draw', 'reloads', 'transitions', 'movement', 'recoilSplits',
  'accuracyTrigger', 'stageSkills', 'steelChallenge',
];

/** The eighth, unofficial section: a custom drill with no skill picked (or a
 *  value the app doesn't recognize), shown last and only when non-empty. */
export const CUSTOM_GROUP: SkillGroupInfo = { label: 'Custom', sub: 'Your own drills, not yet grouped' };

// The board's §1 table, all 22 built-in drills, ONE skill each — matched by
// NAME here only so this table reads the same as the memo (and so a typo in
// a name is obvious at a glance); groupForDrill below never looks names up,
// only the fixed id computed from each name via stockDrillId, exactly as the
// memo's §4 warns ("Accelerator (Steel)", generic practice, must never be
// confused with the real "Steel Challenge: Accelerator" stage — matching by
// name text alone could not tell those apart, matching by id always can).
const BUILTIN_SKILL_BY_NAME: Readonly<Record<string, DrillSkill>> = {
  'Draw to First Shot': 'draw',
  '1-Reload-1': 'reloads',
  'Reload Practice': 'reloads',
  'Accelerator (Steel)': 'transitions',
  'Blake Drill': 'transitions',
  'Box Drill': 'transitions',
  'Failure Drill': 'transitions',
  'Transitions': 'transitions',
  'Wide Transitions': 'transitions',
  'Bill Drill': 'recoilSplits',
  'Doubles / Hammers': 'recoilSplits',
  'Dot Torture': 'accuracyTrigger',
  'Precision Slow Fire': 'accuracyTrigger',
  'El Presidente': 'stageSkills',
  'Steel Challenge: Five to Go': 'steelChallenge',
  'Steel Challenge: Showdown': 'steelChallenge',
  'Steel Challenge: Smoke & Hope': 'steelChallenge',
  'Steel Challenge: Outer Limits': 'steelChallenge',
  'Steel Challenge: Accelerator': 'steelChallenge',
  'Steel Challenge: Pendulum': 'steelChallenge',
  'Steel Challenge: Speed Option': 'steelChallenge',
  'Steel Challenge: Roundabout': 'steelChallenge',
};

/** id -> skill, the ONLY table groupForDrill actually consults for a
 *  built-in drill. Derived from BUILTIN_SKILL_BY_NAME above via the same
 *  stockDrillId() slug rule stockDrills.ts uses to make every built-in id, so
 *  this can never drift from the ids the library actually seeds. */
const BUILTIN_SKILL_BY_ID: Readonly<Record<string, DrillSkill>> = Object.fromEntries(
  Object.entries(BUILTIN_SKILL_BY_NAME).map(([name, skill]) => [stockDrillId(name), skill])
);

function isSkillKey(v: unknown): v is DrillSkill {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SKILL_GROUPS, v);
}

/** Which section a drill belongs to. A built-in (`drs-`) id is looked up in
 *  BUILTIN_SKILL_BY_ID above, in code, every render — nothing stored on the
 *  record decides it (decision 4). Anything else uses its own `skill` field
 *  when that names a real key, else falls back to 'custom'. */
export function groupForDrill(d: DrillDef): DrillSkill | 'custom' {
  const builtin = BUILTIN_SKILL_BY_ID[d.id];
  if (builtin) return builtin;
  return isSkillKey(d.skill) ? d.skill : 'custom';
}

export interface DrillGroupSection {
  key: DrillSkill | 'custom';
  label: string;
  sub: string;
  drills: DrillDef[];
}

/**
 * Buckets `drills` into the board's seven sections plus Custom. Each
 * section's drills are sorted alphabetically (localeCompare, matching the
 * flat list's own prior sort). Empty sections are omitted entirely — a
 * search that only matches one section should show only that section — and
 * Custom is appended last, only when it actually holds a drill.
 */
export function groupDrills(drills: readonly DrillDef[]): DrillGroupSection[] {
  const buckets = new Map<DrillSkill | 'custom', DrillDef[]>();
  for (const d of drills) {
    const key = groupForDrill(d);
    const list = buckets.get(key);
    if (list) list.push(d); else buckets.set(key, [d]);
  }
  const sortedCopy = (list: DrillDef[]) => [...list].sort((a, b) => a.name.localeCompare(b.name));
  const sections: DrillGroupSection[] = [];
  for (const key of SKILL_ORDER) {
    const list = buckets.get(key);
    if (list?.length) sections.push({ key, ...SKILL_GROUPS[key], drills: sortedCopy(list) });
  }
  const custom = buckets.get('custom');
  if (custom?.length) sections.push({ key: 'custom', ...CUSTOM_GROUP, drills: sortedCopy(custom) });
  return sections;
}
