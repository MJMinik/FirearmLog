// First-run import: pick the Pistol Tracker file → confirm gun categories →
// commit → show the verification report (spec §6).
import { useRef, useState } from 'react';
import type { GunCategory } from '../lib/types.ts';
import { GUN_CATEGORIES } from '../lib/types.ts';
import {
  parseOldFile, importPistolTracker, guessCategory
} from '../lib/import/pistolTracker.ts';
import type { VerificationReport } from '../lib/import/pistolTracker.ts';
import { commitDataSet, countAll } from '../lib/db.ts';
import { fileTooLargeMessage, MAX_IMPORT_FILE_BYTES } from '../lib/inputLimits.ts';

type Step =
  | { name: 'pick' }
  | { name: 'confirm'; old: ReturnType<typeof parseOldFile>; guns: { id: string; label: string; category: GunCategory }[] }
  | { name: 'working'; message: string }
  | { name: 'done'; report: VerificationReport }
  | { name: 'error'; message: string };

export function ImportFlow({ onImported }: { onImported: () => void }) {
  const [step, setStep] = useState<Step>({ name: 'pick' });
  const fileRef = useRef<HTMLInputElement>(null);

  async function filePicked(file: File) {
    // S-2: guard the whole-file read at the boundary — the parser stays untouched.
    const tooBig = fileTooLargeMessage(file.size, MAX_IMPORT_FILE_BYTES, 'file');
    if (tooBig) { setStep({ name: 'error', message: tooBig }); return; }
    try {
      const old = parseOldFile(await file.text());
      const guns = (old.firearms ?? []).map((f) => ({
        id: String(f.id),
        label: `${f.name ?? 'Unnamed gun'}`,
        category: guessCategory(f)
      }));
      setStep({ name: 'confirm', old, guns });
    } catch (e) {
      setStep({ name: 'error', message: e instanceof Error ? e.message : 'That file could not be read.' });
    }
  }

  async function confirmAndImport(old: ReturnType<typeof parseOldFile>, guns: { id: string; category: GunCategory }[]) {
    setStep({ name: 'working', message: 'Reading your records…' });
    try {
      const categories: Record<string, GunCategory> = {};
      for (const g of guns) categories[g.id] = g.category;
      const { data, settings, report } = importPistolTracker(old, categories, Date.now());
      await commitDataSet(data, settings, (done, total) => {
        setStep({
          name: 'working',
          message: total > 0 ? `Saving photos: ${done} of ${total}…` : 'Saving your records…'
        });
      });
      const savedPhotos = await countAll('media');
      if (savedPhotos < data.media.length) {
        throw new Error(`Only ${savedPhotos} of ${data.media.length} photos saved. Nothing was lost from your old file — just try the import again.`);
      }
      // Don't refresh the screens yet — the report stays up until Done is tapped.
      setStep({ name: 'done', report });
    } catch (e) {
      setStep({ name: 'error', message: e instanceof Error ? e.message : 'The import did not finish.' });
    }
  }

  if (step.name === 'pick' || step.name === 'error') {
    return (
      <div className="card">
        <h2>Bring In Your Pistol Tracker Data</h2>
        {step.name === 'error' && (
          <p className="report-note" style={{ color: 'var(--danger)' }}>{step.message}</p>
        )}
        <p className="report-note" style={{ marginBottom: 12 }}>
          Pick the backup file Pistol Tracker saved (it ends in .json). Everything comes
          over — guns, sessions, drills, photos, all of it — and you'll see proof.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void filePicked(f);
            e.target.value = '';
          }}
        />
        <button className="button" onClick={() => fileRef.current?.click()}>
          Import Pistol Tracker Backup
        </button>
      </div>
    );
  }

  if (step.name === 'confirm') {
    return (
      <div className="card">
        <h2>Quick Check — What Kind of Gun Is Each One?</h2>
        <p className="report-note" style={{ marginBottom: 8 }}>
          FirearmLog tracks more than pistols. I took a guess for each gun — fix any I got wrong, then finish.
        </p>
        {step.guns.map((g, i) => (
          <div className="row" key={g.id}>
            <span className="label">{g.label}</span>
            <select
              className="category-pick"
              aria-label={`Category for ${g.label}`}
              value={g.category}
              onChange={(e) => {
                const next = [...step.guns];
                next[i] = { ...g, category: e.target.value as GunCategory };
                setStep({ ...step, guns: next });
              }}
            >
              {GUN_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        ))}
        <div style={{ marginTop: 14 }}>
          <button className="button" onClick={() => void confirmAndImport(step.old, step.guns)}>
            Looks Right — Finish Import
          </button>
        </div>
      </div>
    );
  }

  if (step.name === 'working') {
    return (
      <div className="card">
        <h2>Importing</h2>
        <p className="report-note">{step.message}</p>
      </div>
    );
  }

  // done — the verification report (spec §6.4)
  const r = step.report;
  return (
    <div className="card">
      <h2>Import Check — Old App vs FirearmLog</h2>
      {r.counts.filter((c) => c.inCount > 0 || !c.ok).map((c) => (
        <div className="row" key={c.label}>
          <span className="label">{c.label}</span>
          <span className="value">{c.inCount} in, {c.outCount} out</span>
          <span className={`badge ${c.ok ? 'ok' : 'bad'}`}>{c.ok ? 'Match' : 'Off'}</span>
        </div>
      ))}
      <div className="row">
        <span className="label">Photos</span>
        <span className="value">{r.imagesIn} in, {r.imagesOut} out</span>
        <span className={`badge ${r.imagesOk ? 'ok' : 'bad'}`}>{r.imagesOk ? 'Match' : 'Off'}</span>
      </div>
      {r.guns.map((g) => (
        <div className="row" key={g.firearmId}>
          <span className="label">{g.name} — rounds</span>
          <span className="value">{g.newRounds.toLocaleString()}</span>
          <span className={`badge ${g.ok ? 'ok' : 'bad'}`}>{g.ok ? 'Match' : 'Off'}</span>
        </div>
      ))}
      <p className="report-note">
        {r.allOk
          ? 'Every count matches the old app. Your data made the trip with nothing left behind.'
          : 'Something didn’t line up. Your old file is untouched — tell Claude what you see above.'}
      </p>
      <div style={{ marginTop: 14 }}>
        <button className="button" onClick={onImported}>Done</button>
      </div>
    </div>
  );
}
