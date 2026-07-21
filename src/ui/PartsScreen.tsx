// Parts — its own section (split out of the Optics screen,
// Michael's June 14 request). Spare parts (tied to a gun or "Any / Universal")
// PLUS any optic not currently mounted on a firearm, which lives here as
// inventory until you assign it to a gun. Includes a printable report.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Firearm, Optic, Part } from '../lib/types.ts';
import { deleteOne, getAll, getOne, getSettings, putOne } from '../lib/db.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { formatDayKey, todayKey } from '../lib/dates.ts';
import { isBatteryDue } from '../lib/optics.ts';
import { recentValues } from '../lib/suggest.ts';
import { filterHidden } from '../lib/listEdits.ts';
import { buildPartsReportHtml, opticLabel } from '../lib/partsReport.ts';
import { ConfirmSheet, DiscardChangesSheet } from './Sheet.tsx';
import { useDirtyTracker } from './useDirtyTracker.ts';
import { ScreenError } from './ScreenState.tsx';
import { InfoTip } from './InfoTip.tsx';
import { SuggestField, noAutofillProps } from './SuggestField.tsx';
import { FormProblem } from './FormProblem.tsx';
import { ListSearch, matchesQuery } from './ListSearch.tsx';
import { ownedGuns } from '../lib/gunStatus.ts';

export function PartsScreen({ refreshKey, onBack, openPartForm, openOpticForm }: {
  refreshKey: number; onBack: () => void;
  openPartForm: (id?: string) => void; openOpticForm: (id?: string) => void;
}) {
  const [parts, setParts] = useState<Part[]>([]);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [unassignedOptics, setUnassignedOptics] = useState<Optic[]>([]);
  const [problem, setProblem] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(false);
    void (async () => {
      try {
        const [p, f, o] = await Promise.all([getAll<Part>('parts'), getAll<Firearm>('firearms'), getAll<Optic>('optics')]);
        if (!alive) return;
        setParts(p.sort((a, b) => a.name.localeCompare(b.name)));
        setFirearms(f);
        setUnassignedOptics(
          o.filter((op) => !op.firearmId).sort((a, b) => opticLabel(a).localeCompare(opticLabel(b)))
        );
      } catch (e) {
        console.error('Parts load failed', e);
        if (alive) setError(true);
      }
    })();
    return () => { alive = false; };
  }, [refreshKey, nonce]);

  if (error) return <ScreenError onRetry={() => setNonce((n) => n + 1)} />;

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
        <button className="back-btn section-back" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Parts <InfoTip title="Parts">Spare parts and spare optics on the shelf. What you buy here feeds Costs &amp; Purchases.</InfoTip></h1>
      <FormProblem problem={problem} />

      <button className="button" onClick={() => openPartForm()}>+ Add Part</button>
      {!empty && (
        <button className="button secondary" style={{ marginTop: 8 }} onClick={printReport}>
          Parts Report
        </button>
      )}

      {parts.length > 8 && <ListSearch value={q} onChange={setQ} placeholder="Search parts" />}
      <div className="card">
        <h2>Spare Parts</h2>
        {parts.length === 0 && (
          <p className="report-note">
            No spare parts logged yet. Track recoil springs, extractors, optic batteries —
            anything you keep on hand, tied to a gun or universal.
          </p>
        )}
        {parts.filter((p) => matchesQuery(q, p.name, p.partNumber, p.vendor, p.firearmId ? (gunName(p.firearmId) ?? '') : '')).map((p) => (
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

export function PartForm({ id, onSaved, onCancel, onDirtyChange, onSaverChange }: {
  id?: string; onSaved: () => void; onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSaverChange?: (fn: (() => Promise<boolean>) | null) => void;
}) {
  const editing = id !== undefined;
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
  const [discarding, setDiscarding] = useState(false);
  // AUDIT FIX (July 20 2026): on EDIT, gate the dirty baseline on the getOne
  // load — otherwise the baseline is empty strings and a clean close fires
  // "Discard changes?" untouched. On NEW, loaded starts true immediately.
  const [loaded, setLoaded] = useState<boolean>(!editing);
  const [hiddenSuggestions, setHiddenSuggestions] = useState<Record<string, string[]>>({});
  const dirty = useDirtyTracker({ firearmIdSel, name, quantity, partNumber, cost, vendor, datePurchased, notes }, loaded);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

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
        setLoaded(true); // AUDIT FIX: seed dirty baseline once state is populated.
      });
    }
    void getSettings<{ hiddenSuggestions?: Record<string, string[]> }>().then((s) => {
      if (alive) setHiddenSuggestions(s?.hiddenSuggestions ?? {});
    });
    return () => { alive = false; };
  }, [id]);

  function saveProblem(): string | null {
    if (!name.trim()) return 'Name the part — "Recoil spring", "Extractor", etc.';
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty < 0) return 'Quantity needs to be a plain number.';
    const partCost = cost.trim() === '' ? null : Number(cost);
    if (partCost !== null && (!Number.isFinite(partCost) || partCost < 0)) return 'Cost needs to be a plain number.';
    return null;
  }

  async function persistForm(): Promise<boolean> {
    const p = saveProblem();
    if (p) { setProblem(p); return false; }
    const qty = Number(quantity);
    const partCost = cost.trim() === '' ? null : Number(cost);
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
    onDirtyChange?.(false);
    return true;
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
    if (original) await deleteOne('parts', original.id);
    onDirtyChange?.(false);
    onSaved();
  }

  // Your own past part names / vendors, most-recent first — creatable combobox.
  const nameSuggestions = recentValues(allParts.map((p) => ({ date: String(p.updatedAt), value: p.name })));
  const vendorSuggestions = recentValues(allParts.map((p) => ({ date: String(p.updatedAt), value: p.vendor ?? '' })));

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={() => (dirty ? setDiscarding(true) : onCancel())}>‹ Cancel</button>
        <button className="navbar-action" onClick={() => void save()}>Save</button>
      </div>
      {discarding && (
        <DiscardChangesSheet
          onConfirm={() => { onDirtyChange?.(false); onCancel(); }}
          onClose={() => setDiscarding(false)}
          onSave={saveProblem() === null ? () => void save() : undefined} />
      )}
      <h1 className="large-title">{original ? 'Edit Part' : 'New Part'}</h1>
      <FormProblem problem={problem} />
      <div className="card">
        <SuggestField label="Part name" value={name} onChange={setName} name="fl-part-name"
          suggestions={filterHidden(nameSuggestions, hiddenSuggestions, 'part-names')} placeholder="Recoil spring" />
        <label className="field">Firearm
          <select value={firearmIdSel} onChange={(e) => setFirearmIdSel(e.target.value)}>
            <option value="">Any / Universal</option>
            {ownedGuns(firearms, [firearmIdSel]).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
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
          suggestions={filterHidden(vendorSuggestions, hiddenSuggestions, 'vendors')} placeholder="Brownells" />
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
      <button className="button" onClick={() => void save()}>{original ? 'Save changes' : 'Add Part'}</button>
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
