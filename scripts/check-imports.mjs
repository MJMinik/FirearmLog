// Cheap guards that run before code leaves the machine:
//  1. Flag imported names that never appear again in their file (the most common
//     type-check failure).
//  2. Rung-1 privacy invariant — a network call (fetch/sendBeacon/XHR/WebSocket/
//     EventSource) may appear ONLY in the telemetry chokepoint (the one auditable
//     send point). The single allow-listed exception is SetupWizard's same-origin
//     demo-dataset fetch. Anything else fails the build (R-C).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

const NET_RE = /\b(fetch|sendBeacon|XMLHttpRequest|WebSocket|EventSource)\b/;
const NET_ALLOWED_FILE = 'src/lib/telemetry.ts';

let bad = 0;
for (const path of walk('src')) {
  const src = readFileSync(path, 'utf8');
  const rel = path.replace(/\\/g, '/');

  // (1) unused-import guard
  for (const m of src.matchAll(/import (?:type )?\{([^}]+)\} from/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().replace(/^type /, '');
      if (!name) continue;
      const count = (src.match(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')) ?? []).length;
      if (count < 2) {
        console.error(`UNUSED IMPORT: ${name} in ${path}`);
        bad++;
      }
    }
  }

  // (2) network-call invariant
  if (rel !== NET_ALLOWED_FILE) {
    src.split('\n').forEach((line, i) => {
      if (NET_RE.test(line) && !line.includes('demo-dataset')) {
        console.error(`NETWORK CALL OUTSIDE telemetry.ts: ${rel}:${i + 1}`);
        bad++;
      }
    });
  }
}
if (bad > 0) process.exit(1);
console.log('imports clean');
