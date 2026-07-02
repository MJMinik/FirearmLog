import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab, gotoSection } from './helpers';

// The debrief's "How the numbers work ›" link deep-links into the wiki AT the
// section for that match's scoring type (Steel -> the Steel Challenge card, not the
// top of the page). This regressed intermittently once: a scroll-to-top on open
// raced the section scroll, so the link sometimes dumped a Steel shooter at the
// USPSA section up top. This test pins the behaviour: after clicking, the Steel
// section must be in view and the first (USPSA) section must be scrolled past.
//
// We log a minimal Steel match so we land straight on its debrief, then click the link.

test.describe('Wiki deep-link from the debrief', () => {
  test('Steel debrief "How the numbers work" lands on the Steel section, not the top', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');

    await page.getByRole('button', { name: '+ Log Match' }).click();
    await page.getByLabel('What this Match is called').fill('Deep-link Test');
    await page.getByLabel('Match type').selectOption('Steel Challenge');

    await page.getByRole('button', { name: '+ Add Stage' }).click();
    const block = page.locator('.drill-edit').first();
    await block.getByLabel('String 1 time (s)').fill('3.00');
    await block.getByLabel('String 2 time (s)').fill('3.50');
    await block.getByLabel('String 3 time (s)').fill('4.00');
    await block.getByLabel('String 4 time (s)').fill('4.50');
    await block.getByLabel('String 5 time (s)').fill('6.00');

    await page.getByRole('button', { name: 'Save Match' }).click();
    await expect(page.getByRole('heading', { name: 'Deep-link Test' })).toBeVisible();

    // Follow the in-context deep-link from the Steel stage-times card.
    await page.getByRole('button', { name: /How the numbers work/ }).first().click();

    // The wiki opens; the Steel section (#steel) must be scrolled into view, and the
    // first section at the top of the page (#uspsa) must NOT be — i.e. it deep-linked
    // to the section rather than landing at the top.
    await expect(page.getByRole('heading', { name: 'How the numbers work' })).toBeVisible();
    await expect(page.locator('#steel')).toBeInViewport();
    await expect(page.locator('#uspsa')).not.toBeInViewport();
  });

  // Regression guard for the UN-sectioned path: the fix only skips the snap-to-top when
  // a section is set, so opening the wiki from the nav (no section) must STILL land at
  // the top. Pins that the change didn't quietly break the ordinary open.
  test('the nav "How the numbers work" (no section) still lands at the top', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'How the numbers work');

    await expect(page.getByRole('heading', { name: 'How the numbers work' })).toBeVisible();
    // No section target -> the first section (USPSA hit factor) is at the top, in view.
    await expect(page.locator('#uspsa')).toBeInViewport();
  });

  // The Compete "Classification" card deep-links into the wiki's Classification section
  // (the most-asked "what do I need for B?" question). Same section-scroll mechanism.
  test('Compete "How the numbers work" lands on the Classification section', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');

    // The only "How the numbers work" link on Compete is the one on the Classification card.
    await page.getByRole('button', { name: /How the numbers work/ }).first().click();

    await expect(page.getByRole('heading', { name: 'How the numbers work' })).toBeVisible();
    await expect(page.locator('#classification')).toBeInViewport();
    // It deep-linked to the section, not the top of the page.
    await expect(page.locator('#uspsa')).not.toBeInViewport();
  });
});
