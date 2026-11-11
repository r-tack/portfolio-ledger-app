/* Offline support. The app page and its two libraries are kept in a cache, so the app opens
   without a connection. The prices file is never cached here: it is always fetched fresh. */
const CACHE = 'portfolio-ledger-v1';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', 'local.js', 'manifest.webmanifest', 'icon-192.png']).catch(() => {}))); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const rq = e.request, url = new URL(rq.url);
  if (rq.method !== 'GET' || url.pathname.endsWith('/prices.json.enc')) return;
  const own = url.origin === location.origin, lib = /^(cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.host);
  if (!own && !lib) return;
  const save = r => { if (r && (r.ok || r.type === 'opaque')) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(rq, copy)); } return r; };
  // The app's own files: newest from the network, the cached copy when offline. Libraries: cached copy first.
  e.respondWith(own ? fetch(rq).then(save).catch(() => caches.match(rq, { ignoreSearch: true }).then(r => r || caches.match('./')))
    : caches.match(rq).then(r => r || fetch(rq).then(save)));
});
