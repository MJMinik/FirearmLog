import { test, expect } from '@playwright/test';
import { seedDemo, gotoSection } from './helpers';

// Send Feedback (Michael's yes on 18 Sep 2026 to the board's build-gap memo; the row had waited since July because support@ had no mailbox until decision 58): a small section at the
// end of the Help screen (Tour & Setup) — a plain mailto link, not
// deliverFile's blob-download router, since a mailto: link never navigates
// the installed iOS PWA's webview away the way a blob download does (see
// src/ui/deliverFile.ts and the comment above the section in HelpScreen.tsx).

test.describe('Send Feedback (Help screen)', () => {
  test('the section is visible with the right heading and mailto link', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Tour & Setup');

    await expect(page.getByRole('heading', { name: 'Send Feedback' })).toBeVisible();

    const link = page.getByRole('link', { name: 'Email support@firearmlog.com' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute(
      'href',
      'mailto:support@firearmlog.com?subject=FirearmLog%20feedback',
    );
  });
});
