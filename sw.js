/* BASURA Y MÁS · Service worker (PWA instalable y uso offline básico)
   Estrategia:
   · Páginas (navegación): red primero y copia guardada como respaldo, para
     que una actualización se vea en la primera recarga (antes se servía la
     versión vieja desde caché y había que recargar dos veces).
   · Recursos del mismo origen (iconos, manifiesto): caché primero con
     refresco en segundo plano.
   · APIs externas (OSM, OSRM, Nominatim, Supabase): directo a la red. */
const CACHE = 'bym-v5';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(PRECACHE); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Leaflet/OSM/OSRM/Supabase → red

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then(function (c) { c.put('./index.html', copia); });
        }
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) { return hit || caches.match('./'); });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      const red = fetch(req).then(function (res) {
        if (res && res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copia); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || red;
    })
  );
});
