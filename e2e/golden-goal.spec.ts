import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Golden goal (session 35): one user-chosen goal can be starred as the "golden
// goal" — it pins to the top of Goals, is highlighted, and is echoed on Home
// (above Needs Attention), only when set. Starring the current golden goal
// again clears it. Tracked by a single settings pointer, so "exactly one" holds.
test.describe('Golden goal', () => {
  test('star pins a goal and echoes it on Home; unstar removes it', async ({ page }) => {
    await seedDemo(page); // non-empty Home (demo guns/sessions), no golden set yet
    await gotoTab(page, 'Progress');
    const main = page.getByRole('main');

    // Add a known goal.
    await main.getByRole('button', { name: '+ Add Goal' }).click();
    await main.getByPlaceholder('Bill Drill under 2.0 seconds').fill('Draw under 1.2s');
    await main.getByRole('button', { name: 'Add Goal' }).click();
    await main.getByRole('button', { name: 'Done' }).click();

    // Star it → it becomes the golden goal (marker shown, star flips to "Remove").
    await main.getByRole('button', { name: 'Make Draw under 1.2s your golden goal' }).click();
    await expect(main.getByText('Golden goal', { exact: true })).toBeVisible();
    await expect(
      main.getByRole('button', { name: 'Remove Draw under 1.2s as your golden goal' }),
    ).toBeVisible();

    // Home echoes it, above Needs Attention.
    await gotoTab(page, 'Home');
    await expect(page.getByRole('main').getByText('Draw under 1.2s')).toBeVisible();
    await expect(page.getByRole('main').getByText(/Your golden goal/)).toBeVisible();

    // Unstar from Progress → Home no longer shows it.
    await gotoTab(page, 'Progress');
    await page
      .getByRole('main')
      .getByRole('button', { name: 'Remove Draw under 1.2s as your golden goal' })
      .click();
    await gotoTab(page, 'Home');
    await expect(page.getByRole('main').getByText('Draw under 1.2s')).toHaveCount(0);
  });
});
