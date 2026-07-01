// Costs & Purchases (spec §12): what shooting costs, with every dollar counted
// exactly once. Range fees come straight off sessions, match fees straight off
// matches (the single-source rule) — purchases cover everything else. Per-gun
// spend prorates multi-gun sessions by rounds (the old F2 bug, now unit-tested).
import { useEffect, useState } from 'react';
import type { Ammunition, Firearm, Match, Part, Purchase, Session } from '../lib/types.ts';
import { deleteOne, getAll, getOne, putOne } from '../lib/db.ts';
import { activeOnly } from '../lib/softDelete.ts';
import { formatDayKey, todayKey } from '../lib/dates.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { costTotals, gunSpend, purchaseAmmoLink, roundsFired } from '../lib/costing.ts';
import { recentValues } from '../lib/suggest.ts';
import { ammoLabel } from './AmmoScreens.tsx';
import { SuggestField } from './SuggestField.tsx';
import { InfoTip } from './InfoTip.tsx';
import { ConfirmSheet } from './Sheet.tsx';
import { FormProblem } from './FormProblem.tsx';
import { ListSearch, matchesQuery } from './ListSearch.tsx';
import { ScreenError } from './ScreenState.tsx';

const CATEGORIES = [
  'Ammo Purchase', 'Range Fee', 'Gear / Equipment', 'Service / Repair',
  'Training / Class', 'Travel', 'Other'
];

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
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    setError(false);
    void Promise.all([
      getAll<Session>('sessions'), getAll<Purchase>('purchases'), getAll<Match>('matches'),
      getAll<Firearm>('firearms'), getAll<Ammunition>('ammunition'), getAll<Part>('parts')
    ]).then(([s, p, m, f, a, pt]) => {
      if (!alive) return;
      setSessions(activeOnly(s)); // App 7: trashed sessions never count toward costs
      // Date-safe sort: a purchase with a missing date must never crash the
      // load (a rejected promise here would hang the whole screen forever).
      setPurchases(p.sort((x, y) => (y.date || '').localeCompare(x.date || '')));
      setMatches(m);
      setFirearms(f);
      setAmmo(a);
      setParts(pt);
      setLoaded(true);
    }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [refreshKey, reloadNonce]);

  if (error) return <ScreenError onRetry={() => setReloadNonce((n) => n + 1)} />;
  if (!loaded) return <div className="screen" />;

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
        <button className="back-btn" onClick={onBack}>‹ Back</button>
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
          <h2>Spend by Gun <InfoTip title="Spend by Gun">Each gun's share of ammo, range fees, match fees, and parts. When a session or match used more than one gun, the cost is split by each gun's actual rounds, so nothing is double-counted.</InfoTip></h2>
          <p className="report-note" style={{ marginBottom: 8 }}>
            Ammo shot up (oldest purchases first) plus each gun's share of range fees —
            split sessions are divided by rounds, never counted twice — plus its match fees.
          </p>
          {firearms.map((f) => {
            const g = gunSpend(f.id, sessions, purchases, matches, ammo, parts);
            if (g.total === 0) return null;
            return (
              <div className="row" key={f.id}>
                <span className="label">{f.name}
                  <div className="row-sub">
                    {[g.ammo > 0 && `${dollars(g.ammo)} ammo`,
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
          <p className="report-note">Nothing logged yet. Ammo, gear, classes, travel — put it here and the totals above keep themselves honest.</p>
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
            From Spare Parts &amp; Inventory. Tap one to edit it there.
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

export function PurchaseForm({ id, onSaved, onCancel }: {
  id?: string; onSaved: () => void; onCancel: () => void;
}) {
  const editing = id !== undefined;
  const [original, setOriginal] = useState<Purchase | null>(null);
  const [ammo, setAmmo] = useState<Ammunition[]>([]);
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
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void getAll<Ammunition>('ammunition').then((a) => {
      if (alive) setAmmo(a.sort((x, y) => ammoLabel(x).localeCompare(ammoLabel(y))));
    });
    void getAll<Purchase>('purchases').then((all) => {
      if (!alive) return;
      setPastVendors(recentValues(all.map((p) => ({ date: p.date, value: p.vendor }))));
      setPastItems(recentValues(all.map((p) => ({ date: p.date, value: p.item }))));
    });
    if (id !== undefined) {
      void getOne<Purchase>('purchases', id).then((p) => {
        if (!alive || !p) return;
        setOriginal(p);
        setDate(p.date || todayKey());
        setCategory(p.category || 'Other');
        setItem(p.item); setVendor(p.vendor);
        setCost(p.cost ? String(p.cost) : '');
        const link = purchaseAmmoLink(p);
        setRounds(link ? String(link.rounds) : '');
        setAmmoId(link?.ammoId ?? '');
        setAddToInv(p.addedToInventory === true);
        setNotes(p.notes);
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

  async function save() {
    if (saving) return;
    if (!item.trim()) { setProblem('Name the item — "1,000 rds Blazer 115gr", "match belt", whatever it was.'); return; }
    const c = cost.trim() === '' ? 0 : Number(cost);
    if (!Number.isFinite(c) || c < 0) { setProblem('Cost needs to be a plain number.'); return; }
    const isAmmo = category === 'Ammo Purchase';
    const r = isAmmo && rounds.trim() !== '' ? Number(rounds) : null;
    if (r !== null && (!Number.isFinite(r) || r < 0)) { setProblem('Rounds needs to be a plain number.'); return; }

    setSaving(true);
    try {
      const now = Date.now();
      // Clear stale ammo fields when the category moves away from Ammo Purchase
      // (the old app's F6 fix, kept).
      const fields = {
        date, category, item: item.trim(), vendor: vendor.trim(), cost: c, notes: notes.trim(),
        ammoId: isAmmo && ammoId ? ammoId : null,
        rounds: isAmmo ? r : null,
        addedToInventory: isAmmo && addToInv && !!ammoId && (r ?? 0) > 0
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
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function reallyDelete() {
    if (original) {
      await reverseOldBump(original);
      await deleteOne('purchases', original.id);
    }
    onSaved();
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onCancel}>‹ Cancel</button>
        <button className="navbar-action" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <h1 className="large-title">{editing ? 'Edit Purchase' : 'Add Purchase'}</h1>
      <FormProblem problem={problem} />
      <div className="card">
        <label className="field">Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        </label>
        <SuggestField label="Item" value={item} onChange={setItem} suggestions={pastItems}
          placeholder={category === 'Ammo Purchase' ? '1,000 rds Blazer Brass 115gr' : 'Safariland holster'} />
        <SuggestField label="Vendor (optional)" value={vendor} onChange={setVendor}
          suggestions={pastVendors} placeholder="Primary Arms" />
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
        {saving ? 'Saving…' : editing ? 'Save Changes' : 'Save Purchase'}
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
