// Shared presentation for the one battery verdict (lib/opticBattery.ts) across
// the three badge sites (Optics screen, Parts screen, Gun Detail) and the
// Optics screen's expanded card. Kept in ONE place, deliberately, so the
// wording and colour can never drift between screens again — that is the
// entire point of OPTIC_BATTERY_INTEGRATION_SPEC.md. Exact strings/classes
// from spec §5.
//
// Pure presentation only (badge text + CSS modifier class) — no DOM, no
// IndexedDB — so it sits in ui/ rather than lib/opticBattery.ts. (That module
// was pass-1/verified and originally out of scope for pass 2; an adversarial
// audit in round 2 found real bugs in it — a date-parser disagreement and a
// "newest entry" pick that could get stuck on garbage input — and the
// coordinator explicitly authorized fixing those in place. See the comments
// at opticBatteryStatus and batteryChangeRollForward for what changed and why.)
import type { OpticBatteryStatus } from '../lib/opticBattery.ts';
import type { Reminder } from '../lib/types.ts';
import { formatDayKey } from '../lib/dates.ts';

export interface OpticBatteryBadge {
  text: string;
  /** Badge modifier class, e.g. `badge ${cls}`. */
  cls: 'warn-badge' | 'info' | 'ok';
}

/** The Optics/Parts screen badge for one optic's battery verdict. */
export function opticBatteryBadge(status: OpticBatteryStatus): OpticBatteryBadge {
  switch (status.kind) {
    case 'reminder':
      if (status.level === 'due') return { text: 'Battery due', cls: 'warn-badge' };
      if (status.level === 'soon') return { text: 'Battery due soon', cls: 'info' };
      return { text: 'Active', cls: 'ok' };
    case 'age-due':
      return { text: 'Battery due', cls: 'warn-badge' };
    case 'ok':
      return { text: 'Active', cls: 'ok' };
    case 'no-log':
      return { text: 'No battery log', cls: 'info' };
  }
}

/** Gun Detail's optic sub-line — same words as the badge, except NO-LOG reads
 *  differently there (spec §5: "No battery changes logged", no badge shown). */
export function opticBatterySubline(status: OpticBatteryStatus): string {
  if (status.kind === 'no-log') return 'No battery changes logged';
  return opticBatteryBadge(status).text;
}

/**
 * The Log Battery Change sheet's note about what saving is about to do to
 * the governing reminder (spec §4, Decision 3-A), given the patch
 * `batteryChangeRollForward` would apply — null when saving won't touch any
 * reminder.
 *
 * Covers BOTH branches of a real patch, not just one (finding 3, audit round
 * 2): a repeating reminder's `dueDate` moving forward, AND a non-repeating
 * reminder's silent pause (`{ enabled: false, lastDoneDate }` — no `dueDate`
 * at all). Before this fix the note only fired on `patch?.dueDate`, so a
 * governed one-off reminder paused on save with no visible sign at all that
 * saving the battery entry had also marked it done.
 */
export function batteryChangeMoveNote(patch: Partial<Reminder> | null): string | null {
  if (!patch) return null;
  if (typeof patch.dueDate === 'string' && patch.dueDate !== '') {
    return `Saving this also moves the battery reminder to ${formatDayKey(patch.dueDate)}.`;
  }
  if (patch.enabled === false) {
    return 'Saving this also marks the battery reminder done.';
  }
  return null;
}
