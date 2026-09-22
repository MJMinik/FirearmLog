// Signing a licence (ENTITLEMENT_SPEC_2026-09-18.md §3.1 and §4.3).
//
// The mirror image of src/lib/licence.ts's verifyLicence: this builds the
// FL1.<payload>.<signature> text, ECDSA P-256 over SHA-256 of the UTF-8
// bytes of the base64url payload STRING, raw r||s form, which is exactly
// what the browser's crypto.subtle.verify expects on the other end.
//
// The signature itself differs run to run (the WebCrypto ECDSA scheme adds
// fresh randomness each time it signs) even for the identical payload; both
// signatures verify, and spec §3.1 says this is fine: nothing depends on two
// signings of the same purchase producing the same bytes, only the same
// payload.

import { base64UrlEncode } from '../src/lib/licence.ts';
import type { LicencePayload } from '../src/lib/licence.ts';

/**
 * Turns a payload into the exact JSON string that gets signed, in a FIXED
 * field order: v, kid, iss, plan, seq (only for founding), ref, at, to
 * (only when present). The order itself carries no meaning to the verifier
 * (JSON.parse does not care), but fixing it means two signings of the same
 * purchase produce byte-identical payload text, which is what spec §4.3
 * means by "there is nothing to store and nothing to drift" and what
 * tests/licence-worker.test.ts checks directly.
 */
function serializePayload(payload: LicencePayload): string {
  const ordered: Record<string, unknown> = {
    v: payload.v,
    kid: payload.kid,
    iss: payload.iss,
    plan: payload.plan,
  };
  if (payload.plan === 'founding') ordered.seq = payload.seq;
  ordered.ref = payload.ref;
  ordered.at = payload.at;
  if (payload.to !== undefined) ordered.to = payload.to;
  return JSON.stringify(ordered);
}

/** Builds and signs a licence text for `payload` with `privateKeyJwk` (the
 *  Worker secret, spec §4.5). Workers have crypto.subtle built in, the same
 *  as a browser. */
export async function signLicence(
  payload: LicencePayload,
  privateKeyJwk: JsonWebKey,
): Promise<string> {
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(serializePayload(payload)));
  const key = await crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(payloadB64),
  );
  const sigB64 = base64UrlEncode(new Uint8Array(sigBuf));
  return `FL1.${payloadB64}.${sigB64}`;
}
