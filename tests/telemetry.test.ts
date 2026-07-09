import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyticsEnabled,
  setTelemetryEnabled,
  syncTelemetryEnabled,
  registerTelemetryProvider,
  track,
  sendContribution,
  scrubError,
  telemetryState,
  MAX_PROP_STRING,
  type TelemetryEvent,
  type TelemetryProps,
  type TelemetryProvider,
} from '../src/lib/telemetry.ts';
import type { BenchmarkContribution } from '../src/lib/benchmark.ts';

// Reset the module-level singleton before each assertion group.
function reset() {
  setTelemetryEnabled(false);
  registerTelemetryProvider(null);
}

const sample: BenchmarkContribution = {
  scoringType: 'uspsa', division: 'Carry Optics', class: 'C', gunCategory: 'Pistol',
  metric: 'classifier_percent', value: 58,
};

// --- analyticsEnabled + syncTelemetryEnabled: the opt-OUT rule --------------

test('analyticsEnabled: undefined settings => participating (default on)', () => {
  assert.equal(analyticsEnabled(undefined), true);
});

test('analyticsEnabled: analyticsOptOut true => opted out', () => {
  assert.equal(analyticsEnabled({ analyticsOptOut: true }), false);
  assert.equal(analyticsEnabled({ analyticsOptOut: false }), true);
});

test('syncTelemetryEnabled: the live gate follows the stored opt-out', () => {
  reset();
  syncTelemetryEnabled({ analyticsOptOut: true });
  assert.equal(telemetryState().enabled, false);
  syncTelemetryEnabled({ analyticsOptOut: false });
  assert.equal(telemetryState().enabled, true);
  syncTelemetryEnabled(undefined); // no settings yet => participating
  assert.equal(telemetryState().enabled, true);
});

// --- track(): nothing leaves unless BOTH wired and enabled ------------------

test('track: no provider => no-op even when enabled', () => {
  reset();
  setTelemetryEnabled(true);
  assert.doesNotThrow(() => track('app_opened'));
  assert.deepEqual(telemetryState(), { enabled: true, wired: false });
});

test('track: provider registered but disabled => provider NOT called', () => {
  reset();
  const calls: string[] = [];
  registerTelemetryProvider({ track: (event) => calls.push(event) });
  setTelemetryEnabled(false);
  track('app_opened');
  assert.equal(calls.length, 0);
});

test('track: enabled AND wired => provider called with event + sanitized props', () => {
  reset();
  const calls: Array<{ event: string; props?: TelemetryProps }> = [];
  registerTelemetryProvider({ track: (event, props) => calls.push({ event, props }) });
  setTelemetryEnabled(true);
  track('session_logged', { gunCount: 1, drillCount: 2, hasPhotos: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.event, 'session_logged');
  assert.deepEqual(calls[0]!.props, { gunCount: 1, drillCount: 2, hasPhotos: true });
});

test('track: a throwing provider is swallowed (never breaks the app)', () => {
  reset();
  registerTelemetryProvider({ track: () => { throw new Error('network down'); } });
  setTelemetryEnabled(true);
  assert.doesNotThrow(() => track('app_opened'));
});

// --- R-D: the closed event + prop schema ------------------------------------

test('R-D: an unknown event name is refused', () => {
  reset();
  const calls: string[] = [];
  registerTelemetryProvider({ track: (event) => calls.push(event) });
  setTelemetryEnabled(true);
  track('made_up_event' as TelemetryEvent, { anything: 'x' } as TelemetryProps);
  assert.equal(calls.length, 0);
});

test('R-D: unknown prop keys and mistyped values are dropped', () => {
  reset();
  let seen: TelemetryProps | undefined;
  registerTelemetryProvider({ track: (_e, props) => { seen = props; } });
  setTelemetryEnabled(true);
  track('screen_view', { screen: 'home', secret: 'leak', evil: 42 } as TelemetryProps);
  assert.deepEqual(seen, { screen: 'home' }); // unknown keys gone
  // a mistyped known key is dropped, not coerced
  track('session_logged', { gunCount: 'nope' as unknown as number, drillCount: 2, hasPhotos: true });
  assert.deepEqual(seen, { drillCount: 2, hasPhotos: true });
});

test('R-D: a string prop is capped at MAX_PROP_STRING', () => {
  reset();
  let seen: TelemetryProps | undefined;
  registerTelemetryProvider({ track: (_e, props) => { seen = props; } });
  setTelemetryEnabled(true);
  track('screen_view', { screen: 'x'.repeat(500) });
  assert.equal((seen!.screen as string).length, MAX_PROP_STRING);
});

// --- R-C: the Layer-B contribution door -------------------------------------

test('sendContribution: no-op unless enabled AND a provider implements it', () => {
  reset();
  const sent: BenchmarkContribution[] = [];
  const provider: TelemetryProvider = { track: () => {}, sendContribution: (c) => sent.push(c) };

  registerTelemetryProvider(provider);
  setTelemetryEnabled(false);
  sendContribution(sample);
  assert.equal(sent.length, 0); // disabled

  setTelemetryEnabled(true);
  sendContribution(sample);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], sample);
});

test('sendContribution: a provider without the door (usage-only) is a safe no-op', () => {
  reset();
  registerTelemetryProvider({ track: () => {} }); // no sendContribution
  setTelemetryEnabled(true);
  assert.doesNotThrow(() => sendContribution(sample));
});

test('sendContribution: a throwing door is swallowed', () => {
  reset();
  registerTelemetryProvider({ track: () => {}, sendContribution: () => { throw new Error('down'); } });
  setTelemetryEnabled(true);
  assert.doesNotThrow(() => sendContribution(sample));
});

// --- R-D: the crash scrubber (error name + frames, never the message) -------

test('scrubError: keeps the name and frames, never the raw message', () => {
  const err = new Error('gun Glock 19 serial ABC123 failed at the range');
  err.name = 'RangeError';
  const s = scrubError(err);
  assert.equal(s.name, 'RangeError');
  const joined = s.frames.join('\n');
  for (const secret of ['Glock', 'serial', 'ABC123', 'range']) {
    assert.equal(joined.includes(secret), false, `frames must not contain "${secret}"`);
  }
});

test('scrubError: a non-Error input never throws and yields a name', () => {
  const s = scrubError('some raw string');
  assert.equal(typeof s.name, 'string');
  assert.ok(Array.isArray(s.frames));
});
