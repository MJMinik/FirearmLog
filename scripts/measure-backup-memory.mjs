// Measure what a backup actually costs in memory, in a real browser, both ways.
//
// NOT PART OF THE APP — a measuring instrument, run by hand, kept in the repo so
// the numbers quoted in comments and commit messages can be reproduced rather
// than believed.
//
// THE FIRST VERSION OF THIS SCRIPT WAS WRONG, AND WRONG IN THE DIRECTION THAT
// UNDERSTATED THE FIX. That is recorded here rather than quietly corrected,
// because good news is exactly when an instrument deserves the hardest look.
// Three defects, all found by a cold audit:
//
//  1. IT SAMPLED. A 40 ms timer read memory on the same event loop that was
//     awaiting the browser, each tick walking every process on the box. The old
//     path's peak is one enormous long-lived allocation and was caught every
//     time; the new path's peak is a train of short-lived per-photo buffers and
//     was stepped over. Measured miss: 3 MB on the old path, 256-294 MB on the
//     new one — so about half the "improvement" it reported was really the
//     sampler failing to see what the new path spent. Linux already records the
//     exact answer for free: VmHWM in /proc/<pid>/status. Nothing samples now.
//  2. IT SUMMED RSS ACROSS THE PROCESS TREE, counting Chromium's shared binary,
//     V8 snapshot and copy-on-write pages once per process. Measured on one tree:
//     summed RSS 808 MB against Pss 367 MB. Pss divides a shared page by the
//     number of processes sharing it, and is what a memory cost actually is.
//  3. ITS BASELINE WAS A MOVING TARGET, read the instant seeding returned with no
//     collection and no settle. Now: seed, collect, settle, confirm the baseline
//     has stopped moving, RESET the high-water marks (write 5 to clear_refs), and
//     only then run the save — so the growth figure is the save's own peak and
//     nobody else's.
//
// Also: N runs with min/median/max rather than one run quoted to three
// significant figures, and the two archives are hashed and compared, because a
// memory win on a file that is not the same file is not a win.
import { chromium } from '@playwright/test';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';

const PORT = process.env.PORT ?? '5199';
const ORIGIN = `http://localhost:${PORT}`;
const RUNS = Number(process.env.RUNS ?? 3);

function pidsUnder(rootPid) {
  const kids = new Map();
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      if (!kids.has(ppid)) kids.set(ppid, []);
      kids.get(ppid).push(Number(name));
    } catch { /* gone mid-walk */ }
  }
  const out = [];
  const stack = [rootPid];
  const seen = new Set();
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    out.push(pid);
    for (const k of kids.get(pid) ?? []) stack.push(k);
  }
  return out;
}

function fieldKb(path, key) {
  try {
    const m = readFileSync(path, 'utf8').match(new RegExp(`^${key}:\\s+(\\d+) kB`, 'm'));
    return m ? Number(m[1]) : 0;
  } catch { return 0; }
}

/** Peak resident memory since the last reset, over the whole tree, in MB. */
function treeHwmMb(rootPid) {
  let kb = 0;
  for (const pid of pidsUnder(rootPid)) kb += fieldKb(`/proc/${pid}/status`, 'VmHWM');
  return kb / 1024;
}

/** Proportional set size: a shared page divided among its sharers. In MB. */
function treePssMb(rootPid) {
  let kb = 0;
  for (const pid of pidsUnder(rootPid)) kb += fieldKb(`/proc/${pid}/smaps_rollup`, 'Pss');
  return kb / 1024;
}

/** Reset every high-water mark in the tree, so the next reading is the save's. */
function resetTreeHwm(rootPid) {
  let reset = 0;
  for (const pid of pidsUnder(rootPid)) {
    const p = `/proc/${pid}/clear_refs`;
    if (!existsSync(p)) continue;
    try { writeFileSync(p, '5'); reset += 1; } catch { /* not ours to reset */ }
  }
  return reset;
}

async function run(label, seedSpec, body) {
  const server = await chromium.launchServer({
    // Playwright's resolved path can name a revision that is not on disk in this
    // sandbox, so the browser that IS here can be passed in explicitly.
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ['--js-flags=--expose-gc'],
  });
  const pid = server.process().pid;
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  // The app takes the same exclusive lock on boot (the stock-drill seed), so
  // seeding immediately loses a race with it and the run dies with a message
  // about an erase. Let the app settle, then retry rather than assuming.
  await new Promise((r) => setTimeout(r, 2500));

  await page.evaluate(async (spec) => {
    const { putOne, clearAllData } = await import('/src/lib/db.ts');
    for (let attempt = 0; ; attempt++) {
      try { await clearAllData(); break; }
      catch (e) {
        if (attempt >= 20) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    const stamp = 1700000000000;
    let n = 0;
    for (const [count, bytes] of spec) {
      for (let i = 0; i < count; i++) {
        n += 1;
        const data = new ArrayBuffer(bytes);
        const view = new Uint8Array(data);
        // Touch one byte per page: an untouched reservation never becomes
        // resident and would not be measured at all.
        for (let p = 0; p < bytes; p += 4096) view[p] = (p + i) & 0xff;
        await putOne('media', {
          id: 'md-' + String(n).padStart(4, '0'), ownerType: 'session', ownerId: 'se-1',
          kind: bytes > 5000000 ? 'video' : 'image', name: 'item-' + n, annotations: [],
          mime: bytes > 5000000 ? 'video/mp4' : 'image/jpeg', data,
          createdAt: stamp, updatedAt: stamp + n,
        });
      }
    }
  }, seedSpec);

  await page.evaluate('globalThis.gc && globalThis.gc()');
  await new Promise((r) => setTimeout(r, 1500));
  const settledPss = treePssMb(pid);
  await new Promise((r) => setTimeout(r, 500));
  const settledPss2 = treePssMb(pid);

  const resetCount = resetTreeHwm(pid);
  const baseHwm = treeHwmMb(pid);

  const out = await page.evaluate(body);
  const hwmGrowth = treeHwmMb(pid) - baseHwm;
  const pssGrowth = treePssMb(pid) - settledPss2;
  // ONLY NOW hash it. crypto.subtle needs the whole archive as one ArrayBuffer,
  // which is a full extra copy of the file — 264 MB on this library — and doing
  // it inside the measured window would add that to both peaks and flatter
  // neither. The blob is parked on window by the body for exactly this reason.
  const hash = await page.evaluate(`(async () => {
    const digest = await crypto.subtle.digest('SHA-256', await window.__flogBlob.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  })()`);

  const result = {
    label,
    hwmGrowth,
    pssGrowth,
    baselineDrift: Math.abs(settledPss2 - settledPss),
    resetCount,
    size: out.size,
    hash,
  };
  await browser.close();
  await server.close();
  return result;
}

// Michael's shape on 10 August 2026: three iPhone clips of 18, 13 and 29 seconds
// (about 57 MB each at the 4K setting) plus his 31 photos.
const SEED = [[3, 57 * 1024 * 1024], [31, 3 * 1024 * 1024]];

const OLD = `(async () => {
  const { exportSnapshot } = await import('/src/lib/db.ts');
  const { buildFlog } = await import('/src/lib/flog.ts');
  const snapshot = await exportSnapshot();
  // exportedAt pins the archive's date fields, and it is Date.now() on both
  // paths, so it is forced to one constant here. Without it every run produces
  // different bytes and the two paths can never be shown to agree — which is
  // what the first version of this comparison discovered the hard way.
  snapshot.exportedAt = 1700000400000;
  const bytes = buildFlog(snapshot);
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  window.__flogBlob = blob;
  return { size: blob.size };
})()`;

const NEW = `(async () => {
  const { exportSnapshotSources } = await import('/src/lib/db.ts');
  const { buildFlogBlob } = await import('/src/lib/flog.ts');
  const parts = await exportSnapshotSources();
  const blob = await buildFlogBlob(Object.assign({}, parts, { exportedAt: 1700000400000, onProgress: () => {} }));
  window.__flogBlob = blob;
  return { size: blob.size };
})()`;

const mb = (n) => `${n.toFixed(0)} MB`;
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const spread = (xs) => `${mb(Math.min(...xs))} to ${mb(Math.max(...xs))} (median ${mb(med(xs))})`;

const all = { OLD: [], NEW: [] };
for (let i = 0; i < RUNS; i++) {
  all.OLD.push(await run('OLD', SEED, OLD));
  all.NEW.push(await run('NEW', SEED, NEW));
}

const hashes = new Set([...all.OLD, ...all.NEW].map((r) => r.hash));
const archiveMb = all.OLD[0].size / 1024 / 1024;
const totalMb = SEED.reduce((t, [c, b]) => t + (c * b) / 1024 / 1024, 0);

console.log(`\nLibrary: ${SEED.map(([c, b]) => `${c} x ${(b / 1024 / 1024).toFixed(0)} MB`).join(' + ')} = ${totalMb.toFixed(0)} MB`);
console.log(`Runs per path: ${RUNS}. Archive: ${mb(archiveMb)}.`);
console.log(hashes.size === 1
  ? `Both paths produced the identical archive (sha256 ${[...hashes][0].slice(0, 16)}…).`
  : `*** THE TWO PATHS PRODUCED DIFFERENT ARCHIVES (${hashes.size} hashes). The comparison below is meaningless. ***`);

for (const key of ['OLD', 'NEW']) {
  const rs = all[key];
  // LABEL THESE HONESTLY. Only the first is a peak. Pss has no high-water form
  // in Linux, so the second is a single reading taken after the save returned —
  // it says what is still resident at the END, which for a path whose whole
  // design is to be transient is exactly the wrong question. Two comments in
  // danger-zone files quoted the second one as "peak" before this label existed.
  console.log(`\n${key}`);
  console.log(`    PEAK growth during the save (VmHWM):   ${spread(rs.map((r) => r.hwmGrowth))}`);
  console.log(`    still resident when it finished (Pss): ${spread(rs.map((r) => r.pssGrowth))}`);
  console.log(`    baseline drift over 0.5s: ${mb(Math.max(...rs.map((r) => r.baselineDrift)))} · reset on ${rs[0].resetCount} processes`);
}
console.log(`\nThe archive itself is ${mb(archiveMb)} and has to exist. PEAK spend ABOVE it:`);
for (const key of ['OLD', 'NEW']) {
  console.log(`    ${key}: ${mb(med(all[key].map((r) => r.hwmGrowth)) - archiveMb)}`);
}

// The three things that would silently make every number above smaller and
// wronger. They were printed and never checked, which makes them decoration
// rather than controls — so they exit non-zero now.
const problems = [];
if (hashes.size !== 1) problems.push('the two paths produced different archives');
const drift = Math.max(...[...all.OLD, ...all.NEW].map((r) => r.baselineDrift));
if (drift > 5) problems.push(`the baseline was still moving (${mb(drift)} in half a second)`);
const expectedPids = all.OLD[0].resetCount;
if (expectedPids < 2) problems.push(`high-water marks were reset on only ${expectedPids} processes`);
if (problems.length) {
  console.log(`\n*** THESE NUMBERS ARE NOT TRUSTWORTHY: ${problems.join('; ')} ***`);
  process.exitCode = 1;
}
