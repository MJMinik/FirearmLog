// Stage-scores importer -- PASS 2 E2E (STAGE_SCORES_SPEC.md section 7).
// Drives the real paste -> confirm -> write path through a real browser, and
// the danger-flows pattern (a refusal writes NOTHING, proven by reload) for
// every way a paste can go wrong.
import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';
import {
  GUNCRAFT_2026_08_02_STAGE1_REVIEW, GUNCRAFT_2026_08_02_STAGE1_COMBINED,
} from '../tests/fixtures/stageScoresGuncraft-2026-08-02.ts';

/** A doctored variant of the real Ashgrove, Priya Stage 1 row -- same header
 *  and hit breakdown, but the printed Hit Factor no longer reproduces (real
 *  value 1.9800; this says 9.9999) -- the honesty-gate refusal path. */
const DOCTORED_MISMATCH = [
  'Stage Results - Review',
  ['Name', 'Member#', 'Squad', 'Class', 'Category', 'Div', 'PF', 'A', 'B', 'C', 'D', 'M', 'NS', 'Proc', 'AP', 'Time', 'Hit Factor', 'TOD'].join('\t'),
  ['Ashgrove, Priya', 'A200101', '6', 'U', '', 'O', 'Min', '19', '-', '6', '-', '1', '-', '-', '-', '52.02', '9.9999', '08-02 11:07'].join('\t'),
].join('\n') + '\n';

/** Settings -> Who you are, written straight into the meta store (the same
 *  fill-only-what-a-screen-cannot-set-faster pattern importCsv.spec.ts's
 *  seedRecords uses) so every test starts already able to recognise Ashgrove,
 *  Priya / A200101 -- the real (anonymised) identity the Gun Craft fixture
 *  carries. */
async function seedWhoYouAre(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('firearmlog');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite');
      const os = tx.objectStore('meta');
      const getReq = os.get('settings');
      getReq.onsuccess = () => {
        const current = (getReq.result as { value?: Record<string, unknown> } | undefined)?.value ?? {};
        os.put({ key: 'settings', value: { ...current, shooterNames: ['Ashgrove, Priya'], uspsaMemberNumber: 'A200101' } });
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  });
}

/** Log a USPSA match with `stageCount` empty stages, landing on its debrief. */
async function logUspsaMatch(page: Page, name: string, stageCount: number): Promise<void> {
  await gotoTab(page, 'Compete');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: '+ Log Match' }).click();
  await expect(main.getByRole('heading', { name: 'Log Match' })).toBeVisible();
  await main.getByLabel('What this match is called').fill(name);
  await main.locator('#match-gun-select').selectOption({ index: 1 });
  const addStage = main.getByRole('button', { name: '+ Add Stage' });
  for (let i = 0; i < stageCount; i++) await addStage.click();
  await main.getByRole('button', { name: 'Save match' }).click();
  await expect(main.getByRole('heading', { name, level: 1 })).toBeVisible();
}

/** From a match's debrief, open the stage-scores screen and one stage's paste box. */
async function openStageBox(page: Page, stageNumber: number): Promise<void> {
  const main = page.getByRole('main');
  await main.getByRole('button', { name: /Add stage scores/ }).click();
  await expect(main.getByRole('heading', { name: 'Add stage scores' })).toBeVisible();
  await main.getByRole('button', { name: `Stage ${stageNumber}` }).click();
  await expect(main.getByRole('heading', { name: `Stage ${stageNumber}`, level: 1 })).toBeVisible();
}

test.describe('Stage scores importer (pass 2)', () => {
  test('happy path: a real Review page fills a stage and the derived hit factor appears', async ({ page }) => {
    await seedDemo(page);
    await seedWhoYouAre(page);
    await logUspsaMatch(page, 'Stage Scores Happy Path', 2);
    const main = page.getByRole('main');

    await openStageBox(page, 1);
    await main.getByRole('textbox', { name: 'Stage results text' }).fill(GUNCRAFT_2026_08_02_STAGE1_REVIEW);
    await main.getByRole('button', { name: 'Read stage' }).click();

    // The confirm step: parsed shooter, hits, time, derived HF -- BESIDE the
    // target match and stage. Scoped to the "This match" card so its "Stage
    // 1" row value is never confused with the screen's own "Stage 1" h1 title.
    const thisMatchCard1 = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'This match' }) });
    await expect(thisMatchCard1.getByText('Stage Scores Happy Path')).toBeVisible();
    await expect(thisMatchCard1.getByText('Stage 1', { exact: true })).toBeVisible();
    await expect(main.getByText('Ashgrove, Priya')).toBeVisible();
    await expect(main.getByText(/A 19.*C 6.*M 1/)).toBeVisible();

    await main.getByRole('button', { name: /Save Stage 1.s scores/ }).click();

    // Back on the stage list, Stage 1 flips to Added.
    await expect(main.getByRole('heading', { name: 'Add stage scores' })).toBeVisible();
    await expect(main.getByText('Added').first()).toBeVisible();

    // The derived hit factor shows up on the match's own debrief.
    await main.getByRole('button', { name: '‹ Back' }).click();
    await expect(main.getByRole('heading', { name: 'Stage Scores Happy Path' })).toBeVisible();
    await expect(main.getByText('HF 1.98')).toBeVisible();
  });

  // Session 134. The entry gate used to hide "Add stage scores" once every
  // stage carried a hit breakdown. That made the feature unreachable on a log
  // where every stage had been filled in by hand -- which is Michael's whole
  // log, so it shipped unusable for its only user. Every other test in this
  // file starts from EMPTY stages and clicks the button immediately, so the
  // suite stayed green while the door never opened. This test starts where he
  // starts: a match with nothing left to fill.
  test('a match whose every stage is already filled still offers the importer', async ({ page }) => {
    await seedDemo(page);
    await seedWhoYouAre(page);
    await logUspsaMatch(page, 'Stage Scores All Filled', 1);
    const main = page.getByRole('main');

    await openStageBox(page, 1);
    await main.getByRole('textbox', { name: 'Stage results text' }).fill(GUNCRAFT_2026_08_02_STAGE1_REVIEW);
    await main.getByRole('button', { name: 'Read stage' }).click();
    await main.getByRole('button', { name: /Save Stage 1.s scores/ }).click();
    await expect(main.getByText('Added').first()).toBeVisible();

    // Back on the debrief with every stage filled, the door must STILL be open:
    // replacing a filled stage is a supported path (the stage list says "add or
    // replace it" and guards the overwrite with a confirm).
    await main.getByRole('button', { name: '\u2039 Back' }).click();
    await expect(main.getByRole('heading', { name: 'Stage Scores All Filled' })).toBeVisible();
    await expect(main.getByRole('button', { name: /Add stage scores/ })).toBeVisible();

    // Survives a reload, so this is the stored state and not a stale render.
    await page.reload();
    await gotoTab(page, 'Compete');
    await main.getByText('Stage Scores All Filled').click();
    await expect(main.getByRole('button', { name: /Add stage scores/ })).toBeVisible();
  });

  test('the identity E2E: content pasted at the wrong stage slot shows the slot before anything commits', async ({ page }) => {
    await seedDemo(page);
    await seedWhoYouAre(page);
    await logUspsaMatch(page, 'Stage Scores Identity Test', 4);
    const main = page.getByRole('main');

    // Pasted content carries no stage number anywhere in its own text (the
    // whole reason this confirm step exists) -- opened at Stage 4's slot, it
    // must show "Stage 4" plainly, not the stage the page happens to be from.
    await openStageBox(page, 4);
    await main.getByRole('textbox', { name: 'Stage results text' }).fill(GUNCRAFT_2026_08_02_STAGE1_REVIEW);
    await main.getByRole('button', { name: 'Read stage' }).click();

    const thisMatchCard4 = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'This match' }) });
    await expect(thisMatchCard4.getByText('Stage 4', { exact: true })).toBeVisible();
    await expect(main.getByText('Ashgrove, Priya')).toBeVisible();
    // Nothing has committed yet -- the Save button is still on screen, unclicked.
    await expect(main.getByRole('button', { name: /Save Stage 4.s scores/ })).toBeVisible();

    // Leave without confirming: Stage 4 is still Empty. Cold audit L-4: the
    // original assertion here only checked in-memory state after the ‹ Stages
    // tap -- reload from disk first, the same "danger-flows" pattern the
    // refusal-path test below uses, so this actually proves nothing committed
    // rather than just that the screen's own state never advanced.
    await main.getByRole('button', { name: '‹ Stages' }).click();
    await page.reload();
    await gotoTab(page, 'Compete');
    await main.getByText('Stage Scores Identity Test').click();
    await main.getByRole('button', { name: /Add stage scores/ }).click();
    await expect(main.getByRole('button', { name: 'Stage 4' })).toContainText('Empty');
  });

  test('refusal path: a doctored hit factor refuses with the stage number and writes nothing', async ({ page }) => {
    await seedDemo(page);
    await seedWhoYouAre(page);
    await logUspsaMatch(page, 'Stage Scores Refusal Test', 1);
    const main = page.getByRole('main');

    await openStageBox(page, 1);
    await main.getByRole('textbox', { name: 'Stage results text' }).fill(DOCTORED_MISMATCH);
    await main.getByRole('button', { name: 'Read stage' }).click();

    await expect(main.getByText(/Stage 1's numbers include something this app can't verify/)).toBeVisible();
    await expect(main.getByText(/Nothing was saved for Stage 1/)).toBeVisible();

    // Danger-flows pattern: reload and confirm the stage is still Empty.
    await page.reload();
    await gotoTab(page, 'Compete');
    await main.getByText('Stage Scores Refusal Test').click();
    await main.getByRole('button', { name: /Add stage scores/ }).click();
    await expect(main.getByRole('button', { name: 'Stage 1' })).toContainText('Empty');
  });

  test('wrong-surface: a Combined page pasted into the stage box gets routed, not parsed, and writes nothing', async ({ page }) => {
    await seedDemo(page);
    await seedWhoYouAre(page);
    await logUspsaMatch(page, 'Stage Scores Wrong Surface Test', 1);
    const main = page.getByRole('main');

    await openStageBox(page, 1);
    await main.getByRole('textbox', { name: 'Stage results text' }).fill(GUNCRAFT_2026_08_02_STAGE1_COMBINED);
    await main.getByRole('button', { name: 'Read stage' }).click();

    await expect(main.getByText(/Stage 1's Combined page/)).toBeVisible();
    await expect(main.getByText(/Tap Review next to Stage 1 instead of Combined/)).toBeVisible();

    await main.getByRole('button', { name: '‹ Stages' }).click();
    await expect(main.getByRole('button', { name: 'Stage 1' })).toContainText('Empty');
  });

  test('gate absence: no "Add stage scores" row on a Steel Challenge match', async ({ page }) => {
    await seedDemo(page);
    const main = page.getByRole('main');
    await gotoTab(page, 'Compete');
    await main.getByRole('button', { name: '+ Log Match' }).click();
    await main.getByLabel('What this match is called').fill('Stage Scores Steel Gate Test');
    await main.getByLabel('Match type').selectOption({ label: 'Steel Challenge' });
    await main.locator('#match-gun-select').selectOption({ index: 1 });
    await main.getByRole('button', { name: '+ Add Stage' }).click();
    await main.getByRole('button', { name: 'Save match' }).click();
    await expect(main.getByRole('heading', { name: 'Stage Scores Steel Gate Test', level: 1 })).toBeVisible();

    await expect(main.getByRole('button', { name: /Add stage scores/ })).toHaveCount(0);
  });

  // Session 134, REVERSED. This test used to assert the row was ABSENT once
  // every stage carried a breakdown -- it pinned seat 11's condition, and the
  // condition was wrong in practice: Michael had hand-entered breakdowns on
  // every stage of every match, so the importer was unreachable on his entire
  // log. The behaviour was specified, built AND tested; nothing overlooked it.
  // It now asserts the opposite, because replacing a hand-entered stage with
  // the source-verified numbers is a supported path the old gate made
  // impossible to reach.
  test('the "Add stage scores" row stays offered once every stage already has a breakdown', async ({ page }) => {
    await seedDemo(page);
    const main = page.getByRole('main');
    await gotoTab(page, 'Compete');
    await main.getByRole('button', { name: '+ Log Match' }).click();
    await main.getByLabel('What this match is called').fill('Stage Scores Filled Gate Test');
    await main.locator('#match-gun-select').selectOption({ index: 1 });
    await main.getByRole('button', { name: '+ Add Stage' }).click();
    const block = main.locator('.drill-edit').first();
    await block.getByLabel('Time (s)').fill('5');
    await block.getByRole('button', { name: /Add hit breakdown/ }).click();
    await block.getByLabel('Alphas (A)', { exact: true }).fill('10');
    await main.getByRole('button', { name: 'Save match' }).click();
    await expect(main.getByRole('heading', { name: 'Stage Scores Filled Gate Test', level: 1 })).toBeVisible();

    await expect(main.getByRole('button', { name: /Add stage scores/ })).toBeVisible();
  });

  // Cold audit NEW-L-1 (session 133): the stage-list label and the match's
  // own "Add stage scores" entry gate used to disagree about a hand-entered,
  // no-breakdown stage -- the list called it "Added" while the gate (which
  // reads hasHitBreakdown, unchanged here) still treated the match as having
  // an unfilled stage. This proves all three labels now say what's true, and
  // that the entry gate still shows for the hand-entered stage specifically.
  test('the stage list gives a hand-entered, no-breakdown stage its own label -- distinct from Added and Empty', async ({ page }) => {
    await seedDemo(page);
    const main = page.getByRole('main');
    await gotoTab(page, 'Compete');
    await main.getByRole('button', { name: '+ Log Match' }).click();
    await main.getByLabel('What this match is called').fill('Stage Scores Third Label Test');
    await main.locator('#match-gun-select').selectOption({ index: 1 });
    const addStage = main.getByRole('button', { name: '+ Add Stage' });
    await addStage.click();
    await addStage.click();
    await addStage.click();
    const blocks = main.locator('.drill-edit');

    // Stage 1: time only, no breakdown -- the new "logged by hand" case.
    await blocks.nth(0).getByLabel('Time (s)').fill('12.5');
    // Stage 2: left completely bare -- still Empty.
    // Stage 3: a full hit breakdown -- still Added.
    await blocks.nth(2).getByLabel('Time (s)').fill('9');
    await blocks.nth(2).getByRole('button', { name: /Add hit breakdown/ }).click();
    await blocks.nth(2).getByLabel('Alphas (A)', { exact: true }).fill('10');

    await main.getByRole('button', { name: 'Save match' }).click();
    await expect(main.getByRole('heading', { name: 'Stage Scores Third Label Test', level: 1 })).toBeVisible();

    // The entry gate shows. (Session 134: it now shows on every USPSA match
    // with a stage skeleton, so this no longer turns on hasHitBreakdown at
    // all -- the comment above about the gate's definition is history.)
    await main.getByRole('button', { name: /Add stage scores/ }).click();
    await expect(main.getByRole('heading', { name: 'Add stage scores' })).toBeVisible();

    await expect(main.getByRole('button', { name: 'Stage 1' })).toContainText('Logged by hand');
    await expect(main.getByRole('button', { name: 'Stage 1' })).toContainText('paste to add the hit breakdown');
    await expect(main.getByRole('button', { name: 'Stage 2' })).toContainText('Empty');
    await expect(main.getByRole('button', { name: 'Stage 3' })).toContainText('Added');
  });

  test('overwrite: re-pasting an already-filled stage requires an explicit confirm', async ({ page }) => {
    await seedDemo(page);
    await seedWhoYouAre(page);
    await logUspsaMatch(page, 'Stage Scores Overwrite Test', 1);
    const main = page.getByRole('main');

    // Fill Stage 1 the first time.
    await openStageBox(page, 1);
    await main.getByRole('textbox', { name: 'Stage results text' }).fill(GUNCRAFT_2026_08_02_STAGE1_REVIEW);
    await main.getByRole('button', { name: 'Read stage' }).click();
    await main.getByRole('button', { name: /Save Stage 1.s scores/ }).click();
    await expect(main.getByRole('heading', { name: 'Add stage scores' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Stage 1' })).toContainText('Added');

    // Re-paste the SAME stage: the confirm step now offers "Replace", not a
    // silent Save, and the explicit sheet must be answered before anything writes.
    await main.getByRole('button', { name: 'Stage 1' }).click();
    await main.getByRole('textbox', { name: 'Stage results text' }).fill(GUNCRAFT_2026_08_02_STAGE1_REVIEW);
    await main.getByRole('button', { name: 'Read stage' }).click();
    await main.getByRole('button', { name: /Replace Stage 1.s scores/ }).click();

    await expect(page.getByRole('dialog', { name: /Replace Stage 1's scores/ })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Replace scores' }).click();

    await expect(main.getByRole('heading', { name: 'Add stage scores' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Stage 1' })).toContainText('Added');
  });
});
