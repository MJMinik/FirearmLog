// The seven printable reports, extracted from ReportsScreen (menu-bar work,
// July 2026) so the desktop menu bar's Reports menu and the Reports screen share
// ONE code path (spec §0: no forked logic). Each builder is a pure function of
// the loaded data bundle; presenting is split from building so the popup window
// can be opened INSIDE the user's click (synchronously — otherwise iOS and
// popup blockers kill it) while the data loads and the page is written after.
// This is the same window-first pattern ReportsScreen already used for the
// photo-heavy insurance report, now applied uniformly.
import type {
  Ammunition, Classifier, DrillDef, Firearm, Goal, Magazine, Match, MalfunctionEntry,
  MaintenanceEntry, Media, Optic, Part, Purchase, Reference, Session
} from '../lib/types.ts';
import { GUN_CATEGORIES } from '../lib/types.ts';
import { canonicalDivision, formatClassPct } from '../lib/competition.ts';
import { getAll, getAllMediaWholeStore } from '../lib/db.ts';
import { activeOnly, activeMalfunctions, trashedIdSet } from '../lib/softDelete.ts';
import { formatDayKey, todayKey } from '../lib/dates.ts';
import { roundsForFirearm, dryRepsForFirearm, totalRounds } from '../lib/stats.ts';
import { costTotals, gunOwnershipSpend, gunSpend, roundsFired, matchFee } from '../lib/costing.ts';
import { allClassifications, personalRecords, formatDrillScore } from '../lib/dashboard.ts';
import { goalStats } from '../lib/goals.ts';
import { ratePerThousand } from '../lib/trends.ts';
import { maintenanceAlerts } from '../lib/maintenance.ts';
import { buildRefLookup } from '../lib/referenceData.ts';
import { buildReportHtml, type ReportSection } from '../lib/reports.ts';
import { reportImageUrls } from './reportImages.ts';
import { isOwned } from '../lib/gunStatus.ts';
import { ammoLabel } from './AmmoScreens.tsx';
import { labelOrRemoved } from '../lib/lookup.ts';

export interface ReportBundle {
  firearms: Firearm[]; sessions: Session[]; matches: Match[]; purchases: Purchase[];
  ammo: Ammunition[]; classifiers: Classifier[]; malfunctions: MalfunctionEntry[];
  maintenance: MaintenanceEntry[]; references: Reference[]; drills: DrillDef[];
  goals: Goal[]; media: Media[]; parts: Part[]; magazines: Magazine[];
  // Optics joined the bundle 27 Aug 2026: the Costs report's gun & gear table
  // sums each gun's optic price, and nothing else here had ever needed them.
  optics: Optic[];
}

export interface ReportResult { title: string; subtitle: string; sections: ReportSection[] }

const n = (x: number) => x.toLocaleString();
const money = (x: number) => '$' + x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Load everything the reports read — the same live-data-only rules the
 *  Reports screen applies (trashed sessions and their malfunctions excluded). */
export async function loadReportBundle(): Promise<ReportBundle> {
  const [firearms, sessions, matches, purchases, ammo, classifiers, malfunctions, maintenance, references, drills, goals, media, parts, magazines, optics] =
    await Promise.all([
      getAll<Firearm>('firearms'), getAll<Session>('sessions'), getAll<Match>('matches'),
      getAll<Purchase>('purchases'), getAll<Ammunition>('ammunition'), getAll<Classifier>('classifiers'),
      getAll<MalfunctionEntry>('malfunctions'), getAll<MaintenanceEntry>('maintenance'),
      getAll<Reference>('references'), getAll<DrillDef>('drills'), getAll<Goal>('goals'),
      getAllMediaWholeStore(), getAll<Part>('parts'), getAll<Magazine>('magazines'),
      getAll<Optic>('optics')
    ]);
  // App 7: every report works off live data only.
  const liveSessions = activeOnly(sessions);
  const liveMalfs = activeMalfunctions(malfunctions, trashedIdSet(sessions));
  return { firearms, sessions: liveSessions, matches, purchases, ammo, classifiers, malfunctions: liveMalfs, maintenance, references, drills, goals, media, parts, magazines, optics };
}

/** Open the report window NOW (inside the click, so it's never popup-blocked)
 *  with a friendly placeholder; returns null when a blocker still refuses. */
export function openReportWindow(): Window | null {
  const win = window.open('', '_blank');
  if (!win) return null;
  win.document.write('<!doctype html><meta charset="utf-8"><body style="font:15px -apple-system,Arial,sans-serif;padding:40px;color:#555">Preparing report…</body>');
  return win;
}

/** Write the finished report into an already-opened window and offer print. */
export function presentReport(win: Window, r: ReportResult): void {
  win.document.open();
  win.document.write(buildReportHtml(r.title, r.subtitle, r.sections));
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

/** The it-went-wrong path for an already-opened window (never throws). */
export function reportFailed(win: Window): void {
  try { win.document.body.textContent = 'Sorry — could not build this report. Please try again.'; } catch { /* window already closed */ }
}

const gunName = (d: ReportBundle, id: string) => d.firearms.find((f) => f.id === id)?.name ?? '—';

export function roundCountReport(d: ReportBundle): ReportResult {
  const perGun = d.firearms.map((f) => [
    f.name, f.category,
    n(roundsForFirearm(f.id, d.firearms, d.sessions, d.matches)),
    n(dryRepsForFirearm(f.id, d.sessions))
  ]);
  const byCat = GUN_CATEGORIES.map((c) => {
    const rounds = d.firearms.filter((f) => f.category === c)
      .reduce((s, f) => s + roundsForFirearm(f.id, d.firearms, d.sessions, d.matches), 0);
    return { category: c, rounds };
  }).filter((x) => x.rounds > 0);
  return { title: 'Round Count', subtitle: `As of ${formatDayKey(todayKey())}`, sections: [
    { heading: 'Per Gun', table: { headers: ['Gun', 'Type', 'Rounds', 'Dry reps'], rows: perGun } },
    { heading: 'By Category', rows: byCat.map((x) => ({ label: x.category, value: n(x.rounds) })) },
    { heading: 'Total', rows: [{ label: 'Lifetime rounds (all guns)', value: n(totalRounds(d.firearms, d.sessions, d.matches)) }] }
  ] };
}

export function costsReport(d: ReportBundle): ReportResult {
  const year = todayKey().slice(0, 4);
  const inYear = <T extends { date: string }>(rows: T[]) => rows.filter((r) => r.date.startsWith(year));
  const partCosts = d.parts;
  const all = costTotals(d.sessions, d.purchases, d.matches, partCosts);
  const ytd = costTotals(inYear(d.sessions), inYear(d.purchases), inYear(d.matches), partCosts.filter((p) => (p.datePurchased || '').startsWith(year)));
  const fired = roundsFired(d.sessions, d.matches);
  const totalsRows = (t: typeof all) => [
    { label: 'Firearms', value: money(t.firearms) },
    { label: 'Ammo bought', value: money(t.ammoBought) },
    { label: 'Range fees', value: money(t.rangeFees) },
    { label: 'Match fees', value: money(t.matchFees) },
    { label: 'Spare parts', value: money(t.parts) },
    { label: 'Gear & other', value: money(t.gearAndOther) },
    { label: 'Total', value: money(t.total) }
  ];
  const spend = d.firearms.map((f) => ({ f, g: gunSpend(f.id, d.sessions, d.purchases, d.matches, d.ammo, partCosts) }))
    .filter((x) => x.g.total > 0);
  // The printed page carries BOTH per-gun answers, one under the other, because
  // it cannot carry the screen's checkbox (Michael's call, 27 Aug 2026). Each
  // table says in a note what it counts and what it leaves out, since two
  // similar-looking money tables on one page are exactly where a reader guesses.
  const ownership = d.firearms
    .map((f) => ({ f, g: gunOwnershipSpend(f.id, d.sessions, d.purchases, d.ammo, d.firearms, d.optics, partCosts) }))
    .filter((x) => x.g.total > 0);
  return { title: 'Costs', subtitle: `Year ${year} and all-time`, sections: [
    { heading: `This Year (${year})`, rows: totalsRows(ytd) },
    { heading: 'All Time', rows: totalsRows(all) },
    { heading: 'All-In Cost', rows: [{ label: 'Cost per round fired', value: fired > 0 ? '$' + (all.total / fired).toFixed(3) : '—' }] },
    { heading: 'Ammo & fees per gun',
      note: 'What it has cost to shoot each gun: its share of ammo and range fees, its match fees, and spare parts bought for it.',
      table: { headers: ['Gun', 'Ammo', 'Range', 'Matches', 'Parts', 'Total'],
        rows: spend.map((x) => [x.f.name, money(x.g.ammo), money(x.g.rangeFees), money(x.g.matchFees), money(x.g.parts), money(x.g.total)]) } },
    { heading: 'Gun & gear cost per gun',
      note: 'What it has cost to own and feed each gun: what you paid for the gun and its optic, spare parts, gear and service bought for it, and its share of ammo. Range fees and match fees are not counted here — they are in the totals above.',
      table: { headers: ['Gun', 'Ammo', 'The gun', 'Optic', 'Parts', 'Gear & service', 'Total'],
        rows: ownership.map((x) => [x.f.name, money(x.g.ammo), money(x.g.gun), money(x.g.optic), money(x.g.parts), money(x.g.linked), money(x.g.total)]) } }
  ] };
}

export function seasonReport(d: ReportBundle): ReportResult {
  const year = todayKey().slice(0, 4);
  const yMatches = d.matches.filter((m) => (m.date || '').startsWith(year));
  return { title: 'Competition Season', subtitle: `${year}`, sections: [
    { heading: 'Matches', table: { headers: ['Date', 'Match', 'Type', 'Div', 'Place', '%', 'Fee'],
      rows: yMatches.map((m) => [
        m.date ? formatDayKey(m.date) : '—', m.name || 'Match', m.matchType || '—', canonicalDivision(m.division) || '—',
        m.overallPlace != null ? String(m.overallPlace) : '—',
        m.matchPercent != null ? m.matchPercent.toFixed(1) + '%' : '—', money(matchFee(m))
      ]) } },
    { heading: 'Classification by Division', rows: allClassifications(d.classifiers).map((c) => ({
      label: c.division, value: (c.average != null ? formatClassPct(c.average) : '—') + (c.currentClass ? ` · ${c.currentClass}` : '')
    })) }
  ] };
}

export function trainingSummaryReport(d: ReportBundle): ReportResult {
  const live = d.sessions.filter((s) => !s.planned && s.type !== 'dry_fire');
  const dry = d.sessions.filter((s) => !s.planned && s.type === 'dry_fire');
  const liveRounds = totalRounds(d.firearms, d.sessions, d.matches);
  const dryReps = d.firearms.reduce((s, f) => s + dryRepsForFirearm(f.id, d.sessions), 0);
  const prs = personalRecords(d.sessions, d.drills).filter((p) => p.best).slice(0, 10);
  const gs = goalStats(d.goals);
  return { title: 'Training Summary', subtitle: `As of ${formatDayKey(todayKey())}`, sections: [
    { heading: 'Activity', rows: [
      { label: 'Live / class sessions', value: n(live.length) },
      { label: 'Dry-fire sessions', value: n(dry.length) },
      { label: 'Lifetime rounds', value: n(liveRounds) },
      { label: 'Dry-fire reps', value: n(dryReps) }
    ] },
    { heading: 'Personal Records', table: { headers: ['Drill', 'Best', 'Attempts'],
      rows: prs.map((p) => [p.name, formatDrillScore(p.best, p.scoring), String(p.attempts)]) } },
    { heading: 'Goals', rows: [{ label: 'Open', value: String(gs.open) }, { label: 'Achieved', value: String(gs.achieved) }] }
  ] };
}

export function malfunctionsReport(d: ReportBundle): ReportResult {
  // App 3a: malfunctions carry optional ammo / magazine / round-number context,
  // so the report breaks down by those too and lists each one. A table cell with
  // no ammo/magazine shows a dash; a deleted record reads "(removed)".
  const ammoName = (id?: string | null) => labelOrRemoved(d.ammo, id, ammoLabel, '—');
  const magName = (id?: string | null) => labelOrRemoved(d.magazines, id, (mg) => mg.label, '—');

  const byGun = new Map<string, number>();
  const byType = new Map<string, number>();
  const byAmmo = new Map<string, number>();
  const byMag = new Map<string, number>();
  for (const m of d.malfunctions) {
    byGun.set(m.firearmId, (byGun.get(m.firearmId) ?? 0) + 1);
    byType.set(m.type || 'Other', (byType.get(m.type || 'Other') ?? 0) + 1);
    if (m.ammoId) byAmmo.set(m.ammoId, (byAmmo.get(m.ammoId) ?? 0) + 1);
    if (m.magazineId) byMag.set(m.magazineId, (byMag.get(m.magazineId) ?? 0) + 1);
  }
  const rounds = totalRounds(d.firearms, d.sessions, d.matches);
  const rate = ratePerThousand(d.malfunctions.length, rounds);
  const recent = [...d.malfunctions].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 30);
  return { title: 'Malfunctions', subtitle: `As of ${formatDayKey(todayKey())}`, sections: [
    { heading: 'Summary', rows: [
      { label: 'Total malfunctions', value: n(d.malfunctions.length) },
      { label: 'Per 1,000 rounds', value: rate != null ? rate.toFixed(1) : '—' }
    ] },
    { heading: 'By Gun', rows: [...byGun.entries()].map(([id, c]) => ({ label: gunName(d, id), value: n(c) })) },
    { heading: 'By Type', rows: [...byType.entries()].map(([t, c]) => ({ label: t, value: n(c) })) },
    ...(byAmmo.size ? [{ heading: 'By Ammo', rows: [...byAmmo.entries()].map(([id, c]) => ({ label: ammoName(id), value: n(c) })) }] : []),
    ...(byMag.size ? [{ heading: 'By Magazine', rows: [...byMag.entries()].map(([id, c]) => ({ label: magName(id), value: n(c) })) }] : []),
    ...(recent.length ? [{ heading: 'Recent Malfunctions', table: {
      headers: ['Date', 'Gun', 'Type', 'Ammo', 'Magazine', 'Round'],
      rows: recent.map((m) => [
        m.date ? formatDayKey(m.date) : '—', gunName(d, m.firearmId), m.type || '—',
        ammoName(m.ammoId), magName(m.magazineId), m.roundCount != null ? String(m.roundCount) : '—'
      ]) } }] : [])
  ] };
}

export function maintenanceReport(d: ReportBundle): ReportResult {
  const refOf = buildRefLookup(d.references);
  const due = maintenanceAlerts(d.firearms, refOf, d.sessions, d.maintenance, new Date());
  const recent = [...d.maintenance].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 25);
  return { title: 'Maintenance History', subtitle: `As of ${formatDayKey(todayKey())}`, sections: [
    { heading: 'Due / Approaching', rows: due.length
      ? due.map((a) => ({ label: `${a.gunName} — ${a.item.label}`, value: a.item.level === 'due' ? 'Due' : 'Soon' }))
      : [{ label: 'Nothing due', value: '✓' }] },
    { heading: 'Recent Work', table: { headers: ['Date', 'Gun', 'Type', 'Notes'],
      rows: recent.map((m) => [m.date ? formatDayKey(m.date) : '—', gunName(d, m.firearmId), m.type || '—', m.notes || '']) } }
  ] };
}

export async function insuranceReport(d: ReportBundle): Promise<ReportResult> {
  const sections: ReportSection[] = [];
  // Audit #10: insurance inventory lists guns you still own (active + retired),
  // not ones you've sold/lost/etc.
  for (const f of d.firearms.filter(isOwned)) {
    sections.push({
      heading: f.name,
      rows: [
        { label: 'Manufacturer', value: f.manufacturer || '—' },
        { label: 'Model', value: f.model || '—' },
        { label: 'Caliber', value: f.caliber || '—' },
        { label: 'Category', value: f.category },
        { label: 'Serial number', value: f.serialNumber || '—' },
        { label: 'Date acquired', value: f.dateAcquired ? formatDayKey(f.dateAcquired) : '—' }
      ],
      images: await reportImageUrls(d.media, 'firearm', f.id)
    });
  }
  return { title: 'Insurance Inventory', subtitle: `As of ${formatDayKey(todayKey())}`, sections };
}

/** The launchable report list — the single source both the Reports screen and
 *  the desktop menu bar render from, in this order. */
export const REPORTS: {
  label: string; desc: string;
  build: (d: ReportBundle) => ReportResult | Promise<ReportResult>;
}[] = [
  { label: 'Round Count', desc: 'Lifetime + by gun and category', build: roundCountReport },
  { label: 'Costs', desc: 'By category, cost per round, spend by gun', build: costsReport },
  { label: 'Competition Season', desc: 'Matches, finishes, classification', build: seasonReport },
  { label: 'Training Summary', desc: 'Sessions, rounds, PRs, goals', build: trainingSummaryReport },
  { label: 'Malfunctions', desc: 'By gun, type, ammo, magazine; rate per 1,000', build: malfunctionsReport },
  { label: 'Maintenance History', desc: "What's due + recent work", build: maintenanceReport },
  { label: 'Insurance Inventory', desc: 'Guns, serials, photos', build: insuranceReport }
];

/** One call does the whole menu-path launch: window now, data + build after.
 *  Returns false when the popup was blocked (caller shows the plain-language
 *  message it already uses). */
export function launchReport(build: (d: ReportBundle) => ReportResult | Promise<ReportResult>): boolean {
  const win = openReportWindow();
  if (!win) return false;
  loadReportBundle()
    .then((d) => Promise.resolve(build(d)))
    .then((r) => presentReport(win, r))
    .catch(() => reportFailed(win));
  return true;
}
