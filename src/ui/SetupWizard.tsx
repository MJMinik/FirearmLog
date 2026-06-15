// First-run Setup Wizard (M9 — Help & Tour; spec §14.3).
// Shown automatically the first time the app opens with an empty log, and
// re-runnable any time from Help. Two paths: import a Pistol Tracker file (the
// existing, tested ImportFlow), or "start fresh" and add gear via an
// add-your-gear checklist. The checklist reuses the SAME add forms the user
// already knows (GunForm, OpticForm, AmmoForm, MagazineForm) — no new gear-entry
// code, and no new data-handling code here. Guns are nudged first because optics,
// ammo, and sessions all attach to a gun.
import { useEffect, useState } from 'react';
import { countAll } from '../lib/db.ts';
import { ImportFlow } from './ImportFlow.tsx';
import { GunForm } from './GunForm.tsx';
import { OpticForm } from './OpticsScreen.tsx';
import { AmmoForm } from './AmmoScreens.tsx';
import { MagazineForm } from './MagazinesScreen.tsx';

type Adding = 'gun' | 'optic' | 'ammo' | 'mag' | null;

export function SetupWizard({ onFinish, onCancel }: {
  onFinish: () => void; // mark setup done + return to Home
  onCancel: () => void; // leave without choosing (re-run case)
}) {
  const [mode, setMode] = useState<'choose' | 'import' | 'gear'>('choose');
  const [adding, setAdding] = useState<Adding>(null);
  const [counts, setCounts] = useState({ guns: 0, optics: 0, ammo: 0, mags: 0 });
  const [bump, setBump] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [guns, optics, ammo, mags] = await Promise.all([
        countAll('firearms'), countAll('optics'), countAll('ammunition'), countAll('magazines'),
      ]);
      if (alive) setCounts({ guns, optics, ammo, mags });
    })();
    return () => { alive = false; };
  }, [bump]);

  // Adding gear: show the real form, then come back to the checklist.
  const afterAdd = () => { setAdding(null); setBump((b) => b + 1); };
  const cancelAdd = () => setAdding(null);
  if (adding === 'gun') return <GunForm onSaved={afterAdd} onCancel={cancelAdd} />;
  if (adding === 'optic') return <OpticForm onSaved={afterAdd} onCancel={cancelAdd} />;
  if (adding === 'ammo') return <AmmoForm onSaved={afterAdd} onCancel={cancelAdd} />;
  if (adding === 'mag') return <MagazineForm onSaved={afterAdd} onCancel={cancelAdd} />;

  const noGuns = counts.guns === 0;
  // A normal tappable list row (label + count on the left, a compact "+ Add" on
  // the right) — NOT the full-width .button, which would balloon inside a row.
  const gearRow = (label: string, count: number, add: Adding, accent: boolean) => (
    <button className="row-tap" onClick={() => setAdding(add)}>
      <span className="label">{label}<div className="row-sub">{count} added</div></span>
      <span className="value" style={accent ? { color: 'var(--accent)', fontWeight: 600 } : undefined}>+ Add ›</span>
    </button>
  );

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={mode === 'choose' ? onCancel : () => setMode('choose')}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Set up FirearmLog</h1>

      {mode === 'choose' && (
        <>
          <p className="report-note" style={{ marginBottom: 12 }}>Welcome! How would you like to start?</p>

          <div className="card">
            <h2>Bring in my Pistol Tracker data</h2>
            <p className="report-note" style={{ marginBottom: 12 }}>
              Import your Pistol Tracker backup or sync file — guns, sessions, photos, the lot.
              Nothing is lost, and you can re-run this any time without doubling anything up.
            </p>
            <button className="button" onClick={() => setMode('import')}>Choose my file</button>
          </div>

          <div className="card">
            <h2>Start fresh</h2>
            <p className="report-note" style={{ marginBottom: 12 }}>
              Begin with an empty log and let's add your gear. You can always add more later from the
              Guns, Optics, Ammo, and Magazines screens.
            </p>
            <button className="button secondary" onClick={() => setMode('gear')}>Add my gear</button>
          </div>
        </>
      )}

      {mode === 'import' && (
        <div className="card">
          <h2>Import your Pistol Tracker file</h2>
          <p className="report-note" style={{ marginBottom: 12 }}>
            Pick your backup or sync file. You'll confirm each gun's type, then see a report
            checking every record came across.
          </p>
          <ImportFlow onImported={onFinish} />
        </div>
      )}

      {mode === 'gear' && (
        <>
          <div className="card">
            <h2>Add your gear</h2>
            <p className="report-note" style={{ marginBottom: 8 }}>
              {noGuns
                ? 'Start with a gun — your optics, ammo, and sessions all attach to one. Add as many as you like; the others are here whenever you\'re ready.'
                : 'Add as much or as little as you like. You can always come back to this from Help, or add more from each screen.'}
            </p>
            {gearRow('Guns', counts.guns, 'gun', true)}
            {gearRow('Optics', counts.optics, 'optic', false)}
            {gearRow('Ammo', counts.ammo, 'ammo', false)}
            {gearRow('Magazines', counts.mags, 'mag', false)}
          </div>
          <button className="button" onClick={onFinish}>Done — go to the app</button>
        </>
      )}
    </div>
  );
}
