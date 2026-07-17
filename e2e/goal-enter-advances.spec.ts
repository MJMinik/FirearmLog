import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Tester-2 F2 (July 16 2026): in the Goals add-form, Return must ADVANCE from
// field to field, never commit. Enter used to call addGoal() on the Goal field,
// so a tester who pressed Return banked a junk goal that landed hidden under the
// iOS keyboard. Now only the Add Goal button commits.
//
// A6 (Michael, July 17 2026): Enter-advancing INTO the Category field must not
// auto-open its type-ahead suggestion list — that was noise nobody asked for.
// The list still opens on a real tap or on typing, so discoverability is kept.

test.describe('Goals form: Enter advances, only the button commits', () => {
  test('Enter in the Goal field moves focus on and does NOT create a goal', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Progress');

    await page.getByRole('button', { name: '+ Add Goal' }).click();
    const form = page.locator('.goal-add');
    await expect(form).toBeVisible();

    const goalText = `Return-test goal ${Date.now()}`;
    const goalInput = form.getByRole('textbox').first();   // Goal
    const catInput = form.getByRole('textbox').nth(1);     // Category (SuggestField)

    await goalInput.click();
    await goalInput.fill(goalText);
    await goalInput.press('Enter');

    // Enter advanced focus to Category — it did not submit.
    await expect(catInput).toBeFocused();

    // No goal row with this text was created (the form is still open, uncommitted).
    await expect(page.getByRole('main').locator('.goal-row', { hasText: goalText })).toHaveCount(0);
    await expect(form).toBeVisible();

    // A6: focus arrived by Enter-advance, so the suggestion list stayed shut and
    // isn't overlaying the buttons — Add Goal is tappable directly now.
    await form.getByRole('button', { name: 'Add Goal' }).click();
    await expect(page.getByRole('main').locator('.goal-row', { hasText: goalText })).toHaveCount(1);
  });

  test('A6: Enter-advancing into Category leaves its suggestions shut; a click opens them', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Progress');

    await page.getByRole('button', { name: '+ Add Goal' }).click();
    const form = page.locator('.goal-add');
    await expect(form).toBeVisible();

    const goalInput = form.getByRole('textbox').first();   // Goal
    const catInput = form.getByRole('textbox').nth(1);     // Category
    const catList = form.getByRole('listbox');             // its type-ahead list

    await goalInput.click();
    await goalInput.fill('Draw under 1.0 seconds');
    await goalInput.press('Enter');

    // Focus moved into Category, but the suggestion list did NOT auto-open.
    await expect(catInput).toBeFocused();
    await expect(catList).toHaveCount(0);

    // A deliberate click on the field DOES open it (discoverability kept). Move
    // focus off first — the field is already focused from the Enter-advance, so
    // a real re-focus is what proves the click path still opens the list.
    await goalInput.click();
    await catInput.click();
    await expect(catList).toBeVisible();
  });
});
