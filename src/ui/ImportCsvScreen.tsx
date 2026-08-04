// Import from CSV (spec section 7.2, CSV design doc 3.1 to 3.6). The screen on
// top of the pure engine in src/lib/import/csvEngine.ts: pick a file, point
// your columns at our fields, say what to do about guns we have never heard of,
// look at what would happen, and only then write anything.
//
// NOTHING IS WRITTEN UNTIL "Add these to your log". The engine produces a plan;
// commitImportBatch turns an approved plan into records in one transaction, and
// undoImportBatch takes exactly that batch back out.
//
// THREE THINGS IN HERE ARE LOAD-BEARING, each one a defect an earlier build
// shipped and a later pass measured:
//
//  1. THE STATE REFRESH IS STRUCTURAL, NOT A CONVENTION. The two storage
//     functions are imported under *Raw names, and the plain names in this file
//     are local wrappers that re-read the log and hand it back. They return a
//     DIFFERENT SHAPE from the raw pair, so a future handler that reaches for
//     the raw function and skips the refresh does not compile. Before this, an
//     undo followed by a re-import in the same visit skipped the unknown-gun
//     step, called freshly deleted rows "already in your log", and committed
//     sessions pointing at a firearm id that no longer existed. A guarantee
//     three handlers have to remember is not a guarantee.
//  2. THE PAST-IMPORTS LIST IS READ, not just written. An import history that
//     is only ever written makes "Remove this import" unreachable the moment
//     the report is dismissed.
//  3. THE DATE QUESTION IS NEVER ANSWERED FOR THE SHOOTER. If the engine says a
//     column is ambiguous, this screen asks, including when the column is
//     two-digit years and including when no value in it can tell the two
//     readings apart. Every option carries its own name, so there is no route
//     to two identical or unlabelled buttons.
//
// NOTE ON PUNCTUATION: no string in this file uses an em dash, comments
// included (rule 44 / DESIGN_DIRECTION section 4).

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getAll, getImportHistory,
  commitImportBatch as commitImportBatchRaw,
  undoImportBatch as undoImportBatchRaw,
} from '../lib/db.ts';
import type { CommitImportBatchInput, UndoImportResult } from '../lib/db.ts';
import type {
  Ammunition, CsvImportHistoryEntry, Firearm, Session,
} from '../lib/types.ts';
import {
  parseCsv, cellAt, columnName,
  SESSION_FIELDS, guessMapping, missingRequiredFields,
  analyseDateColumn, convertDateValue, dateFormatLabel, dateAmbiguityMessage,
  planImport, collectUnmatchedGunNames,
} from '../lib/import/csvEngine.ts';
import type {
  DateFormat, GunResolution, ImportPlan, ParsedCsv,
} from '../lib/import/csvEngine.ts';
import { readCsvFile } from './importCsvFile.ts';
import { newId } from '../lib/id.ts';
import { formatDayKey } from '../lib/dates.ts';
import { FormProblem } from './FormProblem.tsx';
import { ConfirmSheet } from './Sheet.tsx';
import type { View } from './nav.ts';

type Stage = 'pick' | 'map' | 'guns' | 'preview' | 'report';

/** The log as this screen last read it, plus the imports it can still remove. */
interface LogSnapshot {
  firearms: Firearm[];
  sessions: Session[];
  ammunition: Ammunition[];
  history: CsvImportHistoryEntry[];
}

const EMPTY_LOG: LogSnapshot = { firearms: [], sessions: [], ammunition: [], history: [] };

const SAMPLE_LIMIT = 3;
const PREVIEW_ROWS = 5;
const LIST_LIMIT = 12;

/** Keep a sample value short enough that a narrow phone never scrolls sideways. */
function shortValue(value: string): string {
  const text = value.trim();
  if (text === '') return 'blank';
  return text.length > 28 ? `${text.slice(0, 27)}…` : text;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "sessions and magazines", the way a person lists things. */
function joinWords(parts: string[]): string {
  if (parts.length === 0) return 'somewhere else in your log';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function undoSummary(result: UndoImportResult): string {
  const bits = [`Removed ${plural(result.sessionsRemoved, 'session', 'sessions')}`];
  if (result.firearmsRemoved > 0) {
    bits.push(`and ${plural(result.firearmsRemoved, 'gun', 'guns')} this import added`);
  }
  let text = `${bits.join(' ')}.`;
  for (const kept of result.firearmsKept) {
    text += ` Kept "${kept.name}": you have used it in ${joinWords(kept.referencedBy)} since the import.`;
  }
  return text;
}

export function ImportCsvScreen({ onBack, open }: {
  onBack: () => void;
  open: (v: View) => void;
}) {
  const [log, setLog] = useState<LogSnapshot>(EMPTY_LOG);
  const [loaded, setLoaded] = useState(false);
  const [stage, setStage] = useState<Stage>('pick');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [filename, setFilename] = useState('');
  const [fileText, setFileText] = useState('');
  const [hasHeader, setHasHeader] = useState(true);
  const [delimiter, setDelimiter] = useState<string | null>(null); // null = as detected
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [assignments, setAssignments] = useState<(string | null)[]>([]);
  const [chosenDateFormat, setChosenDateFormat] = useState<DateFormat | null>(null);

  const [gunNames, setGunNames] = useState<string[]>([]);
  const [gunChoices, setGunChoices] = useState<Record<string, GunResolution | undefined>>({});

  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [planFirearmNames, setPlanFirearmNames] = useState<Record<string, string>>({});

  const [report, setReport] = useState<CsvImportHistoryEntry | null>(null);
  const [undoTarget, setUndoTarget] = useState<CsvImportHistoryEntry | null>(null);
  const [undoMessage, setUndoMessage] = useState('');

  // ---- reading the log -----------------------------------------------------

  async function loadLog(): Promise<LogSnapshot> {
    const [firearms, sessions, ammunition, history] = await Promise.all([
      getAll<Firearm>('firearms'),
      getAll<Session>('sessions'),
      getAll<Ammunition>('ammunition'),
      getImportHistory(),
    ]);
    const next: LogSnapshot = { firearms, sessions, ammunition, history };
    setLog(next);
    return next;
  }

  /**
   * Write a batch AND re-read the log. Same name as the storage function on
   * purpose, and a different return type on purpose: reaching past this for the
   * raw one is a type error, not a silent stale snapshot.
   */
  async function commitImportBatch(
    input: CommitImportBatchInput,
  ): Promise<{ entry: CsvImportHistoryEntry; log: LogSnapshot }> {
    const entry = await commitImportBatchRaw(input);
    return { entry, log: await loadLog() };
  }

  /** Remove a batch AND re-read the log. Same rule as above. */
  async function undoImportBatch(
    batchId: string,
  ): Promise<{ result: UndoImportResult; log: LogSnapshot }> {
    const result = await undoImportBatchRaw(batchId);
    return { result, log: await loadLog() };
  }

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await loadLog();
        if (alive) setLoaded(true);
      } catch {
        if (!alive) return;
        setLoaded(true);
        setProblem("Your log could not be read, so an import would not be safe to start. Nothing was changed.");
      }
    })();
    return () => { alive = false; };
  }, []);

  // ---- the date column -----------------------------------------------------

  const dateColumn = assignments.indexOf('date');

  const dateAnalysis = useMemo(() => {
    if (!parsed || dateColumn < 0) return null;
    return analyseDateColumn(parsed.rows.map((row) => cellAt(row, dateColumn)));
  }, [parsed, dateColumn]);

  // A different column is a different question, so an earlier answer is dropped.
  useEffect(() => { setChosenDateFormat(null); }, [dateColumn, parsed]);

  const dateFormat: DateFormat | null =
    dateAnalysis == null ? null
      : dateAnalysis.ambiguous ? chosenDateFormat
        : dateAnalysis.format;

  const dateSample = dateAnalysis?.ambiguous ? dateAnalysis.sample : null;

  const missing = useMemo(
    () => missingRequiredFields(assignments, SESSION_FIELDS),
    [assignments],
  );

  const canLeaveMapping = parsed != null && missing.length === 0 && dateFormat != null;

  // ---- stage 1: pick a file ------------------------------------------------

  function readParsed(text: string, header: boolean, delim: string | null): ParsedCsv {
    return parseCsv(text, { hasHeader: header, ...(delim ? { delimiter: delim } : {}) });
  }

  function applyParsed(next: ParsedCsv): void {
    setParsed(next);
    setAssignments(guessMapping(next.headers, SESSION_FIELDS).map((g) => g.fieldKey));
  }

  async function pickFile(file: File): Promise<void> {
    setProblem('');
    setUndoMessage('');
    const outcome = await readCsvFile(file);
    if (!outcome.ok) { setProblem(outcome.problem); return; }
    const next = readParsed(outcome.text, true, null);
    if (next.rows.length === 0) {
      // Nothing salvageable: say so in the file's own terms and write nothing.
      setProblem(`${next.problems[0]?.message ?? 'That file has no rows we can read.'} Nothing was changed.`);
      return;
    }
    setFilename(outcome.name);
    setFileText(outcome.text);
    setHasHeader(true);
    setDelimiter(null);
    applyParsed(next);
    setGunChoices({});
    setStage('map');
  }

  function reparse(header: boolean, delim: string | null): void {
    if (fileText === '') return;
    setHasHeader(header);
    setDelimiter(delim);
    applyParsed(readParsed(fileText, header, delim));
  }

  function startOver(): void {
    setStage('pick');
    setParsed(null);
    setFileText('');
    setFilename('');
    setAssignments([]);
    setGunNames([]);
    setGunChoices({});
    setPlan(null);
    setReport(null);
    setProblem('');
    setIncludeDuplicates(false);
  }

  // ---- stage 2: mapping ----------------------------------------------------

  function setAssignment(column: number, fieldKey: string | null): void {
    setAssignments((prev) => {
      const next = [...prev];
      // One field can only come from one column, so picking it here takes it
      // off whatever column had it before.
      if (fieldKey) {
        for (let i = 0; i < next.length; i++) if (next[i] === fieldKey) next[i] = null;
      }
      next[column] = fieldKey;
      return next;
    });
  }

  function goToGuns(): void {
    if (!parsed || dateFormat == null) return;
    setProblem('');
    const names = collectUnmatchedGunNames(parsed, { assignments, dateFormat }, log.firearms);
    setGunNames(names);
    if (names.length === 0) { buildPlan({}); return; }
    setGunChoices({});
    setStage('guns');
  }

  // ---- stage 3: unknown guns ----------------------------------------------

  const gunsDecided = gunNames.every((name) => gunChoices[name] != null);

  function buildPlan(resolutions: Record<string, GunResolution | undefined>, dupes = includeDuplicates): void {
    if (!parsed || dateFormat == null) return;
    const clean: Record<string, GunResolution> = {};
    for (const [name, choice] of Object.entries(resolutions)) if (choice) clean[name] = choice;
    const next = planImport(
      parsed,
      { assignments, dateFormat },
      { firearms: log.firearms, sessions: log.sessions, ammunition: log.ammunition },
      clean,
      newId,
      Date.now(),
      { includeDuplicates: dupes },
    );
    setPlan(next);
    setPlanFirearmNames(Object.fromEntries(next.firearms.map((f) => [f.id, f.name])));
    setStage('preview');
  }

  // ---- stage 4: preview, then commit --------------------------------------

  const gunNameById = useMemo(() => {
    const map: Record<string, string> = { ...planFirearmNames };
    for (const f of log.firearms) map[f.id] = f.name;
    return map;
  }, [log.firearms, planFirearmNames]);

  async function commit(): Promise<void> {
    if (!plan || busy) return;
    setBusy(true);
    setProblem('');
    try {
      const batchId = newId('imp');
      const now = Date.now();
      const tag = <T extends { legacy?: Record<string, unknown> }>(record: T): T => ({
        ...record,
        legacy: { ...(record.legacy ?? {}), importBatch: batchId },
      });
      const { entry } = await commitImportBatch({
        batchId,
        filename,
        sessions: plan.sessions.map(tag),
        firearms: plan.firearms.map(tag),
        counts: {
          rowsTotal: plan.rowsTotal,
          rowsPlanned: plan.rowsPlanned,
          rowsFailed: plan.rowsFailed,
          rowsSkipped: plan.rowsSkipped,
          duplicatesInFile: plan.duplicatesInFile,
          duplicatesInLog: plan.duplicatesInLog,
        },
        now,
      });
      setReport(entry);
      setStage('report');
    } catch (e) {
      setProblem(e instanceof Error
        ? `That import did not go through: ${e.message} Nothing was written.`
        : 'That import did not go through. Nothing was written.');
    } finally {
      setBusy(false);
    }
  }

  // ---- undo ---------------------------------------------------------------

  async function runUndo(entry: CsvImportHistoryEntry): Promise<void> {
    if (busy) return;
    setBusy(true);
    setProblem('');
    setUndoTarget(null);
    try {
      const { result } = await undoImportBatch(entry.batchId);
      startOver();
      setUndoMessage(undoSummary(result));
    } catch (e) {
      setProblem(e instanceof Error
        ? `That import could not be removed: ${e.message} Nothing was changed.`
        : 'That import could not be removed. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * What the confirmation says, worked out for THIS import rather than kept as
   * a stock sentence. It does not promise that nothing else in the log is
   * touched, because a gun this import created and you have used since is a
   * real exception, and the shooter is told about it here rather than after.
   */
  function undoMessageFor(entry: CsvImportHistoryEntry): string {
    const parts = [`This takes out the ${plural(entry.counts.sessions, 'session', 'sessions')}`];
    if (entry.counts.firearms > 0) {
      parts.push(`and the ${plural(entry.counts.firearms, 'gun', 'guns')}`);
    }
    parts.push(`this import added, along with any changes you have made to them since.`);
    let text = parts.join(' ');
    text += ' Everything you logged separately stays.';
    if (entry.counts.firearms > 0) {
      text += ' A gun you have used elsewhere in your log since the import is kept, and the next screen names it.';
    }
    return text;
  }

  // ---- rendering ----------------------------------------------------------

  const headerCount = parsed?.headers.length ?? 0;

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn section-back" onClick={stage === 'pick' ? onBack : startOver}>
          {stage === 'pick' ? '‹ Back' : '‹ Start over'}
        </button>
        <span />
      </div>
      <h1 className="large-title">Import from CSV</h1>

      <FormProblem problem={problem} />

      {!loaded && <p className="muted">Reading your log…</p>}

      {loaded && stage === 'pick' && (
        <>
          <div className="card">
            <p>
              A CSV file is what a spreadsheet or another log app saves when you
              ask it to export. Pick your file and you will say which of your
              columns holds the date, the gun and the round count. You see
              exactly what would be added before anything is saved.
            </p>
            <p className="muted">
              One row becomes one session with one gun. A day you shot two guns
              comes in as two sessions, which you can merge by hand afterwards.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.tsv,text/csv,text/plain"
              data-testid="import-csv-file"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void pickFile(f);
              }}
            />
            <button className="button" data-testid="import-csv-choose" onClick={() => fileRef.current?.click()}>
              Choose a file
            </button>
            <div style={{ height: 8 }} />
            <button className="button secondary" onClick={() => open({ kind: 'sync' })}>
              Save a backup first
            </button>
          </div>

          {undoMessage !== '' && (
            <div className="card">
              <p role="status" data-testid="import-csv-undo-result">{undoMessage}</p>
            </div>
          )}

          {/* Written AND read: without this list, an import stops being
              removable the moment its report is dismissed. */}
          {log.history.length > 0 && (
            <div className="card">
              <h2>Past imports</h2>
              <p className="report-note">
                Each one can be taken back out. The sessions it added go, and so
                do the guns it added that nothing else in your log uses.
              </p>
              {log.history.map((entry) => (
                <div key={entry.batchId} className="row-tap" style={{ cursor: 'default' }} data-testid="import-csv-past-row">
                  <span className="label">
                    {entry.filename || 'CSV import'}
                    <div className="row-sub">
                      {formatDayKey(new Date(entry.importedAt).toISOString().slice(0, 10))}
                      {`: ${plural(entry.counts.sessions, 'session', 'sessions')}`}
                      {entry.counts.firearms > 0 ? `, ${plural(entry.counts.firearms, 'gun', 'guns')}` : ''}
                    </div>
                  </span>
                  <button
                    className="button small danger"
                    // .button.small floors at 36px, which is under the 44px a
                    // finger needs, and this row lives on a phone. Measured at
                    // 320 and 390 before and after.
                    style={{ minHeight: 44 }}
                    data-testid="import-csv-remove"
                    disabled={busy}
                    onClick={() => setUndoTarget(entry)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {loaded && stage === 'map' && parsed && (
        <>
          <div className="card">
            <h2>Point your columns at our fields</h2>
            <p className="report-note">
              {filename}: {plural(parsed.rows.length, 'row', 'rows')},{' '}
              {plural(headerCount, 'column', 'columns')}.
            </p>
            <label className="field">Columns are separated by
              <select
                value={delimiter ?? parsed.delimiter}
                data-testid="import-csv-delimiter"
                onChange={(e) => reparse(hasHeader, e.target.value)}
              >
                <option value=",">Commas</option>
                <option value=";">Semicolons</option>
                <option value={'\t'}>Tabs</option>
              </select>
            </label>
            <label className="checklist-take">
              <input
                type="checkbox"
                checked={!hasHeader}
                data-testid="import-csv-no-header"
                onChange={(e) => reparse(!e.target.checked, delimiter)}
              />
              My file has no header row
            </label>
            {parsed.headerLooksLikeData && hasHeader && (
              <p className="report-note warn">
                The first row looks like shooting data rather than column names.
                If it is, tick the box above so it comes in as a session.
              </p>
            )}
          </div>

          {missing.length > 0 && (
            <div className="card">
              <p role="status" data-testid="import-csv-missing">
                Still needed: {missing.map((f) => f.label.toLowerCase()).join(', ')}. Pick the
                column that holds {missing.length === 1 ? 'it' : 'each of them'} below.
              </p>
            </div>
          )}

          {dateAnalysis?.ambiguous && (
            <div className="card" data-testid="import-csv-date-question">
              <h2>Which way do these dates read?</h2>
              <p className="report-note">{dateAmbiguityMessage(dateAnalysis.reason)}</p>
              {dateAnalysis.options.map((format) => (
                <div key={format} style={{ marginBottom: 8 }}>
                  <button
                    className={chosenDateFormat === format ? 'button' : 'button secondary'}
                    data-testid={`import-csv-date-${format}`}
                    onClick={() => setChosenDateFormat(format)}
                  >
                    {/* The name is always there, so two options can never look
                        alike, and a sample is added only when the engine found
                        one that every option can read and reads differently. */}
                    {dateFormatLabel(format)}
                    {dateSample ? `: ${dateSample} is ${formatDayKey(convertDateValue(dateSample, format) ?? '')}` : ''}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="card">
            {parsed.headers.map((header, column) => {
              const samples = parsed.rows.slice(0, SAMPLE_LIMIT).map((row) => cellAt(row, column));
              return (
                <label className="field" key={`${header}-${column}`} style={{ wordBreak: 'break-word' }}>
                  {header || columnName(column)}
                  <select
                    value={assignments[column] ?? ''}
                    data-testid={`import-csv-column-${column}`}
                    onChange={(e) => setAssignment(column, e.target.value === '' ? null : e.target.value)}
                  >
                    <option value="">Skip this column</option>
                    {SESSION_FIELDS.map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label}{field.required ? ' (needed)' : ''}
                      </option>
                    ))}
                  </select>
                  <div className="row-sub" style={{ marginTop: 4, wordBreak: 'break-word' }}>
                    {samples.map(shortValue).join(', ')}
                  </div>
                </label>
              );
            })}
          </div>

          <div className="card">
            <button
              className="button"
              data-testid="import-csv-continue-map"
              disabled={!canLeaveMapping}
              onClick={goToGuns}
            >
              Continue
            </button>
            {!canLeaveMapping && (
              <p className="report-note">
                {missing.length > 0
                  ? 'Point a column at each needed field to carry on.'
                  : 'Answer the date question above to carry on.'}
              </p>
            )}
          </div>
        </>
      )}

      {loaded && stage === 'guns' && (
        <>
          <div className="card">
            <h2>Guns we have not seen before</h2>
            <p className="report-note">
              {plural(gunNames.length, 'name', 'names')} in your file
              {gunNames.length === 1 ? ' does not match' : ' do not match'} a gun in
              your log. Say what to do with each one once, and every row using it
              follows.
            </p>
          </div>
          <div className="card">
            {gunNames.map((name, gunIndex) => {
              const choice = gunChoices[name];
              const value = choice == null ? ''
                : choice.action === 'create' ? 'create'
                  : choice.action === 'skip' ? 'skip' : 'use';
              return (
                <div key={name} style={{ marginBottom: 14 }}>
                  <label className="field" style={{ wordBreak: 'break-word' }}>{name}
                    <select
                      value={value}
                      data-testid={`import-csv-gun-${gunIndex}`}
                      onChange={(e) => {
                        const picked = e.target.value;
                        setGunChoices((prev) => ({
                          ...prev,
                          [name]: picked === 'create' ? { action: 'create' }
                            : picked === 'skip' ? { action: 'skip' }
                              : picked === 'use' ? { action: 'use', firearmId: log.firearms[0]?.id ?? '' }
                                : undefined,
                        }));
                      }}
                    >
                      <option value="">Choose what to do</option>
                      <option value="create">Add it as a new gun</option>
                      {log.firearms.length > 0 && <option value="use">It is a gun I already have</option>}
                      <option value="skip">Skip the rows that use it</option>
                    </select>
                  </label>
                  {choice?.action === 'use' && (
                    <label className="field">Which gun
                      <select
                        value={choice.firearmId}
                        data-testid={`import-csv-gun-pick-${gunIndex}`}
                        onChange={(e) => setGunChoices((prev) => ({
                          ...prev, [name]: { action: 'use', firearmId: e.target.value },
                        }))}
                      >
                        {log.firearms.map((f) => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          <div className="card">
            <button
              className="button"
              data-testid="import-csv-continue-guns"
              disabled={!gunsDecided}
              onClick={() => buildPlan(gunChoices)}
            >
              Continue
            </button>
            {!gunsDecided && (
              <p className="report-note">Choose what to do with each name to carry on.</p>
            )}
          </div>
        </>
      )}

      {loaded && stage === 'preview' && plan && (
        <>
          <div className="card">
            <h2>What this would add</h2>
            <p data-testid="import-csv-headline">
              This will add {plural(plan.sessions.length, 'session', 'sessions')}
              {plan.firearms.length > 0 ? ` and ${plural(plan.firearms.length, 'new gun', 'new guns')}` : ''}.
            </p>
            {plan.rowsSkipped > 0 && (
              <p className="report-note" data-testid="import-csv-skipped">
                {plural(plan.rowsSkipped, 'row', 'rows')} skipped, including{' '}
                {plan.duplicatesInLog} that look like sessions already in your log
                and {plan.duplicatesInFile} that repeat an earlier row in the file.
              </p>
            )}
            {/* ROWS, not problems: a row with three faults is one row to look at. */}
            {plan.rowsFailed > 0 && (
              <p className="report-note" data-testid="import-csv-failed">
                {plural(plan.rowsFailed, 'row', 'rows')} could not be read. Those rows
                are listed below and nothing from them is added.
              </p>
            )}
            <label className="checklist-take">
              <input
                type="checkbox"
                checked={includeDuplicates}
                data-testid="import-csv-include-duplicates"
                onChange={(e) => { setIncludeDuplicates(e.target.checked); buildPlan(gunChoices, e.target.checked); }}
              />
              Add the rows that look like sessions already in my log
            </label>
          </div>

          {plan.sessions.length > 0 && (
            <div className="card">
              <h2>The first few, as they would be saved</h2>
              {plan.sessions.slice(0, PREVIEW_ROWS).map((session) => (
                <div key={session.id} className="row-tap" style={{ cursor: 'default' }}>
                  <span className="label">
                    {formatDayKey(session.date)}
                    <div className="row-sub">
                      {gunNameById[session.guns[0]?.firearmId ?? ''] ?? 'no gun'}
                      {`, ${plural(session.guns[0]?.rounds ?? 0, 'round', 'rounds')}`}
                      {session.location ? `, ${session.location}` : ''}
                    </div>
                  </span>
                </div>
              ))}
              {plan.sessions.length > PREVIEW_ROWS && (
                <p className="report-note">
                  and {plan.sessions.length - PREVIEW_ROWS} more.
                </p>
              )}
            </div>
          )}

          {plan.problems.length > 0 && (
            <div className="card">
              <h2>Rows that could not be read</h2>
              {plan.problems.slice(0, LIST_LIMIT).map((p, i) => (
                <p className="report-note" key={`${p.line}-${i}`}>Line {p.line}: {p.message}</p>
              ))}
              {plan.problems.length > LIST_LIMIT && (
                <p className="report-note">and {plan.problems.length - LIST_LIMIT} more.</p>
              )}
            </div>
          )}

          {plan.notes.length > 0 && (
            <div className="card">
              <h2>Values we had to read loosely</h2>
              {plan.notes.slice(0, LIST_LIMIT).map((n, i) => (
                <p className="report-note" key={`${n.line}-${i}`}>Line {n.line}: {n.message}</p>
              ))}
              {plan.notes.length > LIST_LIMIT && (
                <p className="report-note">and {plan.notes.length - LIST_LIMIT} more.</p>
              )}
            </div>
          )}

          <div className="card">
            <button
              className="button"
              data-testid="import-csv-commit"
              disabled={busy || plan.sessions.length === 0}
              onClick={() => void commit()}
            >
              {busy ? 'Adding…' : 'Add these to your log'}
            </button>
            <p className="report-note">
              Nothing is saved until you tap. You can remove this import
              afterwards from this screen. Want a backup first? Save to File
              lives under Sync and Backup.
            </p>
            <div style={{ height: 8 }} />
            <button className="button secondary" onClick={() => setStage('map')}>
              Back to the columns
            </button>
          </div>
        </>
      )}

      {loaded && stage === 'report' && report && (
        <>
          <div className="card">
            <h2>Added to your log</h2>
            <p role="status" data-testid="import-csv-report">
              {plural(report.counts.sessions, 'session', 'sessions')}
              {report.counts.firearms > 0 ? ` and ${plural(report.counts.firearms, 'new gun', 'new guns')}` : ''}
              {` from ${report.filename || 'your file'}.`}
              {report.counts.rowsSkipped > 0 ? ` ${plural(report.counts.rowsSkipped, 'row was', 'rows were')} skipped.` : ''}
              {report.counts.rowsFailed > 0 ? ` ${plural(report.counts.rowsFailed, 'row', 'rows')} could not be read.` : ''}
            </p>
            <p className="report-note">
              These sessions now count in your round totals, your costs and
              anything due for maintenance.
            </p>
          </div>
          <div className="card">
            <button className="button secondary" data-testid="import-csv-report-undo" disabled={busy}
              onClick={() => setUndoTarget(report)}>
              Remove this import
            </button>
            <div style={{ height: 8 }} />
            <button className="button secondary" onClick={startOver}>Import another file</button>
            <div style={{ height: 8 }} />
            <button className="button" onClick={onBack}>Done</button>
          </div>
        </>
      )}

      {undoTarget && (
        <ConfirmSheet
          title="Remove this import?"
          message={undoMessageFor(undoTarget)}
          confirmLabel="Remove it"
          onConfirm={() => void runUndo(undoTarget)}
          onClose={() => setUndoTarget(null)}
        />
      )}
    </div>
  );
}
