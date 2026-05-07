// カレンダー Service Worker v2 - アイコン更新
const CACHE = 'calendar-v2';
const ASSETS = ['/','/index.html','/css/style.css','/js/app.js','/manifest.json',
  '/icons/icon-192.png','/icons/icon-512.png','/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => Promise.all(ASSETS.map(u => c.add(u).catch(()=>{}))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if ('focus' in c) { await c.focus(); if (c.navigate) { try { await c.navigate(url); } catch(_){} } return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isAsset = /\.(html|js|css)$/.test(url.pathname) || url.pathname === '/';
  if (isAsset) {
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(()=>{}); }
        return res;
      }).catch(() => caches.match(req).then(c => c || caches.match('/index.html')))
    );
  } else {
    e.respondWith(caches.match(req).then(cached => cached || fetch(req)));
  }
});
