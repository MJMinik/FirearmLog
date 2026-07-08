import { test, expect } from '@playwright/test';
import { seedDemo, gotoSection } from './helpers';

// The sync surface speaks range language, not Git: "Save to File" / "Load from
// File" (renamed from Push/Pull, July 8 2026 — a real user asked what "push"
// meant). This guards the labels, the explainer, and the last-saved status
// line's absence until a save has actually happened on the device.

test('Sync & Backup offers Save to File / Load from File in plain words', async ({ page }) => {
  await seedDemo(page);
  await gotoSection(page, 'Sync & Backup');

  await expect(page.getByRole('heading', { name: 'Sync & Backup' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save to File' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load from File' })).toBeVisible();
  // The explainer says plainly that the file is the backup.
  await expect(page.getByText('That file is your backup', { exact: false })).toBeVisible();
  // No Git-speak anywhere on the screen.
  await expect(page.getByRole('main')).not.toContainText(/Push|Pull/);
  // Sample data was loaded, not saved-to-file, so no last-saved line yet.
  await expect(page.getByText('Last saved to the file', { exact: false })).toHaveCount(0);
});
