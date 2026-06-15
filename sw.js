// アプリ本体（シェル）のキャッシュ名。更新時はバージョンを上げる。
const SHELL_CACHE = 'otobako-shell-v1';

const SHELL_ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// インストール時：アプリ本体をキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// 有効化時：古いキャッシュを削除
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

// fetch時：
// - アプリ本体ファイル（同一オリジン）はキャッシュ優先 → オフラインでも開ける
// - GASへのAPI通信や外部リソースはネットワーク優先（キャッシュしない）
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 同一オリジンのナビゲーション・静的アセットはキャッシュファースト
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((res) => {
          // 取得できたら次回用にキャッシュへ追加
          const resClone = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, resClone));
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }

  // それ以外（GAS APIなど）は通常のネットワーク優先。失敗時はそのまま失敗させる
  // → 音声は事前にIndexedDBへ保存しておく前提のため、ここでキャッシュしない
  event.respondWith(fetch(event.request));
});
