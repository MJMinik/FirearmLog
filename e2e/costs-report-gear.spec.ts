import { test, expect, type Page } from '@playwright/test';
import { seedDemo, isDesktop } from './helpers';

// THE PRINTABLE COSTS REPORT NOW CARRIES BOTH PER-GUN ANSWERS (Michael, 27 Aug
// 2026). The screen has a checkbox; a printed page cannot, so the report prints
// "Ammo & fees per gun" and "Gun & gear cost per gun" one under the other.
//
// This is the only test that can reach costsReport at all: its module imports a
// .tsx file, so the node unit runner refuses to load it. The arithmetic itself
// is covered directly in tests/costing.test.ts against gunOwnershipSpend; what
// is proved HERE is the wiring, and one piece of that wiring is genuinely new --
// the report bundle never loaded optics until now, so a gun's optic price could
// only reach the printed page if that load was added and used.

const REC = { createdAt: 1, updatedAt: 1 };

/** Seed a gun with a price, an optic on it, and a gear purchase linked to it. */
async function seedOwnedGun(page: Page, name: string): Promise<void> {
  await page.evaluate(async ({ gunName, rec }) => {
    await new Promise<void>((resolve, reject) => {
      const o = indexedDB.open('firearmlog');
      o.onerror = () => reject(o.error);
      o.onsuccess = () => {
        const db = o.result;
        const tx = db.transaction(['firearms', 'optics', 'purchases'], 'readwrite');
        tx.objectStore('firearms').put({
          ...rec, id: 'fa-report-e2e', name: gunName, manufacturer: '', model: '', caliber: '9mm',
          category: 'Pistol', serialNumber: null, dateAcquired: '', startingRoundCount: 0,
          photoIds: [], referenceId: null, notes: '', pricePaid: 500,
        });
        tx.objectStore('optics').put({
          ...rec, id: 'op-report-e2e', firearmId: 'fa-report-e2e', make: 'Test', model: 'Dot',
          installDate: '', dotSize: '', zeroDist: '', mountHeight: '', torqueSpec: '',
          settingsSnapshot: '', batteryLog: [], notes: '', pricePaid: 300,
        });
        tx.objectStore('purchases').put({
          ...rec, id: 'pu-report-e2e', date: '2026-03-04', category: 'Gear / Equipment',
          item: 'Report holster', vendor: '', cost: 75, notes: '', firearmId: 'fa-report-e2e',
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { gunName: name, rec: REC });
}

test('the printed Costs report carries the gun & gear table, optic price included', async ({ page, context }) => {
  // Desktop only, and deliberately: the report is launched here through the
  // menu bar, which is the path menubar.spec.ts already proves works for a
  // printable report, and the menu bar does not exist at phone width. The page
  // it prints is identical either way -- it is a static HTML document built from
  // the same bundle -- so a second viewport would re-run the same builder
  // against the same data and prove nothing new.
  test.skip(!isDesktop(page), 'the menu-bar launch path is desktop-only');

  await seedDemo(page);
  const gunName = 'Report Gear Gun';
  await seedOwnedGun(page, gunName);
  await page.reload();

  await page.getByRole('menubar').getByRole('menuitem', { name: 'Reports', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Reports', exact: true });
  const [report] = await Promise.all([
    context.waitForEvent('page'),
    menu.getByRole('menuitem', { name: 'Costs', exact: true }).click(),
  ]);
  await report.waitForLoadState('domcontentloaded');
  await expect(report.locator('body')).toContainText(/gun & gear cost per gun/i, { timeout: 15_000 });

  // LOWERCASED ON PURPOSE. The print stylesheet sets text-transform: uppercase
  // on section headings, and innerText returns the RENDERED text, so a
  // case-sensitive match against the source string fails on a page that is
  // completely correct. Matching case-insensitively keeps the assertion about
  // the content rather than about the CSS.
  const body = (await report.locator('body').innerText()).replace(/\s+/g, ' ').toLowerCase();

  // Both tables are present and each says what it counts.
  expect(body).toContain('ammo & fees per gun');
  expect(body).toContain('gun & gear cost per gun');
  expect(body).toContain('range fees and match fees are not counted here');

  // The seeded gun has no sessions and no matches, so it has NOTHING in the
  // ammo-and-fees table and a real total in the gear table. That asymmetry is
  // what proves the two tables are actually different reads rather than the same
  // one printed twice.
  const gearHeadingAt = body.indexOf('gun & gear cost per gun');
  const beforeGear = body.slice(0, gearHeadingAt);
  const gearOnwards = body.slice(gearHeadingAt);
  expect(beforeGear).not.toContain(gunName.toLowerCase());
  expect(gearOnwards).toContain(gunName.toLowerCase());

  // 500 gun + 300 optic + 75 gear = 875, and the optic is the piece that could
  // only arrive if the report bundle really does load optics now.
  expect(gearOnwards).toContain('$500.00');
  expect(gearOnwards).toContain('$300.00');
  expect(gearOnwards).toContain('$75.00');
  expect(gearOnwards).toContain('$875.00');

  await report.close();
});
