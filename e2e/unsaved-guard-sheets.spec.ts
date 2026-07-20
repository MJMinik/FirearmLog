import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedDemo, gotoSection } from './helpers';

// Feature 1 — universal unsaved-changes guard on SHEET-hosted forms.
// Policy (Michael, July 20 2026): every dismiss gesture on a form sheet — a
// backdrop tap, Esc, and the X close button — asks "Discard changes?" when
// the sheet is dirty, and dismisses instantly when it isn't. This spec covers
// the Sheet.tsx `dirty` prop wired to a Photo caption/notes edit. The
// screen-form parity (browser Back / tab-bar) is already covered by
// interaction-safety.spec.ts for the record forms; the gear forms newly
// wired in this batch (GunForm, AmmoForm, PurchaseForm, etc.) are covered
// below through GunForm as the representative smoke.

// A 1×1 red PNG — the smallest legal image the file input will accept.
// Attaching this to a gun through the real UI gives us a deterministic
// PhotoSheet to open (avoids any race with demo-dataset media restore).
const TINY_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

/** Attach a tiny photo to the FIRST gun in the demo through the real UI, then
 *  open its PhotoSheet — deterministic across runs. */
async function openGunPhotoSheet(page: Page): Promise<void> {
  await gotoSection(page, 'Guns');
  // Open the first gun's detail card (the list rows end in the › chevron).
  const guns = page.getByRole('main').locator('button.row-tap, .gun-row');
  await guns.first().click();
  await expect(page.getByRole('heading', { name: 'Photos' })).toBeVisible();

  // The Photos card has a hidden <input type="file"> triggered by "+ Add
  // Photos". setInputFiles goes straight to the input regardless of visibility.
  const photoCard = page.getByRole('main').locator('.card', {
    has: page.getByRole('heading', { name: 'Photos' })
  });
  const fileInput = photoCard.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: 'guard-test.png', mimeType: 'image/png', buffer: TINY_PNG_BYTES,
  });

  // The new thumb shows up in the Photos card; tap it to open the PhotoSheet.
  await photoCard.locator('.thumb-tap').first().click();
  await expect(page.getByRole('dialog', { name: 'Photo' }).first()).toBeVisible();
}

test.describe('Sheet-hosted form: photo caption edit is guarded', () => {
  test('a dirty PhotoSheet backdrop-tap asks "Discard changes?"; Keep editing preserves the text', async ({ page }) => {
    await seedDemo(page);
    await openGunPhotoSheet(page);
    const photoSheet = page.getByRole('dialog', { name: 'Photo' }).first();

    // Type a caption change, then click the top of the backdrop (well above
    // the sheet card). The sheet mounts at bottom, so a click at (x, 20) lands
    // squarely on the backdrop for the "down + up on backdrop" close rule.
    await photoSheet.getByLabel('Caption').fill('unsaved caption edit');
    await page.locator('.sheet-backdrop').first().click({ position: { x: 50, y: 20 }, force: true });

    const discard = page.getByRole('dialog', { name: 'Discard changes?' }).first();
    await expect(discard).toBeVisible();

    // Keep editing → the PhotoSheet is still there with the edited text intact.
    await discard.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByRole('dialog', { name: 'Discard changes?' })).toHaveCount(0);
    await expect(photoSheet.getByLabel('Caption')).toHaveValue('unsaved caption edit');
  });

  test('Escape on a dirty PhotoSheet asks "Discard changes?"', async ({ page }) => {
    await seedDemo(page);
    await openGunPhotoSheet(page);
    const photoSheet = page.getByRole('dialog', { name: 'Photo' }).first();

    await photoSheet.getByLabel('Caption').fill('another edit');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Discard changes?' })).toBeVisible();

    // Discard → sheet closes.
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByRole('dialog', { name: 'Photo' })).toHaveCount(0);
  });

  test('a pristine PhotoSheet dismisses instantly on backdrop tap (no confirm)', async ({ page }) => {
    await seedDemo(page);
    await openGunPhotoSheet(page);
    await expect(page.getByRole('dialog', { name: 'Photo' }).first()).toBeVisible();

    // No edits — backdrop tap closes with no confirm.
    await page.locator('.sheet-backdrop').first().click({ position: { x: 50, y: 20 }, force: true });
    await expect(page.getByRole('dialog', { name: 'Discard changes?' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Photo' })).toHaveCount(0);
  });
});

test.describe('Feature 2 — photo lightbox opens/closes', () => {
  test('tapping the sheet image opens the full-screen viewer; the X closes it', async ({ page }) => {
    await seedDemo(page);
    await openGunPhotoSheet(page);
    const photoSheet = page.getByRole('dialog', { name: 'Photo' }).first();

    await photoSheet.getByRole('button', { name: 'Open photo full screen' }).click();

    const closeX = page.getByRole('button', { name: 'Close full-screen view' });
    await expect(closeX).toBeVisible();

    await closeX.click();
    await expect(closeX).toHaveCount(0);
    // The photo sheet is still there behind it.
    await expect(photoSheet).toBeVisible();
  });
});

test.describe('Screen-form guard newly wired for gear forms', () => {
  // Feature 1 also wired the smaller gear forms (GunForm, AmmoForm, etc.) into
  // App's shared discard guard. GunForm is the representative smoke here: a
  // typed name marks it dirty, the ‹ Cancel button asks first, browser Back
  // asks first, a pristine form leaves silently.
  test('a dirty New Gun form guards ‹ Cancel; pristine leaves silently', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Guns');
    await page.getByRole('main').getByRole('button', { name: '+ Add Gun' }).click();
    await expect(page.getByRole('heading', { name: 'New Gun' })).toBeVisible();

    // Pristine: ‹ Cancel leaves instantly.
    await page.getByRole('main').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'New Gun' })).toHaveCount(0);

    // Dirty: type a name, then ‹ Cancel → discard confirm.
    await page.getByRole('main').getByRole('button', { name: '+ Add Gun' }).click();
    await expect(page.getByRole('heading', { name: 'New Gun' })).toBeVisible();
    await page.getByLabel('What this Gun is called').fill('Sig Sauer Test');
    await page.getByRole('main').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();

    // Keep editing → back on the form with the text intact.
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByLabel('What this Gun is called')).toHaveValue('Sig Sauer Test');

    // ‹ Cancel again → Discard → leaves.
    await page.getByRole('main').getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByRole('heading', { name: 'New Gun' })).toHaveCount(0);
  });

  test('a dirty New Gun form guards the browser Back button (App F3 wiring)', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Guns');
    await page.getByRole('main').getByRole('button', { name: '+ Add Gun' }).click();
    await expect(page.getByRole('heading', { name: 'New Gun' })).toBeVisible();
    await page.getByLabel('What this Gun is called').fill('Half-Entered Gun');

    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByLabel('What this Gun is called')).toHaveValue('Half-Entered Gun');

    await page.goBack();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByRole('heading', { name: 'New Gun' })).toHaveCount(0);
  });
});


// ---------------------------------------------------------------------------
// AUDIT FIXES (July 20 2026): edit-mode false-positive was HIGH.
// useDirtyTracker used to seed its baseline on first render — BEFORE async
// getOne() populated fields — so opening ANY existing record for edit and
// tapping Cancel immediately would fire "Discard changes?" on a clean form.
// The hook now takes a `ready` flag; edit forms flip it once the load settles.
// These specs are the machine check on GunForm as the representative surface.
// ---------------------------------------------------------------------------

test.describe('edit-mode dirty gate (audit fix)', () => {
  test('opening an existing gun for edit and tapping Cancel immediately: NO discard sheet', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Guns');
    // Open the first gun in the demo list.
    const guns = page.getByRole('main').locator('button.row-tap, .gun-row');
    await guns.first().click();
    // The gun-detail screen has an "Edit" button in the navbar.
    await page.getByRole('main').getByRole('button', { name: 'Edit', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Edit Gun' })).toBeVisible();
    // Immediately Cancel — no field touched, no confirm should appear.
    await page.getByRole('main').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Edit Gun' })).toHaveCount(0);
  });

  test('editing an existing gun name, then Cancel: discard sheet, Keep editing preserves', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Guns');
    const guns = page.getByRole('main').locator('button.row-tap, .gun-row');
    await guns.first().click();
    await page.getByRole('main').getByRole('button', { name: 'Edit', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Edit Gun' })).toBeVisible();
    // Change the name — now the form is genuinely dirty.
    const nameField = page.getByLabel('What this Gun is called');
    // Wait for the async record load to populate the field BEFORE reading it —
    // otherwise `original` reads '' and the fill races the load (July 20 2026).
    await expect(nameField).not.toHaveValue('');
    const original = await nameField.inputValue();
    await nameField.fill(original + ' edited');
    await page.getByRole('main').getByRole('button', { name: 'Cancel' }).click();
    // Discard confirm appears; Keep editing brings us back with the edit intact.
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(nameField).toHaveValue(original + ' edited');
  });
});

// ---------------------------------------------------------------------------
// AUDIT FIX #4 (July 20 2026): Esc stacking. When the lightbox is open OVER
// a dirty PhotoSheet, Escape must close the LIGHTBOX only — not spawn the
// sheet's discard confirm. Previously the sheet listened on window and would
// race with the lightbox; now both share the module-level sheetStack, so
// only the top-most listener responds.
// ---------------------------------------------------------------------------

test.describe('lightbox Esc stacking + backdrop (audit fix)', () => {
  test('Escape above a dirty PhotoSheet closes the lightbox only; sheet stays', async ({ page }) => {
    await seedDemo(page);
    await openGunPhotoSheet(page);
    const photoSheet = page.getByRole('dialog', { name: 'Photo' }).first();
    // Make the sheet dirty first.
    await photoSheet.getByLabel('Caption').fill('dirty text');
    // Then open the lightbox on top.
    await photoSheet.getByRole('button', { name: 'Open photo full screen' }).click();
    const closeX = page.getByRole('button', { name: 'Close full-screen view' });
    await expect(closeX).toBeVisible();
    // Escape closes ONLY the lightbox; the sheet's discard confirm should NOT appear.
    await page.keyboard.press('Escape');
    await expect(closeX).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Discard changes?' })).toHaveCount(0);
    // The sheet is still there with the edit intact.
    await expect(photoSheet).toBeVisible();
    await expect(photoSheet.getByLabel('Caption')).toHaveValue('dirty text');
  });

  test('backdrop tap on the lightbox closes it (sheet behind remains open)', async ({ page }) => {
    await seedDemo(page);
    await openGunPhotoSheet(page);
    const photoSheet = page.getByRole('dialog', { name: 'Photo' }).first();
    await photoSheet.getByRole('button', { name: 'Open photo full screen' }).click();
    const closeX = page.getByRole('button', { name: 'Close full-screen view' });
    await expect(closeX).toBeVisible();
    // Tap the backdrop area at the top-left safe corner well outside the media.
    await page.locator('.lightbox-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(closeX).toHaveCount(0);
    await expect(photoSheet).toBeVisible();
  });
});
