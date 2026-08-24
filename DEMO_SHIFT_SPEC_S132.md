# DEMO DATE SHIFT — build spec (session 132, 24 Aug 2026)

Decision signed by Michael (session 132, option 1): the sample log's fixed dates
(newest session 2026-06-21) sit permanently below the forecast feature's 90-day
evidence gate, so the demo can never show the forecast line. Fix: slide every
date in the demo forward AT LOAD TIME so the log always ends "about a week ago,"
whenever it is loaded. The shipped `public/demo-dataset.bin` and
`scripts/make-demo.ts` stay BYTE-IDENTICAL — only the load step changes.

## 1. New module: `src/lib/demoShift.ts`

Pure module. May import ONLY from `./flog.ts` (the `Snapshot` type) and
`./types.ts`. NO database access, NO imports from db.ts.

### Exported API

```ts
/** Whole-week shift, in ms, that lands the newest dated session or match in
 *  [now-14d, now-7d]. 0 if the log is already that fresh (or newer). */
export function demoDateShiftMs(snap: Snapshot, nowMs: number): number

/** Applies the shift IN PLACE to a freshly parsed, private snapshot and
 *  returns it. In-place on purpose: the snapshot is a throwaway value parsed
 *  seconds earlier from the bundled file, and copying would clone ~1 MB of
 *  photo ArrayBuffers for no safety gain. Never call on a user's own data. */
export function shiftDemoDates(snap: Snapshot, nowMs: number): Snapshot
```

### Shift computation (whole weeks — this is load-bearing)

- newestMs = max over `snap.stores.sessions[].date` (ISO `YYYY-MM-DD`),
  parsed as `Date.parse(date + 'T12:00:00Z')` (noon UTC — same convention the
  generator uses, so day boundaries can't wobble with the host timezone).
  Consider ALL sessions (planned or not) and also matches' dates — take the
  max across sessions AND matches so no record ever lands in the future by
  more than the target window allows. (Matches and sessions are interleaved in
  the story; the true newest record governs.)
- rawDelta = (nowMs - 7*DAY) - newestMs; if rawDelta < 0 → shift 0.
- shift = floor(rawDelta / WEEK) * WEEK.
- Whole weeks so every weekday is preserved: Saturday matches stay Saturdays,
  the Monday start stays a Monday. Spacing between any two records is exactly
  preserved (uniform shift), so the arc the demoStory tests pin is untouched.

### What gets shifted (conservative explicit rules)

Walk the snapshot recursively — `snap.stores` (every store, every record) and
`snap.media`, plus the top-level `exportedAt` and `lastModified`:

1. **ISO date strings**: any STRING value matching `/^\d{4}-\d{2}-\d{2}$/`,
   under ANY key → shift by (shift / DAY) days via noon-UTC arithmetic,
   re-rendered `YYYY-MM-DD`. Empty strings and non-matching strings untouched.
2. **Epoch-ms numbers**: a NUMBER value under a key in
   `EPOCH_KEYS = new Set(['createdAt','updatedAt','deletedAt','importedAt',
   'lastBackupAt','exportedAt','lastModified'])`, when the value is finite and
   ≥ `EPOCH_FLOOR = Date.parse('2020-01-01T00:00:00Z')` → value + shift.
   (trash-store `deletedAt` can be an ISO string — rule 1 catches its
   bare-date form, and the unit suite's timestamp-string guard goes red if a
   full ISO-timestamp form ever appears in the bin.)
3. Recurse into plain objects and arrays only. Explicitly SKIP ArrayBuffer,
   typed arrays, and null. (Media `data` must pass through untouched.)

Field inventory this covers (from types.ts, checked 24 Aug): sessions/matches/
classifiers/skills/malfunctions `date`; firearms `dateAcquired`, `statusDate`,
`barrelInstallDate`; magazines `lastCleanedAt`; optics+parts `installDate`;
purchases `datePurchased`; goals `dateSet`, `dateAchieved`; reminders
`dueDate`, `lastDoneDate`; BaseRecord `createdAt`/`updatedAt`; trash
`deletedAt` (rule 1 catches its bare-date string form; the unit suite's
timestamp-string guard goes red if a full ISO-timestamp form ever appears in
the bin); settings `lastBackupAt`; snapshot `exportedAt`/`lastModified`;
media BaseRecord stamps. The COMPLETENESS TEST below is the real guarantee —
the list above is documentation, not the mechanism.

## 2. Call site: `src/ui/SetupWizard.tsx` — `loadDemo()` only

```ts
const snap = parseFlog(new Uint8Array(await res.arrayBuffer()));
await restoreSnapshot(shiftDemoDates(snap, Date.now()));
```

One line added, one import. NOTHING else in the wizard changes. No other call
site anywhere (grep-check: `shiftDemoDates` appears in exactly demoShift.ts,
SetupWizard.tsx, and tests).

## 3. Unit tests: `tests/demoShift.test.ts`

Load the REAL shipped artifact exactly as demoStory.test.ts does (readFileSync
public/demo-dataset.bin → parseFlog). Use a fixed `NOW` constant
(e.g. Date.parse('2027-03-15T16:00:00Z')) — tests must not read the clock.
Parse the bin TWICE (two independent snapshots) so pre-shift and post-shift
can be compared without deep-cloning.

1. **Completeness sweep — the watchdog, independent of the implementation.**
   A test-local recursive scanner (written fresh in the test file, NOT
   imported from demoShift.ts) collects `(path, value)` for EVERY number in
   `[EPOCH_FLOOR, NOW + 5y]` under ANY key, and EVERY `/^\d{4}-\d{2}-\d{2}$/`
   string, from the unshifted snapshot. After `shiftDemoDates`, every
   collected number must equal `old + shift` and every collected date must
   equal `old + shift/DAY` days. ZERO exclusions. The scanner deliberately
   ignores EPOCH_KEYS — it flags epoch-range numbers under keys the
   implementation doesn't know, which is exactly the miss it exists to catch.
2. **The watchdog barks — permanent sabotage proof.** Build a tiny synthetic
   snapshot whose one record carries `createdAt` (in EPOCH_KEYS) and
   `finishedAt` (epoch-range, NOT in EPOCH_KEYS). Run shiftDemoDates, run the
   scanner: it MUST report `finishedAt` unshifted. Assert the report is
   non-empty and names finishedAt. This pins forever that the sweep in test 1
   can actually fail. (It also documents the known limitation honestly: a
   future field named outside EPOCH_KEYS shows up as a red test, which is the
   design.)
3. **Freshness**: newest session lands in [NOW-14d, NOW-7d].
4. **Weekday + spacing preserved**: for all sessions, weekday(new)==
   weekday(old); the sorted list of gaps between consecutive session dates is
   identical pre/post. Record ORDER within each store unchanged.
5. **Evidence gate opens**: after shifting, at least one gun has ≥3 live
   sessions and ≥200 rounds within [NOW-90d, NOW] (compute from sessions'
   per-gun round counts the same way the app's forecast window does — import
   the forecast module's helper if exported, else compute inline and say so).
6. **Already-fresh no-op**: shifting with `NOW = newestMs + 8*DAY` gives
   shift 0 and a byte-equal store walk.
7. **Nothing else mutates**: media `data` ArrayBuffer references are the SAME
   objects (===) after shifting; record counts per store unchanged;
   `demo-dataset.bin` on disk untouched (this one is really the git-status
   check in CI, but assert counts anyway).

## 4. E2E: `e2e/demo-dates.spec.ts` (both projects)

1. Fresh app → Setup wizard → tap "See a log 18 months in" (handle its
   confirm step if one appears) → wait for load to finish.
2. Navigate to More → Gun Maintenance (mobile) / sidebar Gun Maintenance
   (desktop): assert at least one element matching
   /At your recent pace|Months away at your recent pace/ is VISIBLE.
3. Navigate Home: assert the pace line does NOT appear anywhere on it
   (Home stays measured-facts-only — mirror the existing forecast spec's
   Home assertion against the demo data).
4. Assert the Log screen's newest entry is NOT the old fixed era: the string
   `2026` must not appear as the newest session's year when the test runs
   (write it relative: the newest visible session date parses to within 21
   days of the test clock — use the page's own rendered date. AMENDED from
   90 at the cold audit, finding 4: 90 would also pass on an UNSHIFTED bin
   for the first three months after each regeneration; 21 clears the shift's
   7–14-day landing window plus parse fuzz and discriminates immediately).
Follow the existing e2e conventions (see e2e/maint-forecast.spec.ts for
selector style, the desktop/mobile navigation helpers, and beforeEach reset).

## 5. Hard constraints

- `scripts/make-demo.ts`, `public/demo-dataset.bin`, `tests/demoStory.test.ts`
  BYTE-IDENTICAL (git status must show them untouched).
- No danger-zone file is edited (db.ts, flog.ts, import/*, practiscore.ts,
  uspsaClassifier.ts, csv.ts, recordShape.ts, check-shape.mjs).
- Comments follow repo house style: long-form WHY comments; never claim a
  comment as evidence; no comment may overstate ("same guard X uses" only if
  literally true).
- Lint (ESLint 9) and `tsc --noEmit` clean; full unit suite green; new E2E
  green on desktop AND mobile projects.
