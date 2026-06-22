const CACHE_VERSION = 'agrolima-secador-v5';
const STATIC_ASSETS = [
  '/css/styles.css',
  '/favicon.ico',
  '/icons/dryer-icon-192.png',
  '/icons/dryer-icon-512.png',
  '/manifest.webmanifest',
  '/js/dryer-pwa.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((cacheName) => cacheName !== CACHE_VERSION)
        .map((cacheName) => caches.delete(cacheName))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  // Rotas operacionais e autenticadas do secador devem consultar a rede.
  // Não use cache-first aqui para evitar status ou medições desatualizados.
  if (url.pathname === '/secador' || url.pathname.startsWith('/secador/')) {
    event.respondWith(fetch(request));
    return;
  }

  if (STATIC_ASSETS.includes(url.pathname) || url.pathname.startsWith('/images/')) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request).then((networkResponse) => {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, responseToCache));
          return networkResponse;
        });
      })
    );
  }
});
