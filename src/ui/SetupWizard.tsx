// First-run Setup Wizard (M9 — Help & Tour; spec §14.3).
// Shown automatically the first time the app opens with an empty log, and
// re-runnable any time from Help. Two paths: "start fresh" and add gear via an
// add-your-gear checklist, or load sample data to explore. The checklist reuses
// the SAME add forms the user already knows (GunForm, OpticForm, AmmoForm,
// MagazineForm) — no new gear-entry code, and no new data-handling code here.
// Guns are nudged first because optics, ammo, and sessions all attach to a gun.
// F10 (session 55): finishing the gear path asks a true newcomer what they're
// working toward (goal presets + write-your-own + skip) instead of the old
// boot-time auto-assigned "Reach A class" — see lib/northStar.ts.
// (The legacy migration importer lives in lib/import/ with no user-facing
// surface — F11 removed its last screen; it's not part of any first run.)
import { useEffect, useState } from 'react';
import { countAll, getAll, getSettings, localLastModified, restoreSnapshot } from '../lib/db.ts';
import { parseFlog } from '../lib/flog.ts';
import { applySetupGoal, goalStepNeeded, SETUP_GOAL_PRESETS } from '../lib/northStar.ts';
import type { SetupGoalChoice } from '../lib/northStar.ts';
import type { AppSettings, Goal } from '../lib/types.ts';
import { ConfirmSheet } from './Sheet.tsx';
import { FormProblem } from './FormProblem.tsx';
import { noAutofillProps } from './SuggestField.tsx';
import { GunForm } from './GunForm.tsx';
import { OpticForm } from './OpticsScreen.tsx';
import { AmmoForm } from './AmmoScreens.tsx';
import { MagazineForm } from './MagazinesScreen.tsx';

type Adding = 'gun' | 'optic' | 'ammo' | 'mag' | null;

// Step 3b (signed July 10 2026): the first-run 1-2-3 checklist. Shown on the
// welcome screen (step 1 active) and above the goal step (step 2 active); Home
// carries the same three steps until the first session exists. Display-only
// except the ACTIVE step, which is the tap target for what to do next.
export function SetupSteps({ gunDone, goalDone, active, onActive, step2Sub, step3Sub }: {
  gunDone: boolean; goalDone: boolean; active: 1 | 2 | 3; onActive?: () => void;
  step2Sub?: string; step3Sub?: string;
}) {
  const row = (n: 1 | 2 | 3, label: string, done: boolean, sub?: string) => {
    const isActive = n === active && !done;
    const body = (
      <span className="label" style={{
        fontWeight: isActive ? 600 : 400,
        color: done || isActive ? undefined : 'var(--text-dim)',
      }}>
        <span aria-hidden="true" style={{
          display: 'inline-block', width: 22,
          color: done ? 'var(--accent-ink)' : 'var(--text-dim)',
        }}>{done ? '✓' : '○'}</span>
        {label}
        {sub && <div className="row-sub" style={{ marginLeft: 22 }}>{sub}</div>}
      </span>
    );
    if (isActive && onActive) {
      return (
        <button className="row-tap" onClick={onActive}>
          {body}
          <span className="value" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>›</span>
        </button>
      );
    }
    return <div style={{ display: 'flex', padding: '10px 0' }}>{body}</div>;
  };
  return (
    <>
      {row(1, '1. Add a gun', gunDone)}
      {row(2, '2. Pick a goal', goalDone, step2Sub)}
      {row(3, '3. Log your first session', false,
        step3Sub ?? 'You\'ll do this from Home after your next range trip')}
    </>
  );
}

export function SetupWizard({ onFinish, onCancel }: {
  onFinish: () => void; // mark setup done + return to Home
  onCancel: () => void; // leave without choosing (re-run case)
}) {
  const [mode, setMode] = useState<'choose' | 'gear' | 'goal'>('choose');
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
  // F10: the goal step's state — the write-my-own reveal and its text, plus
  // busy/error so a failed save shows and can be retried instead of vanishing.
  const [goalCustom, setGoalCustom] = useState(false);
  const [goalText, setGoalText] = useState('');
  const [goalBusy, setGoalBusy] = useState(false);
  const [goalErr, setGoalErr] = useState('');

  // Step 3b: gate the welcome variant on a completed read, so a re-runner with
  // data never sees a flash of the first-run checklist before counts arrive.
  const [countsLoaded, setCountsLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [guns, optics, ammo, mags, lastChange] = await Promise.all([
        countAll('firearms'), countAll('optics'), countAll('ammunition'), countAll('magazines'),
        localLastModified(),
      ]);
      if (alive) { setCounts({ guns, optics, ammo, mags }); setHasAnyData(lastChange > 0); setCountsLoaded(true); }
    })();
    return () => { alive = false; };
  }, [bump]);

  // Adding gear: show the real form, then come back to the checklist. Step 3b:
  // a gun added from the WELCOME checklist advances straight to the goal step
  // (gearDone decides from a fresh read — or finishes if the question isn't
  // needed); gear added from the gear list returns there, as before.
  const afterAdd = () => {
    const fromWelcome = mode === 'choose' && adding === 'gun';
    setAdding(null); setBump((b) => b + 1);
    if (fromWelcome) void gearDone();
  };
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

  // M-6 hardening: the effect above fills hasAnyData asynchronously, and a fast
  // tap can beat that read — which would replace a real log with the sample,
  // no confirmation asked (caught by E2E on a slower machine; on CI the read
  // always won the race). So decide from a FRESH read at tap time. The state
  // values still short-circuit the common case instantly; if the read itself
  // fails, fail SAFE and ask anyway — an unnecessary confirm is a shrug, a
  // skipped one is someone's log.
  async function demoTapped() {
    let any = hasAnyData || counts.guns > 0;
    if (!any) {
      try { any = (await localLastModified()) > 0; } catch { any = true; }
    }
    if (any) setConfirmDemo(true);
    else await loadDemo();
  }

  // F10: "Done" on the gear checklist. Whether the goal question appears is
  // decided from a FRESH read (mirrors demoTapped's hardening — cached state
  // can lag): ask only a true newcomer — at least one gun, no goals, and the
  // question never answered before (northStarSeeded covers old auto-seed
  // installs too, so nobody is re-asked). Any read failure fails OPEN — finish
  // the wizard rather than trap the user on a question we can't safely decide.
  async function gearDone() {
    try {
      const [settings, guns, goals] = await Promise.all([
        getSettings<AppSettings>(), countAll('firearms'), getAll<Goal>('goals'),
      ]);
      if (goalStepNeeded({ seeded: settings?.northStarSeeded, gunCount: guns, goals })) {
        setMode('goal');
        return;
      }
    } catch { /* undecidable → skip the question, never block the exit */ }
    onFinish();
  }

  // F10: record the answer, then leave the wizard. A storage failure keeps the
  // user here with a plain error and everything still tappable — their choice
  // must never silently vanish.
  async function pickGoal(choice: SetupGoalChoice) {
    setGoalErr(''); setGoalBusy(true);
    try {
      await applySetupGoal(choice);
      onFinish();
    } catch {
      setGoalBusy(false);
      setGoalErr('Could not save that — try again.');
    }
  }

  function saveCustomGoal() {
    const text = goalText.trim();
    if (!text) { setGoalErr('Enter the goal before saving.'); return; }
    void pickGoal({ kind: 'goal', text });
  }

  // One-tap sample data for testers — loads the bundled demo file straight from
  // the app, so there's nothing to download, save, or pick. Uses the same
  // validated restore path as a normal Load from File.
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

  // One sample-data card, used by both welcome variants (first-run + re-run).
  // The story frame (DESIGN_DIRECTION §4, July 12 2026): the sample log is a
  // flash-forward of the USER'S own future — the copy shows them their story,
  // never our features. The demo data behind this button is arc-checked by
  // tests/demoStory.test.ts so these words stay literally true (charter §1).
  const demoCard = (
    <div className="card">
      <h2>See where this goes</h2>
      <p className="report-note" style={{ marginBottom: 12 }}>
        Load a sample log — a year and a half of range trips, matches, and dry-fire,
        a gun getting cared for, gear and costs accounted for, and a goal taking
        shape — and see what your own log will be telling you once you&rsquo;ve been
        keeping yours a while. Start fresh any time and begin yours.
      </p>
      <FormProblem problem={demoErr} />
      <button className="button secondary" disabled={demoBusy}
        onClick={() => void demoTapped()}>
        {demoBusy ? 'Loading sample data…' : 'See a log 18 months in'}
      </button>
    </div>
  );

  const skipLink = (
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
  );

  return (
    <div className="screen">
      <div className="navbar">
        {/* F6: on a true first run (auto-presented welcome, no gun yet) Back
            leads nowhere the user has been — hide it. Every other wizard
            screen has a real place to return to. */}
        {!(mode === 'choose' && (!countsLoaded || counts.guns === 0)) && (
          <button className="back-btn"
            onClick={mode === 'choose' ? onCancel : mode === 'goal' ? () => setMode('gear') : () => setMode('choose')}>‹ Back</button>
        )}
        <span />
      </div>
      <h1 className="large-title">Set up FirearmLog</h1>

      {mode === 'choose' && countsLoaded && counts.guns === 0 && (
        <>
          {/* Step 3b: the first-run welcome — the three steps up front, step 1
              as the tap target, so a brand-new user knows what happens next. */}
          <p className="report-note" style={{ marginBottom: 12 }}>Let's get you set up — three steps:</p>

          <div className="card">
            <SetupSteps gunDone={false} goalDone={false} active={1}
              onActive={() => setAdding('gun')} />
          </div>

          {demoCard}
          {skipLink}
        </>
      )}

      {mode === 'choose' && countsLoaded && counts.guns > 0 && (
        <>
          {/* The re-run welcome (Help → Set Up with a real log): the classic
              two doors — more gear, or sample data. The first-run checklist
              would read as nagging here (the steps are already done). */}
          <p className="report-note" style={{ marginBottom: 12 }}>Welcome! How would you like to start?</p>

          <div className="card">
            <h2>Set up your gear</h2>
            <p className="report-note" style={{ marginBottom: 12 }}>
              Add your guns and gear to get started. You can always add more later from the
              Guns, Optics, Ammo, and Magazines screens.
            </p>
            <button className="button" onClick={() => setMode('gear')}>Add my gear</button>
          </div>

          {demoCard}
          {skipLink}
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
          <button className="button" onClick={() => void gearDone()}>Done — you're ready to log</button>
        </>
      )}

      {mode === 'goal' && (
        <>
          {/* Step 3b: the checklist rides along — box 1 just earned its check,
              step 2 is where the user stands now, and its sub points at the
              choices sitting just below (Michael's fix: without the pointer,
              "current" didn't say WHERE the goal list was). */}
          <div className="card">
            <SetupSteps gunDone goalDone={false} active={2}
              step2Sub="Pick a goal from one below (or write your own) ↓" />
            <button className="row-tap" onClick={() => setMode('gear')}>
              <span className="label" style={{ color: 'var(--text-dim)' }}>Add more gear — optics, ammo, magazines</span>
              <span className="value">›</span>
            </button>
          </div>

          <div className="card">
            <h2>What are you working toward?</h2>
            <p className="report-note" style={{ marginBottom: 8 }}>
              Pick one to keep in front of you on Home — you can change this anytime.
            </p>
            <FormProblem problem={goalErr} />
            {SETUP_GOAL_PRESETS.map((p) => (
              <button key={p.text} className="row-tap" disabled={goalBusy}
                onClick={() => void pickGoal({ kind: 'goal', text: p.text, category: p.category })}>
                <span className="label">{p.text}<div className="row-sub">{p.category}</div></span>
                <span className="value">›</span>
              </button>
            ))}
            {goalCustom ? (
              <>
                <label className="field">My goal
                  <input value={goalText} {...noAutofillProps} name="fl-setup-goal" autoFocus
                    enterKeyHint="done"
                    placeholder="Bill Drill under 2.0 seconds"
                    onChange={(e) => setGoalText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveCustomGoal(); }} />
                </label>
                <button className="button" disabled={goalBusy} onClick={saveCustomGoal}>
                  Set my goal
                </button>
              </>
            ) : (
              <button className="row-tap" disabled={goalBusy} onClick={() => setGoalCustom(true)}>
                <span className="label">Write my own</span>
                <span className="value">›</span>
              </button>
            )}
          </div>
          <button
            onClick={() => void pickGoal({ kind: 'skip' })} disabled={goalBusy}
            style={{
              display: 'block', margin: '6px auto 0', padding: 12, minHeight: 44,
              background: 'none', border: 'none', color: 'var(--accent-ink)',
              fontSize: 15, cursor: 'pointer',
            }}
          >
            Skip for now
          </button>
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
