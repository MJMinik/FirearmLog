// Costs & Purchases (spec §12): what shooting costs, with every dollar counted
// exactly once. Range fees come straight off sessions, match fees straight off
// matches (the single-source rule) — purchases cover everything else. Per-gun
// spend prorates multi-gun sessions by rounds (the old F2 bug, now unit-tested).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScreenLoading } from './ScreenState.tsx';
import type { Ammunition, Firearm, Match, Optic, Part, Purchase, Session } from '../lib/types.ts';
import { deleteOne, getAll, getOne, getSettings, putOne } from '../lib/db.ts';
import { activeOnly } from '../lib/softDelete.ts';
import { formatDayKey, todayKey } from '../lib/dates.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { costTotals, gunOwnershipSpend, gunSpend, isLinkableGunCategory, linkedGunIdForSave,
  purchaseAmmoLink, roundsFired } from '../lib/costing.ts';
import { recentValues } from '../lib/suggest.ts';
import { filterHidden } from '../lib/listEdits.ts';
import { ownedGuns } from '../lib/gunStatus.ts';
import { ammoLabel } from './AmmoScreens.tsx';
import { SuggestField } from './SuggestField.tsx';
import { InfoTip } from './InfoTip.tsx';
import { ConfirmSheet, DiscardChangesSheet } from './Sheet.tsx';
import { useDirtyTracker } from './useDirtyTracker.ts';
import { FormProblem } from './FormProblem.tsx';
import { ListSearch, matchesQuery } from './ListSearch.tsx';
import { ScreenError } from './ScreenState.tsx';

// 'Firearm' leads the list (added 27 Aug 2026): it is the largest thing a
// shooter buys and it had nowhere to go before, so a gun had to be filed as
// gear. The form's default is set explicitly further down, so changing this
// order changes what is OFFERED without changing what is PRE-SELECTED.
const CATEGORIES = [
  'Firearm', 'Ammo Purchase', 'Range Fee', 'Gear / Equipment', 'Service / Repair',
  'Training / Class', 'Travel', 'Other'
];

/**
 * Why "ammo used" can exceed "Ammo bought" (Michael, 27 Aug 2026, from his own
 * numbers: $3,458 used against $1,491 bought).
 *
 * They answer different questions and both are right. "Ammo bought" is money he
 * handed over on purchase rows. The per-gun figure is the VALUE OF WHAT HE SHOT:
 * FIFO against his purchase lots for as many rounds as those cover, then each
 * can's own cost-per-round for the rest (see sessionAmmoCost, the M-9 fix -- those
 * rounds used to be priced at zero, which undercounted the cost-per-round a
 * shooter would quote). His first ammo purchase is dated 9 July 2026 and he has
 * been logging since February, so most of his rounds are priced from the can.
 *
 * Nothing is double-counted and no total is wrong. The defect was that one word,
 * "ammo", was doing both jobs a few inches apart on one screen. Hence "ammo used"
 * on the rows and this sentence in the help.
 */
const AMMO_USED_NOTE =
  'Ammo used is what you shot, not what you bought: rounds your recorded ammo purchases cover are '
  + 'priced from those purchases, and anything you owned before you started recording them is priced '
  + 'from the can\'s cost per round. So ammo used can be more than the "Ammo bought" total above.';

const dollars = (n: number): string =>
  '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CostsScreen({ refreshKey, onBack, openForm, openPart }: {
  refreshKey: number; onBack: () => void;
  openForm: (id?: string) => void; openPart: (id?: string) => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [ammo, setAmmo] = useState<Ammunition[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [optics, setOptics] = useState<Optic[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [q, setQ] = useState('');
  // "Gun & gear cost per gun" mode (Aug 2026). Unchecked on every fresh open —
  // deliberately NOT persisted (a plain useState, no settings write) — so the
  // screen always opens on the familiar ammo-and-fees view.
  const [gunGearMode, setGunGearMode] = useState(false);

  useEffect(() => {
    let alive = true;
    setError(false);
    void Promise.all([
      getAll<Session>('sessions'), getAll<Purchase>('purchases'), getAll<Match>('matches'),
      getAll<Firearm>('firearms'), getAll<Ammunition>('ammunition'), getAll<Part>('parts'),
      getAll<Optic>('optics')
    ]).then(([s, p, m, f, a, pt, op]) => {
      if (!alive) return;
      setSessions(activeOnly(s)); // App 7: trashed sessions never count toward costs
      // Date-safe sort: a purchase with a missing date must never crash the
      // load (a rejected promise here would hang the whole screen forever).
      setPurchases(p.sort((x, y) => (y.date || '').localeCompare(x.date || '')));
      setMatches(m);
      setFirearms(f);
      setAmmo(a);
      setParts(pt);
      setOptics(op);
      setLoaded(true);
    }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [refreshKey, reloadNonce]);

  if (error) return <ScreenError onRetry={() => setReloadNonce((n) => n + 1)} />;
  if (!loaded) return <ScreenLoading />;

  const year = todayKey().slice(0, 4);
  const inYear = <T extends { date: string }>(rows: T[]) => rows.filter((r) => (r.date || '').startsWith(year));
  const inYearParts = parts.filter((p) => (p.datePurchased || '').startsWith(year));
  const costedParts = parts.filter((p) => p.cost != null)
    .sort((a, b) => (b.datePurchased || '').localeCompare(a.datePurchased || ''));
  const all = costTotals(sessions, purchases, matches, parts);
  const ytd = costTotals(inYear(sessions), inYear(purchases), inYear(matches), inYearParts);
  const fired = roundsFired(sessions, matches);
  const allIn = fired > 0 && all.total > 0 ? all.total / fired : null;

  const TotalsCard = ({ title, t }: { title: string; t: typeof all }) => (
    <div className="card">
      <h2>{title}</h2>
      <div className="row"><span className="label">Firearms</span><span className="value">{dollars(t.firearms)}</span></div>
      <div className="row"><span className="label">Ammo bought</span><span className="value">{dollars(t.ammoBought)}</span></div>
      <div className="row"><span className="label">Range fees</span><span className="value">{dollars(t.rangeFees)}</span></div>
      <div className="row"><span className="label">Match fees</span><span className="value">{dollars(t.matchFees)}</span></div>
      <div className="row"><span className="label">Spare parts</span><span className="value">{dollars(t.parts)}</span></div>
      <div className="row"><span className="label">Gear &amp; other</span><span className="value">{dollars(t.gearAndOther)}</span></div>
      <div className="row"><span className="label"><strong>Total</strong></span><span className="value"><strong>{dollars(t.total)}</strong></span></div>
    </div>
  );

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn section-back" onClick={onBack}>‹ Back</button>
      </div>
      <h1 className="large-title">Costs &amp; Purchases</h1>
      <button className="button" onClick={() => openForm()}>+ Add Purchase</button>
      <div style={{ height: 16 }} />
      <TotalsCard title={`This Year (${year})`} t={ytd} />
      <TotalsCard title="All Time" t={all} />
      {allIn !== null && (
        <p className="report-note">
          All-in cost per round fired: <strong>${allIn.toFixed(3)}</strong> — every dollar above,
          spread over {fired.toLocaleString()} rounds of sessions and matches.
        </p>
      )}

      {firearms.length > 0 && (
        <div className="card">
          <h2>
            {gunGearMode ? 'Gun & gear cost per gun' : 'Ammo & fees per gun'}{' '}
            <InfoTip title={gunGearMode ? 'Gun & gear cost per gun' : 'Ammo & fees per gun'}>
              {gunGearMode
                ? `What owning and feeding this gun has actually cost: what the gun itself cost, its optic, spare parts, and any gear or service purchases you told it was for, plus your prorated share of ammo shot through it. Range fees and match fees are not counted here (they're the cost of shooting and competing, not of the gun). You can still see them by unchecking the box below, and in the totals at the top of this screen. ${AMMO_USED_NOTE}`
                : `Each gun's share of ammo, range fees, match fees, and parts. When a session or match used more than one gun, the cost is split by each gun's actual rounds, so nothing is double-counted. ${AMMO_USED_NOTE}`}
            </InfoTip>
          </h2>
          <label className="checklist-take" style={{ margin: '8px 0' }}>
            <input type="checkbox" checked={gunGearMode} onChange={(e) => setGunGearMode(e.target.checked)} />
            Include the gun, optic, parts and gear
          </label>
          <p className="report-note" style={{ marginBottom: 8 }}>
            {gunGearMode
              ? 'What the gun cost, its optic, spare parts, and any gear or service you linked to it, plus its share of ammo shot (oldest purchases first). Range fees and match fees are left out.'
              : 'Ammo shot up (oldest purchases first) plus each gun\'s share of range fees — split sessions are divided by rounds, never counted twice — plus its match fees.'}
          </p>
          {firearms.map((f) => {
            if (gunGearMode) {
              const g = gunOwnershipSpend(f.id, sessions, purchases, ammo, firearms, optics, parts);
              if (g.total === 0) return null;
              return (
                <div className="row" key={f.id}>
                  <span className="label">{f.name}
                    <div className="row-sub">
                      {[g.gun > 0 && `${dollars(g.gun)} gun`,
                        g.optic > 0 && `${dollars(g.optic)} optic`,
                        g.ammo > 0 && `${dollars(g.ammo)} ammo used`,
                        g.parts > 0 && `${dollars(g.parts)} parts`,
                        g.linked > 0 && `${dollars(g.linked)} gear`].filter(Boolean).join(' · ')}
                    </div>
                  </span>
                  <span className="value">{dollars(g.total)}</span>
                </div>
              );
            }
            const g = gunSpend(f.id, sessions, purchases, matches, ammo, parts);
            if (g.total === 0) return null;
            return (
              <div className="row" key={f.id}>
                <span className="label">{f.name}
                  <div className="row-sub">
                    {[g.ammo > 0 && `${dollars(g.ammo)} ammo used`,
                      g.rangeFees > 0 && `${dollars(g.rangeFees)} range`,
                      g.matchFees > 0 && `${dollars(g.matchFees)} matches`,
                      g.parts > 0 && `${dollars(g.parts)} parts`].filter(Boolean).join(' · ')}
                  </div>
                </span>
                <span className="value">{dollars(g.total)}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <h2>Purchases</h2>
        {purchases.length > 8 && <ListSearch value={q} onChange={setQ} placeholder="Search purchases" />}
        {purchases.length === 0 ? (
          <p className="report-note">Nothing logged yet. Ammo, gear, classes, travel — put it here and the totals above stay current.</p>
        ) : purchases.filter((p) => matchesQuery(q, p.item, p.category, p.vendor)).map((p) => (
          <button className="row-tap" key={p.id} onClick={() => openForm(p.id)}>
            <span className="label">
              {p.item || p.category}
              <div className="row-sub">{p.date ? `${formatDayKey(p.date)} · ` : ''}{p.category}{p.vendor ? ` · ${p.vendor}` : ''}</div>
            </span>
            <span className="value">{dollars(p.cost || 0)}</span>
          </button>
        ))}
      </div>
      {costedParts.length > 0 && (
        <div className="card">
          <h2>Spare Part Costs</h2>
          <p className="report-note" style={{ marginBottom: 8 }}>
            From Parts. Tap one to edit it there.
          </p>
          {costedParts.map((p) => (
            <button className="row-tap" key={p.id} onClick={() => openPart(p.id)}>
              <span className="label">
                {p.name}
                <div className="row-sub">
                  {[
                    p.datePurchased ? formatDayKey(p.datePurchased) : '',
                    p.firearmId ? (firearms.find((f) => f.id === p.firearmId)?.name ?? '—') : 'Any / Universal',
                    p.vendor
                  ].filter(Boolean).join(' · ')}
                </div>
              </span>
              <span className="value">{dollars(p.cost || 0)}</span>
            </button>
          ))}
        </div>
      )}
      <p className="report-note">
        Range fees you type on a session and entry fees you type on a match are already
        counted — don't add them again here. Use the "Range Fee" category only for fees
        outside a logged session (like an annual membership).
      </p>
    </div>
  );
}

export function PurchaseForm({ id, onSaved, onCancel, onDirtyChange, onSaverChange }: {
  id?: string; onSaved: () => void; onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSaverChange?: (fn: (() => Promise<boolean>) | null) => void;
}) {
  const editing = id !== undefined;
  const [original, setOriginal] = useState<Purchase | null>(null);
  const [ammo, setAmmo] = useState<Ammunition[]>([]);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [pastVendors, setPastVendors] = useState<string[]>([]);
  const [pastItems, setPastItems] = useState<string[]>([]);
  const [date, setDate] = useState(todayKey());
  const [category, setCategory] = useState('Gear / Equipment');
  const [item, setItem] = useState('');
  const [vendor, setVendor] = useState('');
  const [cost, setCost] = useState('');
  const [rounds, setRounds] = useState('');
  const [ammoId, setAmmoId] = useState('');
  const [addToInv, setAddToInv] = useState(true);
  // "For which gun" (Aug 2026, "gun & gear cost" feature). Only offered — and
  // only ever saved — for Gear / Equipment and Service / Repair (spec decision
  // 6). '' means "Not gun-specific".
  const [firearmIdSel, setFirearmIdSel] = useState('');
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  // AUDIT FIX (July 20 2026): wait for the getOne load before seeding the
  // dirty baseline on edit — otherwise a clean close of an existing purchase
  // fires "Discard changes?" untouched.
  const [loaded, setLoaded] = useState<boolean>(!editing);
  const [hiddenSuggestions, setHiddenSuggestions] = useState<Record<string, string[]>>({});
  const dirty = useDirtyTracker({ date, category, item, vendor, cost, rounds, ammoId, addToInv, firearmIdSel, notes }, loaded);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // Which categories the "For which gun" picker is offered on (spec decision 6).
  // Asked of costing.ts rather than re-tested here, so the answer that decides
  // whether the picker SHOWS is by construction the same answer that decides what
  // gets SAVED a few lines below.
  const linkableCategory = isLinkableGunCategory(category);

  useEffect(() => {
    let alive = true;
    void getAll<Ammunition>('ammunition').then((a) => {
      if (alive) setAmmo(a.sort((x, y) => ammoLabel(x).localeCompare(ammoLabel(y))));
    });
    void getAll<Firearm>('firearms').then((f) => {
      if (alive) setFirearms(f.sort((x, y) => x.name.localeCompare(y.name)));
    });
    void getAll<Purchase>('purchases').then((all) => {
      if (!alive) return;
      setPastVendors(recentValues(all.map((p) => ({ date: p.date, value: p.vendor }))));
      setPastItems(recentValues(all.map((p) => ({ date: p.date, value: p.item }))));
    });
    void getSettings<{ hiddenSuggestions?: Record<string, string[]> }>().then((s) => {
      if (alive) setHiddenSuggestions(s?.hiddenSuggestions ?? {});
    });
    if (id !== undefined) {
      void getOne<Purchase>('purchases', id).then((p) => {
        if (!alive || !p) return;
        setOriginal(p);
        setDate(p.date || todayKey());
        // D4 fix, second door (cold audit, session 140): the stored value,
        // unchanged — not `p.category || 'Other'`. That substitution wrote
        // 'Other' into the dirty-tracker baseline for a purchase whose
        // category was never recorded, so editing the vendor or amount for
        // any unrelated reason and hitting Save wrote 'Other' into a record
        // that never said so. Same shape as D2's ammo bullet-type fix.
        setCategory(p.category);
        setItem(p.item); setVendor(p.vendor);
        setCost(p.cost ? String(p.cost) : '');
        const link = purchaseAmmoLink(p);
        setRounds(link ? String(link.rounds) : '');
        setAmmoId(link?.ammoId ?? '');
        setAddToInv(p.addedToInventory === true);
        setFirearmIdSel(p.firearmId ?? '');
        setNotes(p.notes);
        setLoaded(true); // AUDIT FIX
      });
    }
    return () => { alive = false; };
  }, [id]);

  /** Undo the inventory bump a previously saved version of this purchase made. */
  async function reverseOldBump(p: Purchase) {
    if (!p.addedToInventory) return;
    const link = purchaseAmmoLink(p);
    if (!link) return;
    const can = await getOne<Ammunition>('ammunition', link.ammoId);
    if (!can) return;
    await putOne('ammunition', stampUpdate(
      { ...can, quantity: Math.max(0, (can.quantity || 0) - link.rounds) }, Date.now()));
  }

  function saveProblem(): string | null {
    if (!item.trim()) return 'Name the item — "1,000 rds Blazer 115gr", "match belt", whatever it was.';
    const c = cost.trim() === '' ? 0 : Number(cost);
    if (!Number.isFinite(c) || c < 0) return 'Cost needs to be a plain number.';
    const isAmmo = category === 'Ammo Purchase';
    const r = isAmmo && rounds.trim() !== '' ? Number(rounds) : null;
    if (r !== null && (!Number.isFinite(r) || r < 0)) return 'Rounds needs to be a plain number.';
    return null;
  }

  async function persistForm(): Promise<boolean> {
    if (saving) return false;
    const p = saveProblem();
    if (p) { setProblem(p); return false; }
    const c = cost.trim() === '' ? 0 : Number(cost);
    const isAmmo = category === 'Ammo Purchase';
    const r = isAmmo && rounds.trim() !== '' ? Number(rounds) : null;
    setSaving(true);
    try {
      const now = Date.now();
      // Clear stale ammo fields when the category moves away from Ammo Purchase
      // (the old app's F6 fix, kept). Same rule for the gun link: it's only
      // ever offered on Gear / Equipment and Service / Repair, so a category
      // change away from those two clears it rather than leaving it dangling.
      const fields = {
        date, category, item: item.trim(), vendor: vendor.trim(), cost: c, notes: notes.trim(),
        ammoId: isAmmo && ammoId ? ammoId : null,
        rounds: isAmmo ? r : null,
        addedToInventory: isAmmo && addToInv && !!ammoId && (r ?? 0) > 0,
        firearmId: linkedGunIdForSave(category, firearmIdSel)
      };
      if (original) await reverseOldBump(original);
      const record = original
        ? stampUpdate({ ...original, ...fields }, now)
        : stampNew(fields, newId('pu'), now);
      await putOne('purchases', record);
      if (fields.addedToInventory) {
        const can = await getOne<Ammunition>('ammunition', fields.ammoId as string);
        if (can) {
          await putOne('ammunition', stampUpdate(
            { ...can, quantity: (can.quantity || 0) + (r ?? 0) }, now));
        }
      }
      onDirtyChange?.(false);
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function save() { if (await persistForm()) onSaved(); }

  // Always-fresh saver: the ref holds the LATEST persistForm (re-pointed after
  // every render), and the reported wrapper is reference-stable so App's ref
  // write never churns. This replaces a hand-maintained dep list that could — and
  // did — go stale and save old values.
  const persistRef = useRef(persistForm);
  useEffect(() => { persistRef.current = persistForm; });
  const stablePersist = useCallback(() => persistRef.current(), []);

  // Report after every render (cheap: App just writes a ref) so the reported
  // validity can never lag the form state. Saver present ⟺ dirty AND valid.
  useEffect(() => {
    onSaverChange?.(dirty && saveProblem() === null ? stablePersist : null);
  });
  useEffect(() => () => onSaverChange?.(null), [onSaverChange]);

  async function reallyDelete() {
    if (original) {
      await reverseOldBump(original);
      await deleteOne('purchases', original.id);
    }
    onDirtyChange?.(false);
    onSaved();
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={() => (dirty ? setDiscarding(true) : onCancel())}>‹ Cancel</button>
        <button className="navbar-action" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {discarding && (
        <DiscardChangesSheet
          onConfirm={() => { onDirtyChange?.(false); onCancel(); }}
          onClose={() => setDiscarding(false)}
          onSave={saveProblem() === null ? () => void save() : undefined} />
      )}
      <h1 className="large-title">{editing ? 'Edit Purchase' : 'Add Purchase'}</h1>
      <FormProblem problem={problem} />
      <div className="card">
        <label className="field">Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {/* D4 fix (picker sweep, session 139; blank case closed in the
                session-140 cold audit): an imported purchase with an unlisted
                category (e.g. from an older category list) used to fall
                through to CATEGORIES[0], Firearm, while the gun-link and ammo
                sections below stayed keyed on the TRUE category — the form
                disagreeing with itself on screen. A blank category (never
                recorded) used to fall through the same way to 'Other', via a
                `p.category || 'Other'` load-time substitution — Save doesn't
                require a category (see saveProblem below), so nothing forced
                that write; it happened only because the field had nowhere
                truthful to land. Both cases get their own option now: a
                blank category renders as "Not recorded" (key '__blank__',
                since '' can't be a React key), any other unlisted value
                renders as itself. */}
            {category === '' &&
              <option key="__blank__" value="">Not recorded</option>}
            {category !== '' && !CATEGORIES.includes(category) &&
              <option value={category}>{category}</option>}
            {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        </label>
        {linkableCategory && (
          <label className="field">For which gun
            <select value={firearmIdSel} onChange={(e) => setFirearmIdSel(e.target.value)}>
              <option value="">Not gun-specific</option>
              {ownedGuns(firearms, [firearmIdSel]).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
        )}
        <SuggestField label="Item" value={item} onChange={setItem}
          suggestions={filterHidden(pastItems, hiddenSuggestions, 'purchase-items')}
          placeholder={category === 'Ammo Purchase' ? '1,000 rds Blazer Brass 115gr' : 'Safariland holster'} />
        <SuggestField label="Vendor (optional)" value={vendor} onChange={setVendor}
          suggestions={filterHidden(pastVendors, hiddenSuggestions, 'vendors')} placeholder="Primary Arms" />
        <label className="field">Cost ($)
          <input type="number" inputMode="decimal" min="0" step="0.01" value={cost}
            onChange={(e) => setCost(e.target.value)} placeholder="0.00" />
        </label>
      </div>

      {category === 'Ammo Purchase' && (
        <div className="card">
          <h2>Ammo Details</h2>
          <label className="field">Rounds purchased
            <input type="number" inputMode="numeric" min="0" value={rounds}
              onChange={(e) => setRounds(e.target.value)} placeholder="1000" />
          </label>
          <label className="field">Which ammo can
            <select value={ammoId} onChange={(e) => setAmmoId(e.target.value)}>
              <option value="">— Not linked —</option>
              {/* D6 fix (picker sweep, session 139): a linked can that's since been
                  deleted used to fall through to "— Not linked —", which is a
                  different, false statement — the purchase still holds the id,
                  Save still writes it back, and untouched this is a no-op either
                  way. "(removed)" is the same word labelOrRemoved already shows
                  on the read-only Malfunctions list for the same situation. */}
              {ammoId !== '' && !ammo.some((a) => a.id === ammoId) &&
                <option value={ammoId}>(removed)</option>}
              {ammo.map((a) => <option key={a.id} value={a.id}>{ammoLabel(a)}</option>)}
            </select>
          </label>
          <p className="report-note">
            Linking the can lets FirearmLog price every round you shoot from your real
            purchase history, oldest lot first.
          </p>
          <div className="row">
            <span className="label">Add these rounds to the can now</span>
            <button className={`gun-toggle ${addToInv ? 'on' : ''}`} aria-pressed={addToInv}
              onClick={() => setAddToInv((v) => !v)}>
              {addToInv ? 'Yes' : 'No'}
            </button>
          </div>
          <p className="report-note">
            Say No if the can's count already includes this ammo.
          </p>
        </div>
      )}

      <div className="card">
        <label className="field">Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <button className="button" disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : editing ? 'Save changes' : 'Save purchase'}
      </button>
      {editing && (
        <button className="button danger" style={{ marginTop: 8 }} onClick={() => setConfirming(true)}>
          Delete Purchase
        </button>
      )}
      {confirming && (
        <ConfirmSheet
          title="Delete this purchase?"
          message={original?.addedToInventory
            ? 'Its rounds come back off the linked ammo can, and the cost leaves your totals. There\'s no undo.'
            : 'The cost leaves your totals. There\'s no undo.'}
          confirmLabel="Delete Purchase"
          onConfirm={() => void reallyDelete()}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
