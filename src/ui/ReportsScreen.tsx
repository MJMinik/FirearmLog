// Reports hub (spec §13). Generates each report as a printable page (Save as
// PDF from the print dialog), assembled from the already-tested data helpers.
import { useEffect, useState } from 'react';
import type {
  Ammunition, Classifier, DrillDef, Firearm, Goal, Match, MalfunctionEntry,
  MaintenanceEntry, Media, Part, Purchase, Reference, Session
} from '../lib/types.ts';
import { GUN_CATEGORIES } from '../lib/types.ts';
import { getAll } from '../lib/db.ts';
import { formatDayKey, todayKey } from '../lib/dates.ts';
import { roundsForFirearm, dryRepsForFirearm, totalRounds } from '../lib/stats.ts';
import { costTotals, gunSpend, roundsFired, matchFee } from '../lib/costing.ts';
import { allClassifications, personalRecords, formatDrillScore } from '../lib/dashboard.ts';
import { goalStats } from '../lib/goals.ts';
import { ratePerThousand } from '../lib/trends.ts';
import { maintenanceAlerts } from '../lib/maintenance.ts';
import { buildRefLookup } from '../lib/referenceData.ts';
import { buildReportHtml, type ReportSection } from '../lib/reports.ts';
import { reportImageUrls } from './reportImages.ts';

interface Bundle {
  firearms: Firearm[]; sessions: Session[]; matches: Match[]; purchases: Purchase[];
  ammo: Ammunition[]; classifiers: Classifier[]; malfunctions: MalfunctionEntry[];
  maintenance: MaintenanceEntry[]; references: Reference[]; drills: DrillDef[];
  goals: Goal[]; media: Media[]; parts: Part[];
}

const n = (x: number) => x.toLocaleString();
const money = (x: number) => '$' + x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ReportsScreen({ refreshKey, onBack }: { refreshKey: number; onBack: () => void }) {
  const [data, setData] = useState<Bundle | null>(null);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [firearms, sessions, matches, purchases, ammo, classifiers, malfunctions, maintenance, references, drills, goals, media, parts] =
        await Promise.all([
          getAll<Firearm>('firearms'), getAll<Session>('sessions'), getAll<Match>('matches'),
          getAll<Purchase>('purchases'), getAll<Ammunition>('ammunition'), getAll<Classifier>('classifiers'),
          getAll<MalfunctionEntry>('malfunctions'), getAll<MaintenanceEntry>('maintenance'),
          getAll<Reference>('references'), getAll<DrillDef>('drills'), getAll<Goal>('goals'),
          getAll<Media>('media'), getAll<Part>('parts')
        ]);
      if (!alive) return;
      setData({ firearms, sessions, matches, purchases, ammo, classifiers, malfunctions, maintenance, references, drills, goals, media, parts });
    })();
    return () => { alive = false; };
  }, [refreshKey]);

  if (!data) return <div className="screen" />;
  const d = data;
  const year = todayKey().slice(0, 4);
  const gunName = (id: string) => d.firearms.find((f) => f.id === id)?.name ?? '—';

  function open(title: string, subtitle: string, sections: ReportSection[]) {
    const html = buildReportHtml(title, subtitle, sections);
    const win = window.open('', '_blank');
    if (!win) { setProblem('Pop-ups blocked — please allow pop-ups and try again.'); return; }
    win.document.write(html); win.document.close(); win.focus();
    setTimeout(() => win.print(), 400);
  }

  // For reports that embed photos: open the window now (inside the tap, so iOS
  // doesn't block it as a pop-up), show a "Preparing…" note, then write the real
  // page once the images have been downscaled.
  function openAsync(title: string, subtitle: string, build: () => Promise<ReportSection[]>) {
    const win = window.open('', '_blank');
    if (!win) { setProblem('Pop-ups blocked — please allow pop-ups and try again.'); return; }
    win.document.write('<!doctype html><meta charset="utf-8"><body style="font:15px -apple-system,Arial,sans-serif;padding:40px;color:#555">Preparing report…</body>');
    build().then((sections) => {
      win.document.open();
      win.document.write(buildReportHtml(title, subtitle, sections));
      win.document.close(); win.focus();
      setTimeout(() => win.print(), 400);
    }).catch(() => {
      try { win.document.body.textContent = 'Sorry — could not build this report. Please try again.'; } catch { /* window already closed */ }
    });
  }

  function roundCountReport() {
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
    open('Round Count', `As of ${formatDayKey(todayKey())}`, [
      { heading: 'Per Gun', table: { headers: ['Gun', 'Type', 'Rounds', 'Dry reps'], rows: perGun } },
      { heading: 'By Category', rows: byCat.map((x) => ({ label: x.category, value: n(x.rounds) })) },
      { heading: 'Total', rows: [{ label: 'Lifetime rounds (all guns)', value: n(totalRounds(d.firearms, d.sessions, d.matches)) }] }
    ]);
  }

  function costsReport() {
    const inYear = <T extends { date: string }>(rows: T[]) => rows.filter((r) => r.date.startsWith(year));
    const partCosts = d.parts;
    const all = costTotals(d.sessions, d.purchases, d.matches, partCosts);
    const ytd = costTotals(inYear(d.sessions), inYear(d.purchases), inYear(d.matches), partCosts.filter((p) => (p.datePurchased || '').startsWith(year)));
    const fired = roundsFired(d.sessions, d.matches);
    const totalsRows = (t: typeof all) => [
      { label: 'Ammo bought', value: money(t.ammoBought) },
      { label: 'Range fees', value: money(t.rangeFees) },
      { label: 'Match fees', value: money(t.matchFees) },
      { label: 'Spare parts', value: money(t.parts) },
      { label: 'Gear & other', value: money(t.gearAndOther) },
      { label: 'Total', value: money(t.total) }
    ];
    const spend = d.firearms.map((f) => ({ f, g: gunSpend(f.id, d.sessions, d.purchases, d.matches, d.ammo, partCosts) }))
      .filter((x) => x.g.total > 0);
    open('Costs', `Year ${year} and all-time`, [
      { heading: `This Year (${year})`, rows: totalsRows(ytd) },
      { heading: 'All Time', rows: totalsRows(all) },
      { heading: 'All-In Cost', rows: [{ label: 'Cost per round fired', value: fired > 0 ? '$' + (all.total / fired).toFixed(3) : '—' }] },
      { heading: 'Spend by Gun', table: { headers: ['Gun', 'Ammo', 'Range', 'Matches', 'Parts', 'Total'],
        rows: spend.map((x) => [x.f.name, money(x.g.ammo), money(x.g.rangeFees), money(x.g.matchFees), money(x.g.parts), money(x.g.total)]) } }
    ]);
  }

  function seasonReport() {
    const yMatches = d.matches.filter((m) => (m.date || '').startsWith(year));
    open('Competition Season', `${year}`, [
      { heading: 'Matches', table: { headers: ['Date', 'Match', 'Type', 'Div', 'Place', '%', 'Fee'],
        rows: yMatches.map((m) => [
          m.date ? formatDayKey(m.date) : '—', m.name || 'Match', m.matchType || '—', m.division || '—',
          m.overallPlace != null ? String(m.overallPlace) : '—',
          m.matchPercent != null ? m.matchPercent.toFixed(1) + '%' : '—', money(matchFee(m))
        ]) } },
      { heading: 'Classification by Division', rows: allClassifications(d.classifiers).map((c) => ({
        label: c.division, value: (c.average != null ? c.average.toFixed(1) + '%' : '—') + (c.currentClass ? ` · ${c.currentClass}` : '')
      })) }
    ]);
  }

  function trainingSummaryReport() {
    const live = d.sessions.filter((s) => !s.planned && s.type !== 'dry_fire');
    const dry = d.sessions.filter((s) => !s.planned && s.type === 'dry_fire');
    const liveRounds = totalRounds(d.firearms, d.sessions, d.matches);
    const dryReps = d.firearms.reduce((s, f) => s + dryRepsForFirearm(f.id, d.sessions), 0);
    const prs = personalRecords(d.sessions, d.drills).filter((p) => p.best).slice(0, 10);
    const gs = goalStats(d.goals);
    open('Training Summary', `As of ${formatDayKey(todayKey())}`, [
      { heading: 'Activity', rows: [
        { label: 'Live / class sessions', value: n(live.length) },
        { label: 'Dry-fire sessions', value: n(dry.length) },
        { label: 'Lifetime rounds', value: n(liveRounds) },
        { label: 'Dry-fire reps', value: n(dryReps) }
      ] },
      { heading: 'Personal Records', table: { headers: ['Drill', 'Best', 'Attempts'],
        rows: prs.map((p) => [p.name, formatDrillScore(p.best, p.scoring), String(p.attempts)]) } },
      { heading: 'Goals', rows: [{ label: 'Open', value: String(gs.open) }, { label: 'Achieved', value: String(gs.achieved) }] }
    ]);
  }

  function malfunctionsReport() {
    const byGun = new Map<string, number>();
    const byType = new Map<string, number>();
    for (const m of d.malfunctions) {
      byGun.set(m.firearmId, (byGun.get(m.firearmId) ?? 0) + 1);
      byType.set(m.type || 'Other', (byType.get(m.type || 'Other') ?? 0) + 1);
    }
    const rounds = totalRounds(d.firearms, d.sessions, d.matches);
    const rate = ratePerThousand(d.malfunctions.length, rounds);
    open('Malfunctions', `As of ${formatDayKey(todayKey())}`, [
      { heading: 'Summary', rows: [
        { label: 'Total malfunctions', value: n(d.malfunctions.length) },
        { label: 'Per 1,000 rounds', value: rate != null ? rate.toFixed(1) : '—' }
      ] },
      { heading: 'By Gun', rows: [...byGun.entries()].map(([id, c]) => ({ label: gunName(id), value: n(c) })) },
      { heading: 'By Type', rows: [...byType.entries()].map(([t, c]) => ({ label: t, value: n(c) })) }
    ]);
  }

  function maintenanceReport() {
    const refOf = buildRefLookup(d.references);
    const due = maintenanceAlerts(d.firearms, refOf, d.sessions, d.maintenance, new Date());
    const recent = [...d.maintenance].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 25);
    open('Maintenance History', `As of ${formatDayKey(todayKey())}`, [
      { heading: 'Due / Approaching', rows: due.length
        ? due.map((a) => ({ label: `${a.gunName} — ${a.item.label}`, value: a.item.level === 'due' ? 'Due' : 'Soon' }))
        : [{ label: 'Nothing due', value: '✓' }] },
      { heading: 'Recent Work', table: { headers: ['Date', 'Gun', 'Type', 'Notes'],
        rows: recent.map((m) => [m.date ? formatDayKey(m.date) : '—', gunName(m.firearmId), m.type || '—', m.notes || '']) } }
    ]);
  }

  function insuranceReport() {
    openAsync('Insurance Inventory', `As of ${formatDayKey(todayKey())}`, async () => {
      const sections: ReportSection[] = [];
      for (const f of d.firearms) {
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
      return sections;
    });
  }

  const reports: { label: string; run: () => void; desc: string }[] = [
    { label: 'Round Count', run: roundCountReport, desc: 'Lifetime + by gun and category' },
    { label: 'Costs', run: costsReport, desc: 'By category, cost per round, spend by gun' },
    { label: 'Competition Season', run: seasonReport, desc: 'Matches, finishes, classification' },
    { label: 'Training Summary', run: trainingSummaryReport, desc: 'Sessions, rounds, PRs, goals' },
    { label: 'Malfunctions', run: malfunctionsReport, desc: 'By gun and type, rate per 1,000' },
    { label: 'Maintenance History', run: maintenanceReport, desc: "What's due + recent work" },
    { label: 'Insurance Inventory', run: insuranceReport, desc: 'Guns, serials, photos' }
  ];

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Reports</h1>
      {problem && <p className="form-problem">{problem}</p>}
      <p className="report-note">Each opens a printable page — use your browser's "Save as PDF" to keep a copy.</p>
      <div className="card">
        {reports.map((r) => (
          <button className="row-tap" key={r.label} onClick={r.run}>
            <span className="label">{r.label}<div className="row-sub">{r.desc}</div></span>
            <span className="value">🖨️</span>
          </button>
        ))}
      </div>
      <p className="report-note">A single-session report is on each session — open a session and tap "Session Report".</p>
    </div>
  );
}
