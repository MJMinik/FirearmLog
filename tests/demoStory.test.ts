// The demo dataset's STORY ARC is a spec (DESIGN_DIRECTION §4, the story
// frame; board memo 2026-07-12): the sample log is a flash-forward of the
// user's own future, so its data must show a shooter genuinely improving,
// goals that complete only when the data earns them, and no impossible
// numbers. These tests run against the SHIPPED artifact (public/
// demo-dataset.bin), not the generator — so any regeneration must keep the
// story or fail the suite. (Seat 8's four assertions, board memo Part I.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFlog } from '../src/lib/flog.ts';
import { dryRepsForFirearm } from '../src/lib/stats.ts';

const bin = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo-dataset.bin'));
const snap = parseFlog(new Uint8Array(bin));
const stores = snap.stores as Record<string, Record<string, unknown>[]>;

type DrillRow = { name: string; time: number | null; score: number | null };
type Sess = { date: string; type: string; planned: boolean; drills?: DrillRow[] };
const sessions = (stores.sessions as unknown as Sess[])
  .filter((s) => !s.planned)
  .sort((a, b) => a.date.localeCompare(b.date));

function liveTimes(name: string): number[] {
  const out: number[] = [];
  for (const s of sessions) {
    if (s.type === 'dry_fire') continue;
    for (const d of s.drills ?? []) if (d.name === name && d.time != null) out.push(d.time);
  }
  return out;
}
const avg = (a: number[]) => a.reduce((p, c) => p + c, 0) / a.length;
// Early/late windows are guaranteed DISJOINT (audit finding: at small n a
// naive quarter window overlaps itself, letting a shared sample fake a trend).
const windowSize = (n: number) => Math.min(Math.max(2, Math.floor(n / 4)), Math.floor(n / 2));
const quarter = (a: number[]) => a.slice(0, windowSize(a.length));
const lastQuarter = (a: number[]) => a.slice(-windowSize(a.length));

// Class-appropriate floors (domain seat's table, board memo 2026-07-12).
const FLOORS: Record<string, number> = {
  'Bill Drill': 2.45, 'Draw to First Shot': 1.20, '1-Reload-1': 2.30,
  'Doubles / Hammers': 0.22, 'Transitions': 0.38, 'Wide Transitions': 0.62,
  'Box Drill': 4.0, 'Failure Drill': 2.15, 'Blake Drill': 2.40,
  'El Presidente': 6.8, 'Accelerator (Steel)': 4.9, 'Reload Practice': 1.30,
};

test('demo story: every goal-linked and dense drill IMPROVES live (late avg beats early avg)', () => {
  // The drills the story leans on hardest — trends a shooter will actually check.
  for (const name of ['Bill Drill', 'Draw to First Shot', 'Failure Drill', '1-Reload-1', 'El Presidente', 'Accelerator (Steel)', 'Box Drill', 'Transitions', 'Doubles / Hammers', 'Blake Drill']) {
    const t = liveTimes(name);
    assert.ok(t.length >= 4, `${name}: needs enough live samples to trend (got ${t.length})`);
    assert.ok(avg(lastQuarter(t)) < avg(quarter(t)),
      `${name}: late average ${avg(lastQuarter(t)).toFixed(2)} must beat early ${avg(quarter(t)).toFixed(2)} — the story is improvement`);
  }
  // Every other timed drill may lag but must not clearly REGRESS (honest texture, not decline).
  for (const name of ['Wide Transitions']) {
    const t = liveTimes(name);
    assert.ok(avg(lastQuarter(t)) <= avg(quarter(t)) * 1.05, `${name}: must not regress`);
  }
});

test('demo story: no sample ever beats the class-appropriate floor', () => {
  for (const s of sessions) {
    const dry = s.type === 'dry_fire';
    for (const d of s.drills ?? []) {
      if (d.time == null) continue;
      const floor = FLOORS[d.name];
      if (floor === undefined) continue;
      const lim = dry ? floor * 0.92 : floor;
      // Times are stored rounded to 2 decimals, so a value clamped exactly to
      // the floor can legitimately sit up to half a cent under it.
      assert.ok(d.time >= lim - 0.005,
        `${d.name} ${dry ? '(dry)' : ''} ${d.time}s beats the ${lim.toFixed(2)}s floor — an impossible number for this shooter`);
    }
  }
});

test('demo story: the classifier trail ends SOLID B — improving, and honestly short of A', () => {
  const co = (stores.classifiers as unknown as { date: string; division: string; percent: number }[])
    .filter((c) => c.division === 'Carry Optics')
    .sort((a, b) => a.date.localeCompare(b.date));
  assert.ok(co.length >= 10, 'enough CO classifiers to trend');
  const best6 = (arr: typeof co) => {
    const v = arr.map((c) => c.percent).sort((a, b) => b - a).slice(0, 6);
    return v.reduce((p, c) => p + c, 0) / v.length;
  };
  const finalAvg = best6(co.slice(-8));
  assert.ok(finalAvg >= 66 && finalAvg < 75, `final best-6-of-8 ${finalAvg.toFixed(1)} must sit in solid B (66–74.9)`);
  assert.ok(best6(co.slice(0, 8)) < finalAvg - 5, 'the trail must show a real climb');
  assert.ok(Math.max(...co.map((c) => c.percent)) < 76, 'no single score in A territory — "Make A class" must stay honestly open');
});

test('demo story: every achieved goal is EARNED by the data, on time', () => {
  type Goal = { text: string; achieved: boolean; dateSet: string; dateAchieved: string };
  const goals = stores.goals as unknown as Goal[];
  const g = (frag: string) => {
    const found = goals.find((x) => x.text.includes(frag));
    assert.ok(found, `goal "${frag}" exists`);
    return found!;
  };
  const inWindow = (d: string) => d >= '2025-01-01' && d <= '2026-07-01';

  // Steel goal: achieved exactly when the first steel match happened.
  const steel = g('Steel Challenge match');
  const firstSteel = (stores.matches as unknown as { date: string; scoringType?: string }[])
    .filter((m) => m.scoringType === 'steel').map((m) => m.date).sort()[0];
  assert.equal(steel.achieved, true);
  assert.equal(steel.dateAchieved, firstSteel);

  // B class: achieved on a date where the rolling best-6 really crosses 60.
  const b = g('Reach USPSA B class');
  assert.equal(b.achieved, true);
  assert.ok(inWindow(b.dateAchieved));
  const co = (stores.classifiers as unknown as { date: string; division: string; percent: number }[])
    .filter((c) => c.division === 'Carry Optics' && c.date <= b.dateAchieved)
    .sort((a, b2) => a.date.localeCompare(b2.date));
  const upTo = co.slice(-8).map((c) => c.percent).sort((a, b2) => b2 - a).slice(0, 6);
  assert.ok(upTo.reduce((p, c) => p + c, 0) / upTo.length >= 60, 'B-class goal date is backed by the classifier record');

  // Bill Drill goal: achieved only after the drill data actually runs sub-3.0.
  const bill = g('Bill Drill under 3.0s');
  assert.equal(bill.achieved, true, 're-tuned Bill goal completes late in the log');
  assert.ok(inWindow(bill.dateAchieved) && bill.dateAchieved > b.dateAchieved, 'a LATE payoff — beats span the whole log');
  const billBefore = [];
  for (const s of sessions) {
    if (s.type === 'dry_fire' || s.date > bill.dateAchieved) continue;
    for (const d of s.drills ?? []) if (d.name === 'Bill Drill' && d.time != null) billBefore.push(d.time);
  }
  assert.ok(avg(billBefore.slice(-3)) < 3.0, 'the last three live Bill Drills before the achieved date average under 3.0');

  // The aspirational goal is born INSIDE the log, after B falls — authorship visible.
  const a = g('Reach USPSA A class');
  assert.equal(a.achieved, false, '"Make A class" stays open — the forward pull');
  assert.ok(a.dateSet > b.dateAchieved, 'the A-class goal is set after B class is achieved');

  // Shape: payoffs AND open road, both on the sheet (board: ~3-4 done, rest open).
  const done = goals.filter((x) => x.achieved).length;
  assert.ok(done >= 3 && done <= 5, `some goals complete (${done}) …`);
  assert.ok(goals.length - done >= 3, '…and enough stay open to pull forward');
  // And no achieved goal may carry an empty or out-of-window date.
  for (const x of goals) if (x.achieved) assert.ok(x.dateAchieved && inWindow(x.dateAchieved), `${x.text}: achieved needs an earned date`);
});

test('demo story: the card\'s OTHER claims hold too — a gun getting cared for, gear and costs accounted for', () => {
  // The sample-data card promises more than trends (SetupWizard demoCard):
  // "a gun getting cared for" and "gear and costs accounted for" must be as
  // machine-true as the arc, or a regenerated demo could pass while the card lies.
  const maint = (stores.maintenance as unknown as { date: string }[]).map((m) => m.date).sort();
  assert.ok(maint.length >= 12, `a care RHYTHM needs at least a year of records (got ${maint.length})`);
  const monthsSpanned = (Date.parse(maint[maint.length - 1]) - Date.parse(maint[0])) / (30 * 86400000);
  assert.ok(monthsSpanned >= 12, `maintenance must span most of the log (${monthsSpanned.toFixed(1)} months)`);
  const purchases = stores.purchases as unknown as { cost: number }[];
  assert.ok(purchases.length >= 15, `costs accounted for needs a real purchase history (got ${purchases.length})`);
  assert.ok(purchases.every((p) => typeof p.cost === 'number' && p.cost > 0), 'every purchase carries a real cost');
});

test('demo story: the sample carries its own exit — settings ship with sampleLogLoaded', () => {
  // Session 59: the "You're exploring a sample log / Start my own log" banner
  // keys off settings.sampleLogLoaded, and the flag lives INSIDE the demo
  // dataset (make-demo.ts) — not in app code — so it can't race the load and
  // it vanishes whenever any real data replaces the log. This assertion makes
  // the exit part of the shipped artifact's contract: a regenerated demo that
  // drops the flag strands the converted explorer again, and fails here.
  const meta = stores.meta as unknown as { key: string; value: Record<string, unknown> }[];
  const settings = meta.find((m) => m.key === 'settings');
  assert.ok(settings, 'the demo ships a settings record');
  assert.equal(settings.value.sampleLogLoaded, true,
    'demo settings must carry sampleLogLoaded: true — the exit banner depends on it');
});

test('demo story: dry-fire work is real — every dry session carries reps, every dry-fired gun shows them (F5)', () => {
  // Stranger-test F5 (session 60): the round-count report showed "0 dry reps"
  // for every gun because the generator wrote rounds: 0 on dry-fire sessions.
  // The report was honest; the flash-forward was lying (the arc says this
  // shooter dry-fires twice a week). This pins the fix to the shipped artifact:
  // a regenerated demo whose dry work vanishes again fails here.
  type GunRow = { firearmId: string; rounds: number };
  const dry = (stores.sessions as unknown as (Sess & { guns: GunRow[] })[])
    .filter((s) => !s.planned && s.type === 'dry_fire');
  assert.ok(dry.length >= 20, `the arc needs a real dry-fire habit (got ${dry.length} sessions)`);
  for (const s of dry) {
    assert.ok(s.guns.length >= 1, `dry session on ${s.date} names no gun`);
    for (const g of s.guns) {
      assert.ok(g.rounds > 0, `dry session on ${s.date} carries 0 reps — the F5 lie returning`);
      assert.ok(g.rounds <= 500, `dry session on ${s.date} claims ${g.rounds} reps — implausible for one evening`);
    }
  }
  // And the number the round-count report actually prints: per-gun lifetime dry
  // reps, through the same function the app uses.
  const gunIds = [...new Set(dry.flatMap((s) => s.guns.map((g) => g.firearmId)))];
  assert.ok(gunIds.length >= 2, 'the sample should dry-fire more than one gun');
  const all = stores.sessions as unknown as (Sess & { guns: GunRow[] })[];
  for (const id of gunIds) {
    assert.ok(dryRepsForFirearm(id, all) > 0, `gun ${id} dry-fires in the data but reports 0 lifetime dry reps`);
  }
});

test('demo story: the log is dry-fire-HEAVY — total dry reps run ~3x live rounds (A5)', () => {
  // A5 (batch 2): the pre-fix demo dry-fired only ~a third of live volume —
  // backwards from a dry-fire-heavy training story (doctrine: several dry reps
  // per live round). This pins the regenerated truth: dry reps clearly dominate
  // live volume, landing near 3:1. A regenerated demo that slides back toward the
  // old 0.36:1 fails here. Per-session reps stay believable (the F5 test above
  // caps them at 500/evening).
  // Coupling note: planned sessions are excluded here, matching the totals the
  // dry-fire volume pass in scripts/make-demo.ts targets — keep the two in step.
  type GunRow = { firearmId: string; rounds: number };
  type S = { type: string; planned: boolean; guns: GunRow[] };
  const gunRounds = (s: S) => (s.guns ?? []).reduce((a, g) => a + (g.rounds || 0), 0);
  let live = 0, dry = 0;
  for (const s of stores.sessions as unknown as S[]) {
    if (s.planned) continue;
    if (s.type === 'dry_fire') dry += gunRounds(s);
    else live += gunRounds(s);
  }
  for (const m of stores.matches as unknown as { totalRounds: number | null }[]) live += m.totalRounds ?? 0;
  assert.ok(live > 0, 'the log has live volume to compare against');
  const ratio = dry / live;
  assert.ok(ratio >= 2.5 && ratio <= 3.6, `dry:live-rounds ratio ${ratio.toFixed(2)} must land near 3:1 (dry-fire-heavy)`);
  assert.ok(dry > live * 2, 'dry-fire work must clearly dominate live volume — the story is dry-fire-heavy');
});
