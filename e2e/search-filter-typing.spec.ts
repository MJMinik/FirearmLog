import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Tester-2 F1 (July 16 2026): regression guard for the Sheet focus-trap bug.
// The Log Search & Filter box lives inside a Sheet whose focus-trap effect used
// `[onClose]` deps; each keystroke updated the parent's filter state → re-render
// → fresh onClose identity → the effect tore down (refocusing the trigger) and
// re-ran (focusing the sheet's Close button), so the input lost focus on every
// keystroke and iOS dropped the keyboard. The fix holds onClose in a ref and
// runs the trap ONCE per mount.
//
// This MUST type key-by-key — Playwright's fill() sets the value in one shot and
// never triggers the per-keystroke re-render that exposed the bug, so it would
// pass even against the broken code. pressSequentially reproduces real typing.

test.describe('Search & Filter typing keeps focus', () => {
  test('typing into the search box does not lose focus per keystroke', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');

    await page.getByRole('button', { name: /Search & Filter/ }).click();

    const dialog = page.getByRole('dialog', { name: 'Search & Filter' });
    await expect(dialog).toBeVisible();
    const search = dialog.getByRole('searchbox');
    await search.click();
    await expect(search).toBeFocused();

    // Key-by-key, as a person types. On the broken code the input loses focus
    // after the first keystroke, so subsequent characters never land.
    await search.pressSequentially('gdt', { delay: 60 });

    // Focus stayed on the input AND every character was captured.
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('gdt');
  });
});
