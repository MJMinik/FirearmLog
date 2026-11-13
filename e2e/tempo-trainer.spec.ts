import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoSection, isDesktop, nav, contrastOf } from './helpers';

// The Steel Challenge tempo trainer (decision 80, step 2: the screen).
//
// tests/steelTempo.test.ts proves the arithmetic and tests/tempoSchedule.test.ts
// the timetable; these prove the wiring on the live app: the Tempo button on
// the eight built-in stage drills, the class table, the peak edit, the draw
// default, and above all that the SOUND is scheduled at the times the screen
// shows.
//
// HOW THE SOUND IS CHECKED, with no hook in the app: before the page loads,
// an init script wraps OscillatorNode.prototype.start and .stop and records
// every call (when, frequency, the context clock at that moment). The app's
// own engine then schedules its tones exactly as it would for a shooter, and
// the test reads the record. A longer, lower tone (440 Hz) is the start
// signal; a short, higher click (1760 Hz) is a beat.

const START_HZ = 440;
const BEAT_HZ = 1760;

interface OscCall { when: number; hz: number; now: number }
interface OscRecord { starts: OscCall[]; stops: { when: number | null; hz: number }[] }

async function recordOscillators(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const rec = { starts: [] as unknown[], stops: [] as unknown[] };
    (window as unknown as { __oscRecord: typeof rec }).__oscRecord = rec;
    const proto = OscillatorNode.prototype;
    const origStart = proto.start;
    const origStop = proto.stop;
    proto.start = function (this: OscillatorNode, when?: number) {
      rec.starts.push({ when: when ?? 0, hz: this.frequency.value, now: this.context.currentTime });
      return origStart.call(this, when);
    };
    proto.stop = function (this: OscillatorNode, when?: number) {
      rec.stops.push({ when: when === undefined ? null : when, hz: this.frequency.value });
      return origStop.call(this, when);
    };
  });
}

async function oscRecord(page: Page): Promise<OscRecord> {
  return page.evaluate(() => (window as unknown as { __oscRecord: OscRecord }).__oscRecord);
}

/** Wait until the engine has scheduled `n` tones, then return the record. */
async function waitForTones(page: Page, n: number, timeout = 10_000): Promise<OscRecord> {
  await expect.poll(async () => (await oscRecord(page)).starts.length, { timeout }).toBeGreaterThanOrEqual(n);
  return oscRecord(page);
}

const main = (page: Page) => page.getByRole('main');
// The title holds its help button, so its spoken name is longer than "Tempo":
// match the h1 itself, and its own text.
const tempoTitle = (page: Page) => page.locator('h1.large-title', { hasText: /^Tempo/ });
const startBtn = (page: Page) => main(page).getByRole('button', { name: 'Start', exact: true });
const stopBtn = (page: Page) => main(page).getByRole('button', { name: 'Stop', exact: true });
// A <select> inside its <label>: the label's text includes the option text,
// so these are found by the label's leading words instead of getByLabel.
const stageSelect = (page: Page) => main(page).locator('label.field', { hasText: /^Stage/ }).locator('select');
const divisionSelect = (page: Page) => main(page).locator('label.field', { hasText: /^Division/ }).locator('select');
const drawField = (page: Page) => main(page).getByLabel('Draw (seconds)');
const peakField = (page: Page) => main(page).getByLabel('Your peak time (seconds)');
const status = (page: Page) => main(page).locator('.tempo-status');
/** The screen-reader twin of the status line: every state except "Running". */
const live = (page: Page) => main(page).locator('.tempo-live');
const summary = (page: Page) => main(page).locator('#tempo-summary');
const table = (page: Page) => main(page).locator('table.tempo-table');
/** One class row of the table, by its class name in the first cell. */
const row = (page: Page, band: string) =>
  table(page).locator('tbody tr').filter({ has: page.locator('th', { hasText: new RegExp(`^${band}$`) }) });
const radio = (page: Page, band: string) => row(page, band).getByRole('radio');

/** Drills → expand one drill. Leaves its panel open. */
async function expandDrill(page: Page, name: string): Promise<void> {
  await gotoSection(page, 'Drills');
  await expect(page.getByRole('heading', { name: 'Drills' }).first()).toBeVisible();
  const rowBtn = main(page).locator('button.row-tap').filter({ has: page.locator('.label', { hasText: name }) }).first();
  // The eight stage drills are seeded just after the sample log lands.
  await expect(rowBtn).toBeVisible({ timeout: 15_000 });
  await rowBtn.click();
  await expect(rowBtn).toHaveAttribute('aria-expanded', 'true');
}

/** Drills → a Steel Challenge stage → Tempo, waiting for the screen to be ready. */
async function openTempo(page: Page, stageName: string): Promise<void> {
  await expandDrill(page, `Steel Challenge: ${stageName}`);
  await main(page).getByRole('button', { name: 'Tempo', exact: true }).click();
  await expect(tempoTitle(page)).toBeVisible();
  await expect(stageSelect(page)).toBeVisible();
}

/** The shape every beat test uses. Carry Optics, Smoke & Hope, Master:
 *  peak 10.00; 10.00 / 0.85 = 11.7647, cut 11.76; 11.7647 / 4 = 2.9411, cut
 *  2.94 a string. Draw 1.00 leaves 1.94 for four gaps of 0.485:
 *  beats at 1.00, 1.485, 1.97, 2.455, 2.94 after the start signal. */
const PER = 2.94;
const BEATS = [1, 1.485, 1.97, 2.455, 2.94];
async function openWorkedCase(page: Page): Promise<void> {
  await openTempo(page, 'Smoke & Hope');
  await divisionSelect(page).selectOption('Carry Optics');
  await radio(page, 'M').check();
  await drawField(page).fill('1.00');
  await expect(summary(page)).toHaveText('Draw 1.00 s, then four beats about 0.48 s apart. Last beat at 2.94 s.');
}

/** Record what the dot and the countdown do, from inside the page, so a flash
 *  that lasts under a tenth of a second is never missed between two polls.
 *  Test-side only: a MutationObserver on markup the screen already renders. */
async function watchDot(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __flashes: string[] }).__flashes = seen;
    const stage = document.querySelector('.tempo-stage')!;
    const read = () => {
      const dot = stage.querySelector('.tempo-dot');
      const count = stage.querySelector('.tempo-count');
      const state = count ? `count:${count.textContent}`
        : dot?.classList.contains('start') ? 'start' : dot?.classList.contains('beat') ? 'beat' : 'off';
      if (seen[seen.length - 1] !== state) seen.push(state);
    };
    new MutationObserver(read).observe(stage, { subtree: true, childList: true, attributes: true, characterData: true });
    read();
  });
}
const dotLog = (page: Page) => page.evaluate(() => (window as unknown as { __flashes: string[] }).__flashes);
/** What one string with a countdown looks like on the dot. The tests that
 *  compare against this use a 0.15 s draw on a 1.75 s string, which leaves
 *  0.31 s of dark between two beats (gap 0.40 s, flash 0.09 s). The dot is
 *  redrawn once a frame, so a dark moment is only missed if no frame arrives
 *  for that long; at the screen's default draw the dark moment is under a
 *  tenth of a second and one slow frame on a busy test machine would hide it. */
const WIDE_DRAW = '0.15';
/** (1.75 - 0.15) / 4 = 0.40 exactly, so the line carries no "about". */
const WIDE_SUMMARY = 'Draw 0.15 s, then four beats 0.40 s apart. Last beat at 1.75 s.';
const ONE_STRING = [
  'off', 'count:3', 'count:2', 'count:1',
  'start', 'off', 'beat', 'off', 'beat', 'off', 'beat', 'off', 'beat', 'off', 'beat', 'off',
];

function tonesByKind(rec: OscRecord) {
  return {
    starts: rec.starts.filter((s) => s.hz === START_HZ),
    beats: rec.starts.filter((s) => s.hz === BEAT_HZ),
    other: rec.starts.filter((s) => s.hz !== START_HZ && s.hz !== BEAT_HZ),
  };
}

test.describe('Tempo trainer: getting there', () => {
  test('(a) the Tempo button on a Steel stage drill opens the screen on that stage; other drills have none', async ({ page }) => {
    await seedDemo(page);
    await expandDrill(page, 'Bill Drill');
    await expect(main(page).getByRole('button', { name: 'Edit Drill' })).toBeVisible();
    await expect(main(page).getByRole('button', { name: 'Tempo', exact: true })).toHaveCount(0);

    // The generic plate-rack practice drill is not the SC-105 stage.
    await main(page).locator('button.row-tap').filter({ hasText: 'Accelerator (Steel)' }).first().click();
    await expect(main(page).getByRole('button', { name: 'Edit Drill' })).toBeVisible();
    await expect(main(page).getByRole('button', { name: 'Tempo', exact: true })).toHaveCount(0);

    // A non-first stage, so a screen that ignored the stage would be caught.
    const smoke = main(page).locator('button.row-tap').filter({ hasText: 'Steel Challenge: Smoke & Hope' }).first();
    await smoke.click();
    const panel = smoke.locator('xpath=following-sibling::div[1]');
    // Tempo sits above Edit Drill.
    await expect(panel.locator('button.button')).toHaveText(['Tempo', 'Edit Drill']);
    await expect(panel.getByRole('button', { name: 'Tempo', exact: true })).toHaveClass(/button secondary/);
    await panel.getByRole('button', { name: 'Tempo', exact: true }).click();

    await expect(tempoTitle(page)).toBeVisible();
    await expect(stageSelect(page)).toHaveValue('2');
    await expect(stageSelect(page).locator('option:checked')).toHaveText('Smoke & Hope (SC-103)');
    await expect(stageSelect(page).locator('option')).toHaveCount(8);
    await expect(divisionSelect(page).locator('option')).toHaveCount(16);
    await expect(divisionSelect(page).locator('option', { hasText: /^Other$/ })).toHaveCount(0);

    // The Drills sidebar item stays lit while on Tempo (desktop).
    if (isDesktop(page)) {
      await expect(nav(page).getByRole('button', { name: 'Drills' }).first()).toHaveAttribute('aria-current', 'page');
    }

    // Back returns to Drills.
    await main(page).getByRole('button', { name: '‹ Back' }).click();
    await expect(page.getByRole('heading', { name: 'Drills' }).first()).toBeVisible();
  });

  test('(k) Find a screen: typing "tempo" finds the row and lands on Tempo', async ({ page }) => {
    await seedDemo(page);
    if (!isDesktop(page)) await nav(page).getByRole('button', { name: 'More' }).first().click();
    const find = page.getByRole('search', { name: 'Find a screen' }).getByRole('searchbox');
    await find.fill('tempo');
    await page.locator('[data-find-id="drills-tempo"]').first().click();
    await expect(tempoTitle(page)).toBeVisible();
    // No stage was asked for, so it opens on the first.
    await expect(stageSelect(page)).toHaveValue('0');
  });

  test('the help tip carries the screen\'s explanation, and the page never says "shot"', async ({ page }) => {
    await seedDemo(page);
    await openTempo(page, 'Outer Limits');
    await main(page).getByRole('button', { name: 'Help for Tempo' }).click();
    await expect(main(page).getByRole('note')).toHaveText(
      'A metronome for one Steel Challenge string. Pick the stage, your division and a class, set your draw, then tap Start. You hear a start tone, then five beats: the first at your draw, the last at the time that class needs for one string, the three between spread evenly. It is a pace to hold, not a prediction of your string. Nothing on this screen is saved.');
    const forbidden = /\bshots?\b|pistol tracker|gunshot/i;
    // Every state that shows different words: plain, edited, edited-and-unusable, blocked.
    expect(await main(page).innerText()).not.toMatch(forbidden);
    await main(page).getByRole('button', { name: 'Use my own figure' }).click();
    expect(await main(page).innerText()).not.toMatch(forbidden);
    await peakField(page).fill('0.5');
    expect(await main(page).innerText()).not.toMatch(forbidden);
    await main(page).getByRole('button', { name: 'Reset to official' }).click();
    for (const d of ['', '99', '3.7']) {
      await drawField(page).fill(d);
      expect(await main(page).innerText()).not.toMatch(forbidden);
    }
  });
});

test.describe('Tempo trainer: the class table', () => {
  test('(b) the table shows the hand-worked times, and Outer Limits divides by three', async ({ page }) => {
    await seedDemo(page);
    await openTempo(page, 'Smoke & Hope');
    await divisionSelect(page).selectOption('Carry Optics');

    await expect(table(page).locator('caption')).toHaveText('Times for Carry Optics on Smoke & Hope');
    await expect(table(page).locator('thead th')).toHaveText(['Class', '% of peak', 'Stage', 'Per string']);
    await expect(main(page).getByText('Peak time 10.00 s, from scsa.org/classification.')).toBeVisible();
    // Carry Optics, Smoke & Hope, peak 10.00. M: 10 / 0.85 = 11.7647 -> 11.76; / 4 = 2.9411 -> 2.94.
    await expect(row(page, 'M').locator('td')).toHaveText(['85%', '11.76 s', '2.94 s']);
    // The whole column, by hand: 10/1 = 10.00, 2.50; 10/.95 = 10.5263 -> 10.52, 2.6315 -> 2.63;
    // 10/.75 = 13.3333 -> 13.33, 3.3333 -> 3.33; 10/.6 = 16.6666 -> 16.66, 4.1666 -> 4.16; 10/.4 = 25.00, 6.25.
    await expect(table(page).locator('tbody tr.tempo-row th')).toHaveText(['Peak', 'GM', 'M', 'A', 'B', 'C']);
    await expect(row(page, 'Peak').locator('td')).toHaveText(['100%', '10.00 s', '2.50 s']);
    await expect(row(page, 'GM').locator('td')).toHaveText(['95%', '10.52 s', '2.63 s']);
    await expect(row(page, 'A').locator('td')).toHaveText(['75%', '13.33 s', '3.33 s']);
    await expect(row(page, 'B').locator('td')).toHaveText(['60%', '16.66 s', '4.16 s']);
    await expect(row(page, 'C').locator('td')).toHaveText(['40%', '25.00 s', '6.25 s']);
    // The seventh row.
    const d = table(page).locator('tbody tr').nth(6);
    await expect(d.locator('th')).toHaveText('D');
    await expect(d.locator('td')).toHaveText(['below 40%', 'slower than the C time']);
    await expect(d.locator('td').nth(1)).toHaveAttribute('colspan', '2');

    await expect(main(page).getByText('Stage is the total for the strings that count: your best 4 of 5 (best 3 of 4 on Outer Limits). Per string is the average each of those strings needs. Both are cut to hundredths, never rounded up.')).toBeVisible();
    const outerNote = main(page).getByText('Outer Limits has a move from one box to the other in the middle of the string. The beats stay evenly spaced, so the move has to fit inside one gap.');
    await expect(outerNote).toHaveCount(0);

    // Open, Five to Go, peak 11.25: Peak row is 11.25 and 11.25 / 4 = 2.8125 -> 2.81 (cut, not 2.82).
    await stageSelect(page).selectOption({ label: 'Five to Go (SC-101)' });
    await divisionSelect(page).selectOption('Open');
    await expect(table(page).locator('caption')).toHaveText('Times for Open on Five to Go');
    await expect(row(page, 'Peak').locator('td')).toHaveText(['100%', '11.25 s', '2.81 s']);
    // B: 11.25 / 0.6 = 18.75; / 4 = 4.6875 -> 4.68 (rounding would say 4.69 and cost the class).
    await expect(row(page, 'B').locator('td')).toHaveText(['60%', '18.75 s', '4.68 s']);

    // Outer Limits counts THREE strings. Carry Optics peak 13.75.
    //   Peak: 13.75 / 3 = 4.5833 -> 4.58   (by four it would be 3.4375 -> 3.43)
    //   M:    13.75 / 0.85 = 16.1764 -> 16.17; 16.1764 / 3 = 5.3921 -> 5.39   (by four: 4.04)
    await stageSelect(page).selectOption({ label: 'Outer Limits (SC-104)' });
    await divisionSelect(page).selectOption('Carry Optics');
    await expect(row(page, 'Peak').locator('td')).toHaveText(['100%', '13.75 s', '4.58 s']);
    await expect(row(page, 'M').locator('td')).toHaveText(['85%', '16.17 s', '5.39 s']);
    await expect(outerNote).toBeVisible();
  });

  test('(c) B is selected to begin with; tapping a row or its radio selects it; D cannot be selected', async ({ page }) => {
    await seedDemo(page);
    await openTempo(page, 'Smoke & Hope');
    await divisionSelect(page).selectOption('Carry Optics');

    await expect(table(page).getByRole('radio')).toHaveCount(6);
    await expect(radio(page, 'B')).toBeChecked();
    await expect(main(page).locator('.tempo-readout-class')).toHaveText('B');
    await expect(main(page).locator('.tempo-readout-time')).toHaveText('4.16 s');

    // Tap the row itself (a time cell, not the radio).
    await row(page, 'A').locator('td').last().click();
    await expect(radio(page, 'A')).toBeChecked();
    await expect(radio(page, 'B')).not.toBeChecked();
    await expect(row(page, 'A')).toHaveClass(/\bon\b/);
    await expect(main(page).locator('.tempo-readout-class')).toHaveText('A');
    await expect(main(page).locator('.tempo-readout-time')).toHaveText('3.33 s');
    await expect(summary(page)).toHaveText('Draw 1.00 s, then four beats about 0.58 s apart. Last beat at 3.33 s.');

    // Keyboard: the radios are one group, so an arrow key moves the choice.
    await radio(page, 'A').focus();
    await page.keyboard.press('ArrowUp');
    await expect(radio(page, 'M')).toBeChecked();
    await expect(radio(page, 'M')).toBeFocused();
    await expect(radio(page, 'M')).toHaveAccessibleName('M, 2.94 seconds per string');

    // D: no control in it, tapping it changes nothing, and it does not look tappable.
    const d = table(page).locator('tbody tr').nth(6);
    await expect(d.getByRole('radio')).toHaveCount(0);
    await expect(d.locator('button, input, a, [tabindex]')).toHaveCount(0);
    await d.click();
    await d.locator('td').last().click();
    await expect(radio(page, 'M')).toBeChecked();
    await expect(main(page).locator('.tempo-readout-class')).toHaveText('M');
    expect(await d.evaluate((el) => getComputedStyle(el).cursor)).not.toBe('pointer');
    expect(await row(page, 'M').evaluate((el) => getComputedStyle(el).cursor)).toBe('pointer');
    await expect(d).not.toHaveClass(/\bon\b/);
  });

  test('(g) a typed peak is labelled, recomputes the rows, and Reset takes it all back', async ({ page }) => {
    await seedDemo(page);
    await openTempo(page, 'Smoke & Hope');
    await divisionSelect(page).selectOption('Carry Optics');
    const ownLabel = main(page).getByText('your figure, not SCSA\'s', { exact: true });
    const reset = main(page).getByRole('button', { name: 'Reset to official' });
    const noRows = main(page).getByText('Type a peak of 1.00 seconds or more to see the times.');

    await expect(ownLabel).toHaveCount(0);
    await expect(reset).toHaveCount(0);
    await expect(peakField(page)).toHaveCount(0);

    await main(page).getByRole('button', { name: 'Use my own figure' }).click();
    // Pre-filled with the official peak, focused, and labelled from the first moment.
    await expect(peakField(page)).toHaveValue('10.00');
    await expect(peakField(page)).toBeFocused();
    await expect(peakField(page)).toHaveAttribute('type', 'number');
    await expect(peakField(page)).toHaveAttribute('inputmode', 'decimal');
    await expect(peakField(page)).toHaveAttribute('step', '0.01');
    await expect(ownLabel).toBeVisible();
    await expect(reset).toBeVisible();
    await expect(main(page).getByRole('button', { name: 'Use my own figure' })).toHaveCount(0);
    await expect(table(page).locator('caption')).toHaveText('Times from your figure');

    // 9.20: M is 9.2 / 0.85 = 10.8235 -> 10.82; 10.8235 / 4 = 2.7058 -> 2.70.
    await peakField(page).fill('9.2');
    await expect(main(page).locator('.tempo-peak')).toHaveText('Peak time 9.20 s your figure, not SCSA\'s');
    await expect(row(page, 'Peak').locator('td')).toHaveText(['100%', '9.20 s', '2.30 s']);
    await expect(row(page, 'M').locator('td')).toHaveText(['85%', '10.82 s', '2.70 s']);
    // B is still the chosen class: 9.2 / 0.6 = 15.3333 -> /4 = 3.8333 -> 3.83.
    await expect(main(page).locator('.tempo-readout-time')).toHaveText('3.83 s');

    // A typed peak is cut to hundredths too: 9.209 is 9.20, not 9.21, and the rows agree with the line.
    await peakField(page).fill('9.209');
    await expect(main(page).locator('.tempo-peak')).toHaveText('Peak time 9.20 s your figure, not SCSA\'s');
    await expect(row(page, 'Peak').locator('td')).toHaveText(['100%', '9.20 s', '2.30 s']);
    await expect(row(page, 'M').locator('td')).toHaveText(['85%', '10.82 s', '2.70 s']);

    // On an edited run the table and its caption claim nothing about the official figure.
    const tableText = await table(page).innerText();
    expect(tableText).not.toMatch(/official/i);
    expect(tableText).not.toMatch(/SCSA/i);
    expect(await main(page).locator('.tempo-peak').innerText()).not.toMatch(/official|scsa\.org/i);

    // The label is a visibly different style and readable in both colour schemes (WCAG AA, 4.5:1).
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const c = await contrastOf(page, '.tempo-own');
      expect(c.contrast, `${scheme}: "your figure" label contrast`).toBeGreaterThanOrEqual(4.5);
      const plain = await page.evaluate(() => getComputedStyle(document.querySelector('.tempo-peak')!).color);
      const own = await page.evaluate(() => getComputedStyle(document.querySelector('.tempo-own')!).color);
      expect(own, `${scheme}: label colour differs from the line it sits in`).not.toBe(plain);
    }
    await page.emulateMedia({ colorScheme: null });

    // Unusable figures: under 1.00, empty, not a number. No rows, one line, Start blocked.
    for (const bad of ['0.99', '', '0', '-3']) {
      await peakField(page).fill(bad);
      await expect(noRows.first(), `peak "${bad}"`).toBeVisible();
      // Said once on the peak line (and once as the reason Start is blocked),
      // and tied to the field for a screen reader.
      await expect(noRows).toHaveCount(2);
      await expect(peakField(page)).toHaveAttribute('aria-invalid', 'true');
      await expect(peakField(page)).toHaveAttribute('aria-describedby', 'tempo-peak-line');
      await expect(main(page).locator('#tempo-peak-line')).toHaveAttribute('role', 'status');
      await expect(table(page).locator('tbody tr')).toHaveCount(0);
      await expect(table(page).getByRole('radio')).toHaveCount(0);
      await expect(ownLabel).toHaveCount(0);
      await expect(reset).toBeVisible();
      await expect(startBtn(page)).toHaveAttribute('aria-disabled', 'true');
    }
    // 1.00 exactly is the floor and is usable.
    await peakField(page).fill('1');
    await expect(row(page, 'Peak').locator('td')).toHaveText(['100%', '1.00 s', '0.25 s']);
    // A figure no stage can total is refused too, with its own line.
    await peakField(page).fill('120.01');
    await expect(main(page).getByText('Type a peak of 120.00 seconds or less to see the times.').first()).toBeVisible();
    await expect(table(page).locator('tbody tr')).toHaveCount(0);

    // Reset: field, label and button go; the official rows come back.
    await peakField(page).fill('9.2');
    await reset.click();
    await expect(peakField(page)).toHaveCount(0);
    await expect(ownLabel).toHaveCount(0);
    await expect(reset).toHaveCount(0);
    await expect(main(page).getByText('Peak time 10.00 s, from scsa.org/classification.')).toBeVisible();
    await expect(table(page).locator('caption')).toHaveText('Times for Carry Optics on Smoke & Hope');
    await expect(row(page, 'M').locator('td')).toHaveText(['85%', '11.76 s', '2.94 s']);
    await expect(main(page).getByRole('button', { name: 'Use my own figure' })).toBeFocused();

    // An edit belongs to one stage and division: changing either drops it.
    await main(page).getByRole('button', { name: 'Use my own figure' }).click();
    await peakField(page).fill('9.2');
    await stageSelect(page).selectOption({ label: 'Five to Go (SC-101)' });
    await expect(peakField(page)).toHaveCount(0);
    await expect(ownLabel).toHaveCount(0);
    await expect(main(page).getByText('Peak time 12.50 s, from scsa.org/classification.')).toBeVisible();
    await main(page).getByRole('button', { name: 'Use my own figure' }).click();
    await expect(peakField(page)).toHaveValue('12.50');
    await peakField(page).fill('9.2');
    await divisionSelect(page).selectOption('Open');
    await expect(peakField(page)).toHaveCount(0);
    await expect(main(page).getByText('Peak time 11.25 s, from scsa.org/classification.')).toBeVisible();
    await expect(row(page, 'Peak').locator('td')).toHaveText(['100%', '11.25 s', '2.81 s']);
  });
});

test.describe('Tempo trainer: the draw', () => {
  const DEFAULT_NOTE = 'a working default; set your own. About one second is a common working target for a draw at 7 yards. It is a community figure, not an SCSA one.';

  test('(i) the sample log has no typical draw: 1.00 and the working-default line; its latest Steel division is pre-picked', async ({ page }) => {
    await seedDemo(page);
    await openTempo(page, 'Smoke & Hope');
    await expect(drawField(page)).toHaveValue('1.00');
    await expect(drawField(page)).toHaveAttribute('type', 'number');
    await expect(drawField(page)).toHaveAttribute('inputmode', 'decimal');
    await expect(drawField(page)).toHaveAttribute('step', '0.01');
    await expect(main(page).locator('#tempo-draw-note')).toHaveText(DEFAULT_NOTE);
    // The sample's newest Steel match (May) is stored under the old name
    // "Rimfire Pistol Open"; the screen shows the name SCSA uses.
    await expect(divisionSelect(page)).toHaveValue('Rimfire Pistol Optics');
    // Once a draw is typed it is no longer "a working default".
    await drawField(page).fill('1.2');
    await expect(main(page).locator('#tempo-draw-note')).toHaveText(
      'About one second is a common working target for a draw at 7 yards. It is a community figure, not an SCSA one.');
  });

  test('(i) a fresh install with no data reaches the screen through Find a screen and gets the defaults', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'See a log 18 months in' })).toBeVisible();
    if (!isDesktop(page)) await nav(page).getByRole('button', { name: 'More' }).first().click();
    const find = page.getByRole('search', { name: 'Find a screen' }).getByRole('searchbox');
    await find.fill('tempo');
    await page.locator('[data-find-id="drills-tempo"]').first().click();
    await expect(tempoTitle(page)).toBeVisible();
    await expect(stageSelect(page)).toHaveValue('0');
    await expect(divisionSelect(page)).toHaveValue('Open'); // the first division
    await expect(drawField(page)).toHaveValue('1.00');
    await expect(main(page).locator('#tempo-draw-note')).toHaveText(DEFAULT_NOTE);
    await expect(radio(page, 'B')).toBeChecked();
    // Open, Five to Go, B: 18.75 and 4.68. Start is ready first time.
    await expect(summary(page)).toHaveText('Draw 1.00 s, then four beats 0.92 s apart. Last beat at 4.68 s.');
    await expect(startBtn(page)).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('(i) a logged typical draw is pre-filled with its date; a newer one from a trashed session is not', async ({ page }) => {
    await seedDemo(page);
    // Planted through the page's own IndexedDB (the sample has no timed-skill
    // sets): one typical draw on the newest live session, and a newer-dated
    // one on a session that is in the Trash.
    const liveDate = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('firearmlog');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const all = <T,>(store: string) => new Promise<T[]>((resolve, reject) => {
        const r = db.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => resolve(r.result as T[]);
        r.onerror = () => reject(r.error);
      });
      type S = { id: string; date: string; deletedAt?: number | null; planned?: boolean };
      const sessions = (await all<S>('sessions')).filter((s) => !s.deletedAt && !s.planned);
      sessions.sort((a, b) => (a.date < b.date ? 1 : -1));
      const live = sessions[0];
      const trashed = { ...live, id: 'se-e2e-trashed', date: '2099-01-01', deletedAt: Date.now() };
      const base = {
        createdAt: Date.now(), updatedAt: Date.now(), firearmId: 'fa-e2e', dryFire: false, count: 10,
        parSec: null, cold: false, repTimesSec: null, notes: '',
      };
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['sessions', 'skillSets'], 'readwrite');
        tx.objectStore('sessions').put(trashed);
        const sets = tx.objectStore('skillSets');
        // An older live set, the newest live set, a newer reload set, a newer
        // draw set with no typical time, and the trashed session's draw set.
        sets.put({ ...base, id: 'sk-e2e-old', sessionId: sessions[1].id, date: sessions[1].date, skill: 'draw', bestSec: 1.5, typicalSec: 1.9 });
        sets.put({ ...base, id: 'sk-e2e-live', sessionId: live.id, date: live.date, skill: 'draw', bestSec: 1.2, typicalSec: 1.376 });
        sets.put({ ...base, id: 'sk-e2e-reload', sessionId: live.id, date: live.date, skill: 'reload', bestSec: 1.1, typicalSec: 1.11 });
        sets.put({ ...base, id: 'sk-e2e-notyp', sessionId: live.id, date: live.date, skill: 'draw', bestSec: 1.0, typicalSec: null, createdAt: Date.now() + 5 });
        sets.put({ ...base, id: 'sk-e2e-trashed', sessionId: 'se-e2e-trashed', date: '2099-01-01', skill: 'draw', bestSec: 0.7, typicalSec: 0.77 });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      });
      return live.date;
    });
    // The same rendering the app's date formatter gives (lib/dates.ts formatDayKey).
    const shown = await page.evaluate((key) => {
      const [y, m, d] = key.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }, liveDate);

    await openTempo(page, 'Smoke & Hope');
    // 1.376 is shown cut to hundredths, 1.37, never rounded to 1.38.
    await expect(drawField(page)).toHaveValue('1.37');
    await expect(main(page).locator('#tempo-draw-note')).toHaveText(`your typical draw, from ${shown}`);
    await expect(summary(page)).toContainText('Draw 1.37 s, then four beats');

    // Typing drops the claim that the number came from the log.
    await drawField(page).fill('1.5');
    await expect(main(page).locator('#tempo-draw-note')).toHaveCount(0);
    await expect(main(page).getByText('your typical draw')).toHaveCount(0);
    await expect(summary(page)).toContainText('Draw 1.50 s, then four beats');
  });

  test('(j) a draw that is missing, too long, or leaves too tight a gap blocks Start and says why', async ({ page }) => {
    await recordOscillators(page);
    await seedDemo(page);
    await openWorkedCase(page); // per string 2.94

    const blocked: [string, string][] = [
      ['', 'Set a draw time to hear the pace.'],
      ['0', 'Set a draw time to hear the pace.'],
      ['-1', 'Set a draw time to hear the pace.'],
      ['2.94', 'That draw is as long as the whole string at this class. Set a shorter draw or pick a slower class.'],
      ['5', 'That draw is as long as the whole string at this class. Set a shorter draw or pick a slower class.'],
      // 2.94 - 2.6 = 0.34 over four gaps is 0.085, under a tenth.
      ['2.6', 'That draw leaves under a tenth of a second between the other four beats. Set a shorter draw or pick a slower class.'],
      ['2.93', 'That draw leaves under a tenth of a second between the other four beats. Set a shorter draw or pick a slower class.'],
    ];
    for (const [draw, line] of blocked) {
      await drawField(page).fill(draw);
      await expect(summary(page), `draw "${draw}"`).toHaveText(line);
      // The field is marked wrong and points a screen reader at the reason.
      await expect(drawField(page)).toHaveAttribute('aria-invalid', 'true');
      expect(await drawField(page).getAttribute('aria-describedby')).toContain('tempo-summary');
      await expect(startBtn(page)).toHaveAttribute('aria-disabled', 'true');
      // The reason is tied to the button for a screen reader, and the button stays focusable.
      await expect(startBtn(page)).toHaveAccessibleDescription(line);
      await startBtn(page).focus();
      await expect(startBtn(page)).toBeFocused();
      await startBtn(page).click({ force: true });
      await expect(stopBtn(page)).toHaveCount(0);
      await expect(main(page).locator('.tempo-count')).toHaveCount(0);
    }
    // Nothing was scheduled by any of those taps.
    expect((await oscRecord(page)).starts).toHaveLength(0);

    // A typed draw is CUT to hundredths, never rounded: 1.009 is 1.00 (rounding
    // would say 1.01), and 2.939 is 2.93, which is too tight, not "as long as
    // the string".
    await drawField(page).fill('1.009');
    await expect(summary(page)).toHaveText('Draw 1.00 s, then four beats about 0.48 s apart. Last beat at 2.94 s.');
    await drawField(page).fill('2.939');
    await expect(summary(page)).toHaveText('That draw leaves under a tenth of a second between the other four beats. Set a shorter draw or pick a slower class.');
    // And the beat is scheduled from the figure shown: 1.009 plays at 1.00.
    await drawField(page).fill('1.009');
    await startBtn(page).click();
    const cut = await waitForTones(page, 6);
    const t = cut.starts.find((x) => x.hz === START_HZ)!.when;
    const firstBeat = Math.min(...cut.starts.filter((x) => x.hz === BEAT_HZ).map((x) => x.when));
    expect(Math.abs(firstBeat - (t + 1))).toBeLessThan(1e-9);
    await stopBtn(page).click();

    // 2.54 leaves exactly a tenth (0.40 / 4): the tightest pace that plays.
    await drawField(page).fill('2.54');
    await expect(summary(page)).toHaveText('Draw 2.54 s, then four beats 0.10 s apart. Last beat at 2.94 s.');
    await expect(startBtn(page)).not.toHaveAttribute('aria-disabled', 'true');
    // "Pick a slower class" works: C on this stage is 6.25 a string.
    await drawField(page).fill('2.94');
    await radio(page, 'C').check();
    await expect(summary(page)).toHaveText('Draw 2.94 s, then four beats about 0.82 s apart. Last beat at 6.25 s.');
    await expect(startBtn(page)).not.toHaveAttribute('aria-disabled', 'true');
  });
});

test.describe('Tempo trainer: the run', () => {
  test('(d) Start shows the countdown and locks the settings; Stop ends it and returns to idle', async ({ page }) => {
    await recordOscillators(page);
    await seedDemo(page);
    await openWorkedCase(page);
    await expect(status(page)).toHaveText('');
    // The visible line is plain text; its spoken twin is the live region.
    await expect(live(page)).toHaveAttribute('role', 'status');
    await expect(live(page)).toHaveText('');

    await startBtn(page).click();
    await expect(main(page).locator('.tempo-count')).toHaveText('3');
    await expect(status(page)).toHaveText('Counting down');
    await expect(live(page)).toHaveText('Counting down');
    // Checked straight after the 3, before the slower checks below: the 2 is
    // only on screen for one second.
    await expect(main(page).locator('.tempo-count')).toHaveText('2', { timeout: 3000 });
    await expect(stopBtn(page)).toBeVisible();
    await expect(startBtn(page)).toHaveCount(0);
    await expect(main(page).getByText('Stop to change the settings.')).toBeVisible();
    // Everything that changes the numbers is locked while the sound runs.
    await expect(stageSelect(page)).toBeDisabled();
    await expect(divisionSelect(page)).toBeDisabled();
    await expect(drawField(page)).toBeDisabled();
    await expect(main(page).getByRole('button', { name: 'Use my own figure' })).toBeDisabled();
    await expect(main(page).getByRole('button', { name: 'Repeat' })).toBeDisabled();
    for (const r of await table(page).getByRole('radio').all()) await expect(r).toBeDisabled();
    await row(page, 'C').locator('td').last().click({ force: true });
    await expect(radio(page, 'M')).toBeChecked();

    // The six tones of the string were scheduled up front; Stop cancels every one.
    const before = await waitForTones(page, 6);
    expect(before.stops.filter((s) => s.when === null)).toHaveLength(0);
    await stopBtn(page).click();
    await expect(startBtn(page)).toBeVisible();
    await expect(stopBtn(page)).toHaveCount(0);
    await expect(status(page)).toHaveText('Stopped');
    await expect(live(page)).toHaveText('Stopped');
    await expect(main(page).locator('.tempo-count')).toHaveCount(0);
    await expect(main(page).locator('.tempo-dot')).toBeVisible();
    await expect(main(page).getByText('Stop to change the settings.')).toHaveCount(0);
    await expect(stageSelect(page)).toBeEnabled();
    await expect(drawField(page)).toBeEnabled();
    await expect(radio(page, 'C')).toBeEnabled();
    const after = await oscRecord(page);
    expect(after.stops.filter((s) => s.when === null), 'every scheduled tone was cancelled').toHaveLength(6);
    // And nothing more is scheduled once stopped.
    await page.waitForTimeout(600);
    expect((await oscRecord(page)).starts).toHaveLength(6);
    await expect(main(page).locator('.tempo-dot')).not.toHaveClass(/beat|start/);

    // It starts again cleanly afterwards.
    await startBtn(page).click();
    await expect(main(page).locator('.tempo-count')).toHaveText('3');
    await waitForTones(page, 12);
    // The clock is really running again, not parked from the Stop.
    await expect(main(page).locator('.tempo-count')).toHaveText('2', { timeout: 3000 });
    await stopBtn(page).click();
    await expect(status(page)).toHaveText('Stopped');
  });

  test('a typed peak is locked too while the run is on, and the numbers stay the ones being played', async ({ page }) => {
    await recordOscillators(page);
    await seedDemo(page);
    await openWorkedCase(page);
    await main(page).getByRole('button', { name: 'Use my own figure' }).click();
    // 9.20 / 0.85 = 10.8235, cut 10.82; a string is 10.8235 / 4 = 2.7058, cut 2.70.
    await peakField(page).fill('9.2');
    await expect(row(page, 'M').locator('td')).toHaveText(['85%', '10.82 s', '2.70 s']);
    await startBtn(page).click();
    await expect(main(page).locator('.tempo-count')).toHaveText('3');
    await expect(peakField(page)).toBeDisabled();
    await expect(main(page).getByRole('button', { name: 'Reset to official' })).toBeDisabled();
    // What was scheduled is the typed figure's string, not the official one.
    const rec = await waitForTones(page, 6);
    const { starts, beats } = tonesByKind(rec);
    const last = Math.max(...beats.map((b) => b.when));
    expect(Math.abs(last - (starts[0].when + 2.70))).toBeLessThan(1e-9);
    await stopBtn(page).click();
    await expect(peakField(page)).toBeEnabled();
    await expect(peakField(page)).toHaveValue('9.2');
  });

  test('(e) the tones are scheduled at the times on screen: start signal, then beats at the draw ... the per-string time', async ({ page }) => {
    await recordOscillators(page);
    await seedDemo(page);
    await openWorkedCase(page);
    await expect(main(page).locator('.tempo-readout-time')).toHaveText('2.94 s');

    await startBtn(page).click();
    const rec = await waitForTones(page, 6);
    const { starts, beats, other } = tonesByKind(rec);
    expect(other, 'only the two synthesized voices exist').toHaveLength(0);
    expect(starts, 'one start signal').toHaveLength(1);
    expect(beats, 'five beats').toHaveLength(5);

    const t = starts[0].when;
    // The start signal follows a 3-second countdown from the tap (plus the
    // engine's small scheduling lead), on the audio clock.
    expect(t - starts[0].now).toBeGreaterThanOrEqual(3);
    expect(t - starts[0].now).toBeLessThan(3.25);

    // Beats at start + 1.00, 1.485, 1.97, 2.455, 2.94, each within a millisecond.
    const beatTimes = beats.map((b) => b.when).sort((a, b) => a - b);
    BEATS.forEach((want, i) => {
      expect(Math.abs(beatTimes[i] - (t + want)), `beat ${i + 1} at start + ${want}`).toBeLessThan(0.001);
    });
    // The last beat is the per-string time after the start signal: the same
    // double the sum gives, not four float gaps added up.
    expect(beatTimes[4]).toBe(t + PER);
    expect(Math.abs((beatTimes[4] - t) - PER)).toBeLessThan(1e-9);
    // Scheduled in order, start signal first.
    expect(rec.starts.map((s) => s.when)).toEqual([...rec.starts.map((s) => s.when)].sort((a, b) => a - b));
    expect(rec.starts[0].hz).toBe(START_HZ);

    // A longer, lower tone and a short, higher click: each tone's scheduled
    // end, less its start. 0.30 s and 0.04 s.
    const ends = rec.stops.filter((s) => s.when !== null);
    expect(ends).toHaveLength(6);
    const startEnd = ends.find((s) => s.hz === START_HZ)!;
    expect(Math.abs((startEnd.when as number) - t - 0.3)).toBeLessThan(1e-6);
    const beatEnds = ends.filter((s) => s.hz === BEAT_HZ).map((s) => s.when as number).sort((a, b) => a - b);
    beatEnds.forEach((end, i) => expect(Math.abs(end - beatTimes[i] - 0.04)).toBeLessThan(1e-6));

    await stopBtn(page).click();
  });

  test('with Repeat off the run plays one string, flashes the dot six times, then returns to idle by itself', async ({ page }) => {
    await recordOscillators(page);
    await seedDemo(page);
    // The shortest official string, so the test is quick: PCC Optics on
    // Showdown, peak 7.00, Peak row 7 / 4 = 1.75 s. Draw 0.15 (see ONE_STRING).
    await openTempo(page, 'Showdown');
    await divisionSelect(page).selectOption('PCC Optics');
    await radio(page, 'Peak').check();
    await drawField(page).fill(WIDE_DRAW);
    await expect(summary(page)).toHaveText(WIDE_SUMMARY);
    await expect(main(page).getByRole('button', { name: 'Repeat' })).toHaveAttribute('aria-pressed', 'false');

    await watchDot(page);

    await startBtn(page).click();
    await expect(status(page)).toHaveText('Counting down');
    await expect(status(page)).toHaveText('Running', { timeout: 6000 });
    // "Running" is shown but never spoken: it would be read over the beats.
    await expect(live(page)).toHaveText('');
    expect(await main(page).innerText(), 'while running').not.toMatch(/\bshots?\b|gunshot/i);
    // 3 s countdown + 1.75 s string + a short hold, then idle with no tap.
    await expect(status(page)).toHaveText('Finished', { timeout: 8000 });
    await expect(live(page)).toHaveText('Finished');
    expect(await main(page).innerText(), 'when finished').not.toMatch(/\bshots?\b|gunshot/i);
    await expect(startBtn(page)).toBeVisible();
    await expect(stopBtn(page)).toHaveCount(0);
    await expect(stageSelect(page)).toBeEnabled();

    expect(await dotLog(page)).toEqual(ONE_STRING);
    // One string only: six tones, and none added after the end.
    const rec = await oscRecord(page);
    expect(rec.starts).toHaveLength(6);
    const t = rec.starts[0].when;
    expect(rec.starts[5].when).toBe(t + 1.75);
    // The start flash and the beat flash differ by shape as well as colour.
    const shapes = await page.evaluate(() => {
      const probe = (cls: string) => {
        const el = document.createElement('span');
        el.className = `tempo-dot ${cls}`;
        document.querySelector('.tempo-stage')!.appendChild(el);
        const cs = getComputedStyle(el);
        const out = { radius: cs.borderTopLeftRadius, bg: cs.backgroundColor, transition: cs.transitionDuration, animation: cs.animationName };
        el.remove();
        return out;
      };
      return { off: probe(''), beat: probe('beat'), start: probe('start') };
    });
    expect(shapes.start.radius).not.toBe(shapes.beat.radius);
    expect(shapes.start.bg).not.toBe(shapes.beat.bg);
    expect(shapes.beat.bg).not.toBe(shapes.off.bg);
  });

  test('(f) Repeat schedules the next string 4 seconds after the last beat, and keeps going until Stop', async ({ page }) => {
    await recordOscillators(page);
    await seedDemo(page);
    await openWorkedCase(page);
    test.setTimeout(60_000);
    const repeat = main(page).getByRole('button', { name: 'Repeat' });
    await expect(main(page).getByText('Plays the string again after a 4-second pause, until you tap Stop.')).toBeVisible();
    await repeat.click();
    await expect(repeat).toHaveAttribute('aria-pressed', 'true');

    await startBtn(page).click();
    // The second string is scheduled when the first one's start signal sounds.
    const rec = await waitForTones(page, 12);
    const { starts, beats } = tonesByKind(rec);
    expect(starts).toHaveLength(2);
    expect(beats).toHaveLength(10);
    const [t1, t2] = starts.map((s) => s.when).sort((a, b) => a - b);
    const lastBeat1 = t1 + PER;
    // Second start signal = first start signal + 2.94 + 4.00.
    expect(Math.abs(t2 - (lastBeat1 + 4))).toBeLessThan(1e-9);
    expect(t2).toBe(t1 + PER + 4);
    // And its five beats sit at the same offsets from ITS start signal.
    const second = beats.map((b) => b.when).sort((a, b) => a - b).slice(5);
    BEATS.forEach((want, i) => {
      expect(Math.abs(second[i] - (t2 + want)), `second string beat ${i + 1}`).toBeLessThan(0.001);
    });
    expect(second[4]).toBe(t2 + PER);

    // Still running past the point a single string would have ended.
    await expect(status(page)).toHaveText('Running', { timeout: 6000 });
    await expect(stopBtn(page)).toBeVisible();
    await stopBtn(page).click();
    await expect(status(page)).toHaveText('Stopped');
    const n = (await oscRecord(page)).starts.length;
    await watchDot(page);
    // Under Repeat the next string is scheduled when the following start
    // signal comes round, at most per string + 4 s away. Wait past that whole
    // interval, or a run that Stop failed to end would still look stopped.
    await page.waitForTimeout(Math.ceil((PER + 4 + 1) * 1000));
    expect((await oscRecord(page)).starts, 'no tone scheduled after Stop').toHaveLength(n);
    expect(await dotLog(page), 'the dot never lit after Stop').toEqual(['off']);
    await expect(status(page)).toHaveText('Stopped');
  });

  test('(8) with no Web Audio the screen says so and the run still happens on the dot', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      delete w.AudioContext;
      delete w.webkitAudioContext;
      Object.defineProperty(window, 'AudioContext', { value: undefined, configurable: true });
      Object.defineProperty(window, 'webkitAudioContext', { value: undefined, configurable: true });
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await seedDemo(page);
    await openTempo(page, 'Showdown');
    await divisionSelect(page).selectOption('PCC Optics');
    await radio(page, 'Peak').check();
    await drawField(page).fill(WIDE_DRAW);
    await expect(summary(page)).toHaveText(WIDE_SUMMARY);
    const line = main(page).getByText('This browser could not start the sound. The dot still flashes on every beat.');
    await expect(line).toHaveCount(0);

    await watchDot(page);
    await startBtn(page).click();
    await expect(line).toBeVisible();
    await expect(main(page).locator('.tempo-count')).toHaveText('3');
    await expect(status(page)).toHaveText('Running', { timeout: 6000 });
    await expect(status(page)).toHaveText('Finished', { timeout: 8000 });
    await expect(startBtn(page)).toBeVisible();
    // The whole string was shown, silently, on the page's own clock.
    expect(await dotLog(page)).toEqual(ONE_STRING);
    expect(errors).toEqual([]);
  });

  test('a context that throws on creation fails the same safe way', async ({ page }) => {
    await page.addInitScript(() => {
      const Broken = function () { throw new Error('no audio hardware'); };
      Object.defineProperty(window, 'AudioContext', { value: Broken, configurable: true });
      Object.defineProperty(window, 'webkitAudioContext', { value: Broken, configurable: true });
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await seedDemo(page);
    await openWorkedCase(page);
    await startBtn(page).click();
    await expect(main(page).getByText('This browser could not start the sound. The dot still flashes on every beat.')).toBeVisible();
    await expect(main(page).locator('.tempo-count')).toHaveText('3');
    await stopBtn(page).click();
    await expect(status(page)).toHaveText('Stopped');
    expect(errors).toEqual([]);
  });

  test('the screen is kept awake for the run where the browser can, and let go on Stop', async ({ page }) => {
    await page.addInitScript(() => {
      const log: string[] = [];
      (window as unknown as { __wake: string[] }).__wake = log;
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: {
          request: (type: string) => {
            log.push(`request:${type}`);
            return Promise.resolve({ release: () => { log.push('release'); return Promise.resolve(); } });
          },
        },
      });
    });
    await seedDemo(page);
    await openWorkedCase(page);
    const wake = () => page.evaluate(() => (window as unknown as { __wake: string[] }).__wake);
    expect(await wake()).toEqual([]);
    await startBtn(page).click();
    await expect(main(page).locator('.tempo-count')).toHaveText('3');
    await expect.poll(wake).toEqual(['request:screen']);
    await stopBtn(page).click();
    await expect.poll(wake).toEqual(['request:screen', 'release']);
  });

  test('a refused wake lock is ignored: the run goes ahead', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: { request: () => Promise.reject(new DOMException('battery saver', 'NotAllowedError')) },
      });
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await recordOscillators(page);
    await seedDemo(page);
    await openWorkedCase(page);
    await startBtn(page).click();
    await expect(main(page).locator('.tempo-count')).toHaveText('3');
    await waitForTones(page, 6);
    await stopBtn(page).click();
    expect(errors).toEqual([]);
  });

  test('hiding the page stops the run', async ({ page }) => {
    await recordOscillators(page);
    await seedDemo(page);
    await openWorkedCase(page);
    await startBtn(page).click();
    await expect(main(page).locator('.tempo-count')).toHaveText('3');
    await waitForTones(page, 6);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(status(page)).toHaveText('Stopped');
    await expect(startBtn(page)).toBeVisible();
    expect((await oscRecord(page)).stops.filter((s) => s.when === null)).toHaveLength(6);
  });

  test('leaving the screen mid-run silences it and closes the audio', async ({ page }) => {
    await recordOscillators(page);
    await page.addInitScript(() => {
      const closed: number[] = [];
      (window as unknown as { __closed: number[] }).__closed = closed;
      const orig = AudioContext.prototype.close;
      AudioContext.prototype.close = function (this: AudioContext) { closed.push(1); return orig.call(this); };
    });
    await seedDemo(page);
    await openWorkedCase(page);
    await startBtn(page).click();
    await waitForTones(page, 6);
    await main(page).getByRole('button', { name: '‹ Back' }).click();
    await expect(page.getByRole('heading', { name: 'Drills' }).first()).toBeVisible();
    expect((await oscRecord(page)).stops.filter((s) => s.when === null)).toHaveLength(6);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __closed: number[] }).__closed.length)).toBe(1);
  });

  test('reduced motion: the dot changes state with no animation or transition', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedDemo(page);
    await openTempo(page, 'Showdown');
    await divisionSelect(page).selectOption('PCC Optics');
    await radio(page, 'Peak').check();
    await drawField(page).fill(WIDE_DRAW);
    await expect(summary(page)).toHaveText(WIDE_SUMMARY);
    const motion = await main(page).locator('.tempo-dot').evaluate((el) => {
      const cs = getComputedStyle(el);
      return { animation: cs.animationName, transition: cs.transitionDuration };
    });
    expect(motion.animation).toBe('none');
    expect(['0s', '0.000001s', '1e-06s']).toContain(motion.transition);
    // And it still flashes.
    await watchDot(page);
    await startBtn(page).click();
    await expect(status(page)).toHaveText('Finished', { timeout: 12_000 });
    expect(await dotLog(page)).toEqual(ONE_STRING);
  });
});

test.describe('Tempo trainer: nothing is kept', () => {
  test('(h) leaving and returning forgets a typed peak, a class choice, a typed draw, a division and Repeat', async ({ page }) => {
    await seedDemo(page);
    // What is stored before, to compare after: the screen must write nothing.
    const snapshot = () => page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('firearmlog');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const out: Record<string, string> = {};
      for (const name of Array.from(db.objectStoreNames)) {
        if (name === 'media') continue; // photos: large, and nowhere near this screen
        out[name] = await new Promise<string>((resolve, reject) => {
          const r = db.transaction(name).objectStore(name).getAll();
          r.onsuccess = () => resolve(JSON.stringify(r.result));
          r.onerror = () => reject(r.error);
        });
      }
      db.close();
      const ls: Record<string, string | null> = {};
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; ls[k] = localStorage.getItem(k); }
      const ss: Record<string, string | null> = {};
      for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i)!; ss[k] = sessionStorage.getItem(k); }
      return { stores: out, ls, ss, cookie: document.cookie, path: location.pathname + location.search + location.hash };
    });

    // Taken BEFORE the screen is first opened, so a write on its very first
    // appearance would show up as a difference too.
    const before = await snapshot();
    await openTempo(page, 'Smoke & Hope');
    await expect(divisionSelect(page)).toHaveValue('Rimfire Pistol Optics');
    await divisionSelect(page).selectOption('Carry Optics');
    await main(page).getByRole('button', { name: 'Use my own figure' }).click();
    await peakField(page).fill('9.2');
    await radio(page, 'A').check();
    await drawField(page).fill('1.5');
    await main(page).getByRole('button', { name: 'Repeat' }).click();
    await startBtn(page).click();
    await expect(main(page).locator('.tempo-count')).toHaveText('3');
    await stopBtn(page).click();
    await expect(main(page).locator('.tempo-readout-class')).toHaveText('A');

    await main(page).getByRole('button', { name: '‹ Back' }).click();
    await expect(page.getByRole('heading', { name: 'Drills' }).first()).toBeVisible();
    expect(await snapshot(), 'the Tempo screen stored nothing').toEqual(before);

    // Back in through the same button: everything is at its defaults again.
    await main(page).locator('button.row-tap').filter({ hasText: 'Steel Challenge: Smoke & Hope' }).first().click();
    await main(page).getByRole('button', { name: 'Tempo', exact: true }).click();
    await expect(tempoTitle(page)).toBeVisible();
    await expect(divisionSelect(page)).toHaveValue('Rimfire Pistol Optics');
    await expect(peakField(page)).toHaveCount(0);
    await expect(main(page).getByText('your figure, not SCSA\'s')).toHaveCount(0);
    await expect(main(page).getByRole('button', { name: 'Use my own figure' })).toBeVisible();
    await expect(radio(page, 'B')).toBeChecked();
    await expect(main(page).locator('.tempo-readout-class')).toHaveText('B');
    await expect(drawField(page)).toHaveValue('1.00');
    await expect(main(page).getByRole('button', { name: 'Repeat' })).toHaveAttribute('aria-pressed', 'false');
    await expect(status(page)).toHaveText('');

    // Browser Back and Forward remount it fresh as well.
    await drawField(page).fill('1.5');
    await radio(page, 'C').check();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Drills' }).first()).toBeVisible();
    await page.goForward();
    await expect(tempoTitle(page)).toBeVisible();
    await expect(stageSelect(page)).toHaveValue('2'); // the stage is the address, not a saved setting
    await expect(drawField(page)).toHaveValue('1.00');
    await expect(radio(page, 'B')).toBeChecked();
    expect(await snapshot(), 'still nothing stored').toEqual(before);
  });
});

test.describe('Tempo trainer: small screens', () => {
  test('(l) at 320 px wide nothing overflows sideways, and every control is a full-size tap target', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await seedDemo(page);
    await openTempo(page, 'Outer Limits'); // the longest times and the extra note
    await divisionSelect(page).selectOption('Iron Sight Revolver'); // peak 15.75: C is 39.37 s

    const check = async (what: string) => {
      const res = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const wide: string[] = [];
        for (const el of Array.from(document.querySelectorAll('main .screen *'))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > vw + 0.5 || r.left < -0.5) wide.push(`${el.tagName}.${el.className} ${Math.round(r.left)}..${Math.round(r.right)}`);
        }
        return { vw, docW: document.documentElement.scrollWidth, wide };
      });
      expect(res.docW, `${what}: page is no wider than the screen`).toBeLessThanOrEqual(res.vw);
      expect(res.wide, `${what}: no element pokes out sideways`).toEqual([]);
    };
    await check('plain');
    await expect(row(page, 'C').locator('td')).toHaveText(['40%', '39.37 s', '13.12 s']);
    // A time stays on one line.
    const cell = await row(page, 'C').locator('td').nth(1).boundingBox();
    const cellB = await row(page, 'B').locator('td').nth(1).boundingBox();
    expect(Math.round(cell!.height)).toBe(Math.round(cellB!.height));

    await main(page).getByRole('button', { name: 'Use my own figure' }).click();
    await peakField(page).fill('120');
    await radio(page, 'C').check(); // 120 / 0.4 = 300.00 s stage, 100.00 s per string: the widest row there can be
    await expect(row(page, 'C').locator('td')).toHaveText(['40%', '300.00 s', '100.00 s']);
    await check('edited, widest figures');
    await main(page).getByRole('button', { name: 'Help for Tempo' }).click();
    await check('help open');

    // 44 px tap targets (project rule: mobile wins every tie).
    const targets = {
      'Stage select': stageSelect(page),
      'Division select': divisionSelect(page),
      'peak field': peakField(page),
      'Reset to official': main(page).getByRole('button', { name: 'Reset to official' }),
      'class row': row(page, 'A'),
      'class radio label': row(page, 'A').locator('label'),
      'Draw field': drawField(page),
      'Start': startBtn(page),
      'Repeat': main(page).getByRole('button', { name: 'Repeat' }),
      'Back': main(page).getByRole('button', { name: '‹ Back' }),
    };
    for (const [name, loc] of Object.entries(targets)) {
      const box = await loc.boundingBox();
      expect(box, name).not.toBeNull();
      expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(44);
      expect(box!.width, `${name} width`).toBeGreaterThanOrEqual(44);
    }
    await main(page).getByRole('button', { name: 'Reset to official' }).click();
    const link = await main(page).getByRole('button', { name: 'Use my own figure' }).boundingBox();
    expect(link!.height).toBeGreaterThanOrEqual(44);

    // While running too (the countdown digit is the largest thing on the screen).
    await startBtn(page).click();
    await expect(main(page).locator('.tempo-count')).toHaveText('3');
    await check('counting down');
    const stop = await stopBtn(page).boundingBox();
    expect(stop!.height).toBeGreaterThanOrEqual(44);
    await stopBtn(page).click();
  });

  test('the readout is large: class and time readable from across a room', async ({ page }) => {
    await seedDemo(page);
    await openTempo(page, 'Smoke & Hope');
    const px = (sel: string) => main(page).locator(sel).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    // At least 40 px for the class letter and 52 px for the time at any width
    // (the phone project is 393 px wide; the type scales up with the screen).
    expect(await px('.tempo-readout-class')).toBeGreaterThanOrEqual(40);
    expect(await px('.tempo-readout-time')).toBeGreaterThanOrEqual(52);
    const start = await startBtn(page).boundingBox();
    expect(start!.height).toBeGreaterThanOrEqual(64);
    const dot = await main(page).locator('.tempo-dot').boundingBox();
    expect(dot!.width).toBeGreaterThanOrEqual(120);
    await startBtn(page).click();
    await expect(main(page).locator('.tempo-count')).toHaveText('3');
    expect(await px('.tempo-count')).toBeGreaterThanOrEqual(120);
    await stopBtn(page).click();
  });
});
