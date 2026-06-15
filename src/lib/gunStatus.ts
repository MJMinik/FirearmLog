// Gun lifecycle helpers (audit #10). A gun is never hard-deleted while it has
// history; instead it carries a status. A missing status field means 'active',
// so existing and imported guns need no migration.
import type { Firearm } from './types.ts';

export type GunStatus = 'active' | 'retired' | 'former';

// Reasons a gun is no longer owned (status 'former'). Retired guns you still own.
export const REMOVAL_REASONS = ['Sold', 'Gifted', 'Lost', 'Stolen', 'Destroyed'] as const;

export function gunStatus(g: Firearm): GunStatus {
  return g.status ?? 'active';
}

export const isActive = (g: Firearm): boolean => gunStatus(g) === 'active';
export const isRetired = (g: Firearm): boolean => gunStatus(g) === 'retired';
export const isFormer = (g: Firearm): boolean => gunStatus(g) === 'former';

/** Guns you still own (active or retired) — for maintenance, accessory
 *  assignment, and the insurance inventory. 'former' guns are excluded. */
export const isOwned = (g: Firearm): boolean => gunStatus(g) !== 'former';

/** Guns offered when logging a NEW session or match: active only. Pass the ids
 *  already on the record being edited (`keepIds`) so a since-retired/removed gun
 *  still appears on its own historical record. */
export function pickableGuns(list: Firearm[], keepIds: string[] = []): Firearm[] {
  const keep = new Set(keepIds);
  return list.filter((g) => isActive(g) || keep.has(g.id));
}

/** Owned guns (active + retired) plus any explicitly kept ids. For maintenance
 *  and for the Firearm dropdowns on optics / magazines / parts. */
export function ownedGuns(list: Firearm[], keepIds: string[] = []): Firearm[] {
  const keep = new Set(keepIds);
  return list.filter((g) => isOwned(g) || keep.has(g.id));
}

/** Short badge text for a non-active gun ('' for active). */
export function statusBadge(g: Firearm): string {
  const s = gunStatus(g);
  if (s === 'retired') return 'Retired';
  if (s === 'former') return g.statusReason || 'No longer owned';
  return '';
}
