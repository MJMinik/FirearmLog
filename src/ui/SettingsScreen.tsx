// Settings (App & Data group). A lean preferences home: the coaching-remarks
// toggle, the shooter's own names, the manage-lists entry, and a second entry to
// the guarded "Clear all data" wipe (also kept in Tour & Setup). Preferences
// read/write through the existing settings-save path (putSettings) — no new
// storage mechanism.
import { useEffect, useRef, useState } from 'react';
import { getSettings, putSettings } from '../lib/db.ts';
import { normaliseName, normaliseStoredNames } from '../lib/shooterMatch.ts';
import type { AppSettings } from '../lib/types.ts';
import { ClearAllSheet } from './ClearAllSheet.tsx';
import type { View } from './nav.ts';

export function SettingsScreen({ onBack, open }: { onBack: () => void; open?: (v: View) => void }) {
  const [remarks, setRemarks] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [names, setNames] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [nameProblem, setNameProblem] = useState('');
  const [uspsaNumber, setUspsaNumber] = useState('');
  const [scsaNumber, setScsaNumber] = useState('');
  const [scsaPrefilled, setScsaPrefilled] = useState(false);
  const [numberProblem, setNumberProblem] = useState('');
  // The SCSA value as last COMMITTED (loaded or successfully saved). A ref,
  // not state: by the time onBlur fires, the controlled input's state already
  // holds the freshly-typed value, so comparing against state can never
  // detect an edit (same-auditor verify round, 18 Aug 2026 — the first
  // version of this comparison was a no-op for exactly that reason).
  const committedScsa = useRef('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      const s = await getSettings<AppSettings>();
      // ownerName is deliberately NOT read here — see its note in AppSettings.
      if (alive) {
        setRemarks(s?.coachingRemarks !== false);
        setNames(normaliseStoredNames(s?.shooterNames));
        setUspsaNumber((s?.uspsaMemberNumber ?? '').trim());
        const scsa = (s?.scsaMemberNumber ?? '').trim();
        setScsaNumber(scsa);
        setScsaPrefilled(scsa !== '');
        committedScsa.current = scsa;
        setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  async function toggleRemarks() {
    const next = !remarks;
    setRemarks(next); // optimistic
    await putSettings<AppSettings>({ coachingRemarks: next });
  }

  // Optimistic, then put the list BACK if the write did not land. Showing a name
  // as saved when it was not is a charter §1 problem, not a cosmetic one: the
  // shooter walks away believing the import will find them, and it will not.
  // Same shape as the backup-stamp write in SyncCard.
  async function saveNames(next: string[]) {
    const before = names;
    setNames(next);
    setNameProblem('');
    try {
      await putSettings<AppSettings>({ shooterNames: next });
    } catch {
      setNames(before);
      setNameProblem('That could not be saved. Your list is unchanged — try again.');
    }
  }

  async function addName() {
    const n = draft.trim();
    if (!n) return;
    // A name that reduces to nothing — punctuation only — can never match a
    // shooter, so storing it would put a permanent no-op in the list.
    if (normaliseName(n) === '') { setNameProblem('That does not look like a name.'); return; }
    // Compare on the same normalised form the importer matches on, so the list
    // cannot hold two spellings of one person that both match the same row.
    if (names.some((x) => normaliseName(x) === normaliseName(n))) { setDraft(''); return; }
    setDraft('');
    await saveNames([...names, n]);
  }

  // Same optimistic-then-revert shape as saveNames, one key at a time.
  // Trimmed and capped at 24 characters (MEMBER_NUMBER_SPEC.md §4) — no other
  // validation, because clubs' formats vary and a strict pattern would reject
  // real numbers.
  async function saveUspsaNumber() {
    const before = uspsaNumber;
    const next = uspsaNumber.trim().slice(0, 24);
    setUspsaNumber(next); // optimistic
    setNumberProblem('');
    try {
      await putSettings<AppSettings>({ uspsaMemberNumber: next });
    } catch {
      setUspsaNumber(before);
      setNumberProblem('That could not be saved. Try again.');
    }
  }

  async function saveScsaNumber() {
    const before = scsaNumber;
    const next = scsaNumber.trim().slice(0, 24);
    setScsaNumber(next); // optimistic
    setNumberProblem('');
    try {
      await putSettings<AppSettings>({ scsaMemberNumber: next });
      // The shooter just changed this value themselves, so the check-it's-yours
      // note has done its job — a note about provenance under a number they
      // typed is stale the moment they type it (cold audit, 18 Aug 2026).
      // Compared against the last COMMITTED value, never against state — see
      // the committedScsa note above.
      if (next !== committedScsa.current) setScsaPrefilled(false);
      committedScsa.current = next;
    } catch {
      setScsaNumber(before);
      setNumberProblem('That could not be saved. Try again.');
    }
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn section-back" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Settings</h1>

      <div className="card">
        <h2>Coaching</h2>
        <button type="button" role="switch" aria-checked={remarks} disabled={!loaded}
          className="setting-row" onClick={() => void toggleRemarks()}>
          <span className="setting-label">
            Coaching remarks
            <span className="setting-sub">
              The short coaching read on your match debrief and its occasional questions — like
              whether there was room to push the pace. Turn off to just see the numbers.
            </span>
          </span>
          <span className={`switch${remarks ? ' on' : ''}`} aria-hidden="true"><span className="switch-thumb" /></span>
        </button>
      </div>

      <div className="card">
        <h2>Who you are</h2>
        <p className="report-note" style={{ marginBottom: 10 }}>
          The name you shoot under. When you import a match, anyone on this list is lifted to the
          top of the field so you are not scrolling past strangers to find yourself — you still
          tap the row yourself, and nothing is picked for you. Add a second name if someone else
          in the house shoots the same matches. These names and numbers stay on this device, and
          they travel inside your backup files.
        </p>
        {names.map((n) => (
          <div className="row" key={n}>
            <span className="label">{n}</span>
            <button className="button secondary" style={{ width: 'auto', padding: '6px 12px' }}
              aria-label={`Remove ${n}`}
              onClick={() => void saveNames(names.filter((x) => x !== n))}>Remove</button>
          </div>
        ))}
        <label className="field">Name as it appears in results
          <input value={draft} disabled={!loaded} placeholder="Minik, Michael"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addName(); } }} />
        </label>
        <button className="button secondary" disabled={!loaded || !draft.trim()}
          onClick={() => void addName()}>Add name</button>
        {nameProblem && <p className="report-note" role="alert" style={{ marginTop: 8 }}>{nameProblem}</p>}
        <label className="field">USPSA #
          <input value={uspsaNumber} disabled={!loaded} placeholder="A185231" maxLength={24}
            onChange={(e) => setUspsaNumber(e.target.value)}
            onBlur={() => void saveUspsaNumber()} />
        </label>
        <label className="field">SCSA #
          <input value={scsaNumber} disabled={!loaded} placeholder="SC-12345" maxLength={24}
            aria-describedby={scsaPrefilled && scsaNumber.trim() !== '' ? 'scsa-import-note' : undefined}
            onChange={(e) => setScsaNumber(e.target.value)}
            onBlur={() => void saveScsaNumber()} />
        </label>
        {scsaPrefilled && scsaNumber.trim() !== '' && (
          // A SIBLING of the label, not a child — text inside the label folds
          // into the input's accessible name, so a screen reader would read
          // this whole sentence as the field's NAME (cold audit, 18 Aug 2026);
          // aria-describedby gives it the description role it actually has.
          // Gated on the live value too, so clearing the field hides it.
          // "If" on purpose: settings keep no record of HOW a value arrived,
          // so this can render for a number the shooter typed on an earlier
          // visit. Phrased as a conditional it stays true either way — the
          // spec's original wording would have been false there (charter §1).
          <p id="scsa-import-note" className="report-note">If this came from a past Steel Challenge import, check it's yours.</p>
        )}
        <p className="report-note" style={{ marginTop: 8 }}>
          Optional. Confirms it's you when a match is imported — a row is never picked by number alone.
        </p>
        {numberProblem && <p className="report-note" role="alert" style={{ marginTop: 8 }}>{numberProblem}</p>}
      </div>

      <div className="card">
        <h2>Lists</h2>
        <button className="row-tap" onClick={() => open?.({ kind: 'manage-lists' })}>
          <span className="label">
            Manage lists
            <div className="row-sub">Rename or tidy the names your log suggests — locations, brands, vendors, and more.</div>
          </span>
          <span className="row-chev" aria-hidden="true">›</span>
        </button>
      </div>

      <div className="card">
        <h2>Clear all data / Start over</h2>
        <p className="report-note" style={{ marginBottom: 10 }}>
          Erase everything on this device and begin from an empty log — handy once you've explored the
          sample data and want to start your own. It can't be undone, and your saved backup files
          aren't affected.
        </p>
        <button className="button danger" onClick={() => setClearing(true)}>Clear all data…</button>
      </div>

      {clearing && <ClearAllSheet onClose={() => setClearing(false)} />}
    </div>
  );
}
