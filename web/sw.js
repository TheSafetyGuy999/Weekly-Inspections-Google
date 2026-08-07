/*
 * Offline shell for the Airfield Maintenance app.
 *
 * The app itself is one self-contained bundle (index.html carries React, jsPDF,
 * fonts and the logo inline), so precaching four files is enough to make the
 * whole thing work with no connectivity — which is the normal state at a lodge
 * airfield. Inspection records live in localStorage and are queued by the app,
 * not by this worker.
 *
 * BUILD_ID is replaced with the commit SHA at deploy time so that every release
 * mints a fresh cache and evicts the previous one.
 */
const BUILD_ID = '__BUILD_ID__';
const CACHE = 'airfield-' + BUILD_ID;

// './' and not './index.html': Cloudflare Pages answers /index.html with a 308
// redirect to /, cache.addAll rejects on a redirect, and a rejected install
// means no service worker and no offline support at all — which would only
// show up at a lodge with no signal, long after it shipped.
const SHELL = './';
const PRECACHE = [
  SHELL,
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (c) => {
        // The shell is the one thing worth failing over; a missing icon is not
        // a reason to leave the app with no offline mode.
        await c.add(SHELL);
        await Promise.allSettled(PRECACHE.slice(1).map((u) => c.add(u)));
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Never touch report delivery — those are cross-origin POSTs to the mail
  // backend and must fail loudly so the app can queue the report instead.
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  const url = new URL(req.url);
  // Never intercept API endpoints or admin routes in the Service Worker
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return;

  // Navigations always resolve to the app shell, online or not.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(SHELL)));
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
