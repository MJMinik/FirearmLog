// Export as CSV — stage 1 of the CSV work (design: vault note "FirearmLog -
// CSV import & column mapping — analysis and design (2026-08-02)").
//
// This screen READS ONLY. It never writes, edits or deletes a stored record,
// which is why it was built before the import half: it carries none of that
// side's blast radius, and it ships the second half of spec §7.2 on its own.
//
// It reads the stores with getAll (never `exportSnapshot`, which also loads
// every photo and video into memory — a CSV needs none of that and a big
// library would be a real cost on a phone), hands the rows to the pure
// csvTables registry, and hands the finished text to deliverFile, which
// already knows how to reach the user on every platform including the
// installed iPhone app.

import { useEffect, useState } from 'react';
import { getAll } from '../lib/db.ts';
import { CSV_TABLES, buildLookup } from '../lib/csvTables.ts';
import type { CsvStores, CsvTable } from '../lib/csvTables.ts';
import { exportFilename } from '../lib/csvExport.ts';
import { deliverFile, isIOS, isStandalone } from './deliverFile.ts';
import type { DeliveryOutcome } from './deliverFile.ts';
import { Icon } from './Icon.tsx';
import type {
  Firearm, Session, Ammunition, Purchase, MaintenanceEntry, MalfunctionEntry,
  Magazine, Optic, Part, Goal, Match, Classifier, DrillDef, SkillSet,
  SkillAssessment,
} from '../lib/types.ts';

type Stage =
  | { name: 'loading' }
  | { name: 'ready'; message?: string }
  | { name: 'working'; key: string }
  | { name: 'failed'; message: string };

export function ExportCsvScreen({ onBack }: { onBack: () => void }) {
  const [stores, setStores] = useState<CsvStores>({});
  const [stage, setStage] = useState<Stage>({ name: 'loading' });

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [
          firearms, sessions, drills, ammunition, purchases, maintenance,
          malfunctions, magazines, optics, parts, goals, matches, classifiers,
          skillSets, skills,
        ] = await Promise.all([
          getAll<Firearm>('firearms'), getAll<Session>('sessions'),
          getAll<DrillDef>('drills'), getAll<Ammunition>('ammunition'),
          getAll<Purchase>('purchases'), getAll<MaintenanceEntry>('maintenance'),
          getAll<MalfunctionEntry>('malfunctions'), getAll<Magazine>('magazines'),
          getAll<Optic>('optics'), getAll<Part>('parts'), getAll<Goal>('goals'),
          getAll<Match>('matches'), getAll<Classifier>('classifiers'),
          getAll<SkillSet>('skillSets'), getAll<SkillAssessment>('skills'),
        ]);
        if (!alive) return;
        setStores({
          firearms, sessions, drills, ammunition, purchases, maintenance,
          malfunctions, magazines, optics, parts, goals, matches, classifiers,
          skillSets, skills,
        });
        setStage({ name: 'ready' });
      } catch (e) {
        if (!alive) return;
        // Failing to READ cannot have damaged anything, and the message says so
        // rather than leaving the user wondering.
        setStage({
          name: 'failed',
          message: e instanceof Error
            ? `Couldn't read your log: ${e.message}. Nothing was changed.`
            : "Couldn't read your log. Nothing was changed.",
        });
      }
    })();
    return () => { alive = false; };
  }, []);

  async function exportTable(table: CsvTable) {
    setStage({ name: 'working', key: table.key });
    try {
      const text = table.toText(stores, buildLookup(stores));
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const outcome = await deliverFile(blob, exportFilename(table.key, new Date()), 'text/csv');
      setStage({ name: 'ready', message: doneMessage(table, outcome) });
    } catch (e) {
      setStage({
        name: 'failed',
        message: e instanceof Error
          ? `The export did not finish: ${e.message}`
          : 'The export did not finish.',
      });
    }
  }

  function doneMessage(table: CsvTable, outcome: DeliveryOutcome): string {
    const rows = table.count(stores);
    const noun = rows === 1 ? 'row' : 'rows';
    if (outcome.kind === 'share' && !outcome.shared) {
      // Cancelling the Share sheet is a choice, not a failure, and the message
      // must not read like something went wrong.
      return 'Backed out without saving. Nothing left your device.';
    }
    if (outcome.kind === 'share') {
      return `${table.label}: ${rows} ${noun} handed to the Share sheet. Pick Save to Files to keep it.`;
    }
    if (outcome.kind === 'window') {
      return `${table.label}: ${rows} ${noun} opened in a new window. Use your browser's Save to keep it.`;
    }
    return isIOS()
      ? `${table.label}: ${rows} ${noun} saved to the spot you picked.`
      : `${table.label}: ${rows} ${noun} saved to your Downloads folder, unless you chose another spot.`;
  }

  const busy = stage.name === 'working';

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn section-back" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Export as CSV</h1>

      <div className="card">
        <p>
          A CSV file opens in Numbers, Excel or Google Sheets, and it is what
          most other programs read when you want to move your records somewhere
          else. Pick what you want, and each one saves as its own file.
        </p>
        <p className="muted">
          A CSV holds numbers and words, so your photos and videos are not in
          it, and neither is everything the app stores. For a complete backup,
          use Save to File under Sync &amp; Backup.
        </p>
        {isStandalone() && isIOS() && (
          <p className="muted">
            On your iPhone the file goes to the Share sheet, so pick Save to
            Files to keep it.
          </p>
        )}
      </div>

      {stage.name === 'loading' && <p className="muted">Reading your log…</p>}

      {stage.name === 'failed' && (
        <div className="card">
          <p role="alert">{stage.message}</p>
        </div>
      )}

      {(stage.name === 'ready' || stage.name === 'working') && (
        <>
          {stage.name === 'ready' && stage.message && (
            <div className="card">
              <p role="status">{stage.message}</p>
            </div>
          )}
          <div className="card">
            {CSV_TABLES.map((table) => {
              // Guarded because this runs during RENDER: a single malformed
              // record throwing here would be caught by the error boundary and
              // replace the whole screen, making all sixteen tables unreachable
              // over one odd row. The registry defends itself too; this is the
              // second layer, because the cost of being wrong is the screen.
              // -1 means the count itself threw. Falling back to 0 made the
              // row say "None yet" — a sentence the user reads that is false,
              // silently, for somebody who may have hundreds of rows. A count
              // that failed is a different fact from a count of zero, and the
              // row stays tappable because the export may well succeed.
              let rows = -1;
              try { rows = table.count(stores); } catch { rows = -1; }
              const counted = rows >= 0;
              const empty = rows === 0;
              return (
                <button
                  key={table.key}
                  className="row-tap"
                  data-testid={`export-${table.key}`}
                  // `aria-disabled`, never the `disabled` attribute (decision
                  // 19). A natively disabled button cannot be focused, so a
                  // keyboard or screen-reader user cannot reach it to find out
                  // WHY it is unavailable — they just meet a hole in the list.
                  // This stays focusable and announced as unavailable, and the
                  // handler simply declines to act.
                  onClick={() => { if (!busy && !empty) void exportTable(table); }}
                  aria-disabled={busy || empty}
                >
                  <span className="row-ico" aria-hidden="true"><Icon name="reports" size={20} /></span>
                  <span className="label">
                    {table.label}
                    {/* `row-sub` is the house class for the quiet second line on
                        a row (AmmoScreens, CostsScreen, CompeteScreen all use
                        it). Rendered as a div so it sits UNDER the label rather
                        than beside it. */}
                    <div className="row-sub">{table.describes}</div>
                  </span>
                  <span className="value">
                    {stage.name === 'working' && stage.key === table.key
                      ? 'Saving…'
                      : !counted ? 'Try it ›'
                        : empty ? 'None yet' : `${rows} ›`}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
