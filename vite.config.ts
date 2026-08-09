import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base './' makes the build work from any URL path, including
// GitHub Pages project sites like https://<user>.github.io/<repo>/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    // ---------------------------------------------------------------------------
    // Offline + freshness service worker (Workbox, via vite-plugin-pwa).
    //
    // WHY this replaces the old hand-rolled public/sw.js:
    //  - The hand-rolled SW used a NETWORK-FIRST navigation fetch that went through
    //    the default HTTP cache. GitHub Pages serves index.html with
    //    `cache-control: max-age=600`, so for up to 10 minutes after a deploy a
    //    normal reopen kept getting the OLD, HTTP-cached index.html. That old shell
    //    points at hashed JS filenames that the deploy has DELETED (they 404), so
    //    the app never boots -> blank screen; or it simply shows stale content.
    //  - Workbox PRECACHES the app shell (index.html + every hashed asset) with a
    //    content revision. The precached index.html is served from the Cache Storage
    //    the SW controls, NOT the HTTP cache, so the 10-minute HTTP TTL can no longer
    //    pin a stale shell. A new deploy ships a new SW whose precache manifest lists
    //    the new index.html + new assets; when that SW activates it atomically swaps
    //    the whole shell and deletes the old precache. Result: a cold launch ALWAYS
    //    serves a complete, self-consistent shell (never a shell pointing at 404'd
    //    JS -> never blank), works fully offline, and promptly moves to the latest
    //    build.
    //
    // registerType 'autoUpdate' + skipWaiting + clientsClaim = auto-takeover:
    //  - On a fresh page load the browser byte-compares sw.js; if the deploy changed
    //    it, the new SW installs, skips waiting, claims the open clients, and the
    //    virtual registerSW module reloads once to the new shell. So even a user who
    //    is STUCK on an old build recovers on the next natural reopen WITHOUT any
    //    tap. The banner (below) is the extra courtesy for a tab left open.
    // ---------------------------------------------------------------------------
    VitePWA({
      registerType: 'autoUpdate',
      // We inject registration ourselves (src/ui/registerSw.ts) so we can wire the
      // existing "A new version is ready" banner instead of the plugin's default UI.
      injectRegister: null,
      // Ship OUR manifest file as-is (kept in public/); don't let the plugin
      // generate/override it. This keeps base './', scope './', and the icon set
      // exactly as they are today.
      manifest: false,
      includeAssets: [],
      workbox: {
        // Precache the built app shell + all hashed JS/CSS + the icons/manifest.
        globPatterns: ['**/*.{js,css,html,webmanifest,png,svg,ico}'],
        // demo-dataset.bin is a large, fixed-name file fetched on demand — do NOT
        // bake it into the precache (keeps the install small and lets the runtime
        // NetworkFirst rule below keep it fresh after a deploy).
        globIgnores: ['**/demo-dataset.bin'],
        // Take over immediately so a new deploy applies on next load, not "someday".
        skipWaiting: true,
        clientsClaim: true,
        // Clean out precaches from prior builds so old shells can't linger.
        cleanupOutdatedCaches: true,
        // SPA fallback: any in-app navigation resolves to the precached index.html
        // (served from Cache Storage, immune to the 10-min HTTP TTL).
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // Fixed-name data blobs (e.g. public/demo-dataset.bin) keep the SAME URL
            // across deploys, so a cache-first rule would pin the first copy forever
            // and serve a stale demo. NetworkFirst = always try the network first
            // (fresh after a deploy), fall back to the last saved copy only when
            // offline. Replicates the old sw.js *.bin special-case.
            urlPattern: ({ url }) => url.pathname.endsWith('.bin'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'flog-data-bin',
              // T1-3 guard: only ever store a genuine 200 (never a 404/opaque),
              // so a failed fetch can't poison the offline copy.
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 4 },
            },
          },
        ],
      },
      // Keep dev untouched (SW registers in production only, same as before).
      devOptions: { enabled: false },
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
    // ─── The browser floor, stated rather than implied ────────────────────────
    // This is Vite's own default list with ONE change: safari14 becomes
    // safari15.4. Michael's decision, 9 August 2026, when `structuredClone`
    // arrived in the backup reader (see the comment at cloneMeta in
    // src/lib/flog.ts) — it needs Safari 15.4, March 2022, and it is the first
    // call anywhere in src/ that needs anything newer than Safari 14.
    //
    // Be clear about what this line does and does not do, because it is easy to
    // read it as a fix. It controls SYNTAX only: which language features esbuild
    // may leave in the bundle rather than rewriting into older forms. It does
    // NOT add missing APIs — no target setting makes structuredClone exist on a
    // browser that lacks it. What it does is stop the build claiming support for
    // a browser we no longer support, and stop the two targets in this project
    // disagreeing silently: tsconfig says ES2022, but that pass is --noEmit, so
    // it never constrained the shipped bundle at all.
    //
    // Note that nothing checks APIs against this floor. If a future change
    // reaches for something newer than Safari 15.4, this line will not catch it;
    // only a person will. Raise the number here in the same change that raises
    // the need, and say so out loud.
    target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari15.4'],
  },
});
