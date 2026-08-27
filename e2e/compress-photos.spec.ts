import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoSection, nav, isDesktop } from './helpers';

// COMPRESS PHOTOS (Michael's decision of 25 Aug 2026, built 27 Aug).
//
// What used to be "Free Up Space" -- an always-visible row in App & Data leading
// to a screen of its own -- is now a "Compress Photos" card living inside
// Sync & Backup, which renders nothing at all unless some stored photo is still
// full size.
//
// THE TRAP THIS FILE IS WRITTEN AGAINST. Two of the three obvious assertions
// here pass whether or not the feature works, because they assert that things
// are ABSENT: the old row is gone, and the card is hidden on a clean log. A
// suite made only of those would stay green if the card could never appear at
// all. So the load-bearing test is the third one, which seeds a genuinely
// oversized photo and proves the card shows up -- and it is red-proofed by
// deleting the card from SyncScreen, which turns it and nothing else red.

const OVERSIZE_BYTES = 1_200_000;

/** Put one genuinely oversized image record in the log, the way an old import would have. */
async function seedOversizedPhoto(page: Page, bytes: number): Promise<void> {
  await page.evaluate(async (size) => {
    await new Promise<void>((resolve, reject) => {
      const o = indexedDB.open('firearmlog');
      o.onerror = () => reject(o.error);
      o.onsuccess = () => {
        const db = o.result;
        const tx = db.transaction('media', 'readwrite');
        tx.objectStore('media').put({
          id: 'me-oversize-e2e', createdAt: 1, updatedAt: 1,
          ownerType: 'firearm', ownerId: 'whatever', kind: 'image',
          name: 'old-full-size.jpg', annotations: [], mime: 'image/jpeg',
          data: new ArrayBuffer(size),
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, bytes);
}

test.describe('Compress Photos', () => {
  test('the old "Free Up Space" row is gone from App & Data', async ({ page }) => {
    await seedDemo(page);
    if (isDesktop(page)) {
      await expect(nav(page).getByRole('button', { name: 'Sync & Backup' })).toBeVisible();
      await expect(nav(page).getByRole('button', { name: 'Free Up Space' })).toHaveCount(0);
    } else {
      await nav(page).getByRole('button', { name: 'More' }).first().click();
      const main = page.getByRole('main');
      await expect(main.getByRole('button', { name: 'Sync & Backup' })).toBeVisible();
      await expect(main.getByRole('button', { name: 'Free Up Space' })).toHaveCount(0);
    }
  });

  test('with nothing to compress, Sync & Backup shows no card at all', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Sync & Backup');
    await expect(page.getByRole('heading', { name: 'Sync & Backup' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Compress Photos' })).toHaveCount(0);
  });

  // THE LOAD-BEARING ONE.
  test('one full-size photo makes the card appear on Sync & Backup, below Save to File', async ({ page }) => {
    await seedDemo(page);
    await seedOversizedPhoto(page, OVERSIZE_BYTES + 50_000);

    // Reload so the card's mount probe runs against the seeded record.
    await page.reload();
    await gotoSection(page, 'Sync & Backup');

    const card = page.getByRole('heading', { name: 'Compress Photos' });
    await expect(card).toBeVisible();
    await expect(page.getByRole('button', { name: 'Compress Photos' })).toBeVisible();

    // Position is part of the decision, not decoration: the card's own copy
    // tells the shooter to use "Save to File above" first, and that sentence is
    // only true if Save to File really is above it.
    const order = await page.evaluate(() => {
      const main = document.querySelector('main, [role="main"]');
      const heads = Array.from(main?.querySelectorAll('h2') ?? []).map((h) => (h.textContent || '').trim());
      return heads;
    });
    const sync = order.findIndex((h) => /sync|backup|save/i.test(h));
    const compress = order.indexOf('Compress Photos');
    expect(compress, 'the Compress Photos card must be on this screen').toBeGreaterThan(-1);
    expect(sync, 'a Sync/Backup card must be on this screen too').toBeGreaterThan(-1);
    expect(compress).toBeGreaterThan(sync);
  });

  test('a photo just UNDER the threshold does not summon the card', async ({ page }) => {
    // The boundary, so "the card appears" can never be a test that fires on any
    // photo at all.
    await seedDemo(page);
    await seedOversizedPhoto(page, OVERSIZE_BYTES - 50_000);
    await page.reload();
    await gotoSection(page, 'Sync & Backup');
    await expect(page.getByRole('heading', { name: 'Sync & Backup' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Compress Photos' })).toHaveCount(0);
  });
});
