// Retire / no-longer-own / permanent-delete a gun (audit #10). Nothing is hard-
// deleted while the gun has history — past sessions and matches keep it on record.
// Accessories: on RETIRE they stay attached by default (you still own the gun) but
// can be freed; on "no longer own" and on permanent delete they always move to
// inventory (optic & parts -> unassigned, magazines drop this gun).
import { useState } from 'react';
import type { Firearm, Magazine, Optic, Part, Reminder } from '../lib/types.ts';
import { deleteOne, getAll, putOne } from '../lib/db.ts';
import { stampUpdate } from '../lib/stamps.ts';
import { todayKey } from '../lib/dates.ts';
import { REMOVAL_REASONS } from '../lib/gunStatus.ts';
import { reminderIdsForGun } from '../lib/reminders.ts';
import { Sheet, ConfirmSheet } from './Sheet.tsx';

async function freeAccessories(gunId: string) {
  const [optics, mags, parts] = await Promise.all([
    getAll<Optic>('optics'), getAll<Magazine>('magazines'), getAll<Part>('parts')
  ]);
  const now = Date.now();
  for (const o of optics) {
    if (o.firearmId === gunId) await putOne('optics', stampUpdate({ ...o, firearmId: '' }, now));
  }
  for (const m of mags) {
    if (m.firearmIds.includes(gunId)) {
      await putOne('magazines', stampUpdate({ ...m, firearmIds: m.firearmIds.filter((x) => x !== gunId) }, now));
    }
  }
  for (const p of parts) {
    if (p.firearmId === gunId) await putOne('parts', stampUpdate({ ...p, firearmId: '' }, now));
  }
}

export function GunRemoveSheet({ gun, hasHistory, onClose, onDone }: {
  gun: Firearm; hasHistory: boolean;
  onClose: () => void; onDone: (deleted: boolean) => void;
}) {
  const [mode, setMode] = useState<'choose' | 'former'>('choose');
  const [reason, setReason] = useState<string>(REMOVAL_REASONS[0]);
  const [date, setDate] = useState(todayKey());
  const [freeAcc, setFreeAcc] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  async function retire() {
    if (busy) return; setBusy(true);
    if (freeAcc) await freeAccessories(gun.id);
    await putOne('firearms', stampUpdate({ ...gun, status: 'retired', statusReason: '', statusDate: todayKey() }, Date.now()));
    onDone(false);
  }
  async function markFormer() {
    if (busy) return; setBusy(true);
    await freeAccessories(gun.id);
    await putOne('firearms', stampUpdate({ ...gun, status: 'former', statusReason: reason, statusDate: date }, Date.now()));
    onDone(false);
  }
  async function deleteForever() {
    if (busy) return; setBusy(true);
    await freeAccessories(gun.id);
    // A permanently deleted gun takes its reminders with it — a round-count
    // reminder is meaningless without its gun, and a stranded one would resolve
    // inactive and hide in storage forever. Reminders go BEFORE the gun record,
    // so an interruption can never leave orphans behind a gun that's already gone.
    const reminders = await getAll<Reminder>('reminders');
    for (const rid of reminderIdsForGun(reminders, gun.id)) {
      await deleteOne('reminders', rid);
    }
    await deleteOne('firearms', gun.id);
    onDone(true);
  }

  if (confirmDelete) {
    return (
      <ConfirmSheet
        title={`Delete ${gun.name} permanently?`}
        message="This gun has no logged sessions or matches, so it can be fully removed. Its optic and magazines move to your inventory, and any reminders you set for it are removed with it. There's no undo."
        confirmLabel="Delete Permanently"
        onConfirm={() => void deleteForever()}
        onClose={() => setConfirmDelete(false)}
      />
    );
  }

  return (
    <Sheet title={`Retire or remove ${gun.name}`} onClose={onClose}>
      {mode === 'choose' && (
        <>
          <p className="report-note" style={{ marginBottom: 14 }}>
            Either way, nothing is lost — past sessions and matches keep this gun on record.
          </p>

          <h3 className="checklist-section-title">Retire it</h3>
          <p className="report-note" style={{ marginBottom: 6 }}>
            You still own it, just not shooting it now. It stays in your insurance inventory and
            you can bring it back any time. Its optic and magazines stay attached.
          </p>
          <label className="checklist-take" style={{ marginBottom: 8 }}>
            <input type="checkbox" checked={freeAcc} onChange={(e) => setFreeAcc(e.target.checked)} />
            Also free its optic &amp; magazines to my inventory
          </label>
          <button className="button" onClick={() => void retire()} disabled={busy}>Retire this gun</button>

          <div style={{ height: 16 }} />

          <h3 className="checklist-section-title">No longer own it</h3>
          <p className="report-note" style={{ marginBottom: 6 }}>
            Sold, gifted, lost, stolen, or destroyed. It leaves your active lists and insurance
            inventory; its optic and magazines move to your inventory.
          </p>
          <button className="button secondary" onClick={() => setMode('former')}>I no longer own it…</button>

          {!hasHistory && (
            <>
              <div style={{ height: 16 }} />
              <h3 className="checklist-section-title">Delete it</h3>
              <p className="report-note" style={{ marginBottom: 6 }}>
                This gun has no logged sessions or matches, so you can remove it completely (handy
                for a duplicate or a typo).
              </p>
              <button className="button danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
                Delete permanently
              </button>
            </>
          )}
        </>
      )}

      {mode === 'former' && (
        <>
          <p className="report-note" style={{ marginBottom: 10 }}>What happened to {gun.name}?</p>
          <label className="field">Reason
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {REMOVAL_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="field">Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <p className="report-note" style={{ marginBottom: 10 }}>
            Its optic and magazines will move to your inventory. The gun stays on past sessions
            and matches for your records.
          </p>
          <button className="button" onClick={() => void markFormer()} disabled={busy}>Mark as no longer owned</button>
          <div style={{ height: 8 }} />
          <button className="button secondary" onClick={() => setMode('choose')}>‹ Back</button>
        </>
      )}
    </Sheet>
  );
}
