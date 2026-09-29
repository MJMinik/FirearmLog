/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Test-only threshold override (session 141, video-guards spec §5): true in
// dev and in a CI build run with FL_E2E=1, false in every real production
// build (vite.config.ts's `define`). Lets E2E trip the large-video sheet on a
// tiny fixture without the override branch shipping to real users — see
// MediaField.tsx's use of it, and vite.config.ts for how it's set.
declare const __FL_E2E__: boolean;

// Test-only licence key (entitlement build, 28 Sep 2026). null in every real
// build: vite.config.ts fills it from the FL_E2E_LICENCE_PUBKEY environment
// variable, which only playwright.config.ts ever sets, and only with a PUBLIC
// key generated at run time. See src/lib/licenceState.ts (appLicenceKeys).
declare const __FL_E2E_LICENCE_KEY__: { kid: string; jwk: JsonWebKey } | null;
