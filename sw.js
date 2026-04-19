/* DC Monitor — Service Worker
   Caches the app shell so the tool opens even with no signal at BRS.
   Bump SHELL_VERSION to force refresh after deploys. */

const SHELL_VERSION = 'v1.0.1';
const CACHE = `dcm-shell-${SHELL_VERSION}`;
const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.json',
  './icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never intercept Firebase or Gemini calls — they must stay live
  if (url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('aistudio.google.com')) {
    return;
  }

  // Only handle same-origin GETs
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // Stale-while-revalidate for shell
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
