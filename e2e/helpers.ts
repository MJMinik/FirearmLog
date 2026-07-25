import { type Page, type Locator, expect } from '@playwright/test';

// Shared helpers so specs read like a user's intent, not a pile of selectors.
// The app has two nav layouts: a desktop sidebar (>=900px) where every section
// is a direct link, and a phone layout where sections live under the "More" tab.
// These helpers paper over that difference so a single spec runs on both.

export function isDesktop(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= 900;
}

/** The main navigation (bottom tab bar on phone, sidebar on desktop). */
export function nav(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Main' });
}

/** Go to one of the top-level tabs: Home, Log, Compete, Progress. */
export async function gotoTab(page: Page, name: string): Promise<void> {
  await nav(page).getByRole('button', { name }).first().click();
}

/**
 * Go to a "Data & Gear" section (Guns, Optics, Ammo, ...) or Tour & Setup.
 * On desktop these are sidebar links; on phone they live under the More tab.
 */
export async function gotoSection(page: Page, name: string): Promise<void> {
  if (isDesktop(page)) {
    await nav(page).getByRole('button', { name }).first().click();
  } else {
    await nav(page).getByRole('button', { name: 'More' }).first().click();
    await page.getByRole('main').getByRole('button', { name }).first().click();
  }
}

/**
 * Simulate a left swipe on a list row (a SwipeRow) to reveal its Delete action.
 * Dispatches real touch events in-page, so it works headlessly without relying
 * on Playwright's pointer timing. `row` is the `.swipe-row` element.
 */
export async function swipeRowLeft(row: Locator): Promise<void> {
  await row.evaluate(async (el) => {
    const front = (el.querySelector('.swipe-front') as HTMLElement) ?? (el as HTMLElement);
    const r = front.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const x0 = r.left + r.width - 16;
    const mk = (x: number) => new Touch({ identifier: 1, target: front, clientX: x, clientY: y });
    const fire = (type: string, x: number, end = false) =>
      front.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: end ? [] : [mk(x)], changedTouches: [mk(x)],
      }));
    // A tick between events lets React flush its state (drag/axis) and re-render,
    // so by touchend the handler sees the full -130px drag and opens the row.
    const tick = () => new Promise((res) => setTimeout(res, 20));
    fire('touchstart', x0); await tick();
    fire('touchmove', x0 - 24); await tick();
    fire('touchmove', x0 - 130); await tick();
    fire('touchend', x0 - 130, true); await tick();
  });
}

/**
 * Ensure the Guns & Rounds section is open. Safe to call when already open.
 *
 * H-1 (session 78 audit) removed the auto-collapse that used to fire the
 * moment the first gun was toggled on — a NEW session's Guns & Rounds now
 * stays open through the pick. An EXISTING session still loads collapsed
 * (unrelated, unchanged behavior — the load effect always starts it closed),
 * so editing-a-saved-session flows still need to open it before touching
 * rounds/mags. Call sites on the new-session path no longer need this at all.
 */
export async function openGunsSection(page: Page): Promise<void> {
  const disclosure = page.getByTestId('session-guns-disclosure');
  await expect(disclosure).toBeVisible();
  // The load effect that seeds an existing session (and collapses this
  // section) can still be settling when this runs — React StrictMode
  // double-invokes it, and a contended IndexedDB can leave it resolving
  // after our click, re-closing the section a beat later. Retry the
  // click-then-verify until the open state actually holds, not just a
  // single instant.
  await expect(async () => {
    if ((await disclosure.getAttribute('aria-expanded')) === 'false') await disclosure.click();
    await new Promise((r) => setTimeout(r, 50));
    expect(await disclosure.getAttribute('aria-expanded')).toBe('true');
  }).toPass({ timeout: 10_000 });
}

/**
 * Seed a fresh install with the bundled demo dataset via the in-app one-tap
 * loader — exactly what a tester does. Leaves the app on Home with data.
 */
export async function seedDemo(page: Page): Promise<void> {
  await page.goto('/');
  // An empty log auto-opens the Setup Wizard.
  const demoBtn = page.getByRole('button', { name: 'See a log 18 months in' });
  await expect(demoBtn).toBeVisible();
  await demoBtn.click();
  // Once the restore finishes we land on Home, which shows live stats.
  await expect(page.getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Live-fire rounds')).toBeVisible();
}
