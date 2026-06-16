// バージョンを上げると古いキャッシュが自動的に破棄される
const SHELL_CACHE = 'otobako-shell-v3';

const SHELL_ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ネットワーク優先 → キャッシュにフォールバック（常に最新を取得しようとする）
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request).then((res) => {
        const resClone = res.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, resClone));
        return res;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(fetch(event.request));
});
