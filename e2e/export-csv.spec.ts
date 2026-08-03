import { test, expect } from '@playwright/test';
import { seedDemo, gotoSection } from './helpers';

// Export as CSV (spec §7.2, second half). Stage 1 of the CSV work, and the
// read-only half: nothing on this screen writes to storage.
//
// What these specs are actually for. The unit tests in tests/csvExport.test.ts
// and tests/csvTables.test.ts already prove the SERIALISATION — escaping, the
// formula guard, the Trash exclusion, the one-row-per-gun expansion. What they
// cannot prove is that the screen exists, that it reaches the real stored data,
// and that a tap produces a file with those bytes in it. That is this file's
// job, and it reads the downloaded file rather than trusting the click.

async function downloadTable(page: import('@playwright/test').Page, testId: string) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(testId).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return { download, text: Buffer.concat(chunks).toString('utf8') };
}

test('the Sessions export downloads a real CSV carrying the logged data', async ({ page }) => {
  await seedDemo(page);
  await gotoSection(page, 'Export as CSV');

  await expect(page.getByRole('heading', { name: 'Export as CSV', exact: true })).toBeVisible();

  const { download, text } = await downloadTable(page, 'export-sessions');

  expect(download.suggestedFilename()).toMatch(/^FirearmLog-sessions-\d{4}-\d{2}-\d{2}\.csv$/);

  // A UTF-8 BOM, so Excel reads accented text instead of guessing a codepage.
  expect(text.charCodeAt(0)).toBe(0xfeff);

  // The header row, and at least one row of real data under it.
  const lines = text.replace(new RegExp('^\\uFEFF'), '').trimEnd().split('\r\n');
  expect(lines[0]).toContain('Date');
  expect(lines[0]).toContain('Gun');
  expect(lines[0]).toContain('Rounds');
  expect(lines.length).toBeGreaterThan(1);

  // The gun column holds a NAME, not an internal id. This is the property the
  // import side depends on, so it is worth asserting on the real file rather
  // than only in a unit test.
  const firstRow = lines[1].split(',');
  expect(firstRow[2]).not.toMatch(/^[a-f0-9]{8,}$/i);
  expect(firstRow[2].length).toBeGreaterThan(0);
});

test('a gun serial number never reaches the exported file', async ({ page }) => {
  await seedDemo(page);
  await gotoSection(page, 'Export as CSV');

  const { text } = await downloadTable(page, 'export-firearms');

  // Not even the column header. A serial identifies a specific firearm and a
  // CSV is the format most likely to be mailed or dropped in a shared folder.
  expect(text.toLowerCase()).not.toContain('serial');
});

test('the screen states what a CSV does not carry, so nobody treats it as a backup', async ({ page }) => {
  await seedDemo(page);
  await gotoSection(page, 'Export as CSV');

  const main = page.getByRole('main');
  // No `.or(/photos/)` fallback here. A cold audit pointed out that the looser
  // version would pass if the copy said "your photos ARE included" — a test
  // that cannot fail on the defect it is named after.
  await expect(main.getByText(/photos and videos are not in it/i)).toBeVisible();
  await expect(main.getByText(/neither is everything the app stores/i)).toBeVisible();
  await expect(main.getByText(/For a complete backup, use Save to File/i)).toBeVisible();
});

test('every table row shows a count, and an empty table cannot be tapped', async ({ page }) => {
  await page.goto('/');
  // Deliberately NOT seeded: a first-run log has nothing in it, and the screen
  // has to be honest about that rather than handing over empty files.
  await gotoSection(page, 'Export as CSV');

  const classifiers = page.getByTestId('export-classifiers');
  await expect(classifiers).toBeVisible();
  // aria-disabled rather than the native attribute, so it stays focusable and a
  // screen reader announces it as unavailable instead of skipping it (decision
  // 19). Tapping it must do nothing at all.
  await expect(classifiers).toHaveAttribute('aria-disabled', 'true');
  // Playwright's toBeEnabled() treats aria-disabled as disabled, which is the
  // right call for "can the user act on it" and the wrong probe for the thing
  // this test is about. What matters here is that the NATIVE attribute is
  // absent, because that is what decides whether the element can hold focus.
  expect(await classifiers.evaluate((el: HTMLButtonElement) => el.disabled)).toBe(false);
  await classifiers.focus();
  await expect(classifiers).toBeFocused();
  await expect(classifiers).toContainText('None yet');

  // force:true because Playwright refuses to click an aria-disabled element,
  // and a real finger has no such scruples. This is the case worth proving:
  // the tap lands and the handler declines to act on it.
  await classifiers.click({ force: true });
  // Give a real export time to appear before asserting it did not. toHaveCount(0)
  // passes on its first evaluation, so without the wait this would succeed even
  // if the tap HAD started an export.
  await page.waitForTimeout(500);
  await expect(page.getByRole('status').filter({ hasText: 'Classifiers:' })).toHaveCount(0);
  await expect(classifiers).toContainText('None yet');
});

test('exporting reports what actually landed, and the log is untouched afterwards', async ({ page }) => {
  await seedDemo(page);
  await gotoSection(page, 'Export as CSV');

  const before = await page.evaluate(async () => {
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
    return { sessions: await count('sessions'), firearms: await count('firearms') };
  });

  await downloadTable(page, 'export-sessions');

  // The confirmation names the table and the row count, in past tense. Scoped
  // by text because the sample-log banner is also a role="status" live region,
  // so a bare getByRole('status') matches two elements on a seeded log. Keeping
  // the role in the selector still asserts the thing worth asserting: that the
  // confirmation is announced to a screen reader rather than only drawn.
  await expect(page.getByRole('status').filter({ hasText: 'Sessions:' }))
    .toContainText(/Sessions: \d+ rows?/);

  const after = await page.evaluate(async () => {
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
    return { sessions: await count('sessions'), firearms: await count('firearms') };
  });

  // The whole claim of this stage is that it only reads. Prove it.
  expect(after).toEqual(before);
});
