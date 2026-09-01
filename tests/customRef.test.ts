import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRefLookup, isCustomRefId, suggestReferenceMatch, toEntry } from '../src/lib/referenceData.ts';
import { maintenanceStatus } from '../src/lib/maintenance.ts';
import type { Firearm, Reference } from '../src/lib/types.ts';

const customGuide: Reference = {
  id: 'refx-abc', createdAt: 0, updatedAt: 0,
  name: "Grandpa's 1911", category: 'Pistol',
  deepCleanRounds: 800, recoilSpringRounds: 2000,
  checklist: ['Wipe it down'], guidance: 'Treat her gently.',
  links: [{ label: 'example.com', url: 'https://example.com' }]
};

test('custom IDs are recognized', () => {
  assert.ok(isCustomRefId('refx-abc'));
  assert.ok(!isCustomRefId('ref-glock'));
  assert.ok(!isCustomRefId(null));
});

test('lookup serves both built-ins and custom guides', () => {
  const lookup = buildRefLookup([customGuide]);
  assert.equal(lookup('ref-glock')?.name, 'Glock');
  assert.equal(lookup('refx-abc')?.name, "Grandpa's 1911");
  assert.equal(lookup('refx-missing'), undefined);
  assert.equal(lookup(null), undefined);
});

test('suggestReferenceMatch: exact and near-exact manufacturer names', () => {
  assert.equal(suggestReferenceMatch('Glock', 'Pistol', [])?.id, 'ref-glock');
  assert.equal(suggestReferenceMatch('glock', 'Pistol', [])?.id, 'ref-glock'); // case-insensitive
  // "Atlas Gunworks" should find "Atlas Gunworks (2011)" despite the year suffix
  assert.equal(suggestReferenceMatch('Atlas Gunworks', 'Pistol', [])?.id, 'ref-atlas');
});

test('suggestReferenceMatch: parenthetical abbreviations match (BCM)', () => {
  assert.equal(suggestReferenceMatch('BCM', 'Rifle', [])?.id, 'ref-bcm');
  assert.equal(suggestReferenceMatch('Bravo Company', 'Rifle', [])?.id, 'ref-bcm');
});

test('suggestReferenceMatch: category disambiguates Smith & Wesson', () => {
  assert.equal(suggestReferenceMatch('Smith & Wesson', 'Pistol', [])?.id, 'ref-sw-pistol');
  assert.equal(suggestReferenceMatch('Smith & Wesson', 'Rifle', [])?.id, 'ref-sw-rifle');
  // Wrong category for this manufacturer's only guide -> no match
  assert.equal(suggestReferenceMatch('Mossberg', 'Pistol', []), null);
});

test('suggestReferenceMatch: no match for blank or unrecognized manufacturer', () => {
  assert.equal(suggestReferenceMatch('', 'Pistol', []), null);
  assert.equal(suggestReferenceMatch('   ', 'Pistol', []), null);
  assert.equal(suggestReferenceMatch('Some Random Maker', 'Pistol', []), null);
});

/* ---- Model-aware suggestion (decision 49, session 138). The first test below
   is the PROVE-FAIL for the whole change: on the pre-change matcher, "Ruger" in
   Rifle returned whichever Ruger guide sat first in the array (the centerfire
   one), model or no model — so a 10/22 owner got the centerfire guide and this
   assertion goes red on the old code. ---- */

test('suggestReferenceMatch: the model steers a Ruger rifle to the 10/22 guide', () => {
  assert.equal(suggestReferenceMatch('Ruger', 'Rifle', [], '10/22')?.id, 'ref-ruger-1022');
  assert.equal(suggestReferenceMatch('Ruger', 'Rifle', [], '10/22 Takedown')?.id, 'ref-ruger-1022');
  assert.equal(suggestReferenceMatch('Ruger', 'Rifle', [], '10-22 Carbine')?.id, 'ref-ruger-1022');
});

test('suggestReferenceMatch: no model, or a centerfire model, falls back to the general Ruger rifle guide', () => {
  assert.equal(suggestReferenceMatch('Ruger', 'Rifle', [])?.id, 'ref-ruger-rifle');
  assert.equal(suggestReferenceMatch('Ruger', 'Rifle', [], '')?.id, 'ref-ruger-rifle');
  assert.equal(suggestReferenceMatch('Ruger', 'Rifle', [], 'American Predator')?.id, 'ref-ruger-rifle');
  assert.equal(suggestReferenceMatch('Ruger', 'Rifle', [], 'AR-556')?.id, 'ref-ruger-rifle');
});

test('suggestReferenceMatch: S&W pistols split between centerfire and the SW22 Victory by model', () => {
  assert.equal(suggestReferenceMatch('Smith & Wesson', 'Pistol', [])?.id, 'ref-sw-pistol');
  assert.equal(suggestReferenceMatch('Smith & Wesson', 'Pistol', [], 'M&P 9 M2.0')?.id, 'ref-sw-pistol');
  assert.equal(suggestReferenceMatch('Smith & Wesson', 'Pistol', [], 'SW22 Victory')?.id, 'ref-sw22-victory');
  assert.equal(suggestReferenceMatch('Smith & Wesson', 'Pistol', [], 'Victory Target')?.id, 'ref-sw22-victory');
});

test('suggestReferenceMatch: the punctuation-blind compare treats 10/22, 10-22 and 1022 as one word', () => {
  assert.equal(suggestReferenceMatch('Ruger', 'Rifle', [], '1022')?.id, 'ref-ruger-1022');
  assert.equal(suggestReferenceMatch('Smith & Wesson', 'Rifle', [], 'M&P15-22 Sport')?.id, 'ref-sw-mp1522');
  assert.equal(suggestReferenceMatch('Smith & Wesson', 'Rifle', [], 'MP 15-22')?.id, 'ref-sw-mp1522');
});

test('suggestReferenceMatch: the new categories route — PCC and Revolver get their first guides', () => {
  assert.equal(suggestReferenceMatch('Ruger', 'PCC', [], 'PC Carbine')?.id, 'ref-ruger-pcc');
  assert.equal(suggestReferenceMatch('Ruger', 'PCC', [])?.id, 'ref-ruger-pcc'); // only Ruger PCC guide — model optional
  assert.equal(suggestReferenceMatch('JP Enterprises', 'PCC', [], 'GMR-15')?.id, 'ref-jp-gmr15');
  assert.equal(suggestReferenceMatch('Smith & Wesson', 'Revolver', [], 'Model 617')?.id, 'ref-sw-617');
  assert.equal(suggestReferenceMatch('Smith & Wesson', 'Revolver', [])?.id, 'ref-sw-617'); // only S&W revolver guide
});

test('suggestReferenceMatch: model-aware pistols — Mark IV and Buck Mark', () => {
  assert.equal(suggestReferenceMatch('Ruger', 'Pistol', [], 'Mark IV Target')?.id, 'ref-ruger-markiv');
  assert.equal(suggestReferenceMatch('Ruger', 'Pistol', [], 'MK IV 22/45 Lite')?.id, 'ref-ruger-markiv');
  assert.equal(suggestReferenceMatch('Browning', 'Pistol', [], 'Buck Mark Plus')?.id, 'ref-browning-buckmark');
});

test('suggestReferenceMatch: a model that matches nothing changes nothing (old behavior preserved)', () => {
  assert.equal(suggestReferenceMatch('Glock', 'Pistol', [], 'G34 Gen5')?.id, 'ref-glock');
  assert.equal(suggestReferenceMatch('Mossberg', 'Pistol', [], '940')?.id, undefined);
});

test('suggestReferenceMatch: matches a custom guide before built-ins', () => {
  const mine: Reference = {
    ...customGuide, id: 'refx-mine', name: 'Acme Custom Shop', category: 'Pistol'
  };
  assert.equal(suggestReferenceMatch('Acme Custom Shop', 'Pistol', [mine])?.id, 'refx-mine');
  // Custom guides are scoped by category too
  assert.equal(suggestReferenceMatch('Acme Custom Shop', 'Rifle', [mine]), null);
});

test('a custom guide drives the maintenance schedule', () => {
  const gun: Firearm = {
    id: 'fa-1', createdAt: 0, updatedAt: 0,
    name: 'Old 1911', manufacturer: '', model: '', caliber: '.45',
    category: 'Pistol', serialNumber: null, dateAcquired: '', startingRoundCount: 900,
    recoilSpringInterval: null, recoilSpringWeight: null, deepCleanInterval: null,
    barrelName: null, barrelInstallDate: null, barrelStartRounds: null,
    photoIds: [], referenceId: 'refx-abc', notes: ''
  };
  const items = maintenanceStatus(gun, toEntry(customGuide), [], [], [gun], new Date(2026, 5, 11));
  // 900 starting rounds vs the guide's 800-round deep clean = due
  assert.equal(items.find((i) => i.type === 'deep_clean')!.level, 'due');
  assert.ok(items.some((i) => i.type === 'recoil_spring'));
});
