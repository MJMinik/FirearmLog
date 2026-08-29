import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldStampNewOpticLink } from '../src/ui/reminderOpticLink.ts';

// Finding 6 (audit round 2): a brand-new reminder created via an optic's
// "Set a battery reminder" button stamps `opticId` in persistForm with NO
// guard at all — unlike its sibling, the legacy-upgrade path two lines
// below it, which skips the stamp when the gun field was changed in this
// same edit. Real bug: create the reminder from the optic's button, change
// which gun the reminder is for before saving, and the optic keeps being
// governed by a reminder now labelled for a DIFFERENT gun.
//
// Finding 11: this decision had zero test coverage at any level before this
// file. Extracted to a pure function purely so it can be unit tested without
// a DOM/JSX harness — RemindersScreen.tsx calls this directly.

test('shouldStampNewOpticLink: stamps when a real opticId was handed in, gun is unchanged, and trigger is date', () => {
  assert.equal(shouldStampNewOpticLink('op-1', 'fa-1', 'fa-1', 'date'), true);
});

test('shouldStampNewOpticLink: does NOT stamp when the gun was changed since the button was pressed', () => {
  assert.equal(shouldStampNewOpticLink('op-1', 'fa-1', 'fa-2', 'date'), false);
});

test('shouldStampNewOpticLink: does NOT stamp a round-count-triggered reminder (no due date for reminderGovernsOptic to check)', () => {
  assert.equal(shouldStampNewOpticLink('op-1', 'fa-1', 'fa-1', 'rounds'), false);
});

test('shouldStampNewOpticLink: does NOT stamp when there was no initialOpticId at all (an ordinary new reminder)', () => {
  assert.equal(shouldStampNewOpticLink(undefined, 'fa-1', 'fa-1', 'date'), false);
});

test('shouldStampNewOpticLink: an unassigned loaded gun ("") is compared honestly, not coerced to a match', () => {
  assert.equal(shouldStampNewOpticLink('op-1', undefined, '', 'date'), true); // both "no gun" — unchanged
  assert.equal(shouldStampNewOpticLink('op-1', undefined, 'fa-1', 'date'), false); // gun was ADDED, still a change
});
