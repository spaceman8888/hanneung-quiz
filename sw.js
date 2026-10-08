importScripts('version.js');
const CACHE = self.APP_VERSION;
const FILES = ['./', 'index.html', 'version.js', 'app.js', 'logic.js', 'cards.json', 'notes.json', 'map.json', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== 'img').map(k => caches.delete(k)))));
  self.clients.claim();
});

// Photos live in their own cache that survives app updates; each is stored the first time it is shown.
// ponytail: photo files are treated as immutable — to change a photo, give it a new file name.
self.addEventListener('fetch', e => {
  if (new URL(e.request.url).pathname.includes('/img/')) {
    e.respondWith(caches.open('img').then(c => c.match(e.request).then(r => r || fetch(e.request).then(res => {
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }))));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
