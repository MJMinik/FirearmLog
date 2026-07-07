import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyticsEnabled,
  setTelemetryEnabled,
  registerTelemetryProvider,
  track,
  telemetryState,
  type TelemetryProps,
} from '../src/lib/telemetry.ts';

// Reset the module-level state before each assertion group so tests don't leak
// into each other (the chokepoint is a singleton by design).
function reset() {
  setTelemetryEnabled(false);
  registerTelemetryProvider(null);
}

// --- analyticsEnabled: the opt-OUT rule -------------------------------------

test('analyticsEnabled: undefined settings => participating (default on)', () => {
  assert.equal(analyticsEnabled(undefined), true);
});

test('analyticsEnabled: analyticsOptOut false => participating', () => {
  assert.equal(analyticsEnabled({ analyticsOptOut: false }), true);
});

test('analyticsEnabled: analyticsOptOut true => opted out', () => {
  assert.equal(analyticsEnabled({ analyticsOptOut: true }), false);
});

// --- track(): nothing leaves unless BOTH wired and enabled ------------------

test('track: no provider => no-op even when enabled', () => {
  reset();
  setTelemetryEnabled(true);
  // No provider registered. Must not throw and must send nothing.
  assert.doesNotThrow(() => track('app_open'));
  assert.deepEqual(telemetryState(), { enabled: true, wired: false });
});

test('track: provider registered but disabled => provider NOT called', () => {
  reset();
  const calls: Array<{ event: string; props?: TelemetryProps }> = [];
  registerTelemetryProvider({ track: (event, props) => calls.push({ event, props }) });
  setTelemetryEnabled(false);
  track('app_open', { screen: 'home' });
  assert.equal(calls.length, 0);
});

test('track: enabled AND wired => provider called with event + props', () => {
  reset();
  const calls: Array<{ event: string; props?: TelemetryProps }> = [];
  registerTelemetryProvider({ track: (event, props) => calls.push({ event, props }) });
  setTelemetryEnabled(true);
  track('session_logged', { division: 'CO' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.event, 'session_logged');
  assert.deepEqual(calls[0]!.props, { division: 'CO' });
});

test('track: a throwing provider is swallowed (never breaks the app)', () => {
  reset();
  registerTelemetryProvider({
    track: () => {
      throw new Error('network down');
    },
  });
  setTelemetryEnabled(true);
  assert.doesNotThrow(() => track('app_open'));
});

test('registerTelemetryProvider(null) returns to a pure no-op', () => {
  reset();
  const calls: string[] = [];
  registerTelemetryProvider({ track: (event) => calls.push(event) });
  setTelemetryEnabled(true);
  registerTelemetryProvider(null);
  track('app_open');
  assert.equal(calls.length, 0);
  assert.deepEqual(telemetryState(), { enabled: true, wired: false });
});
