import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { gotoSection } from './helpers';

// Import from CSV (spec section 7.2, CSV design doc 3.1 to 3.6).
//
// EVERY FIXTURE THESE TESTS USE IS FABRICATED, and e2e/fixtures/csv/README.md
// says so in the folder itself. No shooting-log app's export format has been
// verified by this project, so no fixture here pretends to be one.
//
// What these specs are for. The unit suite already proves the engine (parsing,
// dates, numbers, the planner) and the storage half (the single-transaction
// commit, the nine-store undo scan). What it cannot prove is that the screen
// reaches real stored data, that a wrong guess can be corrected before anything
// is written, and that the counts in the log move by exactly what the report
// claimed. That is this file's job, so it reads the object stores directly
// rather than trusting the words on screen.

const FIXTURE = (name: string) => `e2e/fixtures/csv/${name}`;

/**
 * Record counts straight out of IndexedDB, the way export-csv.spec does.
 *
 * THE STORE LIST IS DERIVED FROM THE DATABASE, never written out here. The
 * hand-written version of this listed five stores and left out the three that
 * hold a session reference, which is precisely why "undo puts every count back"
 * passed while undo was orphaning every timed-skill set, malfunction and photo
 * filed against an imported session. A list of stores in a test file goes stale
 * the day a store is added, and nothing tells you.
 */
async function storeCounts(page: Page): Promise<Record<string, number>> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('firearmlog');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const count = (store: string) => new Promise<number>((resolve) => {
      const r = db.transaction(store, 'readonly').objectStore(store).count();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(-1);
    });
    const out: Record<string, number> = {};
    for (const store of Array.from(db.objectStoreNames)) out[store] = await count(store);
    return out;
  });
}

/** Write records straight into a store, to set up what a screen cannot. */
async function seedRecords(page: Page, store: string, records: object[]): Promise<void> {
  await page.evaluate(async ({ store, records }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('firearmlog');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      for (const r of records) tx.objectStore(store).put(r);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }, { store, records });
}

/** The ids of every session this import wrote. */
async function importedSessionIds(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('firearmlog');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const rows = await new Promise<{ id: string; legacy?: { importBatch?: string } }[]>((resolve) => {
      const r = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
      r.onsuccess = () => resolve(r.result);
    });
    return rows.filter((s) => !!s.legacy?.importBatch).map((s) => s.id);
  });
}

async function ammoQuantity(page: Page, id: string): Promise<number> {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('firearmlog');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const row = await new Promise<{ quantity: number } | undefined>((resolve) => {
      const r = db.transaction('ammunition', 'readonly').objectStore('ammunition').get(id);
      r.onsuccess = () => resolve(r.result);
    });
    return row?.quantity ?? -1;
  }, id);
}

async function openImport(page: Page): Promise<void> {
  await gotoSection(page, 'Import from CSV');
  await expect(page.getByRole('heading', { name: 'Import from CSV', exact: true })).toBeVisible();
  await expect(page.getByTestId('import-csv-choose')).toBeVisible();
}

/** The whole ordinary path, from a picked file to a written batch. */
async function importRangeLog(page: Page): Promise<void> {
  await page.getByTestId('import-csv-file').setInputFiles(FIXTURE('range-log.csv'));
  await expect(page.getByTestId('import-csv-continue-map')).toBeVisible();
  await page.getByTestId('import-csv-continue-map').click();
  await page.getByTestId('import-csv-gun-0').selectOption('create');
  await page.getByTestId('import-csv-continue-guns').click();
  await page.getByTestId('import-csv-commit').click();
  await expect(page.getByTestId('import-csv-report')).toBeVisible();
}

test('a spreadsheet becomes sessions, and a wrong guess can be fixed on the way', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  const before = await storeCounts(page);

  await page.getByTestId('import-csv-file').setInputFiles(FIXTURE('range-log.csv'));

  // The guesses the engine made, read off the real screen.
  await expect(page.getByTestId('import-csv-column-0')).toHaveValue('date');
  await expect(page.getByTestId('import-csv-column-1')).toHaveValue('gun');
  await expect(page.getByTestId('import-csv-column-2')).toHaveValue('rounds');
  await expect(page.getByTestId('import-csv-column-3')).toHaveValue('location');
  // A column headed "Time" holding words is not a drill time. This is the guess
  // the shooter has to be able to overrule, and the file is fabricated to
  // contain one on purpose.
  await expect(page.getByTestId('import-csv-column-4')).toHaveValue('drillTime');
  await page.getByTestId('import-csv-column-4').selectOption('');
  await expect(page.getByTestId('import-csv-column-4')).toHaveValue('');

  await page.getByTestId('import-csv-continue-map').click();

  // One decision per unknown name, not one per row.
  await expect(page.getByTestId('import-csv-gun-0')).toBeVisible();
  await expect(page.getByTestId('import-csv-continue-guns')).toBeDisabled();
  await page.getByTestId('import-csv-gun-0').selectOption('create');
  await page.getByTestId('import-csv-continue-guns').click();

  await expect(page.getByTestId('import-csv-headline')).toHaveText('This will add 3 sessions and 1 new gun.');

  // Nothing is written until the tap.
  expect(await storeCounts(page)).toEqual(before);

  await page.getByTestId('import-csv-commit').click();
  await expect(page.getByTestId('import-csv-report')).toContainText('3 sessions and 1 new gun');

  const after = await storeCounts(page);
  expect(after.sessions).toBe(before.sessions + 3);
  expect(after.firearms).toBe(before.firearms + 1);
});

test('a file with nothing in it to read is refused and the log is untouched', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  const before = await storeCounts(page);

  await page.getByTestId('import-csv-file').setInputFiles(FIXTURE('not-a-table.txt'));

  await expect(page.getByRole('alert')).toContainText('Nothing was changed');
  // Still on the first step, with no mapping screen behind the refusal.
  await expect(page.getByTestId('import-csv-choose')).toBeVisible();
  await expect(page.getByTestId('import-csv-continue-map')).toHaveCount(0);
  expect(await storeCounts(page)).toEqual(before);
});

test('dates that could be read two ways force the question', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  await page.getByTestId('import-csv-file').setInputFiles(FIXTURE('ambiguous-dates.csv'));

  await expect(page.getByTestId('import-csv-date-question')).toBeVisible();
  // The engine does not guess, and neither does the screen: no route forward
  // until the shooter answers.
  await expect(page.getByTestId('import-csv-continue-map')).toBeDisabled();

  const dayFirst = page.getByTestId('import-csv-date-dmy');
  const monthFirst = page.getByTestId('import-csv-date-mdy');
  await expect(dayFirst).toContainText('Day first');
  await expect(monthFirst).toContainText('Month first');
  // The sample is only offered when both readings can read it AND they disagree,
  // so the two options can never say the same thing.
  expect((await dayFirst.textContent())?.trim()).not.toBe((await monthFirst.textContent())?.trim());

  await dayFirst.click();
  await expect(page.getByTestId('import-csv-continue-map')).toBeEnabled();
});

test('a date column no sample can settle still offers named readings, never blank ones', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  // Every date in this file has the same number for the day and the month, so
  // no value in the column can tell the two readings apart. The question is
  // still asked, and each option still says which reading it is.
  await page.getByTestId('import-csv-file').setInputFiles(FIXTURE('symmetric-dates.csv'));

  await expect(page.getByTestId('import-csv-date-question')).toBeVisible();
  const dayFirst = (await page.getByTestId('import-csv-date-dmy').textContent())?.trim();
  const monthFirst = (await page.getByTestId('import-csv-date-mdy').textContent())?.trim();
  // Exactly the label and nothing else: a sample here would have to be one both
  // readings agree on, which is two buttons saying the same thing.
  expect(dayFirst).toBe('Day first');
  expect(monthFirst).toBe('Month first');
  expect(dayFirst).not.toBe(monthFirst);
});

test('a two-digit-year column is asked about, never quietly resolved', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  // "01/02/25" could be the first of February, the second of January, or the
  // twenty fifth of February 2001. Nothing in the column says which, so the
  // screen has no business picking one.
  await page.getByTestId('import-csv-file').setInputFiles(FIXTURE('two-digit-years.csv'));

  const question = page.getByTestId('import-csv-date-question');
  await expect(question).toBeVisible();
  await expect(question).toContainText('two-digit years');
  await expect(page.getByTestId('import-csv-continue-map')).toBeDisabled();

  // All three readings are offered, each carrying its own name.
  const labels = await Promise.all(['ymd', 'dmy', 'mdy'].map(
    async (f) => (await page.getByTestId(`import-csv-date-${f}`).textContent())?.trim() ?? '',
  ));
  expect(new Set(labels).size).toBe(3);
  for (const label of labels) expect(label.length).toBeGreaterThan(0);

  await page.getByTestId('import-csv-date-dmy').click();
  await expect(page.getByTestId('import-csv-continue-map')).toBeEnabled();
});

test('a row with three faults is ONE row that could not be read', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  await page.getByTestId('import-csv-file').setInputFiles(FIXTURE('broken-rows.csv'));
  await page.getByTestId('import-csv-continue-map').click();
  await page.getByTestId('import-csv-gun-0').selectOption('create');
  await page.getByTestId('import-csv-continue-guns').click();

  // The headline counts ROWS, so it matches the number of rows the shooter has
  // to go and look at.
  await expect(page.getByTestId('import-csv-failed')).toContainText('1 row could not be read');
  // And all three faults on that one row are still listed, by line number.
  await expect(page.getByText(/^Line 3:/)).toHaveCount(3);
  // The two healthy rows are still importable: a broken row costs its row, not
  // the file.
  await expect(page.getByTestId('import-csv-headline')).toContainText('This will add 2 sessions');
});

test('rows already in the log are skipped by default, and can be included on purpose', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  await importRangeLog(page);

  // The same file a second time. The gun exists now, so there is no unknown-gun
  // step, and every row matches a session already logged.
  await page.getByRole('button', { name: 'Import another file' }).click();
  await page.getByTestId('import-csv-file').setInputFiles(FIXTURE('range-log.csv'));
  await page.getByTestId('import-csv-continue-map').click();

  await expect(page.getByTestId('import-csv-headline')).toContainText('This will add 0 sessions');
  await expect(page.getByTestId('import-csv-skipped')).toContainText('3 rows skipped');
  await expect(page.getByTestId('import-csv-commit')).toBeDisabled();

  // Shown and counted, never silently discarded: the switch brings them in.
  await page.getByTestId('import-csv-include-duplicates').check();
  await expect(page.getByTestId('import-csv-headline')).toContainText('This will add 3 sessions');
});

test('an import stays removable after you leave the screen, and undo puts every count back', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  const before = await storeCounts(page);
  await importRangeLog(page);

  // Leave the screen entirely and come back. The history is READ, not only
  // written, so the import is still removable.
  await gotoSection(page, 'Export as CSV');
  await openImport(page);
  await expect(page.getByTestId('import-csv-past-row')).toHaveCount(1);
  await expect(page.getByTestId('import-csv-past-row')).toContainText('range-log.csv');

  await page.getByTestId('import-csv-remove').click();
  await page.getByRole('button', { name: 'Remove it' }).click();

  await expect(page.getByTestId('import-csv-undo-result')).toContainText('Removed 3 sessions');
  await expect(page.getByTestId('import-csv-past-row')).toHaveCount(0);
  // Every store back where it started, the meta row included.
  expect(await storeCounts(page)).toEqual(before);
});

test('undoing and re-importing in the same visit asks about the gun again', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  const before = await storeCounts(page);
  await importRangeLog(page);

  await page.getByTestId('import-csv-report-undo').click();
  await page.getByRole('button', { name: 'Remove it' }).click();
  await expect(page.getByTestId('import-csv-undo-result')).toBeVisible();
  expect(await storeCounts(page)).toEqual(before);

  // The same file again, without leaving the screen. This is the case an
  // earlier build got wrong: it held the log as it looked at mount, so it
  // skipped the unknown-gun step, called these rows "already in your log", and
  // wrote sessions pointing at a gun it had just deleted.
  await page.getByTestId('import-csv-file').setInputFiles(FIXTURE('range-log.csv'));
  await page.getByTestId('import-csv-continue-map').click();
  await expect(page.getByTestId('import-csv-gun-0')).toBeVisible();
  await page.getByTestId('import-csv-gun-0').selectOption('create');
  await page.getByTestId('import-csv-continue-guns').click();
  await expect(page.getByTestId('import-csv-headline')).toHaveText('This will add 3 sessions and 1 new gun.');

  await page.getByTestId('import-csv-commit').click();
  await expect(page.getByTestId('import-csv-report')).toContainText('3 sessions and 1 new gun');
  const after = await storeCounts(page);
  expect(after.sessions).toBe(before.sessions + 3);
  expect(after.firearms).toBe(before.firearms + 1);
});

test('an inch mark in a notes column does not eat the rows after it', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  const before = await storeCounts(page);

  // Three rows, 450 rounds, and one 8" in the Notes column. Measured before the
  // parser was fixed: two sessions and 350 rounds, with rowsFailed 0,
  // rowsSkipped 0 and an empty problem list, because the rows it ate were gone
  // before anything counted them.
  await page.getByTestId('import-csv-file').setInputFiles(FIXTURE('inch-marks.csv'));
  await page.getByTestId('import-csv-continue-map').click();
  await page.getByTestId('import-csv-gun-0').selectOption('create');
  await page.getByTestId('import-csv-continue-guns').click();

  await expect(page.getByTestId('import-csv-headline')).toHaveText('This will add 3 sessions and 1 new gun.');
  await page.getByTestId('import-csv-commit').click();
  await expect(page.getByTestId('import-csv-report')).toContainText('3 sessions');

  const after = await storeCounts(page);
  expect(after.sessions).toBe(before.sessions + 3);
  // The rounds, not just the row count: a swallowed row takes its rounds with it.
  const rounds = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('firearmlog');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const rows = await new Promise<{ guns: { rounds: number }[] }[]>((resolve) => {
      const r = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
      r.onsuccess = () => resolve(r.result);
    });
    return rows.reduce((n, s) => n + s.guns.reduce((m, g) => m + g.rounds, 0), 0);
  });
  expect(rounds).toBe(450);
});

test('the skipped sentence names the rows that were skipped, and they add up', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  await page.getByTestId('import-csv-file').setInputFiles(FIXTURE('duplicates-and-skips.csv'));
  await page.getByTestId('import-csv-continue-map').click();

  // Two unknown names: keep one, skip the other.
  await page.getByTestId('import-csv-gun-0').selectOption('create');
  await page.getByTestId('import-csv-gun-1').selectOption('skip');
  await page.getByTestId('import-csv-continue-guns').click();

  await expect(page.getByTestId('import-csv-headline')).toContainText('This will add 2 sessions');
  // One in-file repeat and one row using the skipped name: two rows, two
  // reasons, and the parts add up to the total.
  await expect(page.getByTestId('import-csv-skipped')).toHaveText(
    '2 rows skipped: 1 that repeats an earlier row in this file and 1 using a gun name you chose to skip.',
  );
  // Counted AND listed, by line, so the shooter can go and look at them.
  await expect(page.getByTestId('import-csv-skipped-line')).toHaveCount(2);
  await expect(page.getByTestId('import-csv-skipped-line').first()).toContainText('Line 4');

  // The switch governs in-file repeats too, and says so.
  await expect(page.getByTestId('import-csv-include-duplicates')).toBeVisible();
  await expect(page.getByText('Add rows that repeat a session in my log, or an earlier row in this file')).toBeVisible();
  await page.getByTestId('import-csv-include-duplicates').check();
  await expect(page.getByTestId('import-csv-headline')).toContainText('This will add 3 sessions');
  await expect(page.getByTestId('import-csv-skipped').first()).toHaveText(
    '1 row skipped: 1 using a gun name you chose to skip.',
  );
  await expect(page.getByTestId('import-csv-skipped').nth(1)).toHaveText(
    'Being added because you asked for them: 1 that repeats an earlier row in this file.',
  );
});

test('a guess is shown as a guess, and stops being one when you overrule it', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  await page.getByTestId('import-csv-file').setInputFiles(FIXTURE('range-log.csv'));

  // "Time" here holds words, and the engine guessed it as a drill time. A guess
  // that renders exactly like a deliberate choice is the one the shooter never
  // thinks to check.
  await expect(page.getByTestId('import-csv-column-4')).toHaveValue('drillTime');
  await expect(page.getByTestId('import-csv-guessed-4')).toBeVisible();
  await expect(page.getByTestId('import-csv-guessed-4')).toContainText('Matched by the column name');

  await page.getByTestId('import-csv-column-4').selectOption('');
  await expect(page.getByTestId('import-csv-guessed-4')).toHaveCount(0);
});

test('an import takes rounds off the can, and removing it puts exactly those back', async ({ page }) => {
  await page.goto('/');
  await seedRecords(page, 'ammunition', [{
    id: 'am-e2e', createdAt: 1, updatedAt: 1, brand: 'Test Brand', caliber: '9mm',
    grain: '124', bulletType: 'FMJ', quantity: 1000, costPerRound: 0.2, notes: '',
  }]);
  await page.reload();
  await openImport(page);

  await page.getByTestId('import-csv-file').setInputFiles(FIXTURE('ammo-log.csv'));
  await page.getByTestId('import-csv-continue-map').click();
  await page.getByTestId('import-csv-gun-0').selectOption('create');
  await page.getByTestId('import-csv-continue-guns').click();

  // Said before it happens, not discovered on the Ammo screen afterwards.
  await expect(page.getByTestId('import-csv-ammo').first()).toContainText('250 rounds come off');
  await expect(page.getByTestId('import-csv-ammo').first()).toContainText('leaving 750');

  await page.getByTestId('import-csv-commit').click();
  await expect(page.getByTestId('import-csv-report')).toBeVisible();
  expect(await ammoQuantity(page, 'am-e2e')).toBe(750);

  await page.getByTestId('import-csv-report-undo').click();
  await page.getByRole('button', { name: 'Remove it' }).click();
  await expect(page.getByTestId('import-csv-undo-result')).toBeVisible();
  // Measured before this was symmetric: the commit never deducted and the
  // delete refunded, so 1000 became 1150 and stock existed that never had.
  expect(await ammoQuantity(page, 'am-e2e')).toBe(1000);
});

test('undo takes what you filed against an imported session with it', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  const before = await storeCounts(page);
  await importRangeLog(page);

  // A timed-skill set, a malfunction and a target photo on an imported session:
  // all three are reachable from the session form the moment the import lands.
  const [sessionId] = await importedSessionIds(page);
  expect(sessionId).toBeTruthy();
  await seedRecords(page, 'skillSets', [{
    id: 'ss-e2e', createdAt: 1, updatedAt: 1, sessionId, date: '2026-03-02', skill: 'draw',
    firearmId: 'fa-x', dryFire: false, count: 10, bestSec: 1.42, cold: true, notes: '',
  }]);
  await seedRecords(page, 'malfunctions', [{
    id: 'mf-e2e', createdAt: 1, updatedAt: 1, sessionId, date: '2026-03-02',
    firearmId: 'fa-x', type: 'Failure to feed', resolution: '', notes: '',
  }]);
  await seedRecords(page, 'media', [{
    id: 'md-e2e', createdAt: 1, updatedAt: 1, ownerType: 'session', ownerId: sessionId,
    kind: 'image', name: 'target.jpg', annotations: [], mime: 'image/jpeg',
    data: new ArrayBuffer(8),
  }]);

  await page.getByTestId('import-csv-report-undo').click();
  await page.getByRole('button', { name: 'Remove it' }).click();
  await expect(page.getByTestId('import-csv-undo-result')).toContainText('Removed 3 sessions');
  // Named, not silently done: they were the shooter's own additions.
  await expect(page.getByTestId('import-csv-undo-result')).toContainText('Also removed 3 things filed against those sessions');

  // EVERY store back where it started. The three that hold a session reference
  // are in this comparison because the list is read off the database, so a
  // draw time left pointing at a session that no longer exists shows up here.
  expect(await storeCounts(page)).toEqual(before);
});
