// FirearmLog service worker — keeps the app working offline.
// Bump CACHE_VERSION on each release so users get fresh files.
const CACHE_VERSION = 'firearmlog-v12';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;

  // App navigation: try the network first (so updates arrive), fall back to cache (so offline works).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only cache a genuine, successful same-origin response — never a 5xx/error
          // or opaque response, which would poison the cache and serve a broken shell
          // offline (pro-grade audit T1-3).
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // Stable-named data assets (e.g. demo-dataset.bin in public/): network-first, so a new
  // deploy is never served stale. The app's own code/CSS get fingerprinted filenames — a new
  // build simply asks for a new name, so cache-first is safe for them below. But files in
  // public/ keep a FIXED name, so cache-first would pin the first copy forever and hand back
  // an old demo after a fresh deploy. Fetch these from the network; fall back to the saved
  // copy only when offline. (Removes the reliance on remembering to bump CACHE_VERSION.)
  if (new URL(req.url).pathname.endsWith('.bin')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || undefined))
    );
    return;
  }

  // Everything else: cache first (built files have hashed names, so stale files are impossible).
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          // Same guard: don't cache a failed/opaque response (T1-3).
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
    )
  );
});
