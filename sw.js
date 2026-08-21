/* ============================================================
   PWR / PEDRO — Service Worker
   ------------------------------------------------------------
   Existência deste arquivo é o que faz o Chrome instalar o PWR
   como APP DE VERDADE (WebAPK no Android), e não como um mero
   atalho frágil que some quando você reinicia o celular. Também
   é o que faz o app ABRIR SEM INTERNET (academia no subsolo).

   Estratégia:
   - Precache do "casco" do app (index.html + ícones + manifest).
   - Navegações: rede primeiro, cai pro cache se estiver offline.
   - Demais arquivos do próprio app: cache primeiro, rede depois.
   - Fontes do Google (outra origem): passam direto; offline caem
     nos fallbacks (Georgia etc.), sem travar.

   IMPORTANTE: ao publicar uma versão nova do index.html, suba o
   número de CACHE_VERSION abaixo (ex.: v2 → v3). Assim o SW troca
   o cache antigo e serve o app atualizado.
   ============================================================ */

const CACHE_VERSION = 'pwr-v10';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png'
];

// INSTALL — pré-carrega o casco. addAll falharia inteiro se um item
// desse 404; então adicionamos um por um, tolerando faltas (ex.: um
// ícone que você ainda não subiu não impede o app de instalar).
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await Promise.all(CORE_ASSETS.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (e) { /* item ausente — segue o jogo */ }
    }));
    self.skipWaiting();
  })());
});

// ACTIVATE — remove caches de versões antigas e assume o controle já.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE_VERSION ? caches.delete(k) : null)));
    await self.clients.claim();
  })());
});

// Permite que a página peça atualização imediata (ver index.html).
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // FONTES DO GOOGLE (outra origem): cache primeiro, atualiza por trás.
  // Sem isto o app abre offline com as fontes de fallback (Georgia) em vez
  // do Cinzel/Inter — o service worker anterior já fazia certo, e mantemos.
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (isFont) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const hit = await cache.match(req);
      if (hit) {
        // já temos: serve na hora e atualiza em segundo plano
        fetch(req).then((resp) => cache.put(req, resp.clone()).catch(() => {})).catch(() => {});
        return hit;
      }
      try {
        const resp = await fetch(req);
        // O CSS do Google chega OPACO (o <link> não pede CORS), e o cache
        // recusa resposta opaca — era por isso que a fonte nunca ficava
        // guardada. Refazemos a busca com CORS só para poder cachear;
        // o Google Fonts serve com Access-Control-Allow-Origin.
        if (resp.type === 'opaque') {
          fetch(req.url, { mode: 'cors' })
            .then((c) => { if (c && c.ok) cache.put(req, c.clone()).catch(() => {}); })
            .catch(() => {});
        } else {
          cache.put(req, resp.clone()).catch(() => {});
        }
        return resp;
      } catch (e) {
        // IMPORTANTE: sem cache e sem rede, ainda assim precisa devolver uma
        // Response de verdade. Devolver undefined aqui quebrava o carregamento
        // da página inteira offline — a fonte falha sozinha e o app abre.
        return new Response('', { status: 504, statusText: 'offline' });
      }
    })());
    return;
  }

  // Demais origens externas passam direto.
  if (url.origin !== self.location.origin) return;

  // Navegações (abrir o app): rede primeiro pra pegar atualização,
  // cai pro index.html do cache quando offline. ignoreSearch pra
  // casar mesmo com ?source=pwa / ?app=... na start_url.
  const isNavigation = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_VERSION);
        cache.put('./index.html', fresh.clone()).catch(() => {});
        return fresh;
      } catch (e) {
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match(req, { ignoreSearch: true })) ||
               (await cache.match('./index.html')) ||
               (await cache.match('./')) ||
               Response.error();
      }
    })());
    return;
  }

  // Demais recursos do app (ícones, manifest): cache primeiro.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.status === 200 && fresh.type === 'basic') {
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (e) {
      return Response.error();
    }
  })());
});
