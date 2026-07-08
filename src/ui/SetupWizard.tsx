// First-run Setup Wizard (M9 — Help & Tour; spec §14.3).
// Shown automatically the first time the app opens with an empty log, and
// re-runnable any time from Help. Two paths: "start fresh" and add gear via an
// add-your-gear checklist, or load sample data to explore. The checklist reuses
// the SAME add forms the user already knows (GunForm, OpticForm, AmmoForm,
// MagazineForm) — no new gear-entry code, and no new data-handling code here.
// Guns are nudged first because optics, ammo, and sessions all attach to a gun.
// (The retained Pistol Tracker import code is un-routed as of July 8 2026 —
// not here — it's not part of the new-user first run.)
import { useEffect, useState } from 'react';
import { countAll, localLastModified, restoreSnapshot } from '../lib/db.ts';
import { parseFlog } from '../lib/flog.ts';
import { ConfirmSheet } from './Sheet.tsx';
import { FormProblem } from './FormProblem.tsx';
import { GunForm } from './GunForm.tsx';
import { OpticForm } from './OpticsScreen.tsx';
import { AmmoForm } from './AmmoScreens.tsx';
import { MagazineForm } from './MagazinesScreen.tsx';

type Adding = 'gun' | 'optic' | 'ammo' | 'mag' | null;

export function SetupWizard({ onFinish, onCancel }: {
  onFinish: () => void; // mark setup done + return to Home
  onCancel: () => void; // leave without choosing (re-run case)
}) {
  const [mode, setMode] = useState<'choose' | 'gear'>('choose');
  const [adding, setAdding] = useState<Adding>(null);
  const [counts, setCounts] = useState({ guns: 0, optics: 0, ammo: 0, mags: 0 });
  // M-6: loading sample data REPLACES the device's log, so the confirm gate
  // must fire on ANY existing record (classifiers, purchases, goals…), not
  // just guns — a gun-less log is still someone's real data.
  const [hasAnyData, setHasAnyData] = useState(false);
  const [bump, setBump] = useState(0);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoErr, setDemoErr] = useState('');
  const [confirmDemo, setConfirmDemo] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [guns, optics, ammo, mags, lastChange] = await Promise.all([
        countAll('firearms'), countAll('optics'), countAll('ammunition'), countAll('magazines'),
        localLastModified(),
      ]);
      if (alive) { setCounts({ guns, optics, ammo, mags }); setHasAnyData(lastChange > 0); }
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
      <span className="value" style={accent ? { color: 'var(--accent-ink)', fontWeight: 600 } : undefined}>+ Add ›</span>
    </button>
  );

  // One-tap sample data for testers — loads the bundled demo file straight from
  // the app, so there's nothing to download, save, or pick. Uses the same
  // validated restore path as a normal Pull.
  async function loadDemo() {
    setConfirmDemo(false); setDemoErr(''); setDemoBusy(true);
    try {
      const res = await fetch(new URL('demo-dataset.bin', document.baseURI));
      if (!res.ok) throw new Error('not ok');
      const snap = parseFlog(new Uint8Array(await res.arrayBuffer()));
      await restoreSnapshot(snap);
      onFinish();
    } catch {
      setDemoBusy(false);
      setDemoErr('Could not load the sample data — check your connection and try again.');
    }
  }

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
            <h2>Set up your gear</h2>
            <p className="report-note" style={{ marginBottom: 12 }}>
              Add your guns and gear to get started. You can always add more later from the
              Guns, Optics, Ammo, and Magazines screens.
            </p>
            <button className="button" onClick={() => setMode('gear')}>Add my gear</button>
          </div>

          <div className="card">
            <h2>Just want to look around?</h2>
            <p className="report-note" style={{ marginBottom: 12 }}>
              Load a ready-made sample log — guns, sessions, matches, costs, photos, the works —
              so you can see everything the app does. You can start fresh any time to clear it.
            </p>
            <FormProblem problem={demoErr} />
            <button className="button secondary" disabled={demoBusy}
              onClick={() => (hasAnyData || counts.guns > 0 ? setConfirmDemo(true) : void loadDemo())}>
              {demoBusy ? 'Loading sample data…' : 'See it with sample data'}
            </button>
          </div>

          <button
            onClick={onFinish}
            style={{
              display: 'block', margin: '6px auto 0', padding: 12, minHeight: 44,
              background: 'none', border: 'none', color: 'var(--accent-ink)',
              fontSize: 15, cursor: 'pointer',
            }}
          >
            Skip for now — I'm just looking around
          </button>
        </>
      )}

      {mode === 'gear' && (
        <>
          <div className="card">
            <h2>Add your gear</h2>
            <p className="report-note" style={{ marginBottom: 8 }}>
              {noGuns
                ? 'Start with a gun — your optics, ammo, and sessions all attach to one. Add as many as you like; the others are here whenever you\'re ready.'
                : 'Add as much or as little as you like. You can always come back to this from Tour & Setup, or add more from each screen.'}
            </p>
            {gearRow('Guns', counts.guns, 'gun', true)}
            {gearRow('Optics', counts.optics, 'optic', false)}
            {gearRow('Ammo', counts.ammo, 'ammo', false)}
            {gearRow('Magazines', counts.mags, 'mag', false)}
          </div>
          <button className="button" onClick={onFinish}>Done — go to the app</button>
        </>
      )}

      {confirmDemo && (
        <ConfirmSheet
          title="Load sample data?"
          message="This replaces what's on this device with a sample log. There's no undo."
          confirmLabel="Load sample data"
          onConfirm={() => void loadDemo()}
          onClose={() => setConfirmDemo(false)}
        />
      )}
    </div>
  );
}
