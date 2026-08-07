// Maintenance schedule engine (spec §5.9, §9.3). Mirrors the old app's rules:
// deep clean by round count (warning at 90%), field strip after live sessions,
// annual inspection at 12 months, recoil spring by round count. Intervals come
// from the gun itself, else its linked Reference, else sensible defaults.
// Pure logic — fully unit tested.

import type { Firearm, MaintenanceEntry, Session } from './types.ts';
import type { ReferenceEntry } from './referenceData.ts';
import { roundsForFirearm } from './stats.ts';

export const DEFAULT_DEEP_CLEAN_ROUNDS = 10000;

export const MAINT_TYPES = [
  { value: 'field_strip', label: 'Field Strip' },
  { value: 'deep_clean', label: 'Deep Clean' },
  { value: 'annual_inspection', label: 'Annual Inspection' },
  { value: 'recoil_spring', label: 'Recoil Spring' },
  { value: 'mag_springs', label: 'Mag Springs' },
  { value: 'other', label: 'Other' }
] as const;

export function maintLabel(type: string): string {
  const known = MAINT_TYPES.find((t) => t.value === type)?.label;
  if (known) return known;
  // Humanize any unmapped id (legacy/imported/demo, e.g. 'spring_change' → 'Spring change')
  // so a raw snake_case id never reaches the user.
  const words = type.replace(/_+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : type;
}

export type MaintLevel = 'ok' | 'info' | 'warn' | 'due';

export interface MaintItem {
  type: string;
  label: string;
  level: MaintLevel;
  detail: string;
}

/** Rounds this gun fired in live (not dry, not planned) sessions strictly after a date.
 * Dry-fire reps are NOT rounds fired (C-1) — same rule as stats.roundsForFirearm
 * and liveSessionsSince below, so a schedule never advances on reps. */
export function roundsSince(date: string, gunId: string, sessions: Session[]): number {
  let total = 0;
  for (const s of sessions) {
    if (s.planned || s.type === 'dry_fire' || s.date <= date) continue;
    for (const g of s.guns) if (g.firearmId === gunId) total += g.rounds;
  }
  return total;
}

/** Live-fire sessions (not dry, not planned) for this gun strictly after a date. */
export function liveSessionsSince(date: string, gunId: string, sessions: Session[]): number {
  return sessions.filter((s) =>
    !s.planned && s.type !== 'dry_fire' && s.date > date &&
    s.guns.some((g) => g.firearmId === gunId)
  ).length;
}

export interface ScheduleSource {
  deepCleanRounds: number;
  recoilSpringRounds: number | null;
}

/** Gun override wins, then the linked Reference, then defaults. */
export function resolveSchedule(gun: Firearm, ref: ReferenceEntry | undefined): ScheduleSource {
  return {
    deepCleanRounds: gun.deepCleanInterval ?? ref?.maintenance.deepCleanRounds ?? DEFAULT_DEEP_CLEAN_ROUNDS,
    recoilSpringRounds: gun.recoilSpringInterval ?? ref?.maintenance.recoilSpringRounds ?? null
  };
}

export function maintenanceStatus(
  gun: Firearm,
  ref: ReferenceEntry | undefined,
  sessions: Session[],
  maintenance: MaintenanceEntry[],
  firearms: Firearm[],
  now: Date
): MaintItem[] {
  const mine = maintenance
    .filter((m) => m.firearmId === gun.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const last = (type: string) => mine.find((m) => m.type === type);
  const schedule = resolveSchedule(gun, ref);
  const items: MaintItem[] = [];

  // Deep clean — by rounds.
  const lastDeep = last('deep_clean');
  const sinceDeep = lastDeep
    ? roundsSince(lastDeep.date, gun.id, sessions)
    : roundsForFirearm(gun.id, firearms, sessions, []);
  const dc = schedule.deepCleanRounds;
  items.push({
    type: 'deep_clean', label: 'Deep clean',
    level: sinceDeep >= dc ? 'due' : sinceDeep >= dc * 0.9 ? 'warn' : 'ok',
    detail: `${sinceDeep.toLocaleString()} of ${dc.toLocaleString()} rounds since last deep clean`
  });

  // Field strip — after any live session.
  const lastFS = last('field_strip');
  const sessionsAfter = liveSessionsSince(lastFS ? lastFS.date : '0000-00-00', gun.id, sessions);
  items.push({
    type: 'field_strip', label: 'Field strip',
    level: sessionsAfter > 1 ? 'warn' : sessionsAfter === 1 ? 'info' : 'ok',
    detail: sessionsAfter === 0
      ? 'Clean since the last live session'
      : `${sessionsAfter} live session${sessionsAfter !== 1 ? 's' : ''} since the last field strip`
  });

  // Annual inspection — by calendar.
  const annual = last('annual_inspection');
  if (!annual) {
    items.push({
      type: 'annual_inspection', label: 'Annual inspection',
      level: 'info', detail: 'No annual inspection logged yet'
    });
  } else {
    const months = (now.getTime() - new Date(annual.date + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24 * 30);
    items.push({
      type: 'annual_inspection', label: 'Annual inspection',
      level: months > 12 ? 'warn' : 'ok',
      detail: months > 12 ? `Last done ${annual.date} — over a year ago` : `Last done ${annual.date}`
    });
  }

  // Recoil spring — by rounds, only when an interval exists.
  if (schedule.recoilSpringRounds) {
    const lastRS = last('recoil_spring');
    const sinceRS = lastRS
      ? roundsSince(lastRS.date, gun.id, sessions)
      : roundsForFirearm(gun.id, firearms, sessions, []);
    const rs = schedule.recoilSpringRounds;
    items.push({
      type: 'recoil_spring', label: 'Recoil spring',
      level: sinceRS >= rs ? 'due' : sinceRS >= rs * 0.9 ? 'warn' : 'ok',
      detail: `${sinceRS.toLocaleString()} of ${rs.toLocaleString()} rounds on this spring`
    });
  }

  return items;
}

export interface Alert { firearmId: string; gunName: string; item: MaintItem; }

/** Everything due or approaching, across all guns — for the Home screen. */
export function maintenanceAlerts(
  firearms: Firearm[],
  refOf: (id: string | null) => ReferenceEntry | undefined,
  sessions: Session[],
  maintenance: MaintenanceEntry[],
  now: Date
): Alert[] {
  const alerts: Alert[] = [];
  for (const gun of firearms) {
    for (const item of maintenanceStatus(gun, refOf(gun.referenceId), sessions, maintenance, firearms, now)) {
      if (item.level === 'due' || item.level === 'warn') {
        alerts.push({ firearmId: gun.id, gunName: gun.name, item });
      }
    }
  }
  return alerts.sort((a, b) => (a.item.level === 'due' ? 0 : 1) - (b.item.level === 'due' ? 0 : 1));
}
