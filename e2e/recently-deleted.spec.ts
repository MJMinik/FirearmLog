import { test, expect, type Locator, type Page } from '@playwright/test';
import { seedDemo, gotoTab, isDesktop, swipeRowLeft } from './helpers';

// App 7 — swipe-to-delete + Recently Deleted, driven end to end in a real
// browser. On a phone we perform the actual touch swipe; on desktop we use the
// hover-reveal Delete button — both run the same delete path. We prove a planned
// session round-trips through Recently Deleted (delete -> restore) and that a
// logged session is protected (a swipe explains instead of deleting).

/** Reveal and trigger a row's Delete: swipe on phone, hover-button on desktop. */
async function deleteRow(page: Page, row: Locator): Promise<void> {
  if (isDesktop(page)) {
    await row.hover();
    await row.locator('.swipe-hover-del').click();
  } else {
    await swipeRowLeft(row);
    await row.locator('.swipe-delete').click();
  }
}

/** Make a clearly-identifiable session with a distinctive round count. */
async function makeSession(page: Page, kind: 'log' | 'plan', rounds: string): Promise<void> {
  await page.getByRole('button', { name: kind === 'plan' ? '+ Plan Session' : '+ Log Session' }).click();
  const gunsCard = page.locator('.card').filter({ hasText: 'Guns & Rounds' }).first();
  await gunsCard.locator('button.gun-toggle').first().click();
  await gunsCard.getByRole('spinbutton').first().fill(rounds);
  await page.locator('.navbar-action').click();
  await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();
}

test.describe('Recently Deleted (App 7)', () => {
  test('swipe-delete a planned session, then restore it', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await makeSession(page, 'plan', '1357'); // -> "1,357 rds", flagged Planned

    const main = page.getByRole('main');
    const row = main.locator('.swipe-row', { hasText: '1,357' }).filter({ hasText: 'Planned' });
    await expect(row).toHaveCount(1);

    await deleteRow(page, row);

    // It leaves the live list and lands in Recently Deleted.
    await expect(main.locator('.swipe-row', { hasText: '1,357' })).toHaveCount(0);
    const trashHeader = page.getByRole('button', { name: /Recently Deleted/ });
    await expect(trashHeader).toBeVisible();

    // Expand the trash and restore the single entry.
    await trashHeader.click();
    const trashRow = page.locator('.trash-row');
    await expect(trashRow).toHaveCount(1);
    await trashRow.getByRole('button', { name: 'Restore' }).click();

    // The session is back in the list and the trash is empty again.
    await expect(main.locator('.swipe-row', { hasText: '1,357' }).filter({ hasText: 'Planned' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: /Recently Deleted/ })).toHaveCount(0);
  });

  test('on touch, swiping a logged session explains instead of deleting', async ({ page }) => {
    test.skip(isDesktop(page), 'logged sessions have no inline delete on desktop — covered by the gating test');
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await makeSession(page, 'log', '2468'); // a real, logged session

    const main = page.getByRole('main');
    const row = main.locator('.swipe-row', { hasText: '2,468' });
    await expect(row).toHaveCount(1);

    await swipeRowLeft(row);
    await row.locator('.swipe-delete').click();

    // No deletion: the explanation appears and the session stays in the list.
    await expect(page.getByText("This one's part of your record")).toBeVisible();
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(main.locator('.swipe-row', { hasText: '2,468' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: /Recently Deleted/ })).toHaveCount(0);
  });

  test('on desktop, the inline Delete icon shows only on planned sessions', async ({ page }) => {
    test.skip(!isDesktop(page), 'desktop-only affordance');
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await makeSession(page, 'plan', '1357'); // planned -> should have the icon
    await makeSession(page, 'log', '2468');  // logged  -> should NOT

    const main = page.getByRole('main');
    await expect(main.locator('.swipe-row', { hasText: '1,357' }).locator('.swipe-hover-del')).toHaveCount(1);
    await expect(main.locator('.swipe-row', { hasText: '2,468' }).locator('.swipe-hover-del')).toHaveCount(0);
  });
});
