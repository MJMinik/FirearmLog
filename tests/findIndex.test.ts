// Find a screen (decision 75, 12 Sep 2026, build 2): machine checks on the
// ONE table (src/ui/findIndex.ts) behind the search box, the sidebar, and
// the Tour & Setup "Where do I find…" index.
//
// matchesQuery and the ranking helpers are imported from matchQuery.ts /
// findSearch.ts rather than ListSearch.tsx: ListSearch.tsx is a .tsx file
// (JSX), and node's --experimental-strip-types runner refuses to load a
// .tsx file at all — confirmed the same way tests/helpScreenCopy.test.ts's
// own comment confirms it for HelpScreen.tsx (`Unknown file extension
// ".tsx"`, not merely a JSX parse error). matchQuery.ts and findSearch.ts
// are plain .ts files with no JSX, built for exactly this reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIND_INDEX, findEntries } from '../src/ui/findIndex.ts';
import { matchesQuery } from '../src/ui/matchQuery.ts';
import { searchFindEntries, parentIconFor } from '../src/ui/findSearch.ts';

const MAIN_TABS = ['home', 'log', 'compete', 'progress'];

// M2 (cold audit, session 79): MoreScreen is now DERIVED from FIND_INDEX
// (src/ui/screens.tsx) instead of a hand-copied list of View kinds, so the
// old "kinds the More screen opens today" table no longer guards anything —
// a screen row just needs a real destination and an icon to render.
test('every kind: "screen" entry is a main tab or has a view target, and has an icon', () => {
  for (const e of FIND_INDEX) {
    if (e.kind !== 'screen') continue;
    assert.ok(e.icon, `${e.id} is a screen entry with no icon`);
    const isTab = 'tab' in e.go && MAIN_TABS.includes(e.go.tab);
    const hasView = 'view' in e.go;
    assert.ok(isTab || hasView, `${e.id} is a screen entry with neither a main tab nor a view target`);
  }
});

// M2: the audit's mutation (c) deleted an inside row and nothing caught it —
// the More screen, the sidebar, and the index all just quietly showed one
// fewer thing. Pinning the raw count catches that class of change directly.
// Adding, removing, or renaming a FIND_INDEX row is expected to change this
// number — update it right alongside the row change, deliberately.
test('FIND_INDEX has exactly 44 entries (a deliberate change to the table changes this number)', () => {
  assert.equal(FIND_INDEX.length, 44);
});

test('every entry lists at least 2 words', () => {
  for (const e of FIND_INDEX) {
    assert.ok(e.words.length >= 2, `${e.id} has fewer than 2 words (${e.words.length})`);
  }
});

test('ids are unique', () => {
  const ids = FIND_INDEX.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate id in FIND_INDEX');
});

test('names are unique', () => {
  const names = FIND_INDEX.map((e) => e.name);
  assert.equal(new Set(names).size, names.length, 'duplicate name in FIND_INDEX');
});

// M1 (cold audit, session 79): parentIconFor used to GUESS an inside row's
// icon from its `go` target; now it looks up `parent` directly. This is the
// guard that a `parent` id actually names a real screen row that itself has
// an icon to lend — a typo'd or dangling `parent` would silently fall back
// to the generic chevron in the UI without this failing.
test('every "inside" entry\'s parent names an existing "screen" entry with an icon', () => {
  const screens = new Map(FIND_INDEX.filter((e) => e.kind === 'screen').map((e) => [e.id, e]));
  for (const e of FIND_INDEX) {
    if (e.kind !== 'inside') continue;
    assert.ok(e.parent, `${e.id} is an inside entry with no parent`);
    const parent = screens.get(e.parent!);
    assert.ok(parent, `${e.id}'s parent "${e.parent}" is not a kind: 'screen' entry`);
    assert.ok(parent!.icon, `${e.id}'s parent "${e.parent}" has no icon`);
    assert.equal(parent!.group, e.group, `${e.id}'s parent "${e.parent}" is in another group`);
    assert.equal(parentIconFor(e), parent!.icon, `parentIconFor(${e.id}) should return its parent's icon`);
  }
});

test('matchesQuery("heatmap", …) finds progress-grid', () => {
  const entries = findEntries();
  const hit = entries.find((e) => e.id === 'progress-grid');
  assert.ok(hit, 'progress-grid missing from findEntries()');
  assert.ok(matchesQuery('heatmap', hit!.name, hit!.words.join(' '), hit!.group));
});

test('matchesQuery("who you are", …) finds settings', () => {
  const entries = findEntries();
  const hit = entries.find((e) => e.id === 'settings');
  assert.ok(hit, 'settings missing from findEntries()');
  assert.ok(matchesQuery('who you are', hit!.name, hit!.words.join(' '), hit!.group));
});

// H3 + M3: matching and ranking (cold audit, session 79).
//
// The ranking helper: a NAME match ranks above a words/group-only match.
// The spec's own illustration ("drills" -> drills before
// progress-drill-history) doesn't actually hold against the real table:
// progress-drill-history's words are all singular ("drill history", "one
// drill over time", …) and none contain the substring "drills", so
// matchesQuery('drills', …) never matches it at all (verified directly
// against FIND_INDEX before writing this test). The real pair that DOES
// exercise the same ranking rule is 'drills' (a name match) ranking above
// 'progress-timed' (a words-only match, via "par drills" in its words) for
// the same query — this test uses that pair instead.
test('ranking: a name match ranks before a words-only match (query "drills")', () => {
  const entries = findEntries();
  const ranked = searchFindEntries('drills', entries);
  const drillsIdx = ranked.findIndex((e) => e.id === 'drills');
  const timedIdx = ranked.findIndex((e) => e.id === 'progress-timed');
  assert.notEqual(drillsIdx, -1, '"drills" (a name match) should be in the ranked results');
  assert.notEqual(timedIdx, -1, 'progress-timed (a words-only match, via "par drills") should be in the ranked results');
  assert.ok(drillsIdx < timedIdx, `expected 'drills' (name match) before 'progress-timed' (words-only); got ${drillsIdx} vs ${timedIdx}`);
});

// H3: "compete" used to match every one of the ~14 rows under the composite
// "Home, Log, Compete & Progress" group, because the group's own literal
// label contains the substring "compete" — the audit's whole reason for
// excluding that label from the search text. With it excluded, "compete"
// still needs to find Compete's own inside rows (via their `parent`), just
// not Home's or Log's.
test('"compete" ranks the Compete screen first, with its own inside rows close behind', () => {
  const ranked = searchFindEntries('compete', findEntries());
  const ids = ranked.map((e) => e.id);
  assert.equal(ids[0], 'compete', `expected 'compete' first; got ${JSON.stringify(ids)}`);
  for (const id of ['compete-classification', 'compete-log-classifier', 'compete-log-match']) {
    assert.ok(ids.includes(id), `expected ${id} in the top ${ids.length} for "compete"; got ${JSON.stringify(ids)}`);
  }
  assert.ok(
    ids.includes('compete-practiscore') || ids.includes('compete-uspsa-import'),
    `expected at least one importer row in the top ${ids.length} for "compete"; got ${JSON.stringify(ids)}`
  );
  // And NOT one of Home/Log/Progress's inside rows dragged in by the old
  // group-label bug (progress-grid never mentions "compete" anywhere).
  assert.ok(!ids.includes('progress-grid'), '"compete" should not match progress-grid');
});

test('"battery" ranks the Optics screen above the Home "Needs Attention" inside row', () => {
  const ranked = searchFindEntries('battery', findEntries());
  const opticsIdx = ranked.findIndex((e) => e.id === 'optics');
  const homeIdx = ranked.findIndex((e) => e.id === 'home-attention');
  assert.notEqual(opticsIdx, -1, '"battery" should match optics');
  assert.notEqual(homeIdx, -1, '"battery" should match home-attention');
  assert.ok(opticsIdx < homeIdx, `expected optics (screen) before home-attention (inside); got ${opticsIdx} vs ${homeIdx}`);
});

test('"clean" ranks the Gun Maintenance screen above every inside row it also matches', () => {
  const ranked = searchFindEntries('clean', findEntries());
  const maintenanceIdx = ranked.findIndex((e) => e.id === 'maintenance');
  assert.notEqual(maintenanceIdx, -1, '"clean" should match maintenance');
  for (let i = 0; i < maintenanceIdx; i++) {
    assert.equal(ranked[i].kind, 'screen', `expected only screen rows before maintenance for "clean"; found ${ranked[i].id} (${ranked[i].kind}) at ${i}`);
  }
});

// M3: the audit's mutation (b) removed the cap and nothing pinned it —
// "log" matches far more than 8 rows (the Log tab itself, its own inside
// rows via their parent's name, "log a classifier"/"log a match", "log a
// purchase", "new log", and "flog" in Sync's own words), so this is a
// query that actually exercises the cap rather than happening to stop short
// of it on its own.
test('the phone ranking helper caps results at 8 (query "log")', () => {
  const ranked = searchFindEntries('log', findEntries());
  assert.equal(ranked.length, 8, `expected exactly 8 results for "log"; got ${ranked.length}`);
});

// Decision 76 (14 Sep 2026, s147): the filtered desktop sidebar shows a grey
// path line under each "inside" row — the entry's `desktop` path minus what
// the sidebar already shows. Pin the rule on every row, and on the three
// shapes Michael was shown when he chose option 1.
import { sidebarPathFor } from '../src/ui/findSearch.ts';

test('sidebarPathFor: every "inside" row gets a path that names neither the sidebar nor its own group label', () => {
  for (const e of FIND_INDEX) {
    const p = sidebarPathFor(e);
    if (e.kind === 'screen') { assert.equal(p, undefined, `${e.id} is a screen row and should have no path line`); continue; }
    assert.ok(p, `${e.id} is an inside row with no path line`);
    assert.ok(!p.startsWith('sidebar'), `${e.id}: "${p}" still says sidebar`);
    if (e.group !== 'Home, Log, Compete & Progress') assert.ok(!p.startsWith(e.group), `${e.id}: "${p}" repeats its group label`);
    assert.ok(p.includes('→'), `${e.id}: "${p}" is not a path`);
    assert.notEqual(p, e.name, `${e.id}: the path only repeats the name`);
  }
});

test('sidebarPathFor: the three examples from decision 76', () => {
  const byId = (id: string) => FIND_INDEX.find((e) => e.id === id)!;
  assert.equal(sidebarPathFor(byId('compete-log-classifier')), 'Compete → + Log Classifier');
  assert.equal(sidebarPathFor(byId('log-search')), 'Log → Search & Filter');
  assert.equal(sidebarPathFor(byId('costs-purchase')), 'Costs & Purchases → + Purchase');
});
