// Source guards on the SAVE PATH's memory shape, plus one behavioural test of
// the lock it takes.
//
// THE NAMES SAY "SOURCE DOES NOT NAME", NOT "DOES NOT LOAD", AND THAT IS
// DELIBERATE. The first version of this file called itself "SyncCard never loads
// the whole library into memory". A cold auditor put the whole library back into
// memory behind a renamed import and every test stayed green. An oversold name
// is worse than no test, because it is what stops the next person looking. Each
// name here claims exactly what its assertion carries; the real memory property
// is measured in tests/exportSources.test.ts, not here.
//
// FIVE DEFEATS HAVE BEEN DEMONSTRATED AGAINST THIS FILE AND ALL FIVE ARE CLOSED.
// They are listed because each one is an ordinary edit somebody will make again:
//   · `import { exportSnapshot as loadWholeSnapshot }` — the bans wanted the name
//     followed by "(", which an aliased import does not have. Bans are on BARE
//     IDENTIFIERS now.
//   · re-wrapping the archive under a different variable name — the bans were
//     pinned to the literal name `bytes`. They are on the OPERATION now.
//   · extracting that re-wrap into a module-level helper — the operation bans
//     were scoped to saveToFile's braces, and moving three lines up one scope
//     walked past them. They apply to the whole file now, with the callback
//     scoping kept only where it is the point.
//   · taking the lock around nothing — the test only asked whether the word
//     appeared. It checks the CALLBACK's contents now.
//   · naming buildFlogBlob in a type position inside the callback while calling
//     it outside — a name check cannot tell a call from a type reference, so the
//     callback check requires the opening parenthesis.
//
// A grep proves what a file says, never what it does. That limit is why the
// behavioural test at the bottom exists and why the memory keeper lives
// elsewhere.
//
// AND THE "PROVEN AGAINST THE OLD TREE" CLAIM IS NO LONGER PROSE. It was written
// as prose twice and was wrong both times — first miscounting its own assertions,
// then denying that a check fails on HEAD when it does. Prose about a keeper is
// not a keeper. The predicates below are data, and the last test runs them
// against the committed HEAD version of SyncCard.tsx and asserts the exact split.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { withExclusiveIo } from '../src/lib/db.ts';

const SYNC_CARD = 'src/ui/SyncCard.tsx';

/** Executable lines only: the comments quote the very patterns being banned. */
function codeOf(text: string): string {
  return text
    .split('\n')
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

/**
 * The source of one function or callback, from an opening marker to its matching
 * close brace. Brace counting rather than a regex, because the whole question is
 * what sits INSIDE a callback and a regex cannot answer that.
 */
function bodyFrom(code: string, opener: string): string | null {
  const start = code.indexOf(opener);
  if (start === -1) return null;
  const open = code.indexOf('{', start);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  return null;
}


/**
 * The copy ban, applied to a source text with the one permitted site removed.
 * Pulled out as a function because it is applied to more than one file — see the
 * neighbouring-module test below.
 */
function noExtraCopy(src: string): boolean {
  const code = codeOf(src);
  const restore = bodyFrom(code, 'async function filePicked(');
  const rest = restore ? code.replace(restore, '') : code;
  return !/new Blob\(/.test(rest) && !/new ArrayBuffer\(/.test(rest) && !/\.arrayBuffer\(\)/.test(rest);
}

/**
 * Every check, as data, so the same predicates can be run against the current
 * file and against the pre-change one. `holds` returns true when the source is
 * acceptable — so a check that returns false on HEAD is one this pass repaired.
 */
const CHECKS: { name: string; why: string; holds: (src: string) => boolean }[] = [
  {
    name: 'does not name exportSnapshot',
    why: 'exportSnapshot loads every photo and video at once, which is the crash this pass removed. Use exportSnapshotSources().',
    holds: (s) => !/\bexportSnapshot\b/.test(codeOf(s)),
  },
  {
    name: 'does not name buildFlog',
    why: 'the in-memory writer allocates the whole archive a second time. Use buildFlogBlob().',
    holds: (s) => !/\bbuildFlog\b/.test(codeOf(s)),
  },
  {
    name: 'does not name getAllMediaWholeStore',
    why: 'no screen may load the whole media store.',
    holds: (s) => !/\bgetAllMediaWholeStore\b/.test(codeOf(s)),
  },
  {
    name: 'names exportSnapshotSources',
    why: 'the library must be read through the cursor-based source.',
    holds: (s) => /\bexportSnapshotSources\b/.test(codeOf(s)),
  },
  {
    name: 'names buildFlogBlob',
    why: 'the backup must be built with the streaming writer.',
    holds: (s) => /\bbuildFlogBlob\b/.test(codeOf(s)),
  },
  {
    // FILE-WIDE, NOT SCOPED TO saveToFile. Scoping it to one function's braces is
    // what a cold auditor walked past: he moved the copy three lines up, into a
    // module-level helper, and the ban no longer saw it. Extracting a helper is
    // the most ordinary refactor there is.
    //
    // ONE SITE IS EXCLUDED AND IT IS EXCLUDED BY NAME, not by a loose pattern:
    // filePicked, on the RESTORE side, reads the whole chosen file into memory
    // with `file.arrayBuffer()`. That is the read-side twin of the defect this
    // pass fixed on the write side, it costs about three times the file size,
    // and it is deliberately out of scope here (the signed spec is the save side
    // only). Excluding it by name means the guard still catches a new copy
    // anywhere else in the file, including in a helper, while recording the
    // known one instead of pretending it is not there.
    name: 'builds no second copy of the archive anywhere in the file',
    why: 'buildFlogBlob already returns a Blob; constructing another, or reading the archive back into an ArrayBuffer, is a full extra copy of the library. (The one permitted site is filePicked, on the restore side, which pass 3 removes.)',
    holds: (s) => noExtraCopy(s),
  },
  {
    name: 'reads the library inside the exclusive lock',
    why: 'taking a lock and then working unprotected reopens the race it exists to close.',
    holds: (s) => {
      const save = bodyFrom(codeOf(s), 'async function saveToFile()');
      const guarded = save && bodyFrom(save, 'withExclusiveIo(');
      // The parenthesis is required: a name alone is satisfied by a type
      // annotation, which was demonstrated with the pack running outside.
      return !!guarded && /\bexportSnapshotSources\s*\(/.test(guarded);
    },
  },
  {
    name: 'packs the archive inside the exclusive lock',
    why: 'the photo bytes are read during the pack, so that is when the exclusion is needed.',
    holds: (s) => {
      const save = bodyFrom(codeOf(s), 'async function saveToFile()');
      const guarded = save && bodyFrom(save, 'withExclusiveIo(');
      return !!guarded && /\bbuildFlogBlob\s*\(/.test(guarded);
    },
  },
];

const CURRENT = readFileSync(SYNC_CARD, 'utf8');

for (const check of CHECKS) {
  test(`save path: SyncCard source ${check.name}`, () => {
    assert.ok(check.holds(CURRENT), `${SYNC_CARD} — ${check.why}`);
  });
}

// The excluded site is recorded rather than forgotten: if the restore side ever
// stops reading the whole file, this goes red and the exclusion above can be
// deleted. That is the good kind of red — a guard telling you it is obsolete.
test('save path: the restore side still holds the one permitted whole-file read', () => {
  const restore = bodyFrom(codeOf(CURRENT), 'async function filePicked(');
  assert.ok(restore, 'filePicked is gone — the exclusion in the copy ban is now unexplained and must be removed');
  const copies = (restore.match(/\.arrayBuffer\(\)/g) ?? []).length;
  assert.equal(copies, 1,
    `filePicked makes ${copies} whole-file reads. One is the known restore-side copy that pass 3 removes; anything else is new.`);
});

// The one behavioural check here: the lock really does refuse a second holder,
// and it refuses in words that are true whichever job is holding it.
test('save path: a second job is refused while one holds the lock, in words that are true', async () => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  const first = withExclusiveIo('the backup', () => held);
  await assert.rejects(
    () => withExclusiveIo('the photo cleanup', async () => 'should not run'),
    (e: Error) => {
      assert.match(e.message, /Another change to your data is still finishing/);
      assert.match(e.message, /try the photo cleanup again/);
      // It must not claim to know which job is running: the backup holds this
      // lock now, and the old sentence said only an import or a restore could.
      assert.equal(/import or restore/.test(e.message), false,
        'the busy message names jobs that may not be the one running — the backup is the longest holder and was excluded by name');
      return true;
    },
  );
  release();
  await first;
});

// ─── The differential, as code rather than as a sentence ──────────────────────
// Which of the checks above are repairs and which are new constraints is a fact
// about the committed HEAD version of this file. Written as prose it was wrong
// twice. Here it is a comparison the runner performs.
//
// Skipped rather than failed when git or the blob is unavailable, so a shallow
// clone or an exported tarball cannot turn a missing tool into a red build.
test('save path: the guards that are repairs actually fail on the pre-change file', (t) => {
  let head: string;
  try {
    head = execFileSync('git', ['show', 'HEAD:src/ui/SyncCard.tsx'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    t.skip('git or HEAD:src/ui/SyncCard.tsx unavailable — the differential cannot be evaluated here');
    return;
  }
  // If HEAD already contains the change (i.e. this is running after the merge),
  // the differential is meaningless rather than wrong. Detect and skip.
  if (/\bbuildFlogBlob\b/.test(head)) {
    t.skip('HEAD already carries pass 2 — the pre-change comparison no longer applies');
    return;
  }
  const failing = CHECKS.filter((c) => !c.holds(head)).map((c) => c.name);
  const passing = CHECKS.filter((c) => c.holds(head)).map((c) => c.name);
  assert.deepEqual(failing, [
    'does not name exportSnapshot',
    'does not name buildFlog',
    'names exportSnapshotSources',
    'names buildFlogBlob',
    'builds no second copy of the archive anywhere in the file',
    'reads the library inside the exclusive lock',
    'packs the archive inside the exclusive lock',
  ], 'the set of checks that fail on the pre-change file is not what this file claims');
  assert.deepEqual(passing, [
    'does not name getAllMediaWholeStore',
  ], 'the set of checks that already held before this pass is not what this file claims');
});

// ---------------------------------------------------------------------------
// THE NEXT SCOPE UP. The copy ban above is file-wide, which closed the helper
// extraction an auditor demonstrated inside SyncCard. He then walked one scope
// further: a helper exported from a NEIGHBOURING module and called from
// saveToFile reads the archive back and re-wraps it, and nothing in the repo
// sees it. There is no general answer to "the next scope up" — a ban has to stop
// somewhere — so this stops at the modules SyncCard actually imports from its
// own directory, which is where a save-path helper would realistically live.
// Beyond that the honest keeper is the Chromium measurement, not a grep.
// ---------------------------------------------------------------------------
test('save path: the modules SyncCard imports locally build no second copy either', () => {
  const locals = [...CURRENT.matchAll(/^import[^']*'\.\/([\w.-]+)'/gm)].map((m) => m[1]);
  assert.ok(locals.length > 0, 'no local imports found — this guard has stopped reading SyncCard properly');
  const offenders = locals
    .filter((f, i) => locals.indexOf(f) === i)
    .filter((f) => !noExtraCopy(readFileSync(`src/ui/${f}`, 'utf8')));
  assert.deepEqual(offenders, [],
    `these modules SyncCard imports copy an archive: ${offenders.join(', ')}. A save-path helper here is outside the file-wide ban and would go unseen.`);
});
