import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestAmmoRow, sharedCaliber } from '../src/lib/ammoSuggest.ts';

const lib = [
  { id: 'a9-blazer', caliber: '9mm' },
  { id: 'a9-federal', caliber: '9mm' },
  { id: 'a45', caliber: '45 ACP' },
];

test('no auto row when nothing was shot', () => {
  assert.equal(
    suggestAmmoRow({ totalRounds: 0, caliber: '9mm', ammoLib: lib, recentAmmoIds: [] }),
    null
  );
  assert.equal(
    suggestAmmoRow({ totalRounds: -5, caliber: '9mm', ammoLib: lib, recentAmmoIds: [] }),
    null
  );
});

test('single caliber: picks the most-recently-used matching ammo', () => {
  const row = suggestAmmoRow({
    totalRounds: 50, caliber: '9mm', ammoLib: lib, recentAmmoIds: ['a45', 'a9-federal', 'a9-blazer'],
  });
  assert.deepEqual(row, { ammoId: 'a9-federal', rounds: '50' });
});

test('single caliber with exactly one matching ammo and no history: picks it', () => {
  const row = suggestAmmoRow({
    totalRounds: 30, caliber: '45 ACP', ammoLib: lib, recentAmmoIds: [],
  });
  assert.deepEqual(row, { ammoId: 'a45', rounds: '30' });
});

test('single caliber, several matches, no history: leaves type blank but pre-fills rounds', () => {
  const row = suggestAmmoRow({
    totalRounds: 40, caliber: '9mm', ammoLib: lib, recentAmmoIds: [],
  });
  assert.deepEqual(row, { ammoId: '', rounds: '40' });
});

test('no ammo of that caliber: blank type, rounds pre-filled', () => {
  const row = suggestAmmoRow({
    totalRounds: 25, caliber: '5.56', ammoLib: lib, recentAmmoIds: ['a9-blazer'],
  });
  assert.deepEqual(row, { ammoId: '', rounds: '25' });
});

test('mixed/unknown caliber (null): blank type, rounds pre-filled', () => {
  const row = suggestAmmoRow({
    totalRounds: 70, caliber: null, ammoLib: lib, recentAmmoIds: ['a9-blazer'],
  });
  assert.deepEqual(row, { ammoId: '', rounds: '70' });
});

test('caliber match is case- and whitespace-insensitive', () => {
  const row = suggestAmmoRow({
    totalRounds: 10, caliber: ' 9MM ', ammoLib: lib, recentAmmoIds: ['a9-blazer'],
  });
  assert.deepEqual(row, { ammoId: 'a9-blazer', rounds: '10' });
});

test('sharedCaliber: one caliber across guns-with-rounds', () => {
  assert.equal(
    sharedCaliber([{ caliber: '9mm', rounds: 50 }, { caliber: '9mm', rounds: 20 }]),
    '9mm'
  );
});

test('sharedCaliber: guns with 0 rounds are ignored', () => {
  assert.equal(
    sharedCaliber([{ caliber: '9mm', rounds: 50 }, { caliber: '45 ACP', rounds: 0 }]),
    '9mm'
  );
});

test('sharedCaliber: mixed calibers in play -> null', () => {
  assert.equal(
    sharedCaliber([{ caliber: '9mm', rounds: 50 }, { caliber: '45 ACP', rounds: 20 }]),
    null
  );
});

test('sharedCaliber: nothing shot -> null', () => {
  assert.equal(sharedCaliber([{ caliber: '9mm', rounds: 0 }]), null);
});
