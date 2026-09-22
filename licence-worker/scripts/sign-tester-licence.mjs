#!/usr/bin/env node
// Signs one tester licence from the command line, using the exact same code
// path the Worker itself uses to sign a real purchase (sign.ts's
// signLicence), so a tester licence is never a second, possibly-drifted copy
// of the format.
//
// Decision 12.11: pre-launch testers and Michael get founding licences
// issued by hand, from the Worker's own tool, with their founding numbers
// taken from the same counter (ENTITLEMENT_SPEC_2026-09-18.md section 12).
// This script signs; taking the next founding number from the live counter
// is a separate, deliberate step (see licence-worker/README.md, "The key
// ceremony"), so a founding number is never minted by accident from a
// laptop, only chosen and recorded on purpose.
//
// The private key is read from an ENVIRONMENT VARIABLE, never a file
// argument, and this script writes nothing to disk:
//
//   SIGNING_KEY_JWK='{"kty":"EC","crv":"P-256",...,"d":"..."}' \
//     node --experimental-strip-types licence-worker/scripts/sign-tester-licence.mjs \
//     --kid=<kid> --plan=founding --seq=1 --ref=tester-1 --at=2026-09-21 --to="Jane Shooter"
//
// --kid, --plan, --ref and --at are always required. --seq is required when
// --plan=founding (the claimed founding number) and must be OMITTED when
// --plan=standard, because only a founding licence carries one (spec
// section 3.1). --to is always optional (spec section 3.1).

import { signLicence } from '../sign.ts';

function readArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg === undefined ? undefined : arg.slice(prefix.length);
}

function refuse(message) {
  console.error(`Refusing: ${message}`);
  process.exit(1);
}

const privateKeyJson = process.env.SIGNING_KEY_JWK;
if (!privateKeyJson) {
  refuse('set SIGNING_KEY_JWK in the environment (never a file argument).');
}

const kid = readArg('kid');
const plan = readArg('plan');
const seqRaw = readArg('seq');
const ref = readArg('ref');
const at = readArg('at');
const to = readArg('to');

if (!kid || !plan || !ref || !at) {
  refuse('--kid, --plan, --ref and --at are all required.');
}
if (plan !== 'founding' && plan !== 'standard') {
  refuse('--plan must be "founding" or "standard".');
}
if (plan === 'founding' && !seqRaw) {
  refuse('--seq is required for --plan=founding (the claimed founding number).');
}
if (plan === 'standard' && seqRaw) {
  refuse('--seq must be omitted for --plan=standard (only a founding licence carries one).');
}

const payload = { v: 1, kid, iss: 'web', plan, ref, at };
if (plan === 'founding') payload.seq = Number(seqRaw);
if (to) payload.to = to;

const privateKeyJwk = JSON.parse(privateKeyJson);
const licence = await signLicence(payload, privateKeyJwk);
console.log(licence);
