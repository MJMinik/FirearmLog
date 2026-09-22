# FirearmLog licence Worker (Cloudflare Worker)

**Status: INERT.** This folder is ENTITLEMENT_SPEC_2026-09-18.md §11,
build-order step 2: written and tested, but **not deployed, and not called
by the app or the website**. It is a second, separate Worker from
`App/worker/` (the benchmark endpoint), which has its own, unrelated design.

Design source of truth: `ENTITLEMENT_SPEC_2026-09-18.md` §4 (this Worker),
§3 (the licence format it signs), and §9 (the parts that are Paddle-specific
and are filled in the day Paddle approves).

## What it is

Three routes, one table:

| Route              | Does                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /v1/webhook` | Paddle tells us a purchase completed. Checks Paddle's webhook signature; if the product is the founding one, takes the next founding number. Always answers Paddle, never the buyer. |
| `GET /v1/licence`  | Given a transaction id, asks the merchant whether it is real and paid, builds the licence payload from that record, signs it, returns it. Rate-limited.                              |
| `GET /healthz`     | Liveness only.                                                                                                                                                                       |

## The founding counter

`schema.sql` is one table: `founding(seq PRIMARY KEY, txn UNIQUE, at)`. The
two uniqueness rules are the whole safety property: a number can never be
handed out twice, and a purchase can never take two numbers. `store.ts`
claims a number in one SQL statement that refuses to insert at all once 200
rows exist, so the 200-founding-member cap cannot be raced past.

## Section 9: what is deliberately not finished

`merchant.ts`'s `PaddleMerchantLookup` and `index.ts`'s webhook body parsing
are skeletons. Every field name, the webhook header, and the endpoint URL
are placeholders until someone reads Paddle's own documentation on the day
Paddle approves and confirms them against it (spec §9). Nothing about the
rest of this folder depends on that day: the routes, the founding counter,
and the signing are real, tested code now.

## The key ceremony

The private signing key is generated once, by Michael, and stored as a
Cloudflare Worker secret (`SIGNING_KEY_JWK`) and nowhere else in any file. A
copy also goes into Apple Passwords under Michael's control, because it is a
string that can open something. **It never appears in this repository, in a
screenshot, or in a chat.** The public half is added to `src/lib/licence.ts`'s
`LICENCE_KEYS` under its own `kid`, and that list only ever grows (spec §3.3):
removing a key would silently break every honest buyer whose licence it
signed.

If the private key is ever exposed, a new pair is generated, new licences
carry the new `kid`, and the old public key stays in the app forever. That is
the true cost of "no phone-home, ever" (spec §3.3), and this design accepts
it rather than pretending otherwise.

Two small scripts under `scripts/` carry out the mechanical parts:

- `scripts/generate-key.mjs` prints a fresh ECDSA P-256 key pair, PUBLIC and
  PRIVATE clearly labelled, and writes nothing to disk. Run it once, paste
  the public half into `LICENCE_KEYS`, paste the private half into
  Cloudflare secrets and Apple Passwords, and close the terminal.
- `scripts/sign-tester-licence.mjs` signs one licence for a pre-launch
  tester or for Michael himself (decision 12.11), from the same
  `signLicence` code path the Worker itself uses. It reads the private key
  from an environment variable, never a file, and refuses to run if a
  required argument is missing. Taking the tester's founding number from the
  live counter is a separate step, done by hand, so a number is never minted
  by accident from a laptop. See the script's own header for the exact
  command.

## Files

- `schema.sql`: the one-table D1 schema (applied by hand, never at runtime)
- `store.ts`: the `FoundingStore` seam, its D1 implementation, and an
  in-memory implementation for tests
- `sign.ts`: builds and signs the `FL1.` licence text
- `merchant.ts`: the `MerchantLookup` seam, a test double, and the Paddle
  skeleton (section 9)
- `index.ts`: routing, CORS, the webhook signature check, error containment
- `wrangler.toml`: deploy config with the ceremony checklist inline
- `scripts/`: the key-ceremony tools described above

## Tests

`tests/licence-worker.test.ts` runs in the repo's normal suite (`npm test`).
The D1 adapter runs against real SQLite (`node:sqlite`, the same engine D1
runs on), the same choice `tests/worker.test.ts` makes for the benchmark
Worker. One test signs a licence through this Worker and verifies it with
`verifyLicence` from `src/lib/licence.ts`, so the two halves of the licence
system are proven to agree, not just each internally consistent.
