import { test, expect } from '@playwright/test';
import { seedDemo, gotoSection } from './helpers';

// App 1 — attach a printable target image to a drill, end to end in a real
// browser. Drives the actual file picker (a hidden <input type=file>), saves,
// and confirms the target shows back on the drill. Runs on desktop + phone.

// A tiny valid 1x1 PNG so the upload + canvas downscale path runs for real.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

test.describe('Drill targets (App 1)', () => {
  test('attach a target image to a drill, then see it on the drill', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Drills');

    // Make a fresh custom drill so the test is deterministic.
    await page.getByRole('button', { name: '+ Add Drill' }).click();
    await page.getByPlaceholder('Bill Drill').fill('E2E Target Drill');

    // Attach a target image via the Target field's (hidden) file input.
    await page.locator('input[type="file"]').setInputFiles({
      name: 'target.png', mimeType: 'image/png', buffer: PNG,
    });
    await expect(page.getByText('Tap to name')).toBeVisible(); // staged target shows

    await page.locator('.navbar-action').click(); // Save

    // Back on the drill library — open the drill and confirm its target shows.
    const row = page.getByRole('button', { name: /E2E Target Drill/ });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.locator('.thumb-wrap').first()).toBeVisible();
  });
});
