import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { seedDemo, gotoSection, gotoTab } from './helpers';
import { formatDayKey } from '../src/lib/dates.ts';

/*
 * One battery verdict (OPTIC_BATTERY_INTEGRATION_SPEC.md, session 137).
 *
 * Before this feature, the Optics/Parts/Gun Detail badge and a shooter's own
 * battery reminder were two independent judges of "is this battery due" that
 * could — and, from 10 June 2027, WOULD — disagree. This spec proves they
 * can't any more: wherever a reminder governs an optic, every screen defers
 * to it; only an optic nobody set a reminder for falls back to the old
 * 330-day rule; and the two records move together (a logged change rolls the
 * reminder forward, marking the reminder done writes the fact into the log).
 *
 * THE PARTS SCREEN, stated plainly because it shapes several tests below.
 * Parts only ever lists UNASSIGNED optics (assigned ones live entirely under
 * Optics/Gun Detail) — that is unchanged by this feature. So the collision
 * this spec proves on Parts is necessarily proved on an unassigned optic via
 * an EXPLICIT link (the "Set a battery reminder" button), since the LEGACY
 * title/template match can never fire on an optic with no gun (a falsy
 * firearmId never matches anything). The fallback (no-reminder) case is
 * proved on Parts the ordinary way, since that needs no gun at all.
 */

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const cardWith = (page: Page, heading: string) =>
  page.getByRole('main').locator('.card').filter({ has: page.getByRole('heading', { name: heading }) });

/** The Optics/Parts/Guns row for one title — its accessible name includes the
 *  title text plus its badge/sub-line, so a substring match finds it. */
function rowFor(page: Page, title: string): Locator {
  return page.getByRole('main').getByRole('button', { name: new RegExp(title) }).first();
}

async function badgeTextFor(page: Page, title: string): Promise<Locator> {
  return rowFor(page, title).locator('.badge');
}

async function createGun(page: Page, name: string): Promise<void> {
  await gotoSection(page, 'Guns');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: '+ Add Gun' }).click();
  await expect(main.getByRole('heading', { name: 'New Gun' })).toBeVisible();
  await main.getByRole('textbox', { name: 'What this Gun is called' }).fill(name);
  await main.getByRole('textbox', { name: 'Caliber' }).fill('9mm');
  await main.getByRole('button', { name: 'Save gun', exact: true }).click();
  await expect(main.getByText(name)).toBeVisible();
}

/** Adds an optic through the real form. Leave `gunName` unset for Unassigned. */
async function createOptic(page: Page, make: string, model: string, gunName?: string): Promise<void> {
  await gotoSection(page, 'Optics');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: '+ Add Optic' }).click();
  await expect(main.getByRole('heading', { name: 'New Optic' })).toBeVisible();
  if (gunName) await main.getByLabel('Firearm').selectOption({ label: gunName });
  await main.getByLabel('Make').fill(make);
  await main.getByLabel('Model').fill(model);
  await main.getByRole('button', { name: 'Save optic' }).click();
  await expect(main.getByRole('heading', { name: 'Optics' }).first()).toBeVisible();
}

/** Idempotent: opens the card only if it isn't already open, so calling this
 *  more than once (or after navigation that may or may not have preserved
 *  React state) never accidentally COLLAPSES an already-open card. */
async function expandOptic(page: Page, title: string): Promise<void> {
  const row = rowFor(page, title);
  await expect(row).toBeVisible();
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
}

/** Assumes the optic's card is already expanded and on screen. */
async function logBatteryChange(page: Page, dateStr: string): Promise<void> {
  await page.getByRole('main').getByRole('button', { name: '+ Log Battery Change' }).click();
  const dialog = page.getByRole('dialog', { name: 'Log Battery Change' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Date').fill(dateStr);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
}

/** A hand-written (non-template) date reminder on a specific gun — the LEGACY
 *  match path, title-based, exactly what a shooter's existing "Optic Battery"
 *  reminder looks like. */
async function addTitledReminderForGun(page: Page, title: string, dueOffsetDays: number, gunName: string): Promise<void> {
  await gotoSection(page, 'Reminders');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: /Add reminder|Add your own/ }).first().click();
  await expect(main.getByRole('heading', { name: 'New Reminder' })).toBeVisible();
  await main.getByLabel('Title').fill(title);
  await main.getByLabel('Due date').fill(dayOffset(dueOffsetDays));
  await main.getByLabel('Which gun? (optional)').selectOption({ label: gunName });
  await main.getByRole('button', { name: 'Save reminder' }).click();
  await expect(main.getByRole('heading', { name: 'Reminders' }).first()).toBeVisible();
}

test.describe('one battery verdict — the optic badge and the battery reminder never disagree', () => {
  test('collision: a reminder titled "Optic battery" makes an old-battery optic read Active everywhere (legacy title match)', async ({ page }) => {
    await createGunAndDemo(page, 'E2E Collision GunA');
    await createOptic(page, 'CollisionA', 'Optic', 'E2E Collision GunA');
    await expandOptic(page, 'CollisionA Optic');
    await logBatteryChange(page, dayOffset(-400));

    await addTitledReminderForGun(page, 'Optic battery', 40, 'E2E Collision GunA');

    // Optics screen: Active, not "Battery due" — the whole point of the collision.
    await gotoSection(page, 'Optics');
    await expect(await badgeTextFor(page, 'CollisionA Optic')).toHaveText('Active');

    // Gun Detail's sub-line agrees.
    await gotoSection(page, 'Guns');
    await rowFor(page, 'E2E Collision GunA').click();
    await expect(cardWith(page, 'Optics').locator('.row-sub')).toHaveText('Active');

    // Reminders shows the real future date, not a due-today verdict.
    await gotoSection(page, 'Reminders');
    const later = cardWith(page, 'Later');
    await expect(later.getByText(/Optic battery/)).toBeVisible();
    await expect(later).toContainText('In 40 days');
  });

  test('collision: a hand-written "Optic Battery" title (capitalized, no template) still wins the collision', async ({ page }) => {
    await createGunAndDemo(page, 'E2E Collision GunB');
    await createOptic(page, 'CollisionB', 'Optic', 'E2E Collision GunB');
    await expandOptic(page, 'CollisionB Optic');
    await logBatteryChange(page, dayOffset(-400));

    // Custom title, capitalized, no template — the case isBatteryShaped's
    // title clause exists to catch (opticBattery.ts, spec §4).
    await addTitledReminderForGun(page, 'Optic Battery', 40, 'E2E Collision GunB');

    await gotoSection(page, 'Optics');
    await expect(await badgeTextFor(page, 'CollisionB Optic')).toHaveText('Active');

    await gotoSection(page, 'Guns');
    await rowFor(page, 'E2E Collision GunB').click();
    await expect(cardWith(page, 'Optics').locator('.row-sub')).toHaveText('Active');
  });

  // DO NOT "fix" this into an assigned optic + a legacy title/template
  // match, the way the two collision tests above do it. That version is
  // IMPOSSIBLE: Parts only ever lists UNASSIGNED optics, and the legacy
  // match requires the reminder's gun to equal the optic's gun — which an
  // unassigned optic (falsy firearmId) can never satisfy. The explicit link
  // (via "Set a battery reminder") is the ONLY path by which Parts's badge
  // can ever show anything but the 330-day fallback, so it's the only way
  // to prove Parts agrees with the other two screens. Confirmed with the
  // build's coordinator (session 137 follow-up) — the spec's literal
  // instruction here was impossible as written, not a shortcut taken here.
  test('collision on Parts: an unassigned optic explicitly linked via "Set a battery reminder" reads Active there too', async ({ page }) => {
    await seedDemo(page);
    await createOptic(page, 'PartsLink', 'Optic'); // unassigned — legacy match can never reach this one
    await expandOptic(page, 'PartsLink Optic');
    await logBatteryChange(page, dayOffset(-400));

    // Baseline: before any reminder, the fallback rule is what's showing.
    await expect(await badgeTextFor(page, 'PartsLink Optic')).toHaveText('Battery due');

    await expandOptic(page, 'PartsLink Optic');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Set a battery reminder' }).click();
    await expect(main.getByRole('heading', { name: 'New Reminder' })).toBeVisible();
    await expect(main.getByLabel('Title')).toHaveValue('Optic battery');
    await expect(main.locator('.row').filter({ hasText: 'Linked optic' })).toContainText('PartsLink Optic');
    await main.getByLabel('Due date').fill(dayOffset(40));
    await main.getByRole('button', { name: 'Save reminder' }).click();

    // Back on Optics (pushed from there): Active, via the explicit link.
    await expect(main.getByRole('heading', { name: 'Optics' }).first()).toBeVisible();
    await expect(await badgeTextFor(page, 'PartsLink Optic')).toHaveText('Active');

    // The SAME optic, on Parts, agrees.
    await gotoSection(page, 'Parts');
    await expect(await badgeTextFor(page, 'PartsLink Optic')).toHaveText('Active');
  });

  test('logging a battery change rolls a governing reminder forward and clears Home\'s Needs Attention', async ({ page }) => {
    await createGunAndDemo(page, 'E2E RollForward Gun');
    await createOptic(page, 'RollFwd', 'Optic', 'E2E RollForward Gun');

    // From the template, so it repeats yearly (a battery-shaped reminder by
    // templateKey, not just title — the other half of "battery-shaped").
    await gotoSection(page, 'Reminders');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Browse templates' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Optic battery/ }).click();
    await expect(main.getByRole('heading', { name: 'New Reminder' })).toBeVisible();
    await main.getByLabel('Due date').fill(dayOffset(0));
    await main.getByLabel('Which gun? (optional)').selectOption({ label: 'E2E RollForward Gun' });
    await main.getByRole('button', { name: 'Save reminder' }).click();

    await gotoTab(page, 'Home');
    await expect(cardWith(page, 'Needs Attention').getByText(/Optic battery/)).toBeVisible();

    await gotoSection(page, 'Optics');
    await expect(await badgeTextFor(page, 'RollFwd Optic')).toHaveText('Battery due');

    await expandOptic(page, 'RollFwd Optic');
    await page.getByRole('button', { name: '+ Log Battery Change' }).click();
    const dialog = page.getByRole('dialog', { name: 'Log Battery Change' });
    await expect(dialog).toBeVisible();
    // Today is already the default date — this IS the collision-preventing
    // save the note describes.
    await expect(dialog.getByText(/Saving this also moves the battery reminder to/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);

    await expect(await badgeTextFor(page, 'RollFwd Optic')).toHaveText('Active');

    await gotoSection(page, 'Reminders');
    await expect(cardWith(page, 'Later').getByText(/Optic battery/)).toBeVisible();

    await gotoTab(page, 'Home');
    await expect(cardWith(page, 'Needs Attention').getByText(/Optic battery/)).toHaveCount(0);
  });

  test('marking a governing reminder done writes the battery log entry with provenance', async ({ page }) => {
    await createGunAndDemo(page, 'E2E MarkDone Gun');
    await createOptic(page, 'MarkDone', 'Optic', 'E2E MarkDone Gun');
    await addTitledReminderForGun(page, 'Optic battery', 10, 'E2E MarkDone Gun');

    const main = page.getByRole('main');
    await main.getByText(/Optic battery/).click();
    await expect(main.getByRole('heading', { name: 'Edit Reminder' })).toBeVisible();
    await expect(main.locator('.row').filter({ hasText: 'Linked optic' })).toContainText('MarkDone Optic');
    await expect(main.getByText("Mark done also adds today's date to this optic's battery log.")).toBeVisible();
    await main.getByRole('button', { name: 'Mark done' }).click();

    await gotoSection(page, 'Optics');
    await expandOptic(page, 'MarkDone Optic');
    const entryRow = page.getByRole('main').locator('.row').filter({ hasText: 'Marked done from the reminder' });
    await expect(entryRow).toBeVisible();
    await expect(entryRow).toContainText(formatDayKey(dayOffset(0)));
  });

  // F-4 (audit round 3): a prior tap of "Mark done" can have already
  // written today's provenance entry successfully and then failed on the
  // reminder write that follows it — the visible advice in that failure is
  // to tap Mark done again. This proves the retry does NOT append a second,
  // byte-identical entry: with today's entry already seeded (standing in
  // for "a previous attempt already got this far"), marking done must leave
  // exactly ONE such entry, not two.
  test('marking a governing reminder done a second time (retrying after a partial failure) does not duplicate the provenance entry', async ({ page }) => {
    await createGunAndDemo(page, 'E2E DupGuard Gun');
    const gunId = await page.evaluate(() => (window.history.state as { view?: { id?: string } } | null)?.view?.id ?? null);
    expect(gunId).toBeTruthy();

    await seedRaw(page, 'optics', {
      id: 'e2e-dupguard-optic', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
      firearmId: gunId, make: 'DupGuard', model: 'Optic',
      installDate: '', dotSize: '', zeroDist: '', mountHeight: '', torqueSpec: '', settingsSnapshot: '',
      // Standing in for "a previous Mark done tap already wrote this".
      batteryLog: [{ date: dayOffset(0), notes: 'Marked done from the reminder' }], notes: '',
    });
    await page.reload();
    await addTitledReminderForGun(page, 'Optic battery', 10, 'E2E DupGuard Gun');

    const main = page.getByRole('main');
    await main.getByText(/Optic battery/).click();
    await expect(main.getByRole('heading', { name: 'Edit Reminder' })).toBeVisible();
    await expect(main.locator('.row').filter({ hasText: 'Linked optic' })).toContainText('DupGuard Optic');
    await main.getByRole('button', { name: 'Mark done' }).click();
    await expect(main.getByRole('heading', { name: 'Reminders' }).first()).toBeVisible();

    await gotoSection(page, 'Optics');
    await expandOptic(page, 'DupGuard Optic');
    const entryRows = page.getByRole('main').locator('.row').filter({ hasText: 'Marked done from the reminder' });
    await expect(entryRows).toHaveCount(1);
  });

  test('the 330-day fallback still applies with no reminder — on Optics, Gun Detail, and Parts', async ({ page }) => {
    await createGunAndDemo(page, 'E2E Fallback Gun');
    await createOptic(page, 'FallbackAssigned', 'Optic', 'E2E Fallback Gun');
    await expandOptic(page, 'FallbackAssigned Optic');
    await logBatteryChange(page, dayOffset(-400));

    await createOptic(page, 'FallbackUnassigned', 'Optic'); // no gun
    await expandOptic(page, 'FallbackUnassigned Optic');
    await logBatteryChange(page, dayOffset(-400));

    await expect(await badgeTextFor(page, 'FallbackAssigned Optic')).toHaveText('Battery due');
    await expect(await badgeTextFor(page, 'FallbackUnassigned Optic')).toHaveText('Battery due');

    await gotoSection(page, 'Guns');
    await rowFor(page, 'E2E Fallback Gun').click();
    await expect(cardWith(page, 'Optics').locator('.row-sub')).toHaveText('Battery due');

    await gotoSection(page, 'Parts');
    await expect(await badgeTextFor(page, 'FallbackUnassigned Optic')).toHaveText('Battery due');
  });

  test('a fresh optic honestly reads "No battery log", not "Active"', async ({ page }) => {
    await createGunAndDemo(page, 'E2E NoLog Gun');
    await createOptic(page, 'NoLog', 'Optic', 'E2E NoLog Gun');

    await expect(await badgeTextFor(page, 'NoLog Optic')).toHaveText('No battery log');
    await expandOptic(page, 'NoLog Optic');
    const main = page.getByRole('main');
    await expect(main.getByText('No battery changes logged yet.')).toBeVisible();
    await expect(main.getByRole('button', { name: 'Set a battery reminder' })).toBeVisible();

    await gotoSection(page, 'Guns');
    await rowFor(page, 'E2E NoLog Gun').click();
    await expect(page.getByRole('main').getByText('No battery changes logged')).toBeVisible();
  });

  test('a malformed reminder and garbage battery entries never crash Optics, Parts, or Gun Detail', async ({ page }) => {
    await createGunAndDemo(page, 'E2E Garbage Gun');
    const gunId = await page.evaluate(() => (window.history.state as { view?: { id?: string } } | null)?.view?.id ?? null);
    expect(gunId).toBeTruthy();

    await seedRaw(page, 'optics', {
      id: 'e2e-garbage-optic', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
      firearmId: gunId, make: 'Garbage', model: 'Optic',
      installDate: '', dotSize: '', zeroDist: '', mountHeight: '', torqueSpec: '', settingsSnapshot: '',
      batteryLog: [null, 42, 'x', { notes: 'no date' }], notes: '',
    });
    // Finding 2 (audit round 2): a `batteryLog` that isn't an array at all —
    // storage garbage, or a record shape from before this field existed —
    // must read the same way: no entries, never a crash. A restore/import
    // that predates this field, or damage to one record, must not take the
    // whole screen down for every OTHER optic on it.
    await seedRaw(page, 'optics', {
      id: 'e2e-non-array-battery-log', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
      firearmId: gunId, make: 'NonArrayLog', model: 'Optic',
      installDate: '', dotSize: '', zeroDist: '', mountHeight: '', torqueSpec: '', settingsSnapshot: '',
      batteryLog: {}, notes: '',
    });
    await seedRaw(page, 'reminders', {
      id: 'e2e-garbage-reminder', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
      title: 'Garbage battery reminder', notes: '', source: 'custom', trigger: 'date',
      dueDate: 'garbage', enabled: true, firearmId: gunId,
    });

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.reload();

    await gotoSection(page, 'Optics');
    await expectScreenAlive(page, /Optics/);
    await expect(page.getByRole('main').getByText('Garbage Optic')).toBeVisible();
    await expect(page.getByRole('main').getByText('NonArrayLog Optic')).toBeVisible();
    await expect(await badgeTextFor(page, 'NonArrayLog Optic')).toHaveText('No battery log');

    await gotoSection(page, 'Parts');
    await expectScreenAlive(page, /Parts/);

    await gotoSection(page, 'Guns');
    await rowFor(page, 'E2E Garbage Gun').click();
    await expectScreenAlive(page, /E2E Garbage Gun/);
    await expect(page.getByRole('main').getByText('Garbage Optic')).toBeVisible();
    await expect(page.getByRole('main').getByText('NonArrayLog Optic')).toBeVisible();

    expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  // Finding 6 / 11 (audit round 2): the new-reminder opticId-stamping path in
  // persistForm had NO guard against the gun being changed before saving
  // (unlike its sibling legacy-upgrade path a few lines below it, which
  // does). Real bug this proves is fixed: create the reminder from the
  // optic's own button, change which gun it's for before saving, and the
  // optic must NOT keep being governed by a reminder now labelled for a
  // different gun.
  test('changing the gun before saving a reminder created from an optic\'s button does not leave the link stamped', async ({ page }) => {
    await createGunAndDemo(page, 'E2E LinkGuard GunA');
    await createGun(page, 'E2E LinkGuard GunB');
    await createOptic(page, 'LinkGuard', 'Optic', 'E2E LinkGuard GunA');
    await expandOptic(page, 'LinkGuard Optic');
    await logBatteryChange(page, dayOffset(-400)); // fallback: reads Battery due until/unless a reminder governs it

    await expect(await badgeTextFor(page, 'LinkGuard Optic')).toHaveText('Battery due');

    await expandOptic(page, 'LinkGuard Optic');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Set a battery reminder' }).click();
    await expect(main.getByRole('heading', { name: 'New Reminder' })).toBeVisible();
    await expect(main.locator('.row').filter({ hasText: 'Linked optic' })).toContainText('LinkGuard Optic');

    // Change the gun before saving — this is the exact case the missing guard let through.
    await main.getByLabel('Which gun? (optional)').selectOption({ label: 'E2E LinkGuard GunB' });
    await expect(main.locator('.row').filter({ hasText: 'Linked optic' })).toHaveCount(0);
    await main.getByLabel('Due date').fill(dayOffset(40));
    await main.getByRole('button', { name: 'Save reminder' }).click();

    // The optic on GunA must still be reading the fallback rule — the
    // reminder (now for GunB) never governed it.
    await expect(main.getByRole('heading', { name: 'Optics' }).first()).toBeVisible();
    await expect(await badgeTextFor(page, 'LinkGuard Optic')).toHaveText('Battery due');

    // And re-opening the saved reminder confirms no link was stamped: no
    // opticId (so no explicit link), and no legacy match either (its
    // firearmId is now GunB's, which carries no optic at all).
    await gotoSection(page, 'Reminders');
    await main.getByText(/Optic battery/).click();
    await expect(main.getByRole('heading', { name: 'Edit Reminder' })).toBeVisible();
    await expect(main.locator('.row').filter({ hasText: 'Linked optic' })).toHaveCount(0);
  });

  test('deleting a battery-log entry works, and deleting the last one clears the badge back to No battery log', async ({ page }) => {
    await createGunAndDemo(page, 'E2E Delete Gun');
    await createOptic(page, 'DeleteTest', 'Optic', 'E2E Delete Gun');
    await expandOptic(page, 'DeleteTest Optic');
    const oldDate = dayOffset(-200);
    await logBatteryChange(page, oldDate);
    await expandOptic(page, 'DeleteTest Optic');
    await logBatteryChange(page, dayOffset(0));

    await expect(await badgeTextFor(page, 'DeleteTest Optic')).toHaveText('Active');

    await expandOptic(page, 'DeleteTest Optic');
    const main = page.getByRole('main');
    const oldRow = main.locator('.row').filter({ hasText: formatDayKey(oldDate) });
    await expect(oldRow).toBeVisible();
    await oldRow.getByRole('button', { name: `Delete battery log entry from ${formatDayKey(oldDate)}` }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete this battery log entry?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete Entry' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(oldRow).toHaveCount(0);

    // Delete the one remaining entry too.
    const lastRow = main.locator('.row').filter({ hasText: formatDayKey(dayOffset(0)) });
    await expect(lastRow).toBeVisible();
    await lastRow.getByRole('button', { name: `Delete battery log entry from ${formatDayKey(dayOffset(0))}` }).click();
    await page.getByRole('dialog', { name: 'Delete this battery log entry?' })
      .getByRole('button', { name: 'Delete Entry' }).click();

    await expect(main.getByText('No battery changes logged yet.')).toBeVisible();
    await expect(await badgeTextFor(page, 'DeleteTest Optic')).toHaveText('No battery log');
  });

  // F-3 (audit round 3): the screen-level error banner (Finding 4's delete-
  // race message, Finding 5's reminder-write-failure message) was cleared
  // ONLY by the delete button's own onClick — a banner from one failed
  // action kept showing through every later SUCCESSFUL one, including a
  // reload. This proves both clear points: reallyDeleteEntry's own success
  // branch, and BatteryLogSheet's onSaved path.
  test('a stale error banner clears on the next successful action, not left showing forever', async ({ page }) => {
    await createGunAndDemo(page, 'E2E BannerClear Gun');
    const gunId = await page.evaluate(() => (window.history.state as { view?: { id?: string } } | null)?.view?.id ?? null);
    expect(gunId).toBeTruthy();

    const entryA = { date: dayOffset(-10), notes: 'first entry' };
    const entryB = { date: dayOffset(-5), notes: 'second entry' };
    await seedRaw(page, 'optics', {
      id: 'e2e-bannerclear-optic', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
      firearmId: gunId, make: 'BannerClear', model: 'Optic',
      installDate: '', dotSize: '', zeroDist: '', mountHeight: '', torqueSpec: '', settingsSnapshot: '',
      batteryLog: [entryA, entryB], notes: '',
    });
    await page.reload();
    await gotoSection(page, 'Optics');
    await expandOptic(page, 'BannerClear Optic');

    const main = page.getByRole('main');
    const rowA = main.locator('.row').filter({ hasText: formatDayKey(entryA.date) });
    await rowA.getByRole('button', { name: `Delete battery log entry from ${formatDayKey(entryA.date)}` }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete this battery log entry?' });
    await expect(confirm).toBeVisible();

    // Simulate another tab editing this SAME entry while the confirm sheet
    // is open — the exact race Finding 4's freshness check exists to catch.
    await seedRaw(page, 'optics', {
      id: 'e2e-bannerclear-optic', createdAt: 1_700_000_000_000, updatedAt: Date.now(),
      firearmId: gunId, make: 'BannerClear', model: 'Optic',
      installDate: '', dotSize: '', zeroDist: '', mountHeight: '', torqueSpec: '', settingsSnapshot: '',
      batteryLog: [{ date: entryA.date, notes: 'edited by another tab' }, entryB], notes: '',
    });
    await confirm.getByRole('button', { name: 'Delete Entry' }).click();
    await expect(confirm).toHaveCount(0);

    const banner = main.getByRole('alert');
    await expect(banner).toContainText('nothing was deleted');

    // Now delete the OTHER entry, untouched by the race — this must succeed,
    // and reallyDeleteEntry's own success branch must clear the stale banner.
    const rowB = main.locator('.row').filter({ hasText: formatDayKey(entryB.date) });
    await rowB.getByRole('button', { name: `Delete battery log entry from ${formatDayKey(entryB.date)}` }).click();
    await page.getByRole('dialog', { name: 'Delete this battery log entry?' })
      .getByRole('button', { name: 'Delete Entry' }).click();
    await expect(banner).toHaveCount(0);
    await expect(rowB).toHaveCount(0);

    // Provoke the SAME banner a second time, then prove the OTHER clear
    // point: a successful Log Battery Change save (BatteryLogSheet's
    // onSaved path, no governing reminder involved at all here).
    const remainingRow = main.locator('.row').filter({ hasText: 'edited by another tab' });
    await remainingRow.getByRole('button', { name: /Delete battery log entry from/ }).click();
    await seedRaw(page, 'optics', {
      id: 'e2e-bannerclear-optic', createdAt: 1_700_000_000_000, updatedAt: Date.now(),
      firearmId: gunId, make: 'BannerClear', model: 'Optic',
      installDate: '', dotSize: '', zeroDist: '', mountHeight: '', torqueSpec: '', settingsSnapshot: '',
      batteryLog: [{ date: entryA.date, notes: 'edited AGAIN by another tab' }], notes: '',
    });
    await page.getByRole('dialog', { name: 'Delete this battery log entry?' })
      .getByRole('button', { name: 'Delete Entry' }).click();
    await expect(banner).toContainText('nothing was deleted');

    await logBatteryChange(page, dayOffset(0));
    await expect(banner).toHaveCount(0);
  });

  // Item 4 (audit round 3, closing review): tapping a delete icon used to
  // clear the error banner immediately, so CANCELLING that confirm still
  // erased a still-relevant earlier message. The clear now happens only
  // where the delete actually proceeds (reallyDeleteEntry), not on the mere
  // tap that opens the sheet.
  test('cancelling a delete confirm does not erase a still-relevant error banner', async ({ page }) => {
    await createGunAndDemo(page, 'E2E CancelClear Gun');
    const gunId = await page.evaluate(() => (window.history.state as { view?: { id?: string } } | null)?.view?.id ?? null);
    expect(gunId).toBeTruthy();

    const entryA = { date: dayOffset(-10), notes: 'first entry' };
    const entryB = { date: dayOffset(-5), notes: 'second entry' };
    await seedRaw(page, 'optics', {
      id: 'e2e-cancelclear-optic', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
      firearmId: gunId, make: 'CancelClear', model: 'Optic',
      installDate: '', dotSize: '', zeroDist: '', mountHeight: '', torqueSpec: '', settingsSnapshot: '',
      batteryLog: [entryA, entryB], notes: '',
    });
    await page.reload();
    await gotoSection(page, 'Optics');
    await expandOptic(page, 'CancelClear Optic');

    const main = page.getByRole('main');
    const rowA = main.locator('.row').filter({ hasText: formatDayKey(entryA.date) });
    await rowA.getByRole('button', { name: `Delete battery log entry from ${formatDayKey(entryA.date)}` }).click();
    let confirm = page.getByRole('dialog', { name: 'Delete this battery log entry?' });
    await expect(confirm).toBeVisible();
    // Race entryA out from under the confirm, same technique as the banner-
    // clear test, to produce a real banner.
    await seedRaw(page, 'optics', {
      id: 'e2e-cancelclear-optic', createdAt: 1_700_000_000_000, updatedAt: Date.now(),
      firearmId: gunId, make: 'CancelClear', model: 'Optic',
      installDate: '', dotSize: '', zeroDist: '', mountHeight: '', torqueSpec: '', settingsSnapshot: '',
      batteryLog: [{ date: entryA.date, notes: 'edited by another tab' }, entryB], notes: '',
    });
    await confirm.getByRole('button', { name: 'Delete Entry' }).click();
    await expect(confirm).toHaveCount(0);
    const banner = main.getByRole('alert');
    await expect(banner).toContainText('nothing was deleted');

    // Tap delete on the OTHER entry — the banner must survive the mere tap.
    const rowB = main.locator('.row').filter({ hasText: formatDayKey(entryB.date) });
    await rowB.getByRole('button', { name: `Delete battery log entry from ${formatDayKey(entryB.date)}` }).click();
    confirm = page.getByRole('dialog', { name: 'Delete this battery log entry?' });
    await expect(confirm).toBeVisible();
    await expect(banner).toContainText('nothing was deleted'); // still there, tap alone didn't clear it

    // Cancel — the banner must STILL be there.
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(banner).toContainText('nothing was deleted');
  });

  // Finding 9 (audit round 2): the date field is clearable, and a saved
  // entry with date:'' is invisible to every list that filters on
  // date !== '' and unreachable by the delete-row UI (undeletable except by
  // deleting the whole optic) — so clearing it must refuse the save, not
  // silently write an unreachable record.
  test('clearing the date on Log Battery Change refuses the save, rather than writing an unreachable entry', async ({ page }) => {
    await createGunAndDemo(page, 'E2E EmptyDate Gun');
    await createOptic(page, 'EmptyDate', 'Optic', 'E2E EmptyDate Gun');
    await expandOptic(page, 'EmptyDate Optic');

    const main = page.getByRole('main');
    await main.getByRole('button', { name: '+ Log Battery Change' }).click();
    const dialog = page.getByRole('dialog', { name: 'Log Battery Change' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Date').fill('');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(dialog).toBeVisible(); // refused: the sheet stays open
    await expect(dialog.getByText('Pick a date for this battery change before saving.')).toBeVisible();

    // The cleared date field also makes the sheet "dirty" against its
    // today-default baseline, so closing goes through the usual discard
    // confirmation — same as any other unsaved edit.
    await dialog.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('dialog', { name: 'Discard changes?' }).getByRole('button', { name: 'Discard' }).click();
    await expect(dialog).toHaveCount(0);
    // No entry was written — badge still reads the honest no-log state.
    await expect(await badgeTextFor(page, 'EmptyDate Optic')).toHaveText('No battery log');
  });
});

/** Seed the demo (so the app has guns/data), then add one more gun through
 *  the real form. Split out so every collision test starts from the same
 *  known baseline and creates its own isolated gun. */
async function createGunAndDemo(page: Page, gunName: string): Promise<void> {
  await seedDemo(page);
  await createGun(page, gunName);
}

/** Write a record with the given fields straight into IndexedDB — the shape
 *  a damaged restore or import has, unreachable through the UI. Same
 *  technique as e2e/missing-field-crash.spec.ts. */
async function seedRaw(page: Page, store: string, rec: Record<string, unknown>): Promise<void> {
  await page.evaluate(async ({ store, rec }) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('firearmlog');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(rec);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }, { store, rec });
}

const DEAD = /load this screen/i;

/** Same convention as missing-field-crash.spec.ts: wait for the screen to
 *  SETTLE (its own heading, or the death message) before deciding which. */
async function expectScreenAlive(page: Page, heading: RegExp): Promise<void> {
  const main = page.getByRole('main');
  const title = main.getByRole('heading', { name: heading });
  await expect.poll(async () => {
    if (DEAD.test(await main.innerText().catch(() => ''))) return 'dead';
    return (await title.count()) > 0 ? 'alive' : 'waiting';
  }, { timeout: 15_000, message: `screen never settled (waiting for a ${heading} heading or the error state)` })
    .not.toBe('waiting');
  expect(await main.innerText(), `the screen died instead of rendering ${heading}`).not.toMatch(DEAD);
}
