/* Service worker do PWR — abre offline na academia. Só ativa em http(s).
   Documento: network-first (pega update quando online; cache como fallback).
   Fontes do Google: stale-while-revalidate (rápido, funciona offline). */
const CACHE = 'pwr-shell-v1';
const ASSETS = ['./', './index.html'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isDoc = req.mode === 'navigate' || req.destination === 'document' || url.pathname.endsWith('.html');
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

  if (isDoc) {
    e.respondWith(
      fetch(req).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return resp;
      }).catch(() => caches.match(req).then(h => h || caches.match('./index.html')).then(h => h || caches.match('./')))
    );
    return;
  }

  if (isFont || url.origin === location.origin) {
    // stale-while-revalidate: serve do cache na hora, atualiza por trás
    e.respondWith(
      caches.match(req).then(hit => {
        const net = fetch(req).then(resp => {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return resp;
        }).catch(() => hit);
        return hit || net;
      })
    );
  }
});
