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
import { scoreIdpaStage, scoreStageHits, hitFactor } from '../src/lib/competition.ts';

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

// ===================== IDPA CLUB MATCH THREAD (session 75, July 23 2026) =====================
// The board-approved IDPA side-story: a solid-but-crossing-over B-class USPSA shooter
// tries IDPA on the DR920 in Carry Optics, starting rough and genuinely improving,
// with one honest mid-thread wobble — same story-frame discipline as the drill/
// classifier arcs above, pinned against the SHIPPED artifact so a regeneration can't
// silently lose or flatten it.
type IdpaStage = {
  time: number | null;
  idpaDown1?: number | null; idpaDown3?: number | null; idpaMisses?: number | null;
  idpaNonThreatHits?: number | null; idpaProceduralErrors?: number | null;
  idpaFlagrantPenalties?: number | null; idpaFailureToDoRight?: number | null;
};
type IdpaMatch = {
  date: string; name: string; division: string; scoringType?: string;
  matchType: string; firearmId: string; totalRounds: number | null;
  divisionPlace: number | null; divisionOf: number | null;
  entryFee: number | null; stages: IdpaStage[];
};
function idpaPointsDownAndPenalties(m: IdpaMatch): { pointsDown: number; hasPenalty: boolean } {
  let pointsDown = 0;
  let hasPenalty = false;
  for (const st of m.stages) {
    const s = scoreIdpaStage(st);
    pointsDown += s.pointsDown;
    if (s.nonThreatHits || s.proceduralErrors || s.flagrantPenalties || s.failureToDoRight) hasPenalty = true;
  }
  return { pointsDown, hasPenalty };
}

test('demo story: the IDPA thread — at least 3 matches spanning 9+ months, improving, with an honest mid-thread wobble', () => {
  const idpa = (stores.matches as unknown as IdpaMatch[])
    .filter((m) => m.scoringType === 'idpa')
    .sort((a, b) => a.date.localeCompare(b.date));
  assert.ok(idpa.length >= 3, `needs at least 3 IDPA matches (got ${idpa.length})`);
  const spanMonths = (Date.parse(idpa[idpa.length - 1].date) - Date.parse(idpa[0].date)) / (30 * 86400000);
  assert.ok(spanMonths >= 9, `IDPA thread must span at least 9 months (got ${spanMonths.toFixed(1)})`);

  // Every leg: DR920, Carry Optics (CO), unranked (no matchPercent — IDPA has no
  // percent scoring in this app), IDPA Match type, entry fee and rounds present.
  for (const m of idpa) {
    assert.equal(m.firearmId, 'fa-dr920', `${m.date}: IDPA match must be on the DR920`);
    assert.equal(m.division, 'Carry Optics (CO)', `${m.date}: must use the IDPA division label`);
    assert.equal(m.matchType, 'IDPA Match');
    assert.ok(typeof m.entryFee === 'number' && m.entryFee > 0, `${m.date}: needs an entry fee`);
    assert.ok(typeof m.totalRounds === 'number' && m.totalRounds > 0, `${m.date}: needs rounds fired`);
    assert.ok(m.divisionPlace !== null && m.divisionOf !== null && m.divisionPlace <= m.divisionOf,
      `${m.date}: needs a plausible division finish`);
  }

  const rounds = idpa.map((m) => idpaPointsDownAndPenalties(m));
  // Total points down improves from the first match to the last.
  assert.ok(rounds[rounds.length - 1].pointsDown < rounds[0].pointsDown,
    `points down must fall from the first IDPA match (${rounds[0].pointsDown}) to the last (${rounds[rounds.length - 1].pointsDown})`);
  // The honest-wobble rule: at least one mid-thread match (not the first, not the
  // last) either breaks the monotone improving trend or carries a penalty.
  let wobbleFound = false;
  for (let i = 1; i < idpa.length - 1; i++) {
    const worseThanPrev = rounds[i].pointsDown > rounds[i - 1].pointsDown;
    if (worseThanPrev || rounds[i].hasPenalty) wobbleFound = true;
  }
  assert.ok(wobbleFound, 'a mid-thread IDPA match must break the trend or carry a penalty — an honest arc, not a straight line');

  // No IDPA classifier/rank record exists anywhere — this shooter stays unranked
  // in IDPA on purpose. stores.classifiers is USPSA-only; assert it stays that way.
  const classifiers = stores.classifiers as unknown as { division: string }[];
  const idpaDivisionNames = ['Stock Service Pistol', 'Enhanced Service Pistol', 'Custom Defensive Pistol',
    'Compact Carry Pistol', 'Revolver (REV)', 'Backup Gun (BUG)', 'Carry Optics (CO)'];
  for (const c of classifiers) {
    assert.ok(!idpaDivisionNames.includes(c.division), `no IDPA-division classifier/rank record may exist (found ${c.division})`);
  }
});

test('demo story: the marketing-site invariant records are untouched by the IDPA addition', () => {
  type UspsaStage = { number: number; time: number | null; percent: number | null; points: number | null;
    alphas?: number | null; charlies?: number | null; deltas?: number | null;
    misses?: number | null; noShoots?: number | null; procedurals?: number | null };
  type UMatch = { date: string; name: string; powerFactor: string; matchPercent: number | null;
    divisionPlace: number | null; divisionOf: number | null; stages: UspsaStage[] };
  const matches = stores.matches as unknown as UMatch[];

  // Cypress Creek Range Club Match, Jun 6 2026 — exact stage breakdown + 92% + 2 of 15.
  const cc = matches.find((m) => m.date === '2026-06-06' && m.name === 'Cypress Creek Range Club Match');
  assert.ok(cc, 'Cypress Creek Range Club Match Jun 6 2026 must still exist');
  const ccExpected = ['65/9.12/7.1272/73.7', '70/23.55/2.9724/70.6', '56/7.55/7.4172/92', '91/13.24/6.8731/86.4'];
  const ccActual = cc!.stages.map((st) => {
    const score = scoreStageHits(st, cc!.powerFactor, st.time);
    const points = score ? score.stagePoints : st.points; // legacy aggregate stage (no hit breakdown)
    const hf = hitFactor(points, st.time); // same derivation the app uses either way
    return `${points}/${st.time}/${hf}/${st.percent}`;
  });
  assert.deepEqual(ccActual, ccExpected, 'Cypress Creek Jun 6 2026 stage breakdown must be byte-identical');
  assert.equal(cc!.matchPercent, 92);
  assert.equal(cc!.divisionPlace, 2);
  assert.equal(cc!.divisionOf, 15);

  // Gator Classic, Feb 21 2026 — 4 of 20, 84.6%.
  const gc = matches.find((m) => m.date === '2026-02-21' && m.name === 'Gator Classic');
  assert.ok(gc, 'Gator Classic Feb 21 2026 must still exist');
  assert.equal(gc!.divisionPlace, 4);
  assert.equal(gc!.divisionOf, 20);
  assert.equal(gc!.matchPercent, 84.6);

  // Rimfire Steel Blast, Apr 19 2025 — all string times unchanged.
  type SteelStage = { strings?: (number | null)[] };
  const rf = (stores.matches as unknown as { date: string; name: string; stages: SteelStage[] }[])
    .find((m) => m.date === '2025-04-19' && m.name === 'Rimfire Steel Blast');
  assert.ok(rf, 'Rimfire Steel Blast Apr 19 2025 must still exist');
  assert.deepEqual(rf!.stages.map((s) => s.strings), [
    [2.83, 2.75, 2.79, 3.14],
    [2.75, 3.3, 3.67, 3.48, 3.3],
    [2.46, 3.81, 3.67, 2.7, 3.43],
    [3.3, 3.18, 3.85, 3.93, 2.73],
  ]);

  // Classification tiles: CO best-6 70.3 -> B (gap 4.70 to A), LO 63.5 -> B, Production 49.8 -> C.
  type Classifier = { date: string; division: string; percent: number };
  const classifiers = stores.classifiers as unknown as Classifier[];
  const best6 = (division: string) => {
    const v = classifiers.filter((c) => c.division === division)
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8)
      .map((c) => c.percent).sort((a, b) => b - a).slice(0, 6);
    return v.reduce((p, c) => p + c, 0) / v.length;
  };
  assert.equal(Math.round(best6('Carry Optics') * 10) / 10, 70.3);
  assert.equal(Math.round(best6('Limited Optics') * 10) / 10, 63.5);
  assert.equal(Math.round(best6('Production') * 10) / 10, 49.8);

  // 2026 Season: Matches shot becomes 13 (was 11); fees become $618 + the two new
  // 2026 IDPA fees; the average match percent must REMAIN 87.2% (only percent-
  // bearing/USPSA matches feed the average — confirmed here, not just assumed).
  const season2026 = matches.filter((m) => m.date.startsWith('2026'));
  assert.equal(season2026.length, 13, '2026 "Matches shot" must be 13 (11 existing + 2 new 2026 IDPA matches)');
  const fees = season2026.reduce((s, m) => s + ((m as unknown as { entryFee: number | null }).entryFee ?? 0), 0);
  assert.equal(fees, 618 + 30 + 30, '2026 entry fees must be the prior $618 plus the two new 2026 IDPA fees');
  const percents = season2026.map((m) => m.matchPercent).filter((p): p is number => p != null);
  const avgPct = Math.round((percents.reduce((s, p) => s + p, 0) / percents.length) * 10) / 10;
  assert.equal(avgPct, 87.2, 'adding IDPA matches (no matchPercent) must not move the season average — it is USPSA-only');
});

test('demo story: a malfunction\'s magazine is always one that was actually in the gun that session (H-5)', () => {
  // The malfunction-tagging block draws a magazineId to demonstrate the
  // app's malfunction<->magazine linkage (see the block's own comment in
  // make-demo.ts). Every tagged malfunction must name a magazine that
  // session's matching gun actually carried (session.guns[].magIds) — never
  // one from the gun's wider lifetime pool that wasn't there that day.
  type SessGun = { firearmId: string; magIds?: string[] };
  type Sess2 = { id: string; guns: SessGun[] };
  type Malf = { id: string; sessionId: string | null; firearmId: string; magazineId?: string | null };

  const sessById = new Map((stores.sessions as unknown as Sess2[]).map((s) => [s.id, s]));
  const malfunctions = stores.malfunctions as unknown as Malf[];

  const withMagAndSession = malfunctions.filter((mf) => mf.magazineId && mf.sessionId);
  assert.ok(withMagAndSession.length > 0, 'the demo must have at least one malfunction tagged with a magazine');

  for (const mf of withMagAndSession) {
    const sess = sessById.get(mf.sessionId!);
    assert.ok(sess, `${mf.id}: sessionId ${mf.sessionId} must resolve to a real session`);
    const gun = sess!.guns.find((g) => g.firearmId === mf.firearmId);
    const magIds = gun?.magIds ?? [];
    assert.ok(magIds.includes(mf.magazineId!),
      `${mf.id}: magazineId ${mf.magazineId} must be among session ${mf.sessionId}'s magIds for ${mf.firearmId} (got [${magIds.join(', ')}])`);
  }
});
