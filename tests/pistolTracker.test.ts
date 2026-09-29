// Importer tests — run against the app's REAL functions (rule X2), under
// plain Node:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseOldFile, importPistolTracker, guessCategory,
  oldStyleRoundCount, newStyleRoundCount
} from '../src/lib/import/pistolTracker.ts';

const fixturePath = fileURLToPath(new URL('./fixtures/sample-pistol-tracker.json', import.meta.url));
const fixtureText = readFileSync(fixturePath, 'utf8');
const NOW = 1781200000000;

test('rejects files that are not Pistol Tracker backups', () => {
  assert.throws(() => parseOldFile('not json at all'));
  assert.throws(() => parseOldFile('{"hello": "world"}'));
});

test('accepts a valid backup', () => {
  const old = parseOldFile(fixtureText);
  assert.equal(old.firearms?.length, 2);
});

test('guesses categories: 870 is a Shotgun, Atlas is a Pistol', () => {
  const old = parseOldFile(fixtureText);
  assert.equal(guessCategory(old.firearms![0]), 'Pistol');
  assert.equal(guessCategory(old.firearms![1]), 'Shotgun');
});

test('user-confirmed categories override guesses', () => {
  const old = parseOldFile(fixtureText);
  const { data } = importPistolTracker(old, { 'fa-2': 'Other' }, NOW);
  assert.equal(data.firearms.find(f => f.id === 'fa-2')?.category, 'Other');
});

test('old IDs are preserved so cross-references survive', () => {
  const old = parseOldFile(fixtureText);
  const { data } = importPistolTracker(old, {}, NOW);
  assert.ok(data.firearms.some(f => f.id === 'fa-1'));
  assert.ok(data.sessions.some(s => s.id === 'se-2'));
  assert.equal(data.sessions[0].ammoUsage[0].ammoId, 'am-1');
  assert.ok(data.ammunition.some(a => a.id === 'am-1'));
});

test('firearm splits become per-gun rounds; single-gun sessions get one entry', () => {
  const old = parseOldFile(fixtureText);
  const { data } = importPistolTracker(old, {}, NOW);
  const split = data.sessions.find(s => s.id === 'se-2')!;
  assert.deepEqual(split.guns, [
    { firearmId: 'fa-1', rounds: 400 },
    { firearmId: 'fa-2', rounds: 20 }
  ]);
  const single = data.sessions.find(s => s.id === 'se-1')!;
  assert.deepEqual(single.guns, [{ firearmId: 'fa-1', rounds: 300 }]);
});

test('round counts survive import (splits, planned, starting count; dry fire never counts)', () => {
  const old = parseOldFile(fixtureText);
  const { data, report } = importPistolTracker(old, {}, NOW);
  // fa-1: 100 starting + 300 + 400 (split) = 800; planned 200 excluded, and
  // the 50 dry-fire reps are NOT rounds fired (Michael, June 11, 2026).
  assert.equal(oldStyleRoundCount(old, 'fa-1'), 800);
  assert.equal(newStyleRoundCount(data, 'fa-1'), 800);
  // fa-2: 0 starting + 20 from the split
  assert.equal(oldStyleRoundCount(old, 'fa-2'), 20);
  assert.equal(newStyleRoundCount(data, 'fa-2'), 20);
  assert.ok(report.guns.every(g => g.ok));
});

test('images become named media records, counts verified', () => {
  const old = parseOldFile(fixtureText);
  const { data, report } = importPistolTracker(old, {}, NOW);
  assert.equal(report.imagesIn, 2); // 1 insurance + 1 target
  assert.equal(report.imagesOut, 2);
  assert.ok(report.imagesOk);
  const gunPhoto = data.media.find(m => m.ownerType === 'firearm')!;
  assert.equal(gunPhoto.ownerId, 'fa-1');
  assert.match(gunPhoto.name, /Test Erebus/);
  assert.equal(gunPhoto.mime, 'image/png');
  assert.ok(gunPhoto.data.byteLength > 0);
  const linkedGun = data.firearms.find(f => f.id === 'fa-1')!;
  assert.deepEqual(linkedGun.photoIds, [gunPhoto.id]);
});

test('drill library maps dry/live and keeps descriptions', () => {
  const old = parseOldFile(fixtureText);
  const { data } = importPistolTracker(old, {}, NOW);
  const bill = data.drills.find(d => d.name === 'Bill Drill')!;
  assert.equal(bill.fire, 'both');
  assert.equal(bill.requiresHolster, true);
  assert.equal(bill.briefDescription, '6 from holster at 7.');
  assert.equal(data.drills.find(d => d.name === 'Wall Drill')!.fire, 'dry');
  assert.equal(data.drills.find(d => d.name === 'Doubles 5yd')!.fire, 'live');
});

test('verification report: every count matches and allOk is true', () => {
  const old = parseOldFile(fixtureText);
  const { report } = importPistolTracker(old, {}, NOW);
  for (const row of report.counts) {
    assert.ok(row.ok, `${row.label}: ${row.inCount} in, ${row.outCount} out`);
  }
  assert.ok(report.allOk);
});

test('zero loss: unmapped old fields land in legacy', () => {
  const old = parseOldFile(fixtureText);
  // plant an unknown field
  (old.sessions![0] as Record<string, unknown>)._dropdownFirearmId = 'fa-1';
  const { data } = importPistolTracker(old, {}, NOW);
  assert.equal(data.sessions.find(s => s.id === 'se-1')!.legacy?._dropdownFirearmId, 'fa-1');
});

test('re-importing the same file produces identical photo IDs (no duplicates)', () => {
  const old1 = parseOldFile(fixtureText);
  const old2 = parseOldFile(fixtureText);
  const a = importPistolTracker(old1, {}, NOW);
  const b = importPistolTracker(old2, {}, NOW + 5000);
  assert.deepEqual(a.data.media.map(m => m.id), b.data.media.map(m => m.id));
  assert.deepEqual(a.data.drills.map(d => d.id), b.data.drills.map(d => d.id));
  assert.equal(a.data.drills[0].id, 'dr-bill-drill');
});

test('trash and settings are carried over', () => {
  const old = parseOldFile(fixtureText);
  const { data, settings } = importPistolTracker(old, {}, NOW);
  assert.equal(data.trash.length, 1);
  assert.equal(data.trash[0].recordType, 'maintenance');
  assert.equal((settings as { ownerName?: string }).ownerName, 'Test Owner');
});

test('every record carries id, createdAt, updatedAt', () => {
  const old = parseOldFile(fixtureText);
  const { data } = importPistolTracker(old, {}, NOW);
  const all = [
    ...data.firearms, ...data.sessions, ...data.drills, ...data.ammunition,
    ...data.purchases, ...data.maintenance, ...data.magazines, ...data.optics,
    ...data.parts, ...data.media, ...data.trash
  ];
  for (const r of all) {
    assert.ok(r.id, 'id missing');
    assert.equal(r.createdAt, NOW);
    assert.equal(r.updatedAt, NOW);
  }
});

// The migration reader marks EVERY migrated session (entitlement build, 28 Sep
// 2026, decision 12.6): the free-trial count treats any session carrying a
// `legacy` object as brought in rather than logged here, and a session whose
// old record had no unmapped keys used to come out with `legacy` undefined.
import { countLiveFireSessions } from '../src/lib/trialGate.ts';

test('every migrated session carries the migration marker, even with no unmapped keys', () => {
  const old = parseOldFile(fixtureText);
  const { data } = importPistolTracker(old, {}, NOW);
  assert.ok(data.sessions.length > 0);
  for (const s of data.sessions) {
    assert.ok(s.legacy, `session ${s.id} has no legacy object`);
    assert.equal(s.legacy!.importSource, 'migration', `session ${s.id} lacks the marker`);
  }
});

test('the marker is merged with the rest keys: nothing is lost or renamed', () => {
  const old = parseOldFile(fixtureText);
  (old.sessions![0] as Record<string, unknown>)._dropdownFirearmId = 'fa-1';
  (old.sessions![0] as Record<string, unknown>).someOtherOldField = { nested: [1, 2] };
  const { data } = importPistolTracker(old, {}, NOW);
  const first = data.sessions.find((s) => s.id === String(old.sessions![0].id))!;
  assert.equal(first.legacy!.importSource, 'migration');
  assert.equal(first.legacy!._dropdownFirearmId, 'fa-1');
  assert.deepEqual(first.legacy!.someOtherOldField, { nested: [1, 2] });
});

test('an old record that already holds an importSource key keeps its own value (zero loss wins)', () => {
  const old = parseOldFile(fixtureText);
  (old.sessions![0] as Record<string, unknown>).importSource = 'the old value';
  const { data } = importPistolTracker(old, {}, NOW);
  const first = data.sessions.find((s) => s.id === String(old.sessions![0].id))!;
  assert.ok(first.legacy, 'still marked as brought in');
  assert.equal(first.legacy!.importSource, 'the old value');
});

test('the trial count over the real migration output counts none of the migrated sessions', () => {
  const old = parseOldFile(fixtureText);
  const { data } = importPistolTracker(old, {}, NOW);
  assert.ok(data.sessions.some((s) => s.type !== 'dry_fire' && !s.planned), 'the fixture has live sessions');
  assert.equal(countLiveFireSessions(data.sessions, undefined), 0);
});

test('migration marker: other record types are unchanged (no legacy added where takeRest found nothing)', () => {
  const old = parseOldFile(fixtureText);
  const { data } = importPistolTracker(old, {}, NOW);
  // Guns and the rest keep whatever takeRest returned; only sessions gained a marker.
  for (const g of data.firearms) {
    if (g.legacy !== undefined) assert.equal(g.legacy.importSource, undefined);
  }
});
