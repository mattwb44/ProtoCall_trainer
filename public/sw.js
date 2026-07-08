// ProtoCall Trainer service worker.
// Shell + media: cache-first. Library GETs: network-first with cache fallback.
// Auth, live sessions, and sockets: never cached.
const CACHE = 'protocall-v1';
const SHELL = ['/', '/manifest.json', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const CACHEABLE_API = /^\/api\/(scenarios$|public\/scenarios)/;

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/socket.io')) return;

  // Library reads: freshest wins, cache keeps the firehouse browsing offline.
  if (CACHEABLE_API.test(url.pathname)) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  if (url.pathname.startsWith('/api/')) return; // everything else API: network only

  // Shell, media, QR: cache-first, backfill from network.
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok && (url.pathname.startsWith('/media/') || SHELL.includes(url.pathname))) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
