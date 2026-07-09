// R-F — the top privacy properties, pinned as regression tests (not just a
// reviewer's one-time claim): (1) the app is INERT — no network call exists in
// src/ outside the telemetry chokepoint; (2) a benchmark contribution serializes
// to EXACTLY its wire schema — no id, timestamp, or app version ever rides along;
// (3) the D1 schema physically cannot hold a per-person column.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { classifierContribution } from '../src/lib/benchmark.ts';

// (1) Inertness: the ONLY network call in src/ lives in telemetry.ts, plus the
//     one allow-listed same-origin demo-dataset fetch in SetupWizard.
test('no network call exists in src/ outside the telemetry chokepoint', () => {
  const NET = /\b(fetch|sendBeacon|XMLHttpRequest|WebSocket|EventSource)\b/;
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f)) {
        const rel = p.replace(/\\/g, '/');
        if (rel.endsWith('src/lib/telemetry.ts')) continue;
        readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          if (NET.test(line) && !line.includes('demo-dataset')) offenders.push(`${rel}:${i + 1}`);
        });
      }
    }
  };
  walk('src');
  assert.deepEqual(offenders, [], `network call(s) found outside telemetry.ts: ${offenders.join(', ')}`);
});

// (2) A contribution serializes to exactly the six wire fields — nothing more.
test('a benchmark contribution serializes to exactly its six schema fields', () => {
  const c = classifierContribution({ division: 'Open', class: 'B', gunCategory: 'Pistol', percent: 71.4 });
  assert.ok(c);
  assert.deepEqual(
    Object.keys(JSON.parse(JSON.stringify(c))).sort(),
    ['class', 'division', 'gunCategory', 'metric', 'scoringType', 'value'],
  );
});

// (3) The bucket table can never hold anything per-person.
test('worker schema.sql has no id / timestamp / ip / user / device column, ever', () => {
  const raw = readFileSync(new URL('../worker/schema.sql', import.meta.url), 'utf8').toLowerCase();
  // Strip SQL comments (full-line and inline) so we scan only the actual DDL.
  const ddl = raw.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  for (const forbidden of [/\btimestamp\b/, /\bcreated\b/, /\bupdated\b/, /\buser\b/, /\bdevice\b/, /\bip\b/, /\bid\b/, /\bsession\b/]) {
    assert.equal(forbidden.test(ddl), false, `schema DDL must never contain ${forbidden}`);
  }
});
