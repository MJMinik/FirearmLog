import { test, expect, type Page } from '@playwright/test';
import { seedDemo, isDesktop, gotoTab } from './helpers.ts';

// The desktop menu bar (MENUBAR_SPEC.md, July 2026) — spec §6's machine checks:
// each menu opens and closes; items route to the right view through the SAME
// guarded navigation as the sidebar (a dirty form still gets Discard changes?);
// the verified shortcuts fire; shortcuts are suppressed while typing; Esc
// closes; and the phone never sees any of it.

const bar = (page: Page) => page.getByRole('menubar', { name: 'FirearmLog menu bar' });

/** The platform's primary modifier, exactly as the app decides it (⌘ on Mac,
 *  Ctrl elsewhere) — CI's Linux Chromium takes the Ctrl path. */
async function primaryMod(page: Page): Promise<'Meta' | 'Control'> {
  const mac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform));
  return mac ? 'Meta' : 'Control';
}

/** Open one top-level menu by name and return its dropdown. */
async function openMenu(page: Page, name: string) {
  await bar(page).getByRole('menuitem', { name, exact: true }).click();
  return page.getByRole('menu', { name, exact: true });
}

test('phone layout never shows the menu bar, and its shortcuts stay inert', async ({ page }) => {
  test.skip(isDesktop(page), 'covers the phone project only');
  await seedDemo(page);
  await expect(bar(page)).toBeHidden();
  // The shortcut layer is media-gated, not just CSS-hidden: a hardware
  // keyboard on a small viewport must keep its browser behavior untouched.
  const mod = await primaryMod(page);
  await page.keyboard.press(`${mod}+Alt+N`);
  await expect(page.getByRole('heading', { name: 'Log Session', exact: true })).toBeHidden();
  await expect(page.getByRole('main').getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible();
});

test.describe('desktop menu bar', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 900, 'desktop-only surface');

  test('menus open, close on Esc, and close on an outside click', async ({ page }) => {
    await seedDemo(page);
    const file = await openMenu(page, 'File');
    await expect(file).toBeVisible();
    await expect(file.getByRole('menuitem', { name: 'Save to File…' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(file).toBeHidden();
    // Outside click: open again, then click bare page background (right of the
    // 860px content column — nothing interactive lives there).
    await openMenu(page, 'File');
    await page.mouse.click(1200, 500);
    await expect(page.getByRole('menu', { name: 'File', exact: true })).toBeHidden();
  });

  test('Go menu routes to each top-level tab', async ({ page }) => {
    await seedDemo(page);
    const go = await openMenu(page, 'Go');
    await go.getByRole('menuitem', { name: 'Log', exact: true }).click();
    await expect(page.getByRole('main').getByRole('heading', { name: 'Log' })).toBeVisible();
    await (await openMenu(page, 'Go')).getByRole('menuitem', { name: 'Progress', exact: true }).click();
    await expect(page.getByRole('main').getByRole('heading', { name: 'Progress', exact: true })).toBeVisible();
    await (await openMenu(page, 'Go')).getByRole('menuitem', { name: 'Home', exact: true }).click();
    await expect(page.getByRole('main').getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible();
  });

  test('File > New submenu starts each record type', async ({ page }) => {
    await seedDemo(page);
    const file = await openMenu(page, 'File');
    await file.getByRole('menuitem', { name: 'New', exact: true }).click();
    await page.getByRole('menu', { name: 'New', exact: true })
      .getByRole('menuitem', { name: 'Session', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Log Session', exact: true })).toBeVisible();
    // And the Planned variant lands on the plan form, not the log form.
    await page.getByRole('button', { name: 'Cancel' }).click();
    const file2 = await openMenu(page, 'File');
    await file2.getByRole('menuitem', { name: 'New', exact: true }).click();
    await page.getByRole('menu', { name: 'New', exact: true })
      .getByRole('menuitem', { name: 'Planned Session', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Plan Session', exact: true })).toBeVisible();
  });

  test('File > Save to File / Load from File open Sync & Backup', async ({ page }) => {
    await seedDemo(page);
    const file = await openMenu(page, 'File');
    await file.getByRole('menuitem', { name: 'Save to File…' }).click();
    await expect(page.getByRole('heading', { name: 'Sync & Backup' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save to File', exact: true })).toBeVisible();
  });

  test('File > Open Recent lists records and opens one', async ({ page }) => {
    await seedDemo(page);
    const file = await openMenu(page, 'File');
    await file.getByRole('menuitem', { name: 'Open Recent', exact: true }).click();
    const sub = page.getByRole('menu', { name: 'Open Recent', exact: true });
    // The demo log has sessions and matches, so real rows load (never "Loading…").
    const first = sub.getByRole('menuitem').first();
    await expect(first).not.toHaveText(/Loading|No records/);
    await first.click();
    // A recent record opens as its own screen — the session editor or a match.
    await expect(
      page.getByRole('heading', { name: /Edit Session|Match/ }).first()
    ).toBeVisible();
  });

  test('File > Open Recent orders by recency of edit, not record date (owner decision, session 75)', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    // The oldest LOGGED (non-planned) session on screen — last row of the
    // newest-first "All Sessions" list. The demo log runs many months back
    // (e.g. its June 2026 sessions), so this row is nowhere near today.
    const sessionsCard = page.locator('.card', { has: page.getByRole('heading', { name: 'All Sessions' }) });
    const oldRow = sessionsCard.locator('.row-tap').filter({ hasNotText: 'Planned' }).last();
    const dateText = await oldRow.locator('.label').evaluate((el) => el.childNodes[0]?.textContent?.trim() ?? '');
    expect(dateText).toBeTruthy();

    // It does NOT lead Open Recent before we touch it (it's the oldest-dated).
    const before = await openMenu(page, 'File');
    await before.getByRole('menuitem', { name: 'Open Recent', exact: true }).click();
    const subBefore = page.getByRole('menu', { name: 'Open Recent', exact: true });
    await expect(subBefore.getByRole('menuitem').first()).not.toContainText(dateText);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // Open it, make a small edit, and save.
    await oldRow.click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
    const where = page.getByRole('textbox', { name: 'Where' });
    const whereBefore = await where.inputValue();
    await where.fill(`${whereBefore} (touched)`);
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // Despite carrying the oldest date on screen, the session was just saved —
    // updatedAt is now the newest of any record, so it leads Open Recent.
    const file = await openMenu(page, 'File');
    await file.getByRole('menuitem', { name: 'Open Recent', exact: true }).click();
    const sub = page.getByRole('menu', { name: 'Open Recent', exact: true });
    await expect(sub.getByRole('menuitem').first()).toContainText(dateText);
  });

  test('Reports menu opens a printable report in a new window', async ({ page, context }) => {
    await seedDemo(page);
    const reports = await openMenu(page, 'Reports');
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      reports.getByRole('menuitem', { name: 'Round Count', exact: true }).click(),
    ]);
    await popup.waitForLoadState('domcontentloaded');
    await expect(popup.locator('body')).toContainText('Round Count', { timeout: 15_000 });
    await expect(popup.locator('body')).toContainText('Lifetime rounds');
  });

  test('Reports > All Reports… opens the Reports screen', async ({ page }) => {
    await seedDemo(page);
    const reports = await openMenu(page, 'Reports');
    await reports.getByRole('menuitem', { name: 'All Reports…' }).click();
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  });

  test('Help menu launches the Quick Tour directly', async ({ page }) => {
    await seedDemo(page);
    const help = await openMenu(page, 'Help');
    await help.getByRole('menuitem', { name: 'Quick Tour', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome to FirearmLog' })).toBeVisible();
    // And again from the Tour & Setup screen itself (the already-open case).
    await page.keyboard.press('Escape');
    const help2 = await openMenu(page, 'Help');
    await help2.getByRole('menuitem', { name: 'Quick Tour', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome to FirearmLog' })).toBeVisible();
  });

  test('About FirearmLog shows the version', async ({ page }) => {
    await seedDemo(page);
    const app = await openMenu(page, 'FirearmLog');
    await app.getByRole('menuitem', { name: 'About FirearmLog' }).click();
    await expect(page.getByText(/FirearmLog v\d+\.\d+/)).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('keyboard shortcuts: new session, save-to-file, and settings all fire', async ({ page }) => {
    await seedDemo(page);
    const mod = await primaryMod(page);
    await page.keyboard.press(`${mod}+Alt+N`);
    await expect(page.getByRole('heading', { name: 'Log Session', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.keyboard.press(`${mod}+S`);
    await expect(page.getByRole('heading', { name: 'Sync & Backup' })).toBeVisible();
    await page.keyboard.press(`${mod}+,`);
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  });

  test('shortcuts stay quiet while typing in a field', async ({ page }) => {
    await seedDemo(page);
    const mod = await primaryMod(page);
    await page.keyboard.press(`${mod}+Alt+N`);
    await expect(page.getByRole('heading', { name: 'Log Session', exact: true })).toBeVisible();
    // Focus the Where field and fire the shortcut mid-typing: nothing may move.
    const where = page.getByRole('textbox', { name: 'Where' });
    await where.click();
    await where.pressSequentially('Shoot');
    await page.keyboard.press(`${mod}+Alt+N`);
    await expect(page.getByRole('heading', { name: 'Log Session', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeHidden();
    await expect(where).toHaveValue('Shoot');
  });

  test('shortcuts stay quiet under an open modal sheet', async ({ page }) => {
    await seedDemo(page);
    const mod = await primaryMod(page);
    // Dirty form → menu exit → the Discard sheet is up with a parked navigation.
    await page.keyboard.press(`${mod}+Alt+N`);
    const where = page.getByRole('textbox', { name: 'Where' });
    await where.click();
    await where.pressSequentially('Take Aim');
    await (await openMenu(page, 'Go')).getByRole('menuitem', { name: 'Home', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();
    // A shortcut now must NOT swap the parked navigation out from under the question.
    await page.keyboard.press(`${mod}+,`);
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    // The sheet's own answer wins: we land on Home, never Settings.
    await expect(page.getByRole('main').getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeHidden();
  });

  test('menu navigation respects the unsaved-edits guard (F3 parity)', async ({ page }) => {
    await seedDemo(page);
    await page.keyboard.press(`${await primaryMod(page)}+Alt+N`);
    const where = page.getByRole('textbox', { name: 'Where' });
    await where.click();
    await where.pressSequentially('Take Aim');
    // Leaving through the menu must ask first, exactly like the sidebar.
    const go = await openMenu(page, 'Go');
    await go.getByRole('menuitem', { name: 'Home', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(where).toHaveValue('Take Aim');
    // Discarding then really leaves.
    const go2 = await openMenu(page, 'Go');
    await go2.getByRole('menuitem', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page.getByRole('main').getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible();
  });

  test('View > Hide Sidebar hides it, persists across reload, and Show brings it back', async ({ page }) => {
    await seedDemo(page);
    const sidebar = page.getByRole('navigation', { name: 'Main' });
    await expect(sidebar).toBeVisible();
    await (await openMenu(page, 'View')).getByRole('menuitem', { name: 'Hide Sidebar' }).click();
    await expect(sidebar).toBeHidden();
    // The preference survives a reload (View > Show Sidebar is always the way back).
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
    await (await openMenu(page, 'View')).getByRole('menuitem', { name: 'Show Sidebar' }).click();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });

  test('menubar is fully keyboard-operable (arrows, Enter, Esc)', async ({ page }) => {
    await seedDemo(page);
    // Tab reaches the menubar's first button (FirearmLog), arrows walk it.
    await bar(page).getByRole('menuitem', { name: 'FirearmLog', exact: true }).focus();
    await page.keyboard.press('ArrowRight'); // File
    await page.keyboard.press('ArrowRight'); // Go
    await page.keyboard.press('ArrowDown');  // open Go, focus first item (Home)
    await expect(page.getByRole('menu', { name: 'Go', exact: true })).toBeVisible();
    await page.keyboard.press('ArrowDown');  // Log
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main').getByRole('heading', { name: 'Log' })).toBeVisible();
    await expect(page.getByRole('menu', { name: 'Go', exact: true })).toBeHidden();
  });
});
