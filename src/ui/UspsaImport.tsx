// Import classifier scores from USPSA (spec §7.3, M8 build 2). Paste or load the
// export (or try the sample), preview the scores, and confirm — it creates one
// Classifier record per NEW score (skipping any already in your log) and they
// feed the existing C->B classification view. Nothing is written until "Import".
// The parser is pure + tested in src/lib/uspsaClassifier.ts.
import { useEffect, useRef, useState } from 'react';
import type { Classifier } from '../lib/types.ts';
import { getAll, putOne } from '../lib/db.ts';
import { stampNew } from '../lib/stamps.ts';
import { newId } from '../lib/id.ts';
import {
  parseUspsaClassifiers, classifierKey, SAMPLE_USPSA_CSV, type UspsaClassifierRow
} from '../lib/uspsaClassifier.ts';
import { FormProblem } from './FormProblem.tsx';

export function UspsaImport({ onCancel, onDone }: {
  onCancel: () => void;
  onDone: () => void;
}) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<UspsaClassifierRow[] | null>(null);
  const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null); // audit #19 — styled file picker

  useEffect(() => {
    void (async () => {
      const existing = await getAll<Classifier>('classifiers');
      setExistingKeys(new Set(existing.map(classifierKey)));
    })();
  }, []);

  function readResults() {
    setProblem('');
    try {
      setParsed(parseUspsaClassifiers(text));
    } catch (e) {
      setParsed(null);
      setProblem(e instanceof Error ? e.message : 'Could not read that.');
    }
  }

  const isNew = (r: UspsaClassifierRow) => !existingKeys.has(classifierKey(r));
  const newRows = parsed ? parsed.filter(isNew) : [];

  async function importNew() {
    if (saving || newRows.length === 0) return;
    setSaving(true);
    try {
      const now = Date.now();
      for (const r of newRows) {
        await putOne('classifiers', stampNew({
          code: r.code, name: r.name, date: r.date, division: r.division,
          hitFactor: r.hitFactor, percent: r.percent, notes: 'Imported from USPSA.',
        }, newId('cl'), now));
      }
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onCancel}>‹ Cancel</button>
        <span />
      </div>
      <h1 className="large-title">Import USPSA Classifiers</h1>

      <FormProblem problem={problem} />

      {!parsed && (
        <div className="card">
          <p className="report-note">
            Open your classifier record on USPSA, export or copy it, and paste it below. You'll see a
            preview and only the scores you don't already have will be added. No export handy? Tap
            "Try the sample."
          </p>
          <label className="field">Classifier export
            <textarea rows={8} value={text} placeholder="Paste USPSA classifier scores here…"
              onChange={(e) => setText(e.target.value)} />
          </label>
          <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then((t) => { setText(t); setProblem(''); }); e.target.value = ''; }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="button" style={{ flex: 1 }} disabled={!text.trim()} onClick={readResults}>Read scores</button>
            <button className="button secondary" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>Load a file</button>
            <button className="button secondary" style={{ flex: 1 }} onClick={() => { setText(SAMPLE_USPSA_CSV); setProblem(''); }}>Try the sample</button>
          </div>
        </div>
      )}

      {parsed && (
        <>
          <div className="card">
            <h2>Preview</h2>
            <p className="report-note" style={{ marginBottom: 8 }}>
              {parsed.length} score{parsed.length !== 1 ? 's' : ''} found · <strong>{newRows.length} new</strong>
              {parsed.length - newRows.length > 0 ? ` · ${parsed.length - newRows.length} already in your log` : ''}
            </p>
            {parsed.map((r, i) => (
              <div className="row" key={i}>
                <span className="label">
                  {r.code}{r.name ? ` — ${r.name}` : ''}
                  <div className="row-sub">{[r.division, r.date].filter(Boolean).join(' · ')}</div>
                </span>
                <span className="value">
                  {r.percent != null ? `${r.percent.toFixed(2)}%` : '—'}
                  {!isNew(r) && <div className="row-sub">already saved</div>}
                </span>
              </div>
            ))}
          </div>
          <button className="button" disabled={saving || newRows.length === 0} onClick={() => void importNew()}>
            {newRows.length === 0 ? 'All already in your log' : `Import ${newRows.length} new`}
          </button>
          <button className="button secondary" style={{ marginTop: 8 }} onClick={() => { setParsed(null); setProblem(''); }}>Start over</button>
        </>
      )}
    </div>
  );
}
