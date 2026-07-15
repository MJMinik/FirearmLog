import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedDemo, gotoSection, gotoTab } from './helpers';

// Reminders feature (spec §6 / §6b LOCKED). These run on both projects (desktop
// sidebar + phone More), so the two-tier Home model and the section grouping are
// proven on both nav layouts. We seed the demo so guns exist (round-count
// reminders need one) and Home shows its dashboard; the demo carries NO reminders,
// so every reminder here is one the test created through the real UI.

/** A local YYYY-MM-DD `days` from today — reminders are measured against real today. */
function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function openReminders(page: Page): Promise<void> {
  await gotoSection(page, 'Reminders');
  await expect(page.getByRole('main').getByRole('heading', { name: 'Reminders' }).first()).toBeVisible();
}

async function addDateReminder(page: Page, title: string, dueOffsetDays: number, repeat = 'none'): Promise<void> {
  const main = page.getByRole('main');
  await main.getByRole('button', { name: /Add reminder|Add your own/ }).first().click();
  await expect(main.getByRole('heading', { name: 'New Reminder' })).toBeVisible();
  await main.getByLabel('Title').fill(title);
  await main.getByLabel('Due date').fill(dayOffset(dueOffsetDays));
  if (repeat !== 'none') await main.getByLabel('Repeats').selectOption(repeat);
  await main.getByRole('button', { name: 'Save reminder' }).click();
  await expect(main.getByRole('heading', { name: 'Reminders' }).first()).toBeVisible();
}

async function addRoundReminder(page: Page, title: string, everyRounds: number): Promise<void> {
  const main = page.getByRole('main');
  await main.getByRole('button', { name: /Add reminder|Add your own/ }).first().click();
  await expect(main.getByRole('heading', { name: 'New Reminder' })).toBeVisible();
  await main.getByLabel('Title').fill(title);
  await main.getByRole('button', { name: 'A round count' }).click();
  // A <select>'s accessible name includes its selected option, so match the label
  // as a substring, not exact. In round mode this is the only gun picker present.
  await main.getByLabel('Which gun?').selectOption({ index: 1 }); // index 0 is the placeholder
  await main.getByLabel('Every how many rounds?').fill(String(everyRounds));
  await main.getByRole('button', { name: 'Save reminder' }).click();
  await expect(main.getByRole('heading', { name: 'Reminders' }).first()).toBeVisible();
}

const cardWith = (page: Page, heading: string) =>
  page.getByRole('main').locator('.card').filter({ has: page.getByRole('heading', { name: heading }) });

test('empty state does the discovery — template library or your own', async ({ page }) => {
  await seedDemo(page);
  await openReminders(page);
  const main = page.getByRole('main');
  await expect(main.getByText('No reminders yet.')).toBeVisible();
  await expect(main.getByRole('button', { name: 'Browse templates' })).toBeVisible();
  await expect(main.getByRole('button', { name: '+ Add your own' })).toBeVisible();
});

test('a template prefills the form and saves a reminder', async ({ page }) => {
  await seedDemo(page);
  await openReminders(page);
  const main = page.getByRole('main');

  await main.getByRole('button', { name: 'Browse templates' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Start from a template' })).toBeVisible();
  await sheet.getByRole('button', { name: /Optic battery/ }).click();

  await expect(main.getByRole('heading', { name: 'New Reminder' })).toBeVisible();
  await expect(main.getByLabel('Title')).toHaveValue('Optic battery');
  await main.getByLabel('Due date').fill(dayOffset(20));
  await main.getByRole('button', { name: 'Save reminder' }).click();

  await expect(main.getByRole('heading', { name: 'Reminders' }).first()).toBeVisible();
  await expect(main.getByText('Optic battery')).toBeVisible();
});

test('an overdue reminder rises into Home Needs Attention, never Coming up', async ({ page }) => {
  await seedDemo(page);
  await openReminders(page);

  await addDateReminder(page, 'Overdue Batt', -3);

  // Screen: it sits under Overdue.
  await expect(cardWith(page, 'Overdue').getByText('Overdue Batt')).toBeVisible();

  // Home: it's in Needs Attention, and NOT in Coming up.
  await gotoTab(page, 'Home');
  await expect(cardWith(page, 'Needs Attention').getByText('Overdue Batt')).toBeVisible();
  await expect(cardWith(page, 'Coming up').getByText('Overdue Batt')).toHaveCount(0);
});

test('an upcoming reminder sits in Home Coming up, never Needs Attention', async ({ page }) => {
  await seedDemo(page);
  await openReminders(page);

  await addDateReminder(page, 'Soon Batt', 10);

  // Screen: under Coming up.
  await expect(cardWith(page, 'Coming up').getByText('Soon Batt')).toBeVisible();

  // Home: in Coming up, not in Needs Attention.
  await gotoTab(page, 'Home');
  await expect(cardWith(page, 'Coming up').getByText('Soon Batt')).toBeVisible();
  await expect(cardWith(page, 'Needs Attention').getByText('Soon Batt')).toHaveCount(0);
});

test('Home Coming up caps at 4 with a "See all coming up (N)" overflow row', async ({ page }) => {
  await seedDemo(page);
  await openReminders(page);
  const main = page.getByRole('main');

  // Five upcoming reminders, soonest first Cap 1..Cap 5 (due +6..+10 days).
  for (let i = 1; i <= 5; i++) await addDateReminder(page, `Cap ${i}`, 5 + i);

  await gotoTab(page, 'Home');
  const coming = cardWith(page, 'Coming up');
  await expect(coming.getByRole('button', { name: 'See all coming up (5)' })).toBeVisible();
  await expect(coming.getByText('Cap 1').first()).toBeVisible();  // soonest is shown
  await expect(coming.getByText('Cap 5')).toHaveCount(0);          // 5th is past the cap

  // Tapping the overflow row opens the full Reminders screen, where all five show.
  await coming.getByRole('button', { name: 'See all coming up (5)' }).click();
  await expect(main.getByRole('heading', { name: 'Reminders' }).first()).toBeVisible();
  await expect(main.getByText('Cap 5').first()).toBeVisible();
});

test('Add to Calendar exists for a date reminder and is absent for a round-count one', async ({ page }) => {
  await seedDemo(page);
  await openReminders(page);
  const main = page.getByRole('main');

  await addDateReminder(page, 'Cal Batt', 20);
  await addRoundReminder(page, 'Spring Rounds', 100000); // large interval -> lives under Later

  // The date reminder's edit view offers Add to Calendar.
  await main.getByText('Cal Batt').click();
  await expect(main.getByRole('heading', { name: 'Edit Reminder' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Add to Calendar' })).toBeVisible();
  await main.getByRole('button', { name: '‹ Cancel' }).click();

  // The round-count reminder has no date to export — no button.
  await expect(main.getByRole('heading', { name: 'Reminders' }).first()).toBeVisible();
  await main.getByText('Spring Rounds').click();
  await expect(main.getByRole('heading', { name: 'Edit Reminder' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Add to Calendar' })).toHaveCount(0);
});

test('the Reminders screen groups by urgency: Overdue, Coming up, Later', async ({ page }) => {
  await seedDemo(page);
  await openReminders(page);

  await addDateReminder(page, 'Grp Overdue', -2);
  await addDateReminder(page, 'Grp Soon', 12);
  await addDateReminder(page, 'Grp Later', 90);

  await expect(cardWith(page, 'Overdue').getByText('Grp Overdue')).toBeVisible();
  await expect(cardWith(page, 'Coming up').getByText('Grp Soon')).toBeVisible();
  await expect(cardWith(page, 'Later').getByText('Grp Later')).toBeVisible();
});
