// ALL money math lives here (spec §3.5.8, §12) — pure functions, no DOM, no
// IndexedDB, fully unit-tested. The single-source rule: a session's range fee
// and a match's entry fee are entered once and read from here by every screen,
// so nothing can ever double-count. The old app's F2 bug (multi-gun sessions
// double-counting per-gun spend) is pinned down by a unit test.

// The one shape here that is STORED rather than computed: the record a
// deduction leaves behind lives in the import history, so its definition sits
// with the rest of the data model. Type-only, so nothing here gains a runtime
// dependency.
import type { RealisedDeduction } from './types.ts';

// ---- Narrow shapes (structural typing keeps tests dependency-free and
// ---- avoids the Match[]-vs-MatchLike CI failures we hit in M5).

export interface UsageLike { ammoId: string; rounds: number }

export interface CostSessionLike {
  id: string;
  date: string;
  type?: string;
  planned?: boolean;
  rangeFee?: number | null;
  ammoUsage?: UsageLike[];
  guns?: { firearmId: string; rounds: number }[];
}

export interface CostPurchaseLike {
  id: string;
  date: string;
  category: string;
  cost: number;
  ammoId?: string | null;
  rounds?: number | null;
  legacy?: Record<string, unknown>;
  /** Which gun (if any) this purchase is for — "gun & gear cost" feature. */
  firearmId?: string | null;
}

/** A gun as a cost source: what you paid for it, if recorded. */
export interface FirearmCostLike { id: string; pricePaid?: unknown }

/** An optic as a cost source: what you paid for it, and the gun it's mounted on. */
export interface OpticCostLike { firearmId?: string | null; pricePaid?: unknown }

export interface CostMatchLike {
  date?: string;
  firearmId?: string;
  entryFee?: number | null;
  /** Old Pistol Tracker matches carried their fee in a field named `cost`. */
  cost?: unknown;
  totalRounds?: number | null;
}

export interface AmmoLike {
  id: string;
  quantity: number;
  costPerRound: number;
}

/** A spare part as a cost source: what you paid, and the gun it's tied to (if any). */
export interface PartCostLike {
  firearmId?: string;
  cost?: unknown;
  datePurchased?: string;
}

/**
 * A COST read off a stored record, floored at zero. Every cost in this file goes
 * through this; `money()` stays the raw coercion beneath it and is still used
 * where the value is not a cost (a legacy round count, for one).
 *
 * WHY THE FLOOR. `money()` passes any finite number through, negatives included.
 * The forms reject a negative, but a `.flog` restore writes a backup's records
 * back verbatim and the read boundary never touches optional numbers, so a
 * hand-edited or third-party file can carry `cost: -500`. Unfloored it SUBTRACTS
 * from a total, and because rows totalling zero are skipped on the Costs card it
 * can delete a gun's row from the screen entirely -- a wrong answer wearing a
 * tidy face.
 *
 * WIDENED 27 Aug 2026, Michael's call, and the reason is worth keeping. The
 * floor first shipped on `gunOwnershipSpend` alone. A cold audit pointed out the
 * consequence: one corrupt record then gave TWO answers on one screen, zero in
 * the gear view and a negative in the totals card beside it. A guard that is
 * right for one reading of a number is right for all of them, and disagreeing
 * with itself is worse than either answer.
 *
 * This changes nothing for any value at or above zero, which is every value the
 * app itself can write.
 */
const paid = (v: unknown): number => {
  const n = money(v);
  return n > 0 ? n : 0;
};

/** Total spent on spare parts. */
export function partsTotalCost(parts: PartCostLike[]): number {
  return parts.reduce((t, p) => t + paid(p.cost), 0);
}

const money = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v)
    : 0;

// Audit CR-9: round a per-round cost to 4dp so float drift never surfaces as
// "$0.30000000001". (Whole-dollar totals are rounded for display by the UI.)
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export const isAmmoPurchase = (p: CostPurchaseLike): boolean =>
  p.category.toLowerCase() === 'ammo purchase';

export const isRangeFeePurchase = (p: CostPurchaseLike): boolean =>
  p.category.toLowerCase() === 'range fee';

/**
 * Which ammo can a purchase feeds, and how many rounds. Reads the formal
 * fields first, then falls back to the `legacy` bag so data Michael imported
 * BEFORE these fields existed still costs correctly without a re-import.
 */
export function purchaseAmmoLink(p: CostPurchaseLike): { ammoId: string; rounds: number } | null {
  if (!isAmmoPurchase(p)) return null;
  const ammoId = (typeof p.ammoId === 'string' && p.ammoId)
    || (typeof p.legacy?.ammoId === 'string' && p.legacy.ammoId)
    || '';
  const rounds = typeof p.rounds === 'number' && Number.isFinite(p.rounds) && p.rounds > 0
    ? p.rounds
    : money(p.legacy?.rounds);
  if (!ammoId || !(rounds > 0) || !(paid(p.cost) > 0)) return null;
  return { ammoId, rounds };
}

/** A match's entry fee — entryFee if set, else the old app's `cost` field. */
export function matchFee(m: CostMatchLike): number {
  // Both branches floored: a stored entryFee was returned raw, so a negative one
  // reached every total untouched even after the purchase paths were guarded.
  if (typeof m.entryFee === 'number' && Number.isFinite(m.entryFee)) {
    return m.entryFee > 0 ? m.entryFee : 0;
  }
  return paid(m.cost);
}

// ---- FIFO ammo costing (mirrors the old app's verified engine) ----
// Each linked Ammo Purchase is a "lot" with a unit cost. Walking sessions in
// date order, every round shot consumes from the oldest unspent lot of that
// ammo. Bought 1,500 @ $0.40 in Jan and 500 @ $0.20 in Feb, shot 1,000 in
// March and 1,000 in April → March costs $0.40/rd, April $0.30/rd.

interface Lot { date: string; id: string; unitCost: number; remaining: number }

export interface FifoResult {
  /** sessionId → total FIFO-allocated ammo cost */
  sessionCosts: Record<string, number>;
  /** sessionId → rounds a purchase lot actually covered */
  sessionRoundsCovered: Record<string, number>;
  /** sessionId → ammoId → rounds a purchase lot actually covered for THAT ammo.
   *  Lets sessionAmmoCost price the FIFO-uncovered remainder at each ammo's flat
   *  cost/round (M-9), instead of at $0. */
  sessionAmmoCovered: Record<string, Record<string, number>>;
  /** ammoId → its lots after consumption (for "what's left in the can" math) */
  lotsBySku: Record<string, Lot[]>;
}

export function computeFifoCosts(
  purchases: CostPurchaseLike[],
  sessions: CostSessionLike[]
): FifoResult {
  const lotsBySku: Record<string, Lot[]> = {};
  for (const p of purchases) {
    const link = purchaseAmmoLink(p);
    if (!link) continue;
    const unitCost = paid(p.cost) / link.rounds;
    if (!Number.isFinite(unitCost)) continue; // audit CR-9: never seed a NaN/Infinity lot
    (lotsBySku[link.ammoId] ??= []).push({
      date: p.date || '', id: p.id,
      unitCost,
      remaining: link.rounds
    });
  }
  for (const sku of Object.keys(lotsBySku)) {
    lotsBySku[sku].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }

  const sessionCosts: Record<string, number> = {};
  const sessionRoundsCovered: Record<string, number> = {};
  const sessionAmmoCovered: Record<string, Record<string, number>> = {};
  const ordered = [...sessions].sort((a, b) =>
    (a.date || '').localeCompare(b.date || '') || a.id.localeCompare(b.id));
  for (const s of ordered) {
    let total = 0;
    let covered = 0;
    const perAmmo: Record<string, number> = {};
    if (!s.planned) {
      for (const u of s.ammoUsage ?? []) {
        const lots = lotsBySku[u.ammoId];
        if (!lots) continue;
        let needed = u.rounds || 0;
        for (const lot of lots) {
          if (needed <= 0) break;
          if (lot.remaining <= 0) continue;
          const take = Math.min(lot.remaining, needed);
          total += take * lot.unitCost;
          covered += take;
          perAmmo[u.ammoId] = (perAmmo[u.ammoId] ?? 0) + take;
          lot.remaining -= take;
          needed -= take;
        }
      }
    }
    sessionCosts[s.id] = total;
    sessionRoundsCovered[s.id] = covered;
    sessionAmmoCovered[s.id] = perAmmo;
  }
  return { sessionCosts, sessionRoundsCovered, sessionAmmoCovered, lotsBySku };
}

/**
 * Weighted-average cost/round of what's still in the can right now, from the
 * unspent FIFO lots. Null when no purchase data exists for this ammo.
 */
export function ammoCurrentCostPerRound(
  ammoId: string,
  purchases: CostPurchaseLike[],
  sessions: CostSessionLike[]
): number | null {
  const lots = computeFifoCosts(purchases, sessions).lotsBySku[ammoId] ?? [];
  let cost = 0, rounds = 0;
  for (const lot of lots) {
    if (lot.remaining > 0) { cost += lot.remaining * lot.unitCost; rounds += lot.remaining; }
  }
  return rounds > 0 ? round4(cost / rounds) : null;
}

/**
 * Informational preview for the Add Ammo screen: what a can's average
 * cost/round will be after a new buy lands on it. Basis = the can's unspent
 * FIFO lots; if it has no purchase history, the typed flat cost/round covers
 * the rounds already on hand; then the new lot is added on top.
 */
export function costPerRoundAfterBuy(
  canId: string | null,
  purchases: CostPurchaseLike[],
  sessions: CostSessionLike[],
  typedCostPerRound: number,
  onHand: number,
  buyRounds: number,
  buyCost: number
): number | null {
  let cost = 0, rounds = 0;
  if (canId) {
    const lots = computeFifoCosts(purchases, sessions).lotsBySku[canId] ?? [];
    for (const lot of lots) {
      if (lot.remaining > 0) { cost += lot.remaining * lot.unitCost; rounds += lot.remaining; }
    }
  }
  if (rounds === 0 && typedCostPerRound > 0 && onHand > 0) {
    cost = onHand * typedCostPerRound;
    rounds = onHand;
  }
  if (buyRounds > 0 && buyCost > 0) { cost += buyCost; rounds += buyRounds; }
  return rounds > 0 ? round4(cost / rounds) : null;
}

/**
 * Ammo cost of one session: FIFO for the rounds purchase lots actually cover,
 * PLUS each ammo's flat cost/round for any remainder the lots don't reach (M-9).
 * A fully-covered session is unchanged (FIFO only); a session with no lots at
 * all falls back entirely to the flat rate (sessions that pre-date purchase
 * tracking). Before this fix a PARTIALLY-covered session priced its uncovered
 * rounds at $0 — silently undercounting the cost-per-round shooters quote.
 */
export function sessionAmmoCost(
  s: CostSessionLike,
  fifo: FifoResult,
  ammo: AmmoLike[]
): number {
  if (s.planned) return 0;
  const covered = fifo.sessionAmmoCovered[s.id] ?? {};
  // Rounds used per ammo (multiple usage lines can name the same ammo).
  const usedByAmmo: Record<string, number> = {};
  for (const u of s.ammoUsage ?? []) {
    usedByAmmo[u.ammoId] = (usedByAmmo[u.ammoId] ?? 0) + (u.rounds || 0);
  }
  let remainder = 0;
  for (const ammoId of Object.keys(usedByAmmo)) {
    const uncovered = usedByAmmo[ammoId] - (covered[ammoId] ?? 0);
    if (uncovered > 0) {
      const a = ammo.find((x) => x.id === ammoId);
      if (a && a.costPerRound > 0) remainder += uncovered * a.costPerRound;
    }
  }
  return (fifo.sessionCosts[s.id] ?? 0) + remainder;
}

/**
 * Fraction of a session's cost that belongs to one gun, prorated by that
 * gun's share of the session's rounds. Shares always sum to 1 across the
 * session's guns — the F2 double-count bug, killed by unit test.
 */
export function firearmShare(s: CostSessionLike, firearmId: string): number {
  const guns = s.guns ?? [];
  if (guns.length === 0) return 0;
  const total = guns.reduce((t, g) => t + (g.rounds || 0), 0);
  if (total === 0) return guns.some((g) => g.firearmId === firearmId) ? 1 / guns.length : 0;
  const mine = guns.find((g) => g.firearmId === firearmId);
  return mine ? (mine.rounds || 0) / total : 0;
}

// ---- Roll-ups for the Costs screen ----

export interface CostTotals {
  ammoBought: number;   // money handed over for ammo (purchases)
  rangeFees: number;    // session fees + purchases categorized "Range Fee"
  matchFees: number;    // match entry fees (single source — spec §12.2)
  parts: number;        // spare parts (single source — the Part record itself)
  gearAndOther: number; // every remaining purchase category
  total: number;        // each dollar counted exactly once
}

export function costTotals(
  sessions: CostSessionLike[],
  purchases: CostPurchaseLike[],
  matches: CostMatchLike[],
  parts: PartCostLike[] = []
): CostTotals {
  let ammoBought = 0, rangeFees = 0, gearAndOther = 0;
  for (const p of purchases) {
    const c = paid(p.cost);
    if (isAmmoPurchase(p)) ammoBought += c;
    else if (isRangeFeePurchase(p)) rangeFees += c;
    else gearAndOther += c;
  }
  for (const s of sessions) {
    if (!s.planned) rangeFees += paid(s.rangeFee);
  }
  const matchFees = matches.reduce((t, m) => t + matchFee(m), 0);
  const partsCost = partsTotalCost(parts);
  return {
    ammoBought, rangeFees, matchFees, parts: partsCost, gearAndOther,
    total: ammoBought + rangeFees + matchFees + partsCost + gearAndOther
  };
}

/** Rounds actually fired in a period (sessions + matches; planned and dry fire excluded). */
export function roundsFired(sessions: CostSessionLike[], matches: CostMatchLike[]): number {
  let total = 0;
  for (const s of sessions) {
    if (s.planned || s.type === 'dry_fire') continue;
    for (const g of s.guns ?? []) total += g.rounds || 0;
  }
  for (const m of matches) {
    if (typeof m.totalRounds === 'number' && Number.isFinite(m.totalRounds)) total += m.totalRounds;
  }
  return total;
}

export interface GunSpend { ammo: number; rangeFees: number; matchFees: number; parts: number; total: number }

/**
 * What one gun has cost to feed and run: its prorated share of every
 * session's ammo cost and range fee, plus entry fees for matches it shot,
 * plus spare parts tied to this gun. (Universal parts aren't gun-specific, so
 * they land in the overall totals but not in any one gun's spend.)
 */
export function gunSpend(
  firearmId: string,
  sessions: CostSessionLike[],
  purchases: CostPurchaseLike[],
  matches: CostMatchLike[],
  ammo: AmmoLike[],
  parts: PartCostLike[] = []
): GunSpend {
  const fifo = computeFifoCosts(purchases, sessions);
  let ammoCost = 0, rangeFees = 0;
  for (const s of sessions) {
    if (s.planned) continue;
    const share = firearmShare(s, firearmId);
    if (share === 0) continue;
    ammoCost += sessionAmmoCost(s, fifo, ammo) * share;
    rangeFees += paid(s.rangeFee) * share;
  }
  const matchFees = matches
    .filter((m) => m.firearmId === firearmId)
    .reduce((t, m) => t + matchFee(m), 0);
  const partsCost = parts
    .filter((p) => p.firearmId === firearmId)
    .reduce((t, p) => t + paid(p.cost), 0);
  return {
    ammo: ammoCost, rangeFees, matchFees, parts: partsCost,
    total: ammoCost + rangeFees + matchFees + partsCost
  };
}

// ---- Gun ownership cost ("Gun & gear cost per gun", Aug 2026) ----

/**
 * Purchase categories a "For which gun" link may count toward gun ownership
 * cost. Deliberately narrow (spec decision 6: Gear / Equipment AND Service /
 * Repair, nothing else) — an Ammo Purchase or Range Fee is IGNORED here even
 * if it happens to carry a firearmId, so ammo is never double-counted against
 * the FIFO figure above and a range fee can never slip into this mode, which
 * excludes range fees on principle.
 */
const LINKED_PURCHASE_CATEGORIES = new Set(['gear / equipment', 'service / repair']);

/**
 * The purchase categories a gun link is offered on, and the ONE place that
 * question is answered (spec decision 6: Gear / Equipment and Service / Repair).
 *
 * Exported because the screen needs the same answer twice -- to decide whether to
 * SHOW the "For which gun" picker, and to decide what to SAVE when the category
 * has moved. Those two lived as separate expressions and could drift apart, which
 * is the shape of defect where a link is hidden but still stored. Routed through
 * one function instead, so forgetting is not possible rather than merely unlikely.
 */
export function isLinkableGunCategory(category: string): boolean {
  return LINKED_PURCHASE_CATEGORIES.has((category || '').toLowerCase());
}

/**
 * The gun link a purchase should be stored with, given the category showing on
 * the form and the gun currently picked. Null on any non-linkable category, so
 * moving a purchase away from Gear / Equipment or Service / Repair CLEARS the
 * link rather than leaving one that no surface will ever show again.
 */
export function linkedGunIdForSave(category: string, selectedGunId: string | null): string | null {
  return isLinkableGunCategory(category) && selectedGunId ? selectedGunId : null;
}

function isLinkedGunPurchase(p: CostPurchaseLike, firearmId: string): boolean {
  return p.firearmId === firearmId && isLinkableGunCategory(p.category);
}

export interface GunOwnershipSpend {
  ammo: number; gun: number; optic: number; parts: number; linked: number; total: number;
}

/**
 * What owning and feeding one gun has actually cost — a second, deliberately
 * narrower question than gunSpend answers. Range fees and match fees are the
 * price of shooting and competing, not of the gun, so NEITHER appears here:
 * this function doesn't even take a `matches` parameter, and it never reads a
 * session's `rangeFee` field, so there is no field left for either to leak in
 * through.
 *
 * Adds together: the gun's own pricePaid, every optic CURRENTLY assigned to this
 * gun (summed — a gun can wear more than one at a time), spare parts tied to the
 * gun, "Gear / Equipment" and "Service / Repair" purchases linked to it by the
 * For-which-gun picker, and its prorated share of ammo cost — the SAME FIFO
 * figure gunSpend computes, reusing the same helpers (computeFifoCosts,
 * firearmShare, sessionAmmoCost) rather than reimplementing FIFO.
 *
 * ONE HONEST LIMIT, and it is a property of the data model rather than of this
 * function (session-135 cold audit, finding 5). An optic record carries only its
 * CURRENT firearmId; no history is kept. So reassigning an optic moves its whole
 * price to the new gun, and marking a gun "no longer owned" frees its
 * accessories, which drops that optic's price out of this total while the gun's
 * own price and its linked purchases stay. Nothing is lost and nothing is
 * double-counted, but this is a current-assignment sum, not a lifetime one, and
 * the wording above says so deliberately.
 *
 * Every stored cost is read through `paid()`, which floors at zero -- as every
 * other cost path in this file now does too.
 */
export function gunOwnershipSpend(
  firearmId: string,
  sessions: CostSessionLike[],
  purchases: CostPurchaseLike[],
  ammo: AmmoLike[],
  firearms: FirearmCostLike[],
  optics: OpticCostLike[] = [],
  parts: PartCostLike[] = []
): GunOwnershipSpend {
  const fifo = computeFifoCosts(purchases, sessions);
  let ammoCost = 0;
  for (const s of sessions) {
    if (s.planned) continue;
    const share = firearmShare(s, firearmId);
    if (share === 0) continue;
    ammoCost += sessionAmmoCost(s, fifo, ammo) * share;
  }
  const gunCost = paid(firearms.find((f) => f.id === firearmId)?.pricePaid);
  const opticCost = optics
    .filter((o) => o.firearmId === firearmId)
    .reduce((t, o) => t + paid(o.pricePaid), 0);
  const partsCost = parts
    .filter((p) => p.firearmId === firearmId)
    .reduce((t, p) => t + paid(p.cost), 0);
  const linkedCost = purchases
    .filter((p) => isLinkedGunPurchase(p, firearmId))
    .reduce((t, p) => t + paid(p.cost), 0);
  return {
    ammo: ammoCost, gun: gunCost, optic: opticCost, parts: partsCost, linked: linkedCost,
    total: ammoCost + gunCost + opticCost + partsCost + linkedCost
  };
}

// ---- Inventory ----

/**
 * New on-hand quantities after a session's ammo usage changes from `before`
 * to `after` (either may be empty — covers new session, edit, and delete).
 * Returns only the cans whose count changed. Never goes below zero.
 */
export function inventoryAfterUsageChange(
  ammo: AmmoLike[],
  before: UsageLike[],
  after: UsageLike[]
): Map<string, number> {
  const delta = new Map<string, number>();
  for (const u of after) delta.set(u.ammoId, (delta.get(u.ammoId) ?? 0) + (u.rounds || 0));
  for (const u of before) delta.set(u.ammoId, (delta.get(u.ammoId) ?? 0) - (u.rounds || 0));
  const out = new Map<string, number>();
  for (const [ammoId, d] of delta) {
    if (d === 0) continue;
    const a = ammo.find((x) => x.id === ammoId);
    if (!a) continue;
    out.set(ammoId, Math.max(0, (a.quantity || 0) - d));
  }
  return out;
}

/**
 * What one deduction did: the new on-hand figures to store, and the record of
 * what each can actually gave up.
 */
export interface StockDeduction {
  /** New on-hand for every can that moved. Only those; unmoved cans are absent. */
  quantities: Map<string, number>;
  /** Per can, what was asked for and what came off. The undo plays THIS back. */
  realised: RealisedDeduction[];
}

/**
 * Take a set of rounds off the cans, and say what that actually did.
 *
 * WHY THIS RETURNS A RECORD RATHER THAN QUANTITIES ALONE. `Math.max(0, ...)`
 * makes the deduction NOT INVERTIBLE: a can of 100 that an import of 150 empties
 * loses 100, and nothing in the new quantity says whether 100 or 150 was asked
 * for. Two directions computed from the same request therefore disagree by
 * whatever the clamp swallowed, and the difference lands in the shooter's
 * on-hand count as rounds that were never fired and never bought. Sharing ONE
 * function between the two directions does not fix that, because the function is
 * not injective: the shared call was already in place when a can of 100 came
 * back as 150.
 *
 * So the deduction writes down what it did, and restoreDeductedStock replays
 * that number. The restore no longer computes anything that could differ.
 */
export function deductUsageFromStock(
  ammo: AmmoLike[],
  usage: readonly UsageLike[],
): StockDeduction {
  const requested = new Map<string, number>();
  for (const u of usage) requested.set(u.ammoId, (requested.get(u.ammoId) ?? 0) + (u.rounds || 0));
  const quantities = new Map<string, number>();
  const realised: RealisedDeduction[] = [];
  for (const [ammoId, want] of requested) {
    if (want === 0) continue;
    const a = ammo.find((x) => x.id === ammoId);
    if (!a) continue;
    const held = a.quantity || 0;
    // The same arithmetic inventoryAfterUsageChange does, with the part it threw
    // away kept: `taken` is read back OFF the clamped result, so it is by
    // construction the amount the can really lost.
    const left = Math.max(0, held - want);
    quantities.set(ammoId, left);
    realised.push({ ammoId, requested: want, taken: held - left });
  }
  return { quantities, realised };
}

/**
 * Put back what a deduction took, to the can the rounds are off NOW.
 *
 * TWO SEPARATE QUESTIONS, and the ledger answers only one of them.
 *
 * WHERE the rounds go is read from `stillDeducted`, the batch's usage as it
 * stands at this moment, and never from the ledger. A can merge repoints every
 * session onto the kept can and DELETES the one the import named
 * (src/ui/AmmoScreens.tsx, applyAmmoMerge), and a shooter editing an imported
 * session's ammunition moves the rounds the same way. Looking the ledger's can
 * up in the log then finds a can that is gone, or one the rounds are no longer
 * off, and 150 rounds the shooter owns are never handed back. Both are ordinary
 * features and both were measured at 350 where 500 was owed.
 *
 * HOW MANY go back is what the ledger is for. `requested - taken` is the part of
 * the ask that no can ever gave up, because a can does not go below zero, and
 * that part can never come back: it was never anywhere.
 *
 * Rounds whose session has since gone to the Trash are not in `stillDeducted` at
 * all (usageThatMovedStock), because trashing handed them back already
 * (src/ui/sessionDelete.ts softDeleteSession), so they cannot arrive twice.
 */
export function restoreDeductedStock(
  ammo: AmmoLike[],
  realised: readonly RealisedDeduction[],
  stillDeducted: readonly UsageLike[],
): Map<string, number> {
  // What the rows asked of a can that no can ever gave up.
  const shortfall = new Map<string, number>();
  for (const row of realised) {
    const missed = Math.max(0, row.requested - row.taken);
    if (missed > 0) shortfall.set(row.ammoId, (shortfall.get(row.ammoId) ?? 0) + missed);
  }
  // Where this batch's rounds are off cans right now, and how many. Insertion
  // order, so a given batch always settles the same way.
  const owed = new Map<string, number>();
  for (const u of stillDeducted) owed.set(u.ammoId, (owed.get(u.ammoId) ?? 0) + (u.rounds || 0));

  // A SHORTFALL TRAVELS WITH THE ROUNDS IT BELONGS TO. Held against the can the
  // import named, it is lost the moment that can is merged away, and the full
  // ask goes back to a can that never gave it up. So a shortfall whose can is no
  // longer carrying any of this batch's rounds joins a pool, and the pool is
  // taken off whichever cans are.
  let pooled = 0;
  for (const [ammoId, missed] of shortfall) {
    const rounds = owed.get(ammoId);
    if (rounds === undefined) { pooled += missed; continue; }
    owed.set(ammoId, Math.max(0, rounds - missed));
    if (missed > rounds) pooled += missed - rounds;
  }

  const out = new Map<string, number>();
  for (const [ammoId, rounds] of owed) {
    const spend = Math.min(pooled, rounds);
    pooled -= spend;
    const back = rounds - spend;
    if (back === 0) continue;
    const a = ammo.find((x) => x.id === ammoId);
    if (!a) continue;
    out.set(ammoId, (a.quantity || 0) + back);
  }
  return out;
}

/** The little of a session that the stock question actually depends on. */
export interface StockSessionLike {
  planned?: boolean;
  deletedAt?: number | null;
  ammoUsage?: UsageLike[];
}

/**
 * The ammo usage that IS currently off the cans for a set of sessions.
 *
 * Two rules, held here once rather than at each call site:
 *  - a PLANNED session has not been shot, so it has never moved stock (the same
 *    rule SessionForm applies when it saves);
 *  - a session in the Trash has already had its rounds handed back
 *    (src/ui/sessionDelete.ts softDeleteSession), so its usage is no longer off
 *    the can and handing it back again would invent rounds.
 *
 * WHY ONE FUNCTION: the CSV import's commit deducts exactly this, and its undo
 * restores exactly this, from the same call in the opposite direction. A rule
 * added here applies to both halves at once, so the two cannot drift apart into
 * inventing or destroying stock between them.
 */
export function usageThatMovedStock(sessions: readonly StockSessionLike[]): UsageLike[] {
  const out: UsageLike[] = [];
  for (const s of sessions) {
    if (s.planned) continue;
    if (s.deletedAt) continue;
    for (const u of s.ammoUsage ?? []) out.push(u);
  }
  return out;
}

/** Cans running low — 50 rounds or fewer left, but not deliberately empty. */
export function lowAmmo<T extends AmmoLike>(ammo: T[]): T[] {
  return ammo.filter((a) => (a.quantity || 0) > 0 && (a.quantity || 0) <= 50);
}
