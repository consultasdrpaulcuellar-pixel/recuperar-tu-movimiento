/*
  Service worker del Libro Web.

  Estrategia:
    - La página y data/content.json van "primero a la red": el lector
      siempre ve la última versión publicada del libro, y solo si no hay
      conexión (o la red tarda demasiado) se sirve la copia guardada.
    - Todo lo demás (CSS, JS, íconos, imágenes) va "stale-while-revalidate":
      se sirve al instante desde caché y se actualiza en segundo plano.
    - Las imágenes del libro NO se listan a mano: la app le manda al service
      worker la lista que encuentra en content.json (mensaje PRECACHE) y
      este guarda las que ya existen. Las que todavía son placeholders se
      omiten sin romper nada, y se guardan solas cuando aparezcan.

  IMPORTANTE al personalizar un libro nuevo:
  1. Cambia CACHE_NAME (por ejemplo "mi-libro-v1"). Si publicas una
     actualización del motor (CSS/JS), sube el número de versión
     ("mi-libro-v2") para descartar la caché vieja.
  2. APP_SHELL solo lleva los archivos fijos del motor. Suma ahí archivos
     extra que el libro necesite siempre (por ejemplo fuentes locales),
     pero NUNCA un archivo que todavía no existe: si un solo archivo de
     APP_SHELL falta en el servidor, falla el "install" completo y el
     sitio no funciona offline.
*/

const CACHE_NAME = 'recuperar-tu-movimiento-v4';

const APP_SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/styles.css',
  'js/app.js',
  'data/content.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'images/icon_dr_cuellar.svg'
];

// Si la red tarda más que esto y hay copia guardada, se sirve la copia.
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function isOk(response) {
  return response && response.status === 200;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  let cached = await cache.match(request, { ignoreSearch: true });
  if (!cached && request.mode === 'navigate') cached = await cache.match('index.html');

  const network = fetch(request).then((response) => {
    if (isOk(response)) cache.put(request, response.clone());
    return response;
  });

  if (!cached) return network.catch(() => Response.error());

  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_TIMEOUT_MS));
  return Promise.race([network.catch(() => cached), timeout]);
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (isOk(response)) cache.put(request, response.clone());
    return response;
  });
  if (cached) {
    network.catch(() => { /* sin red: ya servimos la copia guardada */ });
    return cached;
  }
  return network.catch(() => Response.error());
}

self.addEventListener('fetch', (event) => {
  // Solo interceptamos peticiones GET del mismo origen.
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const wantsFresh = event.request.mode === 'navigate' || url.pathname.endsWith('/data/content.json');
  event.respondWith(wantsFresh ? networkFirst(event.request) : staleWhileRevalidate(event.request));
});

// La app envía la lista de imágenes del libro para dejarlas disponibles
// offline. Cada una se intenta por separado: una imagen que todavía no
// existe no impide guardar las demás.
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'PRECACHE' || !Array.isArray(data.urls)) return;
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(data.urls.map(async (raw) => {
        const url = new URL(raw, self.registration.scope);
        if (url.origin !== self.location.origin) return;
        if (await cache.match(url.href)) return;
        const response = await fetch(url.href);
        if (isOk(response)) await cache.put(url.href, response);
      }))
    )
  );
});
