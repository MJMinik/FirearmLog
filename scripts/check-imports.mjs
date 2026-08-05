// Cheap guards that run before code leaves the machine:
//  1. Flag imported names that never appear again in their file (the most common
//     type-check failure).
//  2. Rung-1 privacy invariant — a network call (fetch/sendBeacon/XHR/WebSocket/
//     EventSource) may appear ONLY in the telemetry chokepoint (the one auditable
//     send point). The single allow-listed exception is SetupWizard's same-origin
//     demo-dataset fetch. Anything else fails the build (R-C).
//  3. Day-keys are LOCAL (lib/dates.ts, old bug F8). A YYYY-MM-DD cut out of
//     toISOString is the UTC day, which is TOMORROW for anyone west of
//     Greenwich from late afternoon on: the CSV import's past-imports list
//     showed Aug 5 for an import made at 20:30 on Aug 4 in California, and the
//     Home header had the same line. Use dayKey/todayKey. This is here rather
//     than in a review checklist because a convention nobody can forget is the
//     only kind that holds.
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
const UTC_DAY_KEY_RE = /toISOString\(\)\s*\.\s*(slice|substring|substr)\(\s*0\s*,\s*10\s*\)/;
const NET_ALLOWED_FILE = 'src/lib/telemetry.ts';

let bad = 0;
for (const path of walk('src')) {
  const src = readFileSync(path, 'utf8');
  const rel = path.replace(/\\/g, '/');

  // (1) unused-import guard
  for (const m of src.matchAll(/import (?:type )?\{([^}]+)\} from/g)) {
    for (const raw of m[1].split(',')) {
      const declared = raw.trim().replace(/^type /, '');
      if (!declared) continue;
      // `import { x as y }` binds the LOCAL name y, and y is the name that has
      // to appear again in the file. Searching for the whole "x as y" text
      // finds only the import line itself, so a legal alias read as unused.
      const name = declared.includes(' as ') ? declared.split(/\s+as\s+/).pop().trim() : declared;
      if (!name) continue;
      const count = (src.match(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')) ?? []).length;
      if (count < 2) {
        console.error(`UNUSED IMPORT: ${name} in ${path}`);
        bad++;
      }
    }
  }

  // (3) local-day-key invariant
  src.split('\n').forEach((line, i) => {
    if (UTC_DAY_KEY_RE.test(line)) {
      console.error(`UTC DAY-KEY (use dayKey/todayKey from lib/dates.ts): ${rel}:${i + 1}`);
      bad++;
    }
  });

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
