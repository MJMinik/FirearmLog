import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionForTimezone, detectRegion } from '../src/lib/region.ts';

// The consent-region check (decision 2026-07-12: geo-gated hybrid). The rule
// under test: EU/EEA zones are consent-side ('eu'); the UK is opt-out-side by
// name; anything the check cannot place errs toward consent.

test('EU-27 mainland zones are consent-side', () => {
  for (const tz of [
    'Europe/Vienna', 'Europe/Brussels', 'Europe/Sofia', 'Europe/Zagreb',
    'Europe/Prague', 'Europe/Copenhagen', 'Europe/Tallinn', 'Europe/Helsinki',
    'Europe/Paris', 'Europe/Berlin', 'Europe/Athens', 'Europe/Budapest',
    'Europe/Dublin', 'Europe/Rome', 'Europe/Riga', 'Europe/Vilnius',
    'Europe/Luxembourg', 'Europe/Malta', 'Europe/Amsterdam', 'Europe/Warsaw',
    'Europe/Lisbon', 'Europe/Bucharest', 'Europe/Bratislava',
    'Europe/Ljubljana', 'Europe/Madrid', 'Europe/Stockholm',
  ]) {
    assert.equal(regionForTimezone(tz), 'eu', tz);
  }
});

test('EU territory whose zones do not start with Europe/ is still consent-side', () => {
  for (const tz of [
    'Atlantic/Canary', 'Atlantic/Madeira', 'Atlantic/Azores', 'Africa/Ceuta',
    'Asia/Nicosia', 'Asia/Famagusta', 'Europe/Mariehamn',
    'America/Martinique', 'America/Guadeloupe', 'America/Cayenne',
    'Indian/Reunion', 'Indian/Mayotte',
  ]) {
    assert.equal(regionForTimezone(tz), 'eu', tz);
  }
});

test('EEA states (GDPR applies) are consent-side', () => {
  for (const tz of ['Europe/Oslo', 'Atlantic/Reykjavik', 'Europe/Vaduz']) {
    assert.equal(regionForTimezone(tz), 'eu', tz);
  }
});

test('the UK and crown dependencies are opt-out-side (statutory since Feb 2026)', () => {
  for (const tz of [
    'Europe/London', 'Europe/Isle_of_Man', 'Europe/Jersey', 'Europe/Guernsey',
    'Europe/Gibraltar',
  ]) {
    assert.equal(regionForTimezone(tz), 'row', tz);
  }
});

test('the rest of the world is opt-out-side', () => {
  for (const tz of [
    'America/New_York', 'America/Chicago', 'America/Los_Angeles',
    'America/Toronto', 'America/Sao_Paulo', 'Asia/Tokyo', 'Asia/Manila',
    'Australia/Sydney', 'Pacific/Auckland', 'Africa/Johannesburg',
    'Asia/Dubai', 'America/Mexico_City',
  ]) {
    assert.equal(regionForTimezone(tz), 'row', tz);
  }
});

test('unrecognized European zones err toward consent (fail-safe)', () => {
  // Not EU/EEA, but consent-side on purpose: over-asking costs a question,
  // over-assuming costs trust.
  for (const tz of [
    'Europe/Zurich', 'Europe/Monaco', 'Europe/Andorra', 'Europe/San_Marino',
    'Europe/Vatican', 'Europe/Belgrade', 'Europe/Kyiv', 'Europe/Never_Heard_Of_It',
  ]) {
    assert.equal(regionForTimezone(tz), 'eu', tz);
  }
});

test('"cannot tell" errs toward consent: missing or empty zones', () => {
  assert.equal(regionForTimezone(undefined), 'eu');
  assert.equal(regionForTimezone(null), 'eu');
  assert.equal(regionForTimezone(''), 'eu');
});

test('detectRegion never throws and returns a valid region', () => {
  const r = detectRegion();
  assert.ok(r === 'eu' || r === 'row');
});
