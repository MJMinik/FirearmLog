import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Tester-2 F2 (July 16 2026): in the Goals add-form, Return must ADVANCE from
// field to field, never commit. Enter used to call addGoal() on the Goal field,
// so a tester who pressed Return banked a junk goal that landed hidden under the
// iOS keyboard. Now only the Add Goal button commits.

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

    // Focusing Category opened its type-ahead suggestion list, which overlays the
    // buttons below; blur it (refocus the Goal field) so it closes before we tap.
    await goalInput.click();

    // Only the Add Goal button commits — now the goal appears.
    await form.getByRole('button', { name: 'Add Goal' }).click();
    await expect(page.getByRole('main').locator('.goal-row', { hasText: goalText })).toHaveCount(1);
  });
});
