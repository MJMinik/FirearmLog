#!/usr/bin/env node
// Generates a fresh ECDSA P-256 key pair for a FirearmLog licence signing
// key (ENTITLEMENT_SPEC_2026-09-18.md section 3.3 and section 4.5, the key
// ceremony). Prints both halves once, to the terminal, and writes nothing to
// disk: this script never opens a file.
//
// PUBLIC half: paste into src/lib/licence.ts's LICENCE_KEYS under a new kid.
// PRIVATE half: paste into Cloudflare's secret store (wrangler secret put
// SIGNING_KEY_JWK) and into Apple Passwords. Never into a file, never into
// this repository, never into a chat.
//
// Run with: node licence-worker/scripts/generate-key.mjs

const pair = await globalThis.crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);
const publicJwk = await globalThis.crypto.subtle.exportKey('jwk', pair.publicKey);
const privateJwk = await globalThis.crypto.subtle.exportKey('jwk', pair.privateKey);

console.log('PUBLIC (paste into src/lib/licence.ts LICENCE_KEYS under a new kid):');
console.log(JSON.stringify(publicJwk));
console.log('');
console.log('PRIVATE (paste into Cloudflare secrets and Apple Passwords only, never a file):');
console.log(JSON.stringify(privateJwk));
