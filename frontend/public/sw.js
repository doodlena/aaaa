/* Lantern service worker — small and hand-written on purpose.
 *
 * - App shell: navigations are network-first and fall back to the cached index.html; hashed /assets/* are cache-first.
 * - API: ONLY public GETs for a pantry's detail (/api/resources/<id>) and visit plan (/api/resources/<id>/visit-plan)
 *   are cached (network-first, cache fallback) so a saved / recently viewed pantry's visit card opens offline.
 * - Never cached: /api/admin, /api/provider, /api/auth, /api/me, search, reports, AI, any non-GET request.
 */
const VERSION = 'os-v2';
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg'];
const MAX_DATA_ENTRIES = 80;

const CACHEABLE_API = /^\/api\/resources\/\d+(\/visit-plan)?$/;
const NEVER = /^\/api\/(admin|provider|auth|me)(\/|$)/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_DATA_ENTRIES; i++) await cache.delete(keys[i]);
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) {
      await cache.put(request, res.clone());
      if (cacheName === DATA) trim(cache);
    }
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER.test(url.pathname)) return;

  if (url.pathname.startsWith('/api/')) {
    if (CACHEABLE_API.test(url.pathname)) event.respondWith(networkFirst(req, DATA));
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match('/index.html')) || (await caches.match('/')) || Response.error()),
    );
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(SHELL).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
