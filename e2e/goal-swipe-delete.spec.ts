import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoTab, isDesktop, swipeRowLeft } from './helpers';

// Goals swipe-to-delete. On a phone each goal row swipes left to reveal a red
// Delete; on desktop (no touch, and goals have no hover-trash) the goal deletes
// from its Edit sheet. Both permanently remove the goal — goals are disposable
// and referenced by nothing, which is why swipe-delete is safe here.

const GOAL = 'ZZ Swipe Test Goal';

async function addGoal(page: Page): Promise<void> {
  await gotoTab(page, 'Progress');
  const addBtn = page.getByRole('button', { name: '+ Add Goal' });
  if (await addBtn.count()) await addBtn.first().click();
  await page.getByRole('textbox', { name: 'Goal' }).first().fill(GOAL);
  await page.getByRole('button', { name: 'Add Goal' }).click();
  await expect(page.getByText(GOAL)).toBeVisible();
}

test.describe('Goals swipe-to-delete', () => {
  test('a goal can be deleted (swipe on phone, edit sheet on desktop)', async ({ page }) => {
    await seedDemo(page);
    await addGoal(page);

    const row = page.locator('.swipe-row', { hasText: GOAL });
    await expect(row).toHaveCount(1);

    if (isDesktop(page)) {
      // Desktop: no swipe/hover-trash on goals — delete from the Edit sheet.
      await page.getByRole('button', { name: `Edit ${GOAL}` }).click();
      await page.getByRole('button', { name: 'Delete goal' }).click(); // opens confirm
      await page.getByRole('button', { name: 'Delete goal' }).last().click(); // confirm
    } else {
      await swipeRowLeft(row);
      await row.getByRole('button', { name: 'Delete' }).click();
    }

    await expect(page.getByText(GOAL)).toHaveCount(0);
  });
});
