-- FirearmLog benchmark endpoint — D1 schema (applied in step 4 via
-- `wrangler d1 execute`, never at runtime).
--
-- ONE row per bucket. This table is the privacy design made physical: there
-- is no contributions table, no timestamp column, no IP column, no ID column.
-- A contribution is folded into its bucket's count + histogram at POST time
-- and then exists nowhere else ("raw POSTs not retained beyond processing",
-- build spec §5).
--
-- bins: JSON array of 50 non-negative integers — the fixed-width histogram
-- over the metric's plausibility range (see worker/contract.ts). Stored as
-- TEXT and updated in place with SQLite's json_set (see worker/store.ts).

CREATE TABLE IF NOT EXISTS buckets (
  key          TEXT PRIMARY KEY, -- scoringType|division|class|gunCategory|metric
  scoring_type TEXT NOT NULL,
  division     TEXT NOT NULL,
  class        TEXT NOT NULL,
  gun_category TEXT NOT NULL,
  metric       TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  bins         TEXT NOT NULL
);
