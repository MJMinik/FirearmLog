-- FirearmLog signing Worker -- D1 schema (ENTITLEMENT_SPEC_2026-09-18.md §4.2).
-- Applied by hand with `wrangler d1 execute`, never at runtime.
--
-- ONE table, and the two uniqueness rules are what make it safe: seq is the
-- primary key, so the same founding number can never be handed out twice;
-- txn is unique, so the same purchase can never take two numbers. Nothing
-- else is stored here -- no name, no email, no address, no IP (spec §4.4).

CREATE TABLE founding (
  seq INTEGER PRIMARY KEY,
  txn TEXT NOT NULL UNIQUE,
  at  TEXT NOT NULL
);
