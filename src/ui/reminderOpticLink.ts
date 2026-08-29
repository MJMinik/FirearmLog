// Pure guard for whether a NEW reminder created via an optic's "Set a
// battery reminder" button should have its opticId link stamped onto the
// record being saved (spec §4; finding 6, audit round 2).
//
// Extracted out of RemindersScreen.tsx's ReminderForm/persistForm purely so
// it is unit-testable without a DOM/JSX harness. Mirrors the guard already
// used on the sibling legacy-upgrade path a few lines below it in
// persistForm (skip the stamp when the gun field was changed in this same
// edit — a stale match must never get stamped onto the wrong optic), plus
// one guard that path didn't need: a round-count-triggered reminder has no
// due date for reminderGovernsOptic to evaluate, so stamping a link onto one
// would be meaningless.
import type { Reminder } from '../lib/types.ts';

export function shouldStampNewOpticLink(
  initialOpticId: string | undefined,
  loadedFirearmId: string | undefined,
  currentFirearmId: string,
  trigger: Reminder['trigger'],
): boolean {
  if (!initialOpticId) return false;
  if (trigger !== 'date') return false;
  return currentFirearmId === (loadedFirearmId ?? '');
}
