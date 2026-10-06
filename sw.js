/* BASURA Y MÁS · Service worker (PWA instalable y uso offline básico)
   Estrategia:
   · Páginas (navegación), scripts y estilos (.js/.css): red primero y copia
     guardada como respaldo, para que una actualización se vea en la primera
     recarga. Antes el HTML iba por red pero app.js seguía caché-primero, así
     que un app.js viejo seguía sirviendo la versión anterior de la app: las
     colonias nuevas no aparecían hasta la segunda recarga.
   · Recursos del mismo origen (iconos, manifiesto): caché primero con
     refresco en segundo plano.
   · APIs externas (OSM, OSRM, Nominatim, Supabase): directo a la red.
   · /api/ (Eco con IA): nunca a la caché. Una respuesta del modelo no se
     puede guardar: sería una conversación congelada y además es lo único
     que depende de una clave del servidor. */
const CACHE = 'bym-v16';
const PRECACHE = [
  './',
  './index.html',
  './estilos.css',      // desde P4.16 el CSS vive fuera del HTML
  './app.js',           // y el JS también
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
  if (url.pathname.indexOf('/api/') === 0) return;  // Eco con IA → red siempre

  // .js y .css del mismo origen: red primero. app.js lleva el catálogo de
  // colonias, así que servirlo desde caché ocultaba las actualizaciones.
  const esCodigo = /\.(?:js|css)$/.test(url.pathname);
  if (req.mode === 'navigate' || esCodigo) {
    const esNav = req.mode === 'navigate';
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then(function (c) { c.put(esNav ? './index.html' : req, copia); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          if (hit) return hit;
          if (esNav) return caches.match('./index.html').then(function (h) { return h || caches.match('./'); });
          return new Response('', { status: 504, statusText: 'Sin red y sin copia guardada' });
        });
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
