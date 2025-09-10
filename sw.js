const CACHE = 'v2-2025-09-10'; // ← ここを更新すると強制リフレッシュ

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      c.addAll(['./','./index.html','./app.js','./manifest.webmanifest'])
    )
  );
  self.skipWaiting(); // 新SWを即座に有効化
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim(); // 既存タブにも新SWを適用
});

self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
