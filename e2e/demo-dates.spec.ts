import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab, gotoSection } from './helpers';

// Demo date shift (session 132, DEMO_SHIFT_SPEC_S132.md). The shipped demo
// bin's dates are fixed at generation time; src/lib/demoShift.ts slides them
// forward at load time so the log always ends "about a week ago", whenever
// it's loaded — which is the only way the maintenance forecast's 90-day
// evidence window (forecast.ts) can ever have anything to look at in the
// sample data. This spec proves the shift actually reaches the app: the
// forecast line appears where it's supposed to (Gun Maintenance), stays off
// the one surface it's deliberately excluded from (Home — mirroring
// maint-forecast.spec.ts's own Home assertion), and the Log screen's newest
// entry reads as recent rather than the bin's original fixed era.
//
// No hardcoded dates or years anywhere below — the whole point of the
// feature is that it keeps working for as long as the codebase does, so the
// assertions are written relative to whatever "now" the test happens to run
// under, exactly like maint-forecast.spec.ts's own runtime-relative dates.

/** Either forecast copy shape forecastLine can produce (forecast.ts) — the
 * anchored "At your recent pace, due roughly ..." range, or the far-future
 * "Months away at your recent pace" fallback. Matches maint-forecast.spec.ts's
 * ANY_FORECAST in spirit, but ORs in the months-away literal too since this
 * spec doesn't know (or care) which of the two shapes the shifted demo data
 * happens to land in — only that some gun's forecast is showing at all. */
const FORECAST_TEXT = /At your recent pace|Months away at your recent pace/;

/** The leading "Mon D, YYYY" (formatDayKey, src/lib/dates.ts) at the start of
 * a session row's label. */
const ROW_DATE_RE = /^([A-Za-z]{3} \d{1,2}, \d{4})/;

test.describe('demo date shift reaches the app', () => {
  test('forecast text shows on Gun Maintenance, stays off Home, and the Log screen reads as recent', async ({ page }) => {
    // Step 1: fresh app -> Setup Wizard -> "See a log 18 months in" -> loaded.
    // A brand-new install has no data yet, so loadDemo() runs straight away
    // with no confirm step (SetupWizard.demoTapped only asks first when there
    // is something to overwrite) — seedDemo already waits for that load to
    // finish and land on Home.
    await seedDemo(page);

    // Step 2: Gun Maintenance shows real forecast copy now that the shifted
    // dates clear the evidence gate (proven directly, against the shipped
    // bin, by tests/demoShift.test.ts's "evidence gate opens" case).
    await gotoSection(page, 'Gun Maintenance');
    const main = page.getByRole('main');
    await expect(main.getByText(FORECAST_TEXT).first()).toBeVisible();

    // Step 3: Home stays a measured-facts surface — no forecast copy there,
    // case-insensitively, mirroring maint-forecast.spec.ts's own Home check.
    await gotoTab(page, 'Home');
    await expect(page.getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible();
    await expect(page.getByText(/at your recent pace/i)).toHaveCount(0);

    // Step 4: the Log screen's newest entry (sessions render newest-first —
    // see screens.tsx's "Newest first, like everywhere") reads as recent, not
    // the bin's original fixed era. Asserted relatively (parses within 21
    // days of the test's own clock — see the tolerance note below) rather
    // than against a literal year, so this keeps passing regardless of what
    // year it actually runs in.
    await gotoTab(page, 'Log');
    const sessionsCard = page.locator('.card').filter({
      has: page.getByRole('heading', { name: 'All Sessions', exact: true }),
    });
    await expect(sessionsCard).toBeVisible();
    const newestRow = sessionsCard.locator('.row-tap').first();
    await expect(newestRow).toBeVisible();
    const rowText = (await newestRow.innerText()).trim();
    const match = ROW_DATE_RE.exec(rowText);
    expect(match, `expected the newest session row to start with a rendered date, got: ${JSON.stringify(rowText)}`).not.toBeNull();
    const newestMs = new Date(match![1]).getTime();
    expect(Number.isNaN(newestMs), `could not parse rendered date ${JSON.stringify(match![1])}`).toBe(false);
    // 21 days, not the forecast's 90 (cold-audit finding 4): the shift lands
    // the newest record 7–14 days back, so 21 gives margin for date-parse and
    // timezone fuzz while staying far below any stale gap an unshifted bin
    // could show — a 90-day tolerance would have passed on the UNSHIFTED bin
    // for the first three months after each regeneration, proving nothing.
    const toleranceMs = 21 * 24 * 60 * 60 * 1000;
    expect(Math.abs(Date.now() - newestMs)).toBeLessThanOrEqual(toleranceMs);
  });
});
