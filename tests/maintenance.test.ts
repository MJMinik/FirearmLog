import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  liveSessionsSince, maintenanceAlerts, maintenanceStatus, maintLabel, resolveSchedule, roundsSince
} from '../src/lib/maintenance.ts';
import type { Firearm, MaintenanceEntry, Session } from '../src/lib/types.ts';
import { getReference } from '../src/lib/referenceData.ts';

const gun = (over: Partial<Firearm> = {}): Firearm => ({
  id: 'fa-1', createdAt: 0, updatedAt: 0,
  name: 'Test Erebus', manufacturer: 'Atlas', model: 'Erebus', caliber: '9mm',
  category: 'Pistol', serialNumber: null, dateAcquired: '', startingRoundCount: 0,
  recoilSpringInterval: null, recoilSpringWeight: null,
  barrelName: null, barrelInstallDate: null, barrelStartRounds: null,
  deepCleanInterval: null,
  photoIds: [], referenceId: null, notes: '', ...over
});

const session = (date: string, rounds: number, type = 'practice', planned = false): Session => ({
  id: `se-${date}`, createdAt: 0, updatedAt: 0,
  date, type, guns: [{ firearmId: 'fa-1', rounds }],
  location: '', distances: '', notes: '', ammoUsage: [], drills: [],
  targetMediaIds: [], malfunctions: [], selfRating: null, rangeFee: null,
  planned, checklist: null
});

const maint = (date: string, type: string): MaintenanceEntry => ({
  id: `ma-${date}-${type}`, createdAt: 0, updatedAt: 0,
  date, firearmId: 'fa-1', type, performedBy: 'Self', partsReplaced: '', notes: ''
});

const NOW = new Date(2026, 5, 11);

test('maintLabel: known types keep their label; unmapped ids are humanized, never raw', () => {
  assert.equal(maintLabel('deep_clean'), 'Deep Clean');
  assert.equal(maintLabel('recoil_spring'), 'Recoil Spring');
  // Unmapped (legacy/imported/demo) ids must not reach the user as snake_case.
  assert.equal(maintLabel('spring_change'), 'Spring change');
  assert.equal(maintLabel('red_dot_swap'), 'Red dot swap');
  assert.equal(maintLabel(''), '');
});

test('roundsSince counts only this gun, after the date, never planned', () => {
  const sessions = [session('2026-01-01', 100), session('2026-02-01', 200), session('2026-03-01', 999, 'practice', true)];
  assert.equal(roundsSince('2026-01-15', 'fa-1', sessions), 200);
});

test('liveSessionsSince excludes dry fire and planned', () => {
  const sessions = [
    session('2026-02-01', 100),
    session('2026-02-02', 50, 'dry_fire'),
    session('2026-02-03', 100),
    session('2026-02-04', 100, 'practice', true)
  ];
  assert.equal(liveSessionsSince('2026-01-31', 'fa-1', sessions), 2);
});

test('schedule resolution: gun override > reference > default', () => {
  const atlas = getReference('ref-atlas');
  assert.equal(resolveSchedule(gun(), undefined).deepCleanRounds, 10000);
  assert.equal(resolveSchedule(gun(), atlas).deepCleanRounds, 3000);
  assert.equal(resolveSchedule(gun({ deepCleanInterval: 1234 }), atlas).deepCleanRounds, 1234);
  assert.equal(resolveSchedule(gun(), atlas).recoilSpringRounds, 5000);
  assert.equal(resolveSchedule(gun({ recoilSpringInterval: 4000 }), atlas).recoilSpringRounds, 4000);
});

test('deep clean goes warn at 90% and due at 100%', () => {
  const g = gun({ deepCleanInterval: 1000 });
  const items9 = maintenanceStatus(g, undefined, [session('2026-01-01', 900)], [], [g], NOW);
  assert.equal(items9.find((i) => i.type === 'deep_clean')!.level, 'warn');
  const items10 = maintenanceStatus(g, undefined, [session('2026-01-01', 1000)], [], [g], NOW);
  assert.equal(items10.find((i) => i.type === 'deep_clean')!.level, 'due');
  const after = maintenanceStatus(g, undefined, [session('2026-01-01', 1000)], [maint('2026-01-02', 'deep_clean')], [g], NOW);
  assert.equal(after.find((i) => i.type === 'deep_clean')!.level, 'ok');
});

test('field strip: info after one live session, warn after two, ok when clean', () => {
  const g = gun();
  const one = maintenanceStatus(g, undefined, [session('2026-01-01', 100)], [], [g], NOW);
  assert.equal(one.find((i) => i.type === 'field_strip')!.level, 'info');
  const two = maintenanceStatus(g, undefined, [session('2026-01-01', 100), session('2026-01-02', 100)], [], [g], NOW);
  assert.equal(two.find((i) => i.type === 'field_strip')!.level, 'warn');
  const cleaned = maintenanceStatus(g, undefined, [session('2026-01-01', 100)], [maint('2026-01-02', 'field_strip')], [g], NOW);
  assert.equal(cleaned.find((i) => i.type === 'field_strip')!.level, 'ok');
});

test('annual inspection: info when never done, warn when stale, ok when recent', () => {
  const g = gun();
  const never = maintenanceStatus(g, undefined, [], [], [g], NOW);
  assert.equal(never.find((i) => i.type === 'annual_inspection')!.level, 'info');
  const stale = maintenanceStatus(g, undefined, [], [maint('2024-01-01', 'annual_inspection')], [g], NOW);
  assert.equal(stale.find((i) => i.type === 'annual_inspection')!.level, 'warn');
  const fresh = maintenanceStatus(g, undefined, [], [maint('2026-01-01', 'annual_inspection')], [g], NOW);
  assert.equal(fresh.find((i) => i.type === 'annual_inspection')!.level, 'ok');
});

test('recoil spring rule only exists when an interval does', () => {
  const none = maintenanceStatus(gun(), undefined, [], [], [gun()], NOW);
  assert.ok(!none.some((i) => i.type === 'recoil_spring'));
  const g = gun({ recoilSpringInterval: 500 });
  const due = maintenanceStatus(g, undefined, [session('2026-01-01', 600)], [], [g], NOW);
  assert.equal(due.find((i) => i.type === 'recoil_spring')!.level, 'due');
});

test('alerts: only warn/due items, due first', () => {
  const g = gun({ deepCleanInterval: 100, recoilSpringInterval: 1000 });
  const sessions = [session('2026-01-01', 950)];
  const alerts = maintenanceAlerts([g], () => undefined, sessions, [], NOW);
  assert.ok(alerts.length >= 2);
  assert.equal(alerts[0].item.level, 'due'); // deep clean blown past
  assert.ok(alerts.every((a) => a.item.level === 'due' || a.item.level === 'warn'));
});
