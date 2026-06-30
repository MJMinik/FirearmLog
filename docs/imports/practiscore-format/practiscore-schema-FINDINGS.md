# PractiScore results / .psc JSON structure — captured 2026-06-30

## Source of truth
The canonical schema comes from PractiScore's own match-manager source:
https://github.com/jglover/practiscore-match-manager  (lib/ps_classes/*.js)
These classes parse/serialize the exact JSON that PractiScore's app, the .psc file,
and the (now-locked) results.json all use. Field names below are verbatim from that source.

## Could NOT get a live raw results.json (honest note)
- The historical anonymous path is confirmed real:
  https://s3.amazonaws.com/ps-scores/production/<MATCH_UUID>/results.json
  (also match_def.json and match_scores.json at the same prefix).
- As of this capture it returns HTTP 403 AccessDenied (S3 bucket locked down) —
  exactly the lockdown the community thread describes. Verified live from a
  practiscore.com browser tab for two real matches:
    UUID 7154f559-6425-4cea-9b9d-2dc617db0416 (Steel Challenge) -> 403
    UUID 679c461f-0bef-456a-88f3-5e11c925b555 (Marysville USPSA NW02, numeric id 279947) -> 403
- practiscore.com/results/new/<numericId> redirects to /results/all/<numericId> and
  renders the score tables as server-side HTML; it does NOT fetch a JSON the browser
  can grab. So no anonymous JSON endpoint is currently reachable.

## TOP-LEVEL SHAPE (two separate objects, bundled together in a .psc file)
A match is split into:
  1. match_def  (definition: stages, shooters, divisions, classes)  -> matchdef.js
  2. match_scores (the scores)                                       -> matchscores.js

### match_scores object
{
  "match_id": "<match UUID>",
  "match_scores": [ <StageScores>, ... ],     // one entry per stage
  "match_scores_history": { ... }             // optional edit history
}

### StageScores (one per stage) — keyed by stage UUID
{
  "stage_number": 1,
  "stage_uuid": "<stage UUID>",
  "stage_stagescores": [ <Score>, ... ]        // one Score per shooter on this stage
}

### Score (one shooter's score on one stage) — THE HIT BREAKDOWN LIVES HERE
{
  "shtr": "<shooter UID>",   // links to a shooter in match_def
  "str":  [ 12.34, ... ],    // string times (array, seconds). One entry per string.
  "ts":   [ <int>, ... ],    // TARGET SCORES, one bit-packed int per target  <-- A/C/D/M/NS
  "proc": 0,                 // procedural penalty COUNT
  "poph": 0,                 // popper hits
  "popm": 0,                 // popper misses
  "aprv": true,              // approved
  "dnf":  false,             // did not finish
  "dqr":  "",                // DQ reason
  "penr": "",                // penalty reason
  "dname":"", "udid":"", "mod":"<utc timestamp>"
}

## ***THE A / C / D / M / NS MAPPING*** (verbatim from lib/ps_classes/score.js, tsDecode)
Each element of the `ts` array is ONE TARGET. It is a single integer, bit-packed,
4 bits (one nibble) per hit type. To decode target hits:

  a   = (hits >>  0) & 0x0f   // # of Alpha  (A)
  b   = (hits >>  4) & 0x0f   // # of Bravo  (B)   (legacy classic target B-zone)
  c   = (hits >>  8) & 0x0f   // # of Charlie (C)
  d   = (hits >> 12) & 0x0f   // # of Delta  (D)
  ns  = (hits >> 16) & 0x0f   // # of No-Shoot (NS)
  m   = (hits >> 20) & 0x0f   // # of Miss   (M)
  npm = (hits >> 24) & 0x0f   // # of Non-Penalty Miss (NPM)

So to get a stage total for a shooter, sum each nibble across every element of `ts`:
  alphas   = sum over ts of ((t>>0)&0xf)
  bravos   = sum over ts of ((t>>4)&0xf)
  charlies = sum over ts of ((t>>8)&0xf)
  deltas   = sum over ts of ((t>>12)&0xf)
  noshoots = sum over ts of ((t>>16)&0xf)
  misses   = sum over ts of ((t>>20)&0xf)
  npm      = sum over ts of ((t>>24)&0xf)

PROCEDURALS are NOT in `ts`. They are the separate top-level `proc` integer on the Score.

## Power factor, division, class — live in match_def (NOT in the score)
On each shooter object in match_def.getShooters():
  - power factor field is `pf` (per Shooter class: setPowerFactorMajor/Minor) -> "MAJOR"/"MINOR"
  - division `div`, class `class`, name fields, shooter UID `sh_uid`/`sh_id`
The Score row only carries `shtr` (the UID); you join it back to match_def to get
division / power factor / name.

## Time, points, hit factor, stage % — DERIVED, not stored
- Time: from `str` (sum of string times) -> getStringTimesTotal().
- Raw points / hit factor / stage percent: PractiScore COMPUTES these from
  (ts hits x USPSA point values for the shooter's power factor) minus penalties,
  divided by time. They are not stored as fields in the score JSON; the
  match-manager recomputes them (see lib/matchtypes/uspsa.js). USPSA point values:
    A=5; C= 4(major)/3(minor); D= 2(major)/1(minor); M = -10 each; NS = -10 each;
    procedural = -10 each. HitFactor = max(points,0) / time.
  (These point values are the standard USPSA rules; confirm against uspsa.js when
   building the importer — I could not fully extract uspsa.js this session, see notes.)

## Numeric id vs UUID
- Old matches are reachable by numeric id (e.g. /results/all/279947); newer ones by
  UUID (e.g. /results/html/7154f559-...). The numeric id maps to a UUID
  (279947 -> 679c461f-0bef-456a-88f3-5e11c925b555, seen embedded in the page).
- The JSON STRUCTURE is the same for both (the S3 prefix always uses the UUID).
  I could not diff two live JSON payloads because both were 403-locked.

## Practical takeaway for the FirearmLog importer
- The realistic import source is a user-supplied .psc file (or the PractiScore
  Competitor app export), NOT a live URL scrape — the anonymous results.json is dead.
- Parse: match_scores -> per stage (stage_uuid) -> per shooter (shtr) -> decode `ts`
  nibbles for A/B/C/D/M/NS/NPM, read `proc` for procedurals, `str` for time.
- Join shooter `shtr` UID to match_def for division / power factor / name.
