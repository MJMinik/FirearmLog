// Ammo inventory (spec §15.6, §5.7): one row per ammo can — brand, caliber,
// grain, bullet type, rounds on hand, and what those rounds cost. The
// cost/round shown prefers the FIFO "in the can" number (from linked Ammo
// Purchases) and falls back to the manually typed figure.
import { useEffect, useRef, useState } from 'react';
import { ScreenLoading } from './ScreenState.tsx';
import type { Ammunition, Purchase, Session } from '../lib/types.ts';
import { applyAmmoMerge, deleteOne, getAll, getOne, getSettings, putOne } from '../lib/db.ts';
import { activeOnly } from '../lib/softDelete.ts';
import { todayKey } from '../lib/dates.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { ammoCurrentCostPerRound, costPerRoundAfterBuy, lowAmmo } from '../lib/costing.ts';
import { combinedCan, findSameAmmo, repointAmmoUsage, repointPurchaseIds } from '../lib/ammoMerge.ts';
import { optionsWithStored } from '../lib/competition.ts';
import { recentValues } from '../lib/suggest.ts';
import { filterHidden } from '../lib/listEdits.ts';
import { SuggestField } from './SuggestField.tsx';
import { ConfirmSheet, DiscardChangesSheet, Sheet } from './Sheet.tsx';
import { useDirtyTracker } from './useDirtyTracker.ts';
import { InfoTip } from './InfoTip.tsx';
import { FieldProblem, type SaveProblem } from './FieldProblem.tsx';
import { ListSearch, matchesQuery } from './ListSearch.tsx';
import { ScreenError } from './ScreenState.tsx';

export const ammoLabel = (a: Pick<Ammunition, 'brand' | 'caliber' | 'grain' | 'bulletType'>): string =>
  [a.brand, a.caliber, a.grain && `${a.grain}gr`, a.bulletType].filter(Boolean).join(' ');

export function AmmoScreen({ refreshKey, onBack, openForm }: {
  refreshKey: number; onBack: () => void; openForm: (id?: string) => void;
}) {
  const [ammo, setAmmo] = useState<Ammunition[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    setError(false);
    void Promise.all([
      getAll<Ammunition>('ammunition'), getAll<Purchase>('purchases'), getAll<Session>('sessions')
    ]).then(([a, p, s]) => {
      if (!alive) return;
      setAmmo(a.sort((x, y) => ammoLabel(x).localeCompare(ammoLabel(y))));
      setPurchases(p);
      setSessions(activeOnly(s)); // App 7: trashed sessions don't count usage
      setLoaded(true);
    }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [refreshKey, reloadNonce]);

  if (error) return <ScreenError onRetry={() => setReloadNonce((n) => n + 1)} />;
  if (!loaded) return <ScreenLoading />;
  const low = new Set(lowAmmo(ammo).map((a) => a.id));

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn section-back" onClick={onBack}>‹ Back</button>
      </div>
      <h1 className="large-title">Ammo <InfoTip title="Ammo">Every kind of ammo you have on hand — rounds left and their cost per round. Cost is figured first-in-first-out (oldest rounds counted first), so it reflects what you actually paid; log your ammo buys under Costs &amp; Purchases to keep it accurate.</InfoTip></h1>
      <button className="button" onClick={() => openForm()}>+ Add Ammo</button>
      {ammo.length > 8 && <ListSearch value={q} onChange={setQ} placeholder="Search ammo" />}
      {ammo.length === 0 ? (
        <p className="empty">No ammo tracked yet. Add a can, then log purchases under Costs &amp; Purchases so FirearmLog can figure your true cost per round.</p>
      ) : (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>On Hand <InfoTip title="On Hand">Rounds you have and what they cost. The cost per round is figured first-in-first-out — oldest purchases counted first — so it reflects what you actually paid for the rounds you're shooting. To add more of the same ammo, add it again with the same brand, caliber, grain, and bullet type — FirearmLog spots the match and offers to combine it into that can, keeping your cost history.</InfoTip></h2>
          {ammo.filter((a) => matchesQuery(q, ammoLabel(a), a.brand, a.caliber, a.bulletType)).map((a) => {
            const inCan = ammoCurrentCostPerRound(a.id, purchases, sessions);
            const perRound = inCan ?? (a.costPerRound > 0 ? a.costPerRound : null);
            return (
              <button className="row-tap" key={a.id} onClick={() => openForm(a.id)}>
                <span className="label">
                  {ammoLabel(a) || 'Unnamed ammo'}
                  <div className="row-sub">
                    {perRound !== null
                      ? `$${perRound.toFixed(3)}/round${inCan !== null ? '' : ' (typed in, not from purchases)'}`
                      : 'No cost info yet'}
                  </div>
                </span>
                <span className="value">
                  {(a.quantity || 0).toLocaleString()} rds
                  {low.has(a.id) && <span className="badge warn-badge" style={{ marginLeft: 6 }}>Low</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <p className="report-note">
        Rounds come off a can automatically when you log a session that used it,
        and go on when you log an ammo purchase linked to it.
      </p>
    </div>
  );
}

const BULLET_TYPES = ['FMJ', 'JHP', 'TMJ', 'LRN', 'Frangible', 'Birdshot', 'Buckshot', 'Slug', 'Other'];

export function AmmoForm({ id, onSaved, onCancel, onDirtyChange, onSaverChange }: {
  id?: string; onSaved: () => void; onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  // Save-from-guard excluded: AmmoForm's save can open a duplicate-ammo confirm
  // dialog (setDupe) before persisting — that multi-step path can't safely run
  // from inside the discard sheet. onSaverChange is accepted but never reports
  // a saver, so the guard always shows two buttons on this form.
  onSaverChange?: (fn: (() => Promise<boolean>) | null) => void;
}) {
  const editing = id !== undefined;
  const [original, setOriginal] = useState<Ammunition | null>(null);
  const [brand, setBrand] = useState('');
  const [caliber, setCaliber] = useState('9mm');
  const [grain, setGrain] = useState('');
  const [bulletType, setBulletType] = useState('FMJ');
  const [quantity, setQuantity] = useState('');
  const [costPerRound, setCostPerRound] = useState('');
  const [notes, setNotes] = useState('');
  const [usedBy, setUsedBy] = useState(0);
  const [allAmmo, setAllAmmo] = useState<Ammunition[]>([]);
  const [purchRounds, setPurchRounds] = useState('');
  const [purchCost, setPurchCost] = useState('');
  const [purchVendor, setPurchVendor] = useState('');
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [justCounting, setJustCounting] = useState(false);
  const [problem, setProblem] = useState<SaveProblem>(null);
  const ammoGroupRef = useRef<HTMLDivElement>(null);
  const quantityFieldRef = useRef<HTMLInputElement>(null);
  const costPerRoundFieldRef = useRef<HTMLInputElement>(null);
  const purchNumbersRef = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [dupe, setDupe] = useState<Ammunition | null>(null);
  const [discarding, setDiscarding] = useState(false);
  // AUDIT FIX (July 20 2026): on EDIT, gate the dirty baseline on the async
  // getOne load — otherwise the baseline is empty strings and a clean close
  // fires "Discard changes?". New: loaded starts true; nothing to wait for.
  const [loaded, setLoaded] = useState<boolean>(!editing);
  const [hiddenSuggestions, setHiddenSuggestions] = useState<Record<string, string[]>>({});
  const dirty = useDirtyTracker({ brand, caliber, grain, bulletType, quantity, costPerRound, notes, purchRounds, purchCost, purchVendor, justCounting }, loaded);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  // Save-from-guard excluded (see prop comment). Report null on mount/unmount so
  // App's ref is always clear when this form is shown.
  useEffect(() => { onSaverChange?.(null); return () => onSaverChange?.(null); }, [onSaverChange]);

  useEffect(() => {
    let alive = true;
    void getAll<Ammunition>('ammunition').then((cans) => {
      if (alive) setAllAmmo(cans);
    });
    void getAll<Purchase>('purchases').then((all) => {
      if (alive) setPurchases(all);
    });
    void getAll<Session>('sessions').then((all) => {
      if (!alive) return;
      const live = activeOnly(all); // App 7: trashed sessions don't count usage
      setSessions(live);
      if (id !== undefined) {
        setUsedBy(live.filter((x) => (x.ammoUsage ?? []).some((u) => u.ammoId === id)).length);
      }
    });
    if (id !== undefined) {
      void getOne<Ammunition>('ammunition', id).then((a) => {
        if (!alive || !a) return;
        setOriginal(a);
        setBrand(a.brand); setCaliber(a.caliber); setGrain(a.grain);
        // D2 fix (picker sweep, session 139): the stored value, unchanged — not
        // `a.bulletType || 'FMJ'`. That substitution showed FMJ for a blank can
        // (the migration reader writes '' when the source had no bullet type)
        // and the "Discard changes?" baseline was taken AFTER it, so a plain
        // quantity edit and Save wrote FMJ into a record that never said so.
        // A NEW can still starts on 'FMJ' (the useState default above) — this
        // only touches what an EXISTING can loads as.
        setBulletType(a.bulletType);
        setQuantity(String(a.quantity || 0));
        setCostPerRound(a.costPerRound > 0 ? String(a.costPerRound) : '');
        setNotes(a.notes);
        setLoaded(true); // AUDIT FIX: seed dirty baseline now, not before load.
      });
    }
    void getSettings<{ hiddenSuggestions?: Record<string, string[]> }>().then((s) => {
      if (alive) setHiddenSuggestions(s?.hiddenSuggestions ?? {});
    });
    return () => { alive = false; };
  }, [id]);

  const pastBrands = recentValues(allAmmo.map((a) => ({ date: String(a.updatedAt), value: a.brand })));
  const pastCalibers = recentValues(allAmmo.map((a) => ({ date: String(a.updatedAt), value: a.caliber })));
  const pastVendors = recentValues(purchases.map((p) => ({ date: p.date, value: p.vendor })));

  // Live "what your shelf looks like after Save" readout (informational only).
  const match = !editing
    ? findSameAmmo(allAmmo, { brand: brand.trim(), caliber: caliber.trim(), grain: grain.trim(), bulletType })
    : undefined;
  const prN = Number(purchRounds) > 0 ? Number(purchRounds) : 0;
  const pcN = Number(purchCost) > 0 ? Number(purchCost) : 0;
  const buying = prN > 0 && pcN > 0;
  const qtyN = justCounting && Number(quantity) > 0 ? Number(quantity) : 0;
  const cprN = justCounting && Number(costPerRound) > 0 ? Number(costPerRound) : 0;
  const shelfAfter = (match?.quantity ?? 0) + qtyN + (buying ? prN : 0);
  const costAfter = costPerRoundAfterBuy(
    match?.id ?? null, purchases, sessions,
    match && match.costPerRound > 0 ? match.costPerRound : cprN,
    (match?.quantity ?? 0) + qtyN,
    buying ? prN : 0, buying ? pcN : 0
  );

  function checkNumbers(): { qty: number; cpr: number; pr: number; pc: number } | null {
    if (!brand.trim() && !caliber.trim()) { setProblem({ field: 'ammoGroup', message: 'Give it at least a brand or a caliber.' }); setTimeout(() => { ammoGroupRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 0); return null; }
    // On Add, the shelf-count fields only exist when "just counting" is open.
    const counting = editing || justCounting;
    const qty = !counting || quantity.trim() === '' ? 0 : Number(quantity);
    const cpr = !counting || costPerRound.trim() === '' ? 0 : Number(costPerRound);
    const pr = purchRounds.trim() === '' ? 0 : Number(purchRounds);
    const pc = purchCost.trim() === '' ? 0 : Number(purchCost);
    if (!Number.isFinite(qty) || qty < 0) { setProblem({ field: 'quantity', message: 'Rounds on the shelf needs to be a plain number.' }); setTimeout(() => { quantityFieldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); quantityFieldRef.current?.focus(); }, 0); return null; }
    if (!Number.isFinite(cpr) || cpr < 0) { setProblem({ field: 'costPerRound', message: 'Cost per round needs to be a plain number, like 0.30.' }); setTimeout(() => { costPerRoundFieldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); costPerRoundFieldRef.current?.focus(); }, 0); return null; }
    if (!Number.isFinite(pr) || pr < 0 || !Number.isFinite(pc) || pc < 0) {
      setProblem({ field: 'purchNumbers', message: 'The buy needs plain numbers for rounds and price.' });
      setTimeout(() => { purchNumbersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 0); return null;
    }
    if ((pr > 0) !== (pc > 0)) {
      setProblem({ field: 'purchNumbers', message: 'Fill in both the rounds and what you paid for the buy.' });
      setTimeout(() => { purchNumbersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 0); return null;
    }
    if (!editing && !justCounting && !(pr > 0)) {
      setProblem({ field: 'purchNumbers', message: 'Fill in the buy — rounds and what you paid. Not buying? Tap "Just counting the shelf" below.' });
      setTimeout(() => { purchNumbersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 0); return null;
    }
    return { qty, cpr, pr, pc };
  }

  /** The "Buying it now?" section saves a real Ammo Purchase linked to the can. */
  async function savePurchase(canId: string, pr: number, pc: number, now: number) {
    if (!(pr > 0) || !(pc > 0)) return;
    const label = ammoLabel({ brand: brand.trim(), caliber: caliber.trim(), grain: grain.trim(), bulletType });
    await putOne('purchases', stampNew({
      date: todayKey(), category: 'Ammo Purchase',
      item: `${pr.toLocaleString()} rds ${label}`.trim(),
      vendor: purchVendor.trim(), cost: pc, notes: '',
      ammoId: canId, rounds: pr, addedToInventory: true
    }, newId('pu'), now));
  }

  async function save(keepSeparate = false) {
    const n = checkNumbers();
    if (!n) return;
    const fields = {
      brand: brand.trim(), caliber: caliber.trim(), grain: grain.trim(),
      bulletType, quantity: n.qty, costPerRound: n.cpr, notes: notes.trim()
    };
    if (!keepSeparate) {
      const other = findSameAmmo(allAmmo, fields, original?.id);
      if (other) { setDupe(other); return; }
    }
    const now = Date.now();
    // Purchased rounds go on the shelf on top of whatever was typed above.
    const canId = original ? original.id : newId('am');
    const withPurchase = { ...fields, quantity: fields.quantity + n.pr };
    if (original) await putOne('ammunition', stampUpdate({ ...original, ...withPurchase }, now));
    else await putOne('ammunition', stampNew(withPurchase, canId, now));
    await savePurchase(canId, n.pr, n.pc, now);
    onDirtyChange?.(false);
    onSaved();
  }

  /** Pour this form's rounds into the can we already track (and, when editing,
      move the old can's history over before removing it). */
  async function combineInto(other: Ammunition) {
    const n = checkNumbers();
    if (!n) { setDupe(null); return; }
    const now = Date.now();
    const merged = combinedCan(other, { quantity: n.qty, costPerRound: n.cpr });
    const extraNotes = notes.trim() && notes.trim() !== other.notes ? notes.trim() : '';
    const keptCan = stampUpdate({
      ...other,
      quantity: merged.quantity + n.pr, // purchased rounds land on the kept can too
      costPerRound: merged.costPerRound,
      notes: [other.notes, extraNotes].filter(Boolean).join(' · ')
    }, now);
    const label = ammoLabel({ brand: brand.trim(), caliber: caliber.trim(), grain: grain.trim(), bulletType });
    const newPurchase = (n.pr > 0 && n.pc > 0)
      ? stampNew({
          date: todayKey(), category: 'Ammo Purchase',
          item: `${n.pr.toLocaleString()} rds ${label}`.trim(),
          vendor: purchVendor.trim(), cost: n.pc, notes: '',
          ammoId: other.id, rounds: n.pr, addedToInventory: true
        }, newId('pu'), now)
      : undefined;
    const sessionRecs: object[] = [];
    const purchaseRecs: object[] = [];
    let deleteCanId: string | undefined;
    if (original) {
      // Every session and purchase that pointed at the duplicate now points at
      // the kept can, so history and FIFO costing survive the merge.
      // NB: include trashed sessions here on purpose — a merged-away can must be
      // repointed on EVERY session (App 7), or a later restore would dangle.
      const [sessions, purchases] = await Promise.all([
        getAll<Session>('sessions'), getAll<Purchase>('purchases')
      ]);
      for (const change of repointAmmoUsage(sessions, original.id, other.id)) {
        const s = sessions.find((x) => x.id === change.id);
        if (s) sessionRecs.push(stampUpdate({ ...s, ammoUsage: change.ammoUsage }, now));
      }
      for (const pid of repointPurchaseIds(purchases, original.id)) {
        const p = purchases.find((x) => x.id === pid);
        if (p) purchaseRecs.push(stampUpdate({ ...p, ammoId: other.id }, now));
      }
      deleteCanId = original.id;
    }
    // Audit CR-8: the whole merge lands in ONE transaction (can + repointed
    // sessions/purchases + the buy + deleting the old can) — never half-applied.
    await applyAmmoMerge({ keptCan, sessions: sessionRecs, purchases: purchaseRecs, newPurchase, deleteCanId });
    onDirtyChange?.(false);
    onSaved();
  }

  async function reallyDelete() {
    if (id !== undefined) await deleteOne('ammunition', id);
    onDirtyChange?.(false);
    onSaved();
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={() => (dirty ? setDiscarding(true) : onCancel())}>‹ Cancel</button>
        <button className="navbar-action" onClick={() => void save()}>Save</button>
      </div>
      {discarding && (
        <DiscardChangesSheet
          onConfirm={() => { onDirtyChange?.(false); onCancel(); }}
          onClose={() => setDiscarding(false)} />
      )}
      <h1 className="large-title">{editing ? 'Edit Ammo' : 'Add Ammo'}</h1>
      {problem && !['ammoGroup', 'quantity', 'costPerRound', 'purchNumbers'].includes(problem.field) && (
        <p className="form-problem" role="alert">{problem.message}</p>
      )}
      <div className="card" ref={ammoGroupRef}>
        <FieldProblem id="ammo-group-err" problem={problem} field="ammoGroup" />
        <SuggestField label="Brand" value={brand} onChange={(v) => { setBrand(v); if (problem?.field === 'ammoGroup') setProblem(null); }}
          suggestions={filterHidden(pastBrands, hiddenSuggestions, 'ammo-brands')} placeholder="Blazer Brass" />
        <SuggestField label="Caliber" value={caliber} onChange={(v) => { setCaliber(v); if (problem?.field === 'ammoGroup') setProblem(null); }}
          suggestions={filterHidden(pastCalibers, hiddenSuggestions, 'calibers')} placeholder="9mm" />
        <label className="field">Grain
          <input type="number" inputMode="numeric" value={grain} onChange={(e) => setGrain(e.target.value)} placeholder="115" />
        </label>
        <label className="field">Bullet type
          <select value={bulletType} onChange={(e) => setBulletType(e.target.value)}>
            {/* D2 fix: the stored value always gets an option, including a blank
                one (an unlisted bullet type, or a can whose bullet type was never
                recorded) — optionsWithStored injects it so the select never falls
                through to BULLET_TYPES[0], FMJ, for a can that isn't FMJ. */}
            {optionsWithStored(BULLET_TYPES, bulletType).map((t) =>
              <option key={t === '' ? '__blank__' : t} value={t}>{t === '' ? 'Not recorded' : t}</option>)}
          </select>
        </label>
        {editing && (
          <>
            <label className={`field${problem?.field === 'quantity' ? ' invalid' : ''}`}>Rounds on hand (live count)
              <input
                ref={quantityFieldRef}
                id="ammo-quantity-input"
                type="number" inputMode="numeric" min="0"
                value={quantity}
                onChange={(e) => { setQuantity(e.target.value); if (problem?.field === 'quantity') setProblem(null); }}
                aria-invalid={problem?.field === 'quantity' || undefined}
                aria-describedby={problem?.field === 'quantity' ? 'ammo-quantity-err' : undefined} />
              <FieldProblem id="ammo-quantity-err" problem={problem} field="quantity" />
            </label>
            <p className="report-note">
              This count runs itself — purchases add to it, sessions subtract. Only change it here to match a real shelf recount.
            </p>
            <label className={`field${problem?.field === 'costPerRound' ? ' invalid' : ''}`}>Cost per round ($, optional)
              <input
                ref={costPerRoundFieldRef}
                id="ammo-cpr-input"
                type="number" inputMode="decimal" step="0.001" min="0"
                value={costPerRound}
                onChange={(e) => { setCostPerRound(e.target.value); if (problem?.field === 'costPerRound') setProblem(null); }}
                aria-invalid={problem?.field === 'costPerRound' || undefined}
                aria-describedby={problem?.field === 'costPerRound' ? 'ammo-cpr-err' : undefined}
                placeholder="0.30" />
              <FieldProblem id="ammo-cpr-err" problem={problem} field="costPerRound" />
            </label>
            <p className="report-note">
              Only needed for sessions older than your purchase history — once you log
              ammo purchases, FirearmLog works out the real cost per round on its own.
            </p>
            <label className="field">Notes
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </>
        )}
      </div>

      {!editing && (
        <>
          {/* Audit #14: pick the mode FIRST — logging a purchase vs. just recording
              ammo you already own — so someone counting their shelf isn't led
              through purchase fields they don't need. */}
          <div className="card">
            <h2>What are you doing?</h2>
            <div className="seg" role="group" aria-label="Ammo entry mode">
              <button type="button" aria-pressed={!justCounting} className={!justCounting ? 'on' : ''}
                onClick={() => { setJustCounting(false); setQuantity(''); setCostPerRound(''); }}>Logging a purchase</button>
              <button type="button" aria-pressed={justCounting} className={justCounting ? 'on' : ''}
                onClick={() => { setJustCounting(true); setPurchRounds(''); setPurchCost(''); setPurchVendor(''); }}>Just counting what I have</button>
            </div>
            {justCounting && (
              <>
                <label className={`field${problem?.field === 'quantity' ? ' invalid' : ''}`} style={{ marginTop: 8 }}>Rounds on the shelf right now
                  <input
                    ref={quantityFieldRef}
                    id="ammo-quantity-input"
                    type="number" inputMode="numeric" min="0"
                    value={quantity}
                    onChange={(e) => { setQuantity(e.target.value); if (problem?.field === 'quantity') setProblem(null); }}
                    aria-invalid={problem?.field === 'quantity' || undefined}
                    aria-describedby={problem?.field === 'quantity' ? 'ammo-quantity-input-err' : undefined} />
                  <FieldProblem id="ammo-quantity-input-err" problem={problem} field="quantity" />
                </label>
                <label className={`field${problem?.field === 'costPerRound' ? ' invalid' : ''}`}>Cost per round ($, optional)
                  <input
                    ref={costPerRoundFieldRef}
                    id="ammo-cpr-new-input"
                    type="number" inputMode="decimal" step="0.001" min="0"
                    value={costPerRound}
                    onChange={(e) => { setCostPerRound(e.target.value); if (problem?.field === 'costPerRound') setProblem(null); }}
                    aria-invalid={problem?.field === 'costPerRound' || undefined}
                    aria-describedby={problem?.field === 'costPerRound' ? 'ammo-cpr-new-err' : undefined}
                    placeholder="0.30" />
                  <FieldProblem id="ammo-cpr-new-err" problem={problem} field="costPerRound" />
                </label>
                <p className="report-note">
                  For ammo you already own — bought before you started tracking. The
                  cost is only used for sessions older than your purchase history.
                </p>
              </>
            )}
          </div>

          {!justCounting && (
            <div className="card" ref={purchNumbersRef}>
              <h2>The Buy</h2>
              <FieldProblem id="ammo-purch-err" problem={problem} field="purchNumbers" />
              <label className="field">Rounds purchased
                <input type="number" inputMode="numeric" min="0" value={purchRounds}
                  onChange={(e) => { setPurchRounds(e.target.value); if (problem?.field === 'purchNumbers') setProblem(null); }} placeholder="1000" />
              </label>
              <label className="field">What you paid, total ($)
                <input type="number" inputMode="decimal" min="0" step="0.01" value={purchCost}
                  onChange={(e) => { setPurchCost(e.target.value); if (problem?.field === 'purchNumbers') setProblem(null); }} placeholder="299.99" />
              </label>
              <SuggestField label="Vendor (optional)" value={purchVendor} onChange={setPurchVendor}
                suggestions={filterHidden(pastVendors, hiddenSuggestions, 'vendors')} placeholder="Primary Arms" />
              <p className="report-note">
                One Save does it all: the buy lands under Costs &amp; Purchases, the rounds go
                on the shelf, and every round you shoot from this can gets priced from your
                buys, oldest first.
              </p>
            </div>
          )}

          <div className="card">
            <h2>On the Shelf After Saving</h2>
            {match && (
              <p className="report-note" style={{ marginTop: 0 }}>
                This is the {ammoLabel(match)} can you already track
                ({(match.quantity || 0).toLocaleString()} rounds on hand) — Save will
                offer to put this on it.
              </p>
            )}
            <div className="row">
              <span className="label">Rounds on the shelf</span>
              <span className="value">{shelfAfter.toLocaleString()}</span>
            </div>
            <div className="row">
              <span className="label">Average cost per round</span>
              <span className="value">{costAfter !== null ? `$${costAfter.toFixed(3)}` : '—'}</span>
            </div>
            <p className="report-note">
              These two run themselves from here on — buys add to the shelf, logged
              sessions subtract, and the cost averages across what's left.
            </p>
          </div>

          <div className="card">
            <label className="field">Notes
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
        </>
      )}

      <button className="button" onClick={() => void save()}>{editing ? 'Save changes' : 'Save ammo'}</button>
      {editing && (
        <button className="button danger" style={{ marginTop: 8 }} onClick={() => setConfirming(true)}>
          Delete Ammo
        </button>
      )}
      {dupe && (
        <Sheet title="You Already Track This Ammo" onClose={() => setDupe(null)}>
          <p className="report-note" style={{ marginBottom: 12 }}>
            {ammoLabel(dupe)} is already on your shelf with {(dupe.quantity || 0).toLocaleString()} rounds
            on hand. Combine the two into one can? Rounds add together, the cost per round
            averages across only the rounds that have a known cost (a can with no cost set
            won't pull the average toward $0), and {original ? 'every session and purchase that used this can follows along' : 'nothing else changes'}.
          </p>
          <button className="button" onClick={() => { setDupe(null); void combineInto(dupe); }}>
            Combine Into One Can
          </button>
          <div style={{ height: 8 }} />
          <button className="button secondary" onClick={() => { setDupe(null); void save(true); }}>
            Keep as Separate Cans
          </button>
        </Sheet>
      )}
      {confirming && (
        <ConfirmSheet
          title="Delete this ammo?"
          message={usedBy > 0
            // D6 fix: this used to promise those sessions "will show 'ammo
            // deleted'," which nothing in the app renders — a grep found the
            // words only in this promise. What the app actually shows for a
            // deleted can, on every screen that reads it back, is "(removed)".
            ? `${usedBy} session${usedBy === 1 ? '' : 's'} used this ammo and will show "(removed)" for it. There's no undo.`
            : "This removes the can from your inventory. There's no undo."}
          confirmLabel="Delete Ammo"
          onConfirm={() => void reallyDelete()}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
