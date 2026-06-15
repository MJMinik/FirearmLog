// Spare Parts & Inventory — its own section (split out of the Optics screen,
// Michael's June 14 request). Spare parts (tied to a gun or "Any / Universal")
// PLUS any optic not currently mounted on a firearm, which lives here as
// inventory until you assign it to a gun. Includes a printable report.
import { useEffect, useState } from 'react';
import type { Firearm, Optic, Part } from '../lib/types.ts';
import { deleteOne, getAll, getOne, putOne } from '../lib/db.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { formatDayKey, todayKey } from '../lib/dates.ts';
import { isBatteryDue } from '../lib/optics.ts';
import { recentValues } from '../lib/suggest.ts';
import { buildPartsReportHtml, opticLabel } from '../lib/partsReport.ts';
import { ConfirmSheet } from './Sheet.tsx';
import { InfoTip } from './InfoTip.tsx';
import { SuggestField, noAutofillProps } from './SuggestField.tsx';

export function PartsScreen({ refreshKey, onBack, openPartForm, openOpticForm }: {
  refreshKey: number; onBack: () => void;
  openPartForm: (id?: string) => void; openOpticForm: (id?: string) => void;
}) {
  const [parts, setParts] = useState<Part[]>([]);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [unassignedOptics, setUnassignedOptics] = useState<Optic[]>([]);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let alive = true;
    void Promise.all([getAll<Part>('parts'), getAll<Firearm>('firearms'), getAll<Optic>('optics')])
      .then(([p, f, o]) => {
        if (!alive) return;
        setParts(p.sort((a, b) => a.name.localeCompare(b.name)));
        setFirearms(f);
        setUnassignedOptics(
          o.filter((op) => !op.firearmId).sort((a, b) => opticLabel(a).localeCompare(opticLabel(b)))
        );
      });
    return () => { alive = false; };
  }, [refreshKey]);

  const gunName = (id: string) => firearms.find((f) => f.id === id)?.name;

  function printReport() {
    const html = buildPartsReportHtml({ parts, firearms, optics: unassignedOptics, today: todayKey() });
    const win = window.open('', '_blank');
    if (!win) { setProblem('Pop-ups blocked — please allow pop-ups and try again.'); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  }

  const empty = parts.length === 0 && unassignedOptics.length === 0;

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Spare Parts &amp; Inventory <InfoTip title="Spare Parts & Inventory">Spare parts and spare optics on the shelf. What you buy here feeds Costs.</InfoTip></h1>
      {problem && <p className="form-problem">{problem}</p>}

      <button className="button" onClick={() => openPartForm()}>+ Add Part</button>
      {!empty && (
        <button className="button secondary" style={{ marginTop: 8 }} onClick={printReport}>
          🖨️ Spare Parts &amp; Inventory Report
        </button>
      )}

      <div className="card">
        <h2>Spare Parts</h2>
        {parts.length === 0 && (
          <p className="report-note">
            No spare parts logged yet. Track recoil springs, extractors, optic batteries —
            anything you keep on hand, tied to a gun or universal.
          </p>
        )}
        {parts.map((p) => (
          <button className="row-tap" key={p.id} onClick={() => openPartForm(p.id)}>
            <span className="label">
              {p.name}
              <div className="row-sub">
                {[
                  p.firearmId ? (gunName(p.firearmId) ?? '—') : 'Any / Universal',
                  p.partNumber,
                  p.cost != null ? `$${p.cost.toFixed(2)}` : '',
                  p.datePurchased ? formatDayKey(p.datePurchased) : ''
                ].filter(Boolean).join(' · ')}
              </div>
            </span>
            <span className="value">{p.quantity} ›</span>
          </button>
        ))}
      </div>

      {unassignedOptics.length > 0 && (
        <div className="card">
          <h2>Unassigned Optics</h2>
          <p className="report-note" style={{ marginBottom: 8 }}>
            Optics not on a gun yet. Tap one to edit it or mount it on a firearm.
          </p>
          {unassignedOptics.map((op) => {
            const due = isBatteryDue(op.batteryLog, new Date());
            return (
              <button className="row-tap" key={op.id} onClick={() => openOpticForm(op.id)}>
                <span className="label">
                  {opticLabel(op)}
                  <div className="row-sub">
                    {[op.dotSize, op.zeroDist].filter(Boolean).join(' · ') || 'Unassigned'}
                  </div>
                </span>
                <span className={`badge ${due ? 'warn-badge' : 'ok'}`}>{due ? 'Battery due' : 'Active'}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PartForm({ id, onSaved, onCancel }: {
  id?: string; onSaved: () => void; onCancel: () => void;
}) {
  const [original, setOriginal] = useState<Part | null>(null);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [allParts, setAllParts] = useState<Part[]>([]);
  const [firearmIdSel, setFirearmIdSel] = useState('');
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [partNumber, setPartNumber] = useState('');
  const [cost, setCost] = useState('');
  const [vendor, setVendor] = useState('');
  const [datePurchased, setDatePurchased] = useState('');
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState('');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let alive = true;
    void getAll<Firearm>('firearms').then((f) => {
      if (alive) setFirearms(f.sort((a, b) => a.name.localeCompare(b.name)));
    });
    void getAll<Part>('parts').then((p) => { if (alive) setAllParts(p); });
    if (id !== undefined) {
      void getOne<Part>('parts', id).then((p) => {
        if (!alive || !p) return;
        setOriginal(p);
        setFirearmIdSel(p.firearmId);
        setName(p.name); setQuantity(String(p.quantity));
        setPartNumber(p.partNumber); setDatePurchased(p.datePurchased); setNotes(p.notes);
        setCost(p.cost != null ? String(p.cost) : '');
        setVendor(p.vendor ?? '');
      });
    }
    return () => { alive = false; };
  }, [id]);

  async function save() {
    if (!name.trim()) { setProblem('Name the part — "Recoil spring", "Extractor", etc.'); return; }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty < 0) { setProblem('Quantity needs to be a plain number.'); return; }
    const partCost = cost.trim() === '' ? null : Number(cost);
    if (partCost !== null && (!Number.isFinite(partCost) || partCost < 0)) {
      setProblem('Cost needs to be a plain number.'); return;
    }
    const fields = {
      firearmId: firearmIdSel, name: name.trim(), quantity: qty,
      partNumber: partNumber.trim(), datePurchased, notes: notes.trim(),
      cost: partCost, vendor: vendor.trim()
    };
    if (original) {
      await putOne('parts', stampUpdate({ ...original, ...fields }, Date.now()));
    } else {
      await putOne('parts', stampNew(fields, newId('pt'), Date.now()));
    }
    onSaved();
  }

  async function reallyDelete() {
    if (original) await deleteOne('parts', original.id);
    onSaved();
  }

  // Your own past part names / vendors, most-recent first — creatable combobox.
  const nameSuggestions = recentValues(allParts.map((p) => ({ date: String(p.updatedAt), value: p.name })));
  const vendorSuggestions = recentValues(allParts.map((p) => ({ date: String(p.updatedAt), value: p.vendor ?? '' })));

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onCancel}>‹ Cancel</button>
        <button className="navbar-action" onClick={() => void save()}>Save</button>
      </div>
      <h1 className="large-title">{original ? 'Edit Part' : 'New Part'}</h1>
      {problem && <p className="form-problem">{problem}</p>}
      <div className="card">
        <SuggestField label="Part name" value={name} onChange={setName} name="fl-part-name"
          suggestions={nameSuggestions} placeholder="Recoil spring" />
        <label className="field">Firearm
          <select value={firearmIdSel} onChange={(e) => setFirearmIdSel(e.target.value)}>
            <option value="">Any / Universal</option>
            {firearms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <label className="field">Quantity
          <input type="number" inputMode="numeric" min="0" value={quantity}
            onChange={(e) => setQuantity(e.target.value)} />
        </label>
        <label className="field">Part number
          <input value={partNumber} onChange={(e) => setPartNumber(e.target.value)}
            {...noAutofillProps} name="fl-part-number" />
        </label>
        <label className="field">Cost ($)
          <input type="number" inputMode="decimal" min="0" step="0.01" value={cost}
            onChange={(e) => setCost(e.target.value)} placeholder="0.00" />
        </label>
        <SuggestField label="Vendor (optional)" value={vendor} onChange={setVendor} name="fl-part-vendor"
          suggestions={vendorSuggestions} placeholder="Brownells" />
        <label className="field">Date purchased
          <input type="date" value={datePurchased} onChange={(e) => setDatePurchased(e.target.value)} />
        </label>
        <p className="report-note">
          A cost here shows up in Costs &amp; Purchases — in the totals, and (if the part's
          tied to a gun) in that gun's Spend by Gun.
        </p>
        <label className="field">Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <button className="button" onClick={() => void save()}>{original ? 'Save Changes' : 'Add Part'}</button>
      {original && (
        <button className="button danger" style={{ marginTop: 8 }} onClick={() => setConfirming(true)}>
          Delete Part
        </button>
      )}
      {confirming && (
        <ConfirmSheet
          title="Delete this part?"
          message="There's no undo."
          confirmLabel="Delete Part"
          onConfirm={() => void reallyDelete()}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
