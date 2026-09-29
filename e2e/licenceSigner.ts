import { webcrypto } from 'node:crypto';

// Signs a licence for the browser tests, with the key pair playwright.config.ts
// generated for this run (FL_E2E_LICENCE_PRIVKEY). The format is the one the
// signing Worker produces (licence-worker/sign.ts): FL1.<payload>.<signature>,
// ECDSA P-256 over SHA-256 of the UTF-8 bytes of the base64url payload
// string, raw r-then-s. No key is stored in any file; the private half exists
// only in this process's environment.

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

export interface TestLicence {
  plan?: 'founding' | 'standard';
  seq?: number;
  to?: string;
  at?: string;
  ref?: string;
  /** Use a kid the app does not know (a licence the app must refuse). */
  kid?: string;
}

export async function signTestLicence(opts: TestLicence = {}): Promise<string> {
  const priv = process.env.FL_E2E_LICENCE_PRIVKEY;
  const pub = process.env.FL_E2E_LICENCE_PUBKEY;
  if (!priv || !pub) throw new Error('playwright.config.ts did not set the licence test keys');
  const kid = opts.kid ?? (JSON.parse(pub) as { kid: string }).kid;
  const plan = opts.plan ?? 'standard';
  const payload: Record<string, unknown> = { v: 1, kid, iss: 'web', plan };
  if (plan === 'founding') payload.seq = opts.seq ?? 17;
  payload.ref = opts.ref ?? 'txn_e2e_test';
  payload.at = opts.at ?? '2026-11-03';
  if (opts.to !== undefined) payload.to = opts.to;
  const payloadB64 = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await webcrypto.subtle.importKey(
    'jwk', JSON.parse(priv), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );
  const sig = await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(payloadB64),
  );
  return `FL1.${payloadB64}.${b64url(new Uint8Array(sig))}`;
}
