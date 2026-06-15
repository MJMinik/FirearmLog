// Ammo inventory (spec §15.6, §5.7): one row per ammo can — brand, caliber,
// grain, bullet type, rounds on hand, and what those rounds cost. The
// cost/round shown prefers the FIFO "in the can" number (from linked Ammo
// Purchases) and falls back to the manually typed figure.
import { useEffect, useState } from 'react';
import type { Ammunition, Purchase, Session } from '../lib/types.ts';
import { deleteOne, getAll, getOne, putOne } from '../lib/db.ts';
import { todayKey } from '../lib/dates.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { ammoCurrentCostPerRound, costPerRoundAfterBuy, lowAmmo } from '../lib/costing.ts';
import { combinedCan, findSameAmmo, repointAmmoUsage, repointPurchaseIds } from '../lib/ammoMerge.ts';
import { recentValues } from '../lib/suggest.ts';
import { SuggestField } from './SuggestField.tsx';
import { ConfirmSheet, Sheet } from './Sheet.tsx';
import { InfoTip } from './InfoTip.tsx';

export const ammoLabel = (a: Pick<Ammunition, 'brand' | 'caliber' | 'grain' | 'bulletType'>): string =>
  [a.brand, a.caliber, a.grain && `${a.grain}gr`, a.bulletType].filter(Boolean).join(' ');

export function AmmoScreen({ refreshKey, onBack, openForm }: {
  refreshKey: number; onBack: () => void; openForm: (id?: string) => void;
}) {
  const [ammo, setAmmo] = useState<Ammunition[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      getAll<Ammunition>('ammunition'), getAll<Purchase>('purchases'), getAll<Session>('sessions')
    ]).then(([a, p, s]) => {
      if (!alive) return;
      setAmmo(a.sort((x, y) => ammoLabel(x).localeCompare(ammoLabel(y))));
      setPurchases(p);
      setSessions(s);
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [refreshKey]);

  if (!loaded) return <div className="screen" />;
  const low = new Set(lowAmmo(ammo).map((a) => a.id));

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ More</button>
      </div>
      <h1 className="large-title">Ammo</h1>
      <button className="button" onClick={() => openForm()}>+ Add Ammo</button>
      {ammo.length === 0 ? (
        <p className="empty">No ammo tracked yet. Add a can, then log purchases under Costs &amp; Purchases so FirearmLog can figure your true cost per round.</p>
      ) : (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>On Hand <InfoTip title="On Hand">Rounds you have and what they cost. The cost per round is figured first-in-first-out — oldest purchases counted first — so it reflects what you actually paid for the rounds you're shooting.</InfoTip></h2>
          {ammo.map((a) => {
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

export function AmmoForm({ id, onSaved, onCancel }: {
  id?: string; onSaved: () => void; onCancel: () => void;
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
  const [problem, setProblem] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [dupe, setDupe] = useState<Ammunition | null>(null);

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
      setSessions(all);
      if (id !== undefined) {
        setUsedBy(all.filter((x) => (x.ammoUsage ?? []).some((u) => u.ammoId === id)).length);
      }
    });
    if (id !== undefined) {
      void getOne<Ammunition>('ammunition', id).then((a) => {
        if (!alive || !a) return;
        setOriginal(a);
        setBrand(a.brand); setCaliber(a.caliber); setGrain(a.grain);
        setBulletType(a.bulletType || 'FMJ');
        setQuantity(String(a.quantity || 0));
        setCostPerRound(a.costPerRound > 0 ? String(a.costPerRound) : '');
        setNotes(a.notes);
      });
    }
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
    if (!brand.trim() && !caliber.trim()) { setProblem('Give it at least a brand or a caliber.'); return null; }
    // On Add, the shelf-count fields only exist when "just counting" is open.
    const counting = editing || justCounting;
    const qty = !counting || quantity.trim() === '' ? 0 : Number(quantity);
    const cpr = !counting || costPerRound.trim() === '' ? 0 : Number(costPerRound);
    const pr = purchRounds.trim() === '' ? 0 : Number(purchRounds);
    const pc = purchCost.trim() === '' ? 0 : Number(purchCost);
    if (!Number.isFinite(qty) || qty < 0) { setProblem('Rounds on the shelf needs to be a plain number.'); return null; }
    if (!Number.isFinite(cpr) || cpr < 0) { setProblem('Cost per round needs to be a plain number, like 0.30.'); return null; }
    if (!Number.isFinite(pr) || pr < 0 || !Number.isFinite(pc) || pc < 0) {
      setProblem('The buy needs plain numbers for rounds and price.'); return null;
    }
    if ((pr > 0) !== (pc > 0)) {
      setProblem('Fill in both the rounds and what you paid for the buy.'); return null;
    }
    if (!editing && !justCounting && !(pr > 0)) {
      setProblem('Fill in the buy — rounds and what you paid. Not buying? Tap "Just counting the shelf" below.');
      return null;
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
    await putOne('ammunition', stampUpdate({
      ...other,
      quantity: merged.quantity + n.pr, // purchased rounds land on the kept can too
      costPerRound: merged.costPerRound,
      notes: [other.notes, extraNotes].filter(Boolean).join(' · ')
    }, now));
    await savePurchase(other.id, n.pr, n.pc, now);
    if (original) {
      // Every session and purchase that pointed at the duplicate now points
      // at the kept can, so history and FIFO costing survive the merge.
      const [sessions, purchases] = await Promise.all([
        getAll<Session>('sessions'), getAll<Purchase>('purchases')
      ]);
      for (const change of repointAmmoUsage(sessions, original.id, other.id)) {
        const s = sessions.find((x) => x.id === change.id);
        if (s) await putOne('sessions', stampUpdate({ ...s, ammoUsage: change.ammoUsage }, now));
      }
      for (const pid of repointPurchaseIds(purchases, original.id)) {
        const p = purchases.find((x) => x.id === pid);
        if (p) await putOne('purchases', stampUpdate({ ...p, ammoId: other.id }, now));
      }
      await deleteOne('ammunition', original.id);
    }
    onSaved();
  }

  async function reallyDelete() {
    if (id !== undefined) await deleteOne('ammunition', id);
    onSaved();
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onCancel}>‹ Cancel</button>
        <button className="navbar-action" onClick={() => void save()}>Save</button>
      </div>
      <h1 className="large-title">{editing ? 'Edit Ammo' : 'Add Ammo'}</h1>
      {problem && <p className="form-problem">{problem}</p>}
      <div className="card">
        <SuggestField label="Brand" value={brand} onChange={setBrand}
          suggestions={pastBrands} placeholder="Blazer Brass" />
        <SuggestField label="Caliber" value={caliber} onChange={setCaliber}
          suggestions={pastCalibers} placeholder="9mm" />
        <label className="field">Grain
          <input type="number" inputMode="numeric" value={grain} onChange={(e) => setGrain(e.target.value)} placeholder="115" />
        </label>
        <label className="field">Bullet type
          <select value={bulletType} onChange={(e) => setBulletType(e.target.value)}>
            {BULLET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        {editing && (
          <>
            <label className="field">Rounds on hand (live count)
              <input type="number" inputMode="numeric" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </label>
            <p className="report-note">
              This count runs itself — purchases add to it, sessions subtract. Only change it here to match a real shelf recount.
            </p>
            <label className="field">Cost per round ($, optional)
              <input type="number" inputMode="decimal" step="0.001" min="0" value={costPerRound}
                onChange={(e) => setCostPerRound(e.target.value)} placeholder="0.30" />
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
          <div className="card">
            <h2>The Buy</h2>
            <label className="field">Rounds purchased
              <input type="number" inputMode="numeric" min="0" value={purchRounds}
                onChange={(e) => setPurchRounds(e.target.value)} placeholder="1000" />
            </label>
            <label className="field">What you paid, total ($)
              <input type="number" inputMode="decimal" min="0" step="0.01" value={purchCost}
                onChange={(e) => setPurchCost(e.target.value)} placeholder="299.99" />
            </label>
            <SuggestField label="Vendor (optional)" value={purchVendor} onChange={setPurchVendor}
              suggestions={pastVendors} placeholder="Primary Arms" />
            <p className="report-note">
              One Save does it all: the buy lands under Costs &amp; Purchases, the rounds go
              on the shelf, and every round you shoot from this can gets priced from your
              buys, oldest first.
            </p>
          </div>

          <div className="card">
            <h2>On the Shelf After Saving</h2>
            {match && (
              <p className="report-note" style={{ marginTop: 0 }}>
                This is the {ammoLabel(match)} can you already track
                ({(match.quantity || 0).toLocaleString()} rounds on hand) — Save will
                offer to put this buy on it.
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
            <button className={`gun-toggle ${justCounting ? 'on' : ''}`} aria-pressed={justCounting}
              onClick={() => setJustCounting(!justCounting)}>
              Just counting the shelf — no buy to log
            </button>
            {justCounting && (
              <>
                <label className="field" style={{ marginTop: 8 }}>Rounds on the shelf right now
                  <input type="number" inputMode="numeric" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                </label>
                <label className="field">Cost per round ($, optional)
                  <input type="number" inputMode="decimal" step="0.001" min="0" value={costPerRound}
                    onChange={(e) => setCostPerRound(e.target.value)} placeholder="0.30" />
                </label>
                <p className="report-note">
                  For ammo you already own — bought before you started tracking. The
                  cost is only used for sessions older than your purchase history.
                </p>
              </>
            )}
          </div>

          <div className="card">
            <label className="field">Notes
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
        </>
      )}

      <button className="button" onClick={() => void save()}>{editing ? 'Save Changes' : 'Save Ammo'}</button>
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
            averages out, and {original ? 'every session and purchase that used this can follows along' : 'nothing else changes'}.
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
            ? `${usedBy} session${usedBy === 1 ? ' used' : 's used'} this ammo — those will show "ammo deleted." There's no undo.`
            : "This removes the can from your inventory. There's no undo."}
          confirmLabel="Delete Ammo"
          onConfirm={() => void reallyDelete()}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
