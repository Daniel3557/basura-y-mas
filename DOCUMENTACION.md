# BASURA Y MÁS · Documentación técnica completa

> **Comunidad limpia para Ciudad Guzmán, Jalisco.**
> Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
> Producción: <https://basura-y-mas.vercel.app> · Repo: `Daniel3557/basura-y-mas`

Este documento es el mapa completo de la aplicación: qué archivos existen, qué hace cada línea de estructura, qué servicios externos consume, cómo viajan los datos, cómo está protegida la base de datos, cómo se despliega y cómo se usa. Todo está verificado contra el código real del repositorio.

> ⚠️ **Actualizado tras el endurecimiento P1–P4 (octubre 2026).**
> Cambió la estructura de archivos: el CSS y el JavaScript salieron de `index.html` a
> `estilos.css` y `app.js` para poder activar una `Content-Security-Policy` estricta.
> Las secciones 3, 4 y 5 describen todavía el monolito tal como estaba antes del cambio;
> los módulos, sus nombres y su orden **no han cambiado**, solo dónde viven. Las secciones
> **8, 16 y 17** sí están al día y describen el estado actual.

---

## Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Arquitectura en una imagen](#2-arquitectura-en-una-imagen)
3. [Inventario de archivos](#3-inventario-de-archivos)
4. [Anatomía de `index.html` bloque por bloque](#4-anatomía-de-indexhtml-bloque-por-bloque)
5. [Los 23 módulos JavaScript](#5-los-23-módulos-javascript)
6. [Integraciones externas (una por una)](#6-integraciones-externas-una-por-una)
7. [Flujos de extremo a extremo](#7-flujos-de-extremo-a-extremo)
8. [Supabase: base de datos, RLS, trigger y Storage](#8-supabase-base-de-datos-rls-trigger-y-storage)
9. [Gamificación](#9-gamificación)
10. [PWA, service worker y caché](#10-pwa-service-worker-y-caché)
11. [SEO y cabeceras de seguridad](#11-seo-y-cabeceras-de-seguridad)
12. [Accesibilidad](#12-accesibilidad)
13. [Despliegue](#13-despliegue)
14. [Cómo se usa la app (paso a paso)](#14-cómo-se-usa-la-app-paso-a-paso)
15. [Persistencia: todas las claves de localStorage](#15-persistencia-todas-las-claves-de-localstorage)
16. [Verificación y pruebas](#16-verificación-y-pruebas)
17. [Límites conocidos, pendientes y lo no verificado](#17-límites-conocidos-pendientes-y-lo-no-verificado)
18. [Glosario rápido](#18-glosario-rápido)

---

## 1. Resumen ejecutivo

**Qué es.** Una *single-page application* cívica y ecológica que vive en **un solo archivo HTML de 3 640 líneas** (`index.html`) que contiene a la vez el HTML, el CSS y el JavaScript. No hay framework, no hay bundler, no hay `npm install`, no hay proceso de build. Se abre y funciona.

**Qué hace.** Seis vistas navegables sin recargar la página:

| Vista | `id` | Línea | Para qué sirve |
|---|---|---|---|
| Inicio | `#view-inicio` | 623 | Resumen, acceso rápido, tarjeta de conciencia diaria |
| Mapa y rutas | `#view-mapa` | 704 | Mapa real con ruta de recolección, puntos, modo demostración |
| Guía de separación | `#view-guia` | 774 | Buscador de 21 residuos en 4 categorías |
| Reportes | `#view-reportes` | 878 | Formulario de reporte ciudadano con foto y ubicación |
| Comunidad | `#view-comunidad` | 961 | Muro de publicaciones, "Me importa", comentarios, compartir |
| Mi perfil | `#view-perfil` | 1012 | Puntos, nivel, progreso, insignias, historial de acciones |

**La idea de diseño central: honestidad de los datos.** La app nunca presenta como real algo que no lo es. Cada dato que el sistema *calcula* en lugar de *medir* está etiquetado:

- Los puntos de recolección son **"Punto propuesto por el sistema"** (se generan cada 400 m sobre la geometría real).
- El camión en movimiento es **"Modo demostración"** con banner visible (`#bannerDemo`).
- Si la nube no responde, todo se muestra como **"(copia local)"**.
- Si Overpass cae, la ruta avisa que viene de **"vialidades de OpenStreetMap (copia local)"**.
- El GPS real de camiones **no está conectado** y el código lo dice en un comentario explícito (`dataLayer.getVehiclePosition()` devuelve `null`).

**El segundo pilar: funciona sin internet.** Todo el estado vive en `localStorage`. La nube es un *extra*, no un requisito: si Supabase no responde, la app sigue aceptando reportes y los marca como locales.

**El tercer pilar: la seguridad está en la base de datos, no en el JavaScript.** El navegador es un cliente desatendido que puede ser modificado por cualquiera; por eso la únicos garantías reales son las políticas RLS y un trigger en PostgreSQL que *restaura* los campos protegidos en vez de rechazar la petición (para que un "Me importa" nunca se pierda por una copia desactualizada).

**Stack tecnológico:**

- **Frontend:** HTML5 + CSS3 (variables CSS, `color-mix`, media queries) + JavaScript ES2020 (IIFE con `'use strict'`, Promesas, `async/await`, `AbortController`, Canvas 2D).
- **Cero dependencias de build.** Dos únicas librerías externas: Leaflet 1.9.4 (CSS + JS desde unpkg).
- **Backend:** Supabase (PostgreSQL + PostgREST + GoTrue Auth + Storage) en plan gratuito.
- **Mapas:** Mapbox (teselas + Directions API), OpenStreetMap (Overpass API, Nominatim, teselas de respaldo), OSRM (routing abierto).
- **Hosting:** Vercel (estático, cabeceras vía `vercel.json`).
- **PWA:** `manifest.webmanifest` + service worker propio (`sw.js`).

---

## 2. Arquitectura en una imagen

```
┌───────────────────────────────────────────────────────────────────────┐
│  NAVEGADOR (una sola pestaña, una sola carga de index.html)          │
│                                                                       │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐              │
│  │  CAPA UI     │   │  CAPA LÓGICA │   │  CAPA DATOS  │              │
│  │  M0-M7       │   │  M8-M21      │   │  M3 + NUBE   │              │
│  │              │   │              │   │              │              │
│  │ renderX()    │◄──┤ gamificación │◄──┤ upsertNube() │              │
│  │ abrirModal() │   │ irA()        │   │ ssyncX()     │              │
│  │ toast()      │   │ iniciar()    │   │ subirFoto()  │              │
│  └──────────────┘   └──────────────┘   └──────┬───────┘              │
│                                               │                      │
│  ┌────────────┐   ┌────────────────┐          │                      │
│  │ localStorage│  │  state (RAM)   │◄─────────┘                      │
│  │ bym.v1 …    │  │  estado {}     │                                 │
│  └────────────┘   └────────────────┘         ┌─────────────────────┐  │
└──────────────────────────────────────────────┼─────────────────────┼──┘
                                               │                     │
        ┌──────────────────────────────────────┘                     │
        │                            ┌─────────────────────────────┘
        ▼                            ▼
┌───────────────────┐   ┌────────────────────────────────────────────┐
│  SUPABASE (nube)  │   │  SERVICIOS DE MAPAS (sin cuenta, sin costo) │
│                   │   │                                            │
│ Auth (cuentas)    │   │  Mapbox      → teselas + Directions API   │
│ PostgREST (filas) │   │  Overpass    → vialidades reales de OSM    │
│ Storage (fotos)   │   │  OSRM        → ruta por calles reales      │
│ PostgreSQL + RLS  │   │  Nominatim   → búsqueda de direcciones     │
└───────────────────┘   └────────────────────────────────────────────┘
```

**Por qué esta forma y no otra.** Un proyecto escolar de un solo desarrollador, sin presupuesto y sin servidor propio. Todo lo que se pueda ejecutar en el navegador se ejecuta en el navegador; lo único que necesita servidor es la base de datos compartida, y eso lo da Supabase en su plan gratuito. La consecuencia directa es que **cualquier compañero puede abrir el repositorio, hacer `git clone` y tener la app funcionando sin pedirle nada a nadie**.

---

## 3. Inventario de archivos

### Versionados en Git (lo que se despliega)

| Archivo | Bytes / Líneas | Función |
|---|---|---|
| `index.html` | 210 KB · 3 640 líneas | **Toda la aplicación.** HTML + CSS + JS |
| `sw.js` | 66 líneas | Service worker: PWA, caché `bym-v5`, red-primero |
| `manifest.webmanifest` | 18 líneas | Metadatos de la PWA instalable |
| `vercel.json` | 45 líneas | Cabeceras de seguridad y de caché |
| `supabase-schema.sql` | 228 líneas | Espejo completo del esquema de BD (para replicarlo) |
| `robots.txt` | 77 B | Permite todo, declara el sitemap |
| `sitemap.xml` | 274 B | Una URL, `lastmod`, `changefreq`, `priority` |
| `icon.svg` / `icon-192.png` / `icon-512.png` / `apple-touch-icon.png` | — | Iconos PWA en 4 formatos |
| `og.png` | 63 KB | Imagen 1200×630 para redes sociales |
| `video-demo-basura-y-mas.mp4` | 966 KB | Video de demostración |
| `README.md` | 5.3 KB | Resumen del proyecto, créditos, honesty statement |
| `.gitignore` | 389 B | Excluye material personal |
| `tests/e2e-supabase.js` | 135 líneas | Verificación automática de 24 comprobaciones |

### Locales, NO versionados (protegidos por `.gitignore`)

`.freebuff/`, `.vercel/`, `node_modules/`, `WhatsApp Image *.jpeg`, `qr-sitio.png`, `ecoruta-viva.html` (prototipo alternativo del autor, **no tocar ni subir**), `video-demo-basura-y-mas.webm`, `.DS_Store`, `Thumbs.db`.

> Nota: el `.mp4` del video **sí** está versionado a propósito (es material del proyecto); el `.webm` es la grabación de trabajo y no.

---

## 4. Anatomía de `index.html` bloque por bloque

### 4.1 `<head>` — líneas 3–37

Contiene, en orden:

**Metadatos base**
```html
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
```
`viewport-fit=cover` es lo que permite que el header respete la muesca del iPhone usando `env(safe-area-inset-*)`.

**SEO**
- `description`: resumen del proyecto con las palabras "FILOSOFARTE · Filosofía II · CBTis 226".
- `theme-color`: `#2E7D32` (verde); el JS lo cambia a `#0D1410` en tema oscuro.
- `<title>`: "BASURA Y MÁS · Comunidad limpia para Ciudad Guzmán".
- `<link rel="canonical" href="https://basura-y-mas.vercel.app/">` — evita que el motor de búsqueda trate parámetros de tracking como páginas distintas.
- `<link rel="sitemap" type="application/xml" href="./sitemap.xml">`.

**Open Graph y Twitter Card**
```html
<meta property="og:image" content="https://basura-y-mas.vercel.app/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
```
Con esto, al pegar el enlace en WhatsApp o Facebook aparece una vista previa con imagen.

**PWA en iOS** (no usa manifest, necesita meta tags explícitos):
```html
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="BASURA Y MÁS">
```

**Iconos** (4 entradas: SVG, 192, 512, apple-touch).

**Recursos externos:**
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
```
`preconnect` abre la conexión TLS antes de que el CSS solicite la fuente: ahorra ~200 ms de First Contentful Paint.

### 4.2 `<style>` — líneas 38–535

CSS plano con variables. Los bloques están numerados con comentarios para poder navegar el archivo:

| Bloque | Línea | Contenido |
|---|---|---|
| 1. VARIABLES | 39 | `:root` con paleta, radios, sombras, `color-scheme`, tema oscuro vía `[data-theme="dark"]` |
| 2. LOADER | 101 | Pantalla de carga con logo animado |
| 3. HEADER | 114 | Barra superior fija, sombra al hacer scroll (`.con-sombra`) |
| 4. NAVEGACIÓN | 132 | `.nav-lateral` (escritorio, columna izquierda) y `.nav-inferior` (móvil, 6 columnas, con `env(safe-area-inset-bottom)`) |
| 5. LAYOUT Y VISTAS | 152 | Contenedor, `.view` con `.activa` para mostrar/ocultar |
| 6. BOTONES | 175 | `.btn`, `.btn-claro`, `.btn-borde`, `.btn-enlace`, `.btn-secundario`, `.btn-chico` |
| 7. INICIO | 203 | Hero, tarjetas de acción rápida, tarjeta de conciencia |
| 8. MAPA | 248 | `#mapa` con altura fija, popups, marcadores personalizados (`.mk-punto`, `.mk-usuario` con pulso, `.mk-camion`) |
| 9. GUÍA | 311 | Tabs de 4 categorías, paneles, buscador, resultados |
| 10. FORMULARIOS | 348 | Campos, `.invalido`, mensajes de error, subida de foto con preview |
| 11. COMUNIDAD | 377 | Muro, tarjetas de publicación, botones de acción, comentarios |
| 12. PERFIL | 408 | Avatar, barra de progreso, grid de insignias, estadísticas |
| 13. TOASTS | 439 | Notificaciones flotantes con variantes `exito` / `error` / `alerta` / `info` / `logro` |
| 14. MODALES | 456 | `.modal-overlay` + `.modal`, animación de entrada, `prefers-reduced-motion` respetado |
| 15. FOOTER | 480 | Créditos, texto filosófico, aviso de datos |
| 16. RESPONSIVE | 496 | Breakpoints: sidebar oculta bajo 900px, grid de una columna, tipografía reducida |

Técnicas CSS destacadas:
- `color-mix(in srgb, var(--primary) 14%, transparent)` para el fondo del icono activo sin definir 6 colores más.
- `@media (prefers-reduced-motion: reduce)` para desactivar animaciones.
- `prefers-color-scheme` como valor inicial del tema.

### 4.3 `<body>` — líneas 537–1325

El orden importa, porque el JS delega eventos a IDs que deben existir:

1. **Sprite SVG** (línea 542–572): 30 `<symbol>` con `id="i-…"` (`i-hoja`, `i-mapa`, `i-camion`, `i-basura`, `i-alavoz`, `i-usuarios`, `i-like`, `i-comentar`, `i-compartir`, `i-play`, `i-stop`, `i-search`… ). Se usan con `<svg><use href="#i-mapa"/></svg>`. Un solo archivo, cero peticiones de iconos.
2. **Loader** (577): se oculta tras `load` + 350 ms, con red de seguridad a 4 000 ms.
3. **Header** (583–600): marca con logo, `#headerColonia`, chip `#headerNivel`, `#btnNotif`, `#btnCuenta`, `#btnConfig`.
4. **Nav lateral** (603–610): 6 botones con `data-nav="inicio|mapa|guia|reportes|comunidad|perfil"`.
5. **`<main id="contenido">`** con las 6 vistas (`623`, `704`, `774`, `878`, `961`, `1012`).
6. **Nav inferior móvil** (1091–1100): mismos 6 `data-nav`.
7. **Footer** (1101–1113): créditos del proyecto, texto de ética y política, atribución de OpenStreetMap/OSRM.
8. **Ocho modales** (1115–1322), todos con `role="dialog" aria-modal="true"` y su `aria-labelledby`:

| Modal | Línea | Para qué |
|---|---|---|
| `#modalCuenta` | 1115 | Registro, inicio de sesión, perfil de la cuenta, cerrar sesión |
| `#modalBienvenida` | 1192 | Onboarding de primera visita (crear cuenta / entrar / invitado) |
| `#modalConfig` | 1206 | Tema, colonia, notificaciones, modo demo, restablecer datos, acerca de, privacidad |
| `#modalInfo` | 1243 | Ficha del punto de recolección (distancia, tiempo, estado) |
| `#modalPunto` | 1254 | Detalle del punto seleccionado en el mapa |
| `#modalConfirmar` | 1268 | Confirmación reutilizable (`confirmarAccion(texto, detalle, botón)`) |
| `#modalShare` | 1282 | Texto para compartir manualmente (fallback sin `navigator.share`) |
| `#modalNuevaPass` | 1300 | Formulario de nueva contraseña tras el enlace de recuperación |

9. **`<canvas id="confetti">`** (1323) y **`<div id="toasts" aria-live="polite">`** (1324) — el `aria-live` hace que los lectores de pantalla anuncien los avisos.

### 4.4 El `<script>` — líneas 1327–3638

Primero se carga Leaflet externo (1326):
```html
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
```
Luego el script inline. Todo está dentro de una IIFE con `'use strict'`:

```js
(function(){
'use strict';
/* ... 23 módulos ... */
})();
```

**Consecuencia de la IIFE:** nada de lo que hay dentro existe en el objeto global `window`. Cualquier cosa que necesite ser global (poco: el service worker y los `addEventListener` de `window`) se registra explícitamente. Ventaja: los nombres de funciones no colisionan y no se pueden pisar desde la consola.

**Consecuencia del CDN:** si Leaflet no carga, `typeof L === 'undefined'` y `iniciar()` (M22) lo detecta: muestra un mensaje en `#listaPuntos` y un toast, y **el resto de la app sigue funcionando**. La comprobación está explícita:
```js
if (typeof L === 'undefined'){
  $('#listaPuntos').innerHTML = '<div class="vacio visible" …>…</div>';
  toast('Sin conexión: el mapa no está disponible ahora.', 'error', 6000);
} else {
  initMapa();
  $('#rutaSelect').value = estado.coloniaId;
  cargarRutaColonia(false);   // precarga en segundo plano
}
```

---

## 5. Los 23 módulos JavaScript

Cada módulo empieza con un bloque de comentario `/* ═══… MÓDULO N · TÍTULO ═══ */` con su número de línea, pensado para que cualquier persona encuentre la lógica en segundos con Ctrl+F.

| # | Módulo | Línea | Responsabilidad |
|---|---|---|---|
| 0 | Utilidades | 1331 | `$`, `$$`, `normalizar`, `fmtDistancia`, `fmtDuracion`, `haversine`, `tiempoRelativo`, `uid`, `hoyISO`, `iniciales` |
| 1 | Persistencia local | 1377 | Objeto `almacen` con prueba de escritura, lectura/escritura tolerante a fallos |
| 2 | Estado global | 1398 | Objeto `estado` con 20 campos: vista, tema, colonia, puntos, acciones, insignias… |
| 3 | Capa de datos | 1423 | `dataLayer`: interfaz asíncrona pensada para cambiar de backend sin tocar la UI |
| **3b** | **Cuentas (Supabase Auth)** | **1497** | **Sesión, registro, login, recuperación, sincronización con la nube** |
| 4 | Toasts | 1835 | Avisos flotantes accesibles |
| 5 | Modales | 1860 | `abrirModal` / `cerrarModal` con foco atrapado y Escape |
| 6 | Navegación SPA | 1925 | `irA(v)`: cambia `.activa`, actualiza `aria-current`, scroll al inicio |
| 7 | Tema | 1946 | `aplicarTema`: `data-theme` + `theme-color` |
| 8 | Gamificación | 1962 | Niveles, puntos, insignias, progreso |
| 9 | Confeti | 2112 | Canvas 2D con partículas y gravedad |
| 10 | Zonas | 2150 | Las 6 colonias como polígonos aproximados |
| 11 | **Servicios externos** | **2176** | **Overpass + OSRM + Mapbox + Nominatim, con cadena de respaldos** |
| 12 | Mapa Leaflet | 2440 | `initMapa`, capas, marcadores, eventos, invalidación de tamaño |
| 13 | Ubicación | 2673 | `usarMiUbicacion()` (GPS), elegir punto en el mapa, ruta hasta el usuario |
| 14 | Modo demostración | 2755 | Camión simulado con `requestAnimationFrame`, etiquetado como demo |
| 15 | Notificaciones | 2831 | `Notification.requestPermission` con fallback a toasts |
| 16 | Conciencia | 2877 | Tarjeta de "registré mi acción de hoy" (una vez por día) |
| 17 | Guía y buscador | 2913 | 21 residuos × 4 categorías, búsqueda tolerante a acentos |
| 18 | Reportes ciudadanos | 3010 | Formulario, compresión de foto, subida, lista |
| 19 | Comunidad | 3207 | Muro, nodos de publicación, like, comentario, compartir |
| 20 | Perfil / Config / Reset | 3339 | Nombre, colonia, restablecer datos |
| 20b | Cuenta: eventos UI | 3354 | Todos los `addEventListener` de cuenta y modales |
| 21 | Scroll / Conexión / Errores | 3536 | Sombra del header, online/offline, `error` y `unhandledrejection` globales |
| 22 | Inicialización | 3560 | `iniciar()`: el orquestador de arranque |

### 5.1 Módulo 0 — Utilidades (1331)

```js
const $  = (s, c) => (c || document).querySelector(s);
const $$ = (s, c) => Array.prototype.slice.call((c || document).querySelectorAll(s));
const REDUCIR = window.matchMedia('(prefers-reduced-motion: reduce)');
```

Funciones que se usan en todo el archivo:

- **`normalizar(t)`** — `String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim()`. Quita tildes y pasa a minúsculas. Es lo que hace que buscar "cáscara" encuentre "cascara". Sin esto habría que duplicar cada palabra con y sin acento.
- **`haversine(a, b)`** — distancia en metros entre dos `{lat, lng}` con `R = 6371000`. Se usa para medir la longitud de la ruta, distribuir puntos y ordenar por cercanía.
- **`tiempoRelativo(ts)`** — "hace un momento", "hace 12 min", "hace 3 h", "ayer", "hace 5 días".
- **`uid()`** — `'b' + Date.now().toString(36) + Math.random()...`. IDs legibles, ordenables por tiempo y sin colisiones. **No usa `crypto.randomUUID()` a propósito**: los IDs viajan como `text` en PostgreSQL y un prefijo legible facilita depurar.
- **`iniciales(n)`** — avatares de texto: "Daniel Alvarez" → "DA".

### 5.2 Módulo 1 — Persistencia local (1377)

```js
const almacen = {
  clave: 'bym.v1',
  ok: (function(){ try { localStorage.setItem('__t','1'); localStorage.removeItem('__t'); return true; } catch(e){ return false; } })(),
  datos: null,
  leer(){ … }, guardar(){ … }, borrar(){ … }
};
```

La **prueba de escritura al arrancar** es la decisión clave: en modo incógnito de iOS o con almacenamiento lleno, `localStorage.setItem` lanza excepción. En lugar de romper el arranque, `ok` queda en `false` y toda la app opera solo en memoria.

`guardar()` captura `QuotaExceededError` y avisa:
```js
catch(e){ toast('No se pudo guardar localmente (espacio lleno). La app sigue funcionando.', 'error'); }
```

### 5.3 Módulo 2 — Estado global (1398)

```js
const estado = {
  vista: 'inicio',
  tema: almacen.datos.tema || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  coloniaId: almacen.datos.coloniaId || 'centro',
  nombrePerfil: almacen.datos.nombrePerfil || 'Invitado',
  notif: !!almacen.datos.notif,
  demo: !!almacen.datos.demo,
  puntos: almacen.datos.puntos || 0,
  acciones: almacen.datos.acciones || [],      // {ts, tipo, texto} — máx 40
  accionDia: almacen.datos.accionDia || null,  // último día con acción ecológica
  diasAccion: almacen.datos.diasAccion || [],  // días distintos con acción
  insignias: almacen.datos.insignias || [],
  reportes: null, publicaciones: null,
  ubicacion: null,          // {lat,lng} del usuario (GPS)
  ubicacionManual: null,    // {lat,lng} elegida en el mapa
  ubicacionReporte: null,   // {lat,lng} del reporte en curso
  fotoData: null,
  modoElegirMapa: null,     // 'usuario' | 'reporte' | null
  eliminadosRep: almacen.datos.eliminadosRep || []  // ids borrados localmente
};
```

Notas de diseño:
- **Tres coordenadas distintas y separadas** (`ubicacion`, `ubicacionManual`, `ubicacionReporte`). Confundirlas era un bug fácil: la ubicación del reporte no debe moverse cuando el usuario vuelve a pedir su GPS.
- **`modoElegirMapa`** evita el anti-patrón de un `onClick` global del mapa que intercepte clics cuando el usuario solo está mirando.
- **`eliminadosRep`** permite borrar un reporte del dispositivo sin que la siguiente sincronización lo vuelva a traer de la nube.

### 5.4 Módulo 3 — Capa de datos (1423)

El corazón de la arquitectura. Una interfaz con 6 métodos, cada uno una Promesa:

```js
const dataLayer = {
  getUserLocation(){ … },                 // navigator.geolocation
  getRoutes(zona){ return construirRutaZona(zona); },
  getCollectionPoints(ruta, intervaloM){ return distribuirPuntos(ruta.geometria, intervaloM); },
  getVehiclePosition(){ return Promise.resolve(null); },   // ← GPS real NO conectado
  createReport(reporte){ … },
  createPost(post){ … },
  votePost(id){ … },
  sendNotification(titulo, cuerpo){ notificarReal(titulo, cuerpo); }
};
```

El comentario del header del módulo lo dice: *"Cada función devuelve Promesas y está lista para reemplazarse por Supabase / Firebase / API municipal sin tocar la interfaz."* La UI nunca sabe si los datos vienen de una API o de un array.

**El honesto `getVehiclePosition`:**
```js
getVehiclePosition(){
  // Punto de integración futuro: API municipal o backend propio.
  // Cuando exista, devolver {lat,lng,ts} y la app lo mostrará como real.
  return Promise.resolve(null);
}
```
Devolver `null` en lugar de inventar coordenadas es la razón por la que la app nunca muestra un camión "real" falso.

### 5.5 Módulo 3b — Cuentas de usuario (1497)

**El módulo más importante y el más reciente.** Toda la autenticación.

**Configuración** (línea 1478–1483):
```js
const NUBE = {
  url:      'https://rmnnqggasqxlpntcffrz.supabase.co/rest/v1/',
  storage:  'https://rmnnqggasqxlpntcffrz.supabase.co/storage/v1/object/',
  bucketFotos: 'reportes-fotos',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.…'   // JWT con rol "anon"
};
const NUBE_AUTH = 'https://rmnnqggasqxlpntcffrz.supabase.co/auth/v1/';
const CLAVE_SESION = 'bym.sesion.v1';
const MAX_NUBE = 120;    // filas que trae la nube
const MAX_LOCAL = 150;   // filas que guarda el dispositivo
```

> **Sobre esa clave.** Es la clave *anon* de Supabase, y **está publicada en el código a propósito**: no es un secreto. Es como una contraseña vacía — el diseño de Supabase espera que el navegador la tenga. Lo único que nunca debe aparecer es la clave `service_role` (esa sí permitiría saltarse todas las políticas RLS). Con `anon` + RLS, un atacante puede hacer exactamente lo mismo que un visitante: leer lo público y crear filas con `usuario_id = null`. Y eso ya está permitido y limitado por los `CHECK` de la base de datos.

**Cabeceras** (1552):
```js
function cabecerasAnon(extra){
  const h = { apikey: NUBE.key, Authorization: 'Bearer ' + NUBE.key, 'Content-Type': 'application/json' };
  …
}
function cabecerasNube(extra){
  const h = { apikey: NUBE.key, 'Content-Type': 'application/json' };
  h.Authorization = 'Bearer ' + (sesion.usuario && sesion.usuario.token ? sesion.usuario.token : NUBE.key);
  …
}
```
Sin sesión → clave anónima. Con sesión → `access_token` del usuario. La diferencia es exactamente lo que RLS evalúa.

**`restaurarSesion()`** (1518) — la pieza que hace que la sesión sobreviva a cerrar el navegador:
```js
return fetch(NUBE_AUTH + 'token?grant_type=refresh_token', {
  method: 'POST', headers: cabecerasAnon(), body: JSON.stringify({ refresh_token: s.refresh })
}).then(r => r.ok ? r.json() : null).then(d => {
  if (d && d.access_token){
    guardarSesion({ id: d.user.id, email: d.user.email, token: d.access_token, refresh: d.refresh_token });
    return cargarPerfilRemoto();
  }
  guardarSesion(null);   // sesión irrecuperable → sigue como invitado
}).catch(function(){
  sesion.usuario = s;     // sin internet → usa la sesión guardada tal cual
});
```
Los tres desenlaces están cubiertos: **token renovado**, **token inválido (baja a invitado)** y **sin red (arranca con lo guardado)**.

**`cargarPerfilRemoto()`** (1534) — lee el nombre real de la cuenta:
```js
fetch(NUBE.url + 'perfiles?id=eq.' + uid + '&select=nombre&limit=1', { headers: cabecerasAnon() })
```
El trigger de la base de datos (`on_auth_user_crea_perfil`) crea el perfil con la parte del correo anterior a la `@` como nombre provisional; la app lo actualiza de inmediato con lo que el usuario escribió.

**`upsertNube(tabla, obj)`** (1649) — la función de escritura central:
```js
if (!estado._nube) return Promise.resolve(false);        // sin nube: no se intenta
const copia = Object.assign({}, obj);
delete copia.ejemplo; delete copia.votado; delete copia._nube; delete copia._sinc;  // marcas locales
if (sesion.usuario && sesion.usuario.id) copia.usuario_id = sesion.usuario.id;
fetch(NUBE.url + tabla, {
  method: 'POST',
  headers: cabecerasNube({ 'Prefer': 'resolution=merge-duplicates' }),   // ← UPSERT
  body: JSON.stringify([copia])
}).then(r => {
  if (r.status === 401 && sesion.usuario && sesion.usuario.refresh){     // token caducado
    return restaurarSesion().then(() => fetch(…).then(r2 => r2.ok));
  }
  return r.ok;
}).catch(() => false);
```

Cuatro decisiones importantes aquí:
1. **`Prefer: resolution=merge-duplicates`** convierte el `POST` en un UPSEM. Por eso `id` es la clave primaria y puede ser el mismo: reintentar no duplica.
2. **Se barren las marcas locales** (`ejemplo`, `votado`, `_nube`, `_sinc`). Sin esto, datos de presentación del navegador (si el usuario ya votó) acabarían guardados como parte del contenido en la base de datos.
3. **`usuario_id` se inyecta en el servidor de la app pero lo valida la base de datos.** El navegador no puede convencerse a sí mismo: si alguien edita el código para poner el `usuario_id` de otro, la política RLS devuelve `42501`.
4. **Reintento único en 401.** Los JWT de Supabase duran ~1 hora; un usuario que dejó la app abierta una tarde no debe perder su publicación.

**`subirFotoReporte(reporte)`** (1683):
```js
if (!d || d.indexOf('data:') !== 0) return Promise.resolve(reporte.foto || null); // ya es URL
const ruta = NUBE.bucketFotos + '/reportes/' + encodeURIComponent(reporte.id) + '.jpg';
fetch(NUBE.storage + ruta, {
  method: 'POST',
  headers: {
    apikey: NUBE.key,
    Authorization: 'Bearer ' + (sesion?.token || NUBE.key),
    'Content-Type': 'image/jpeg',
    'x-upsert': 'true'            // ← idempotente
  },
  body: dataUrlABlob(d)
}).then(r => r.ok ? (NUBE.storage + 'public/' + ruta) : null)
 .catch(() => null);
```
Devuelve la URL pública o `null`. Si devuelve `null`, la foto se queda como data URL en el dispositivo y el reporte se marca local — **el usuario nunca pierde su reporte por un fallo de red**.

**`podarLista(lista, esEjemplo)`** (1702) — el control de crecimiento:
```js
const ejemplos = lista.filter(esEjemplo);
const reales = lista.filter(x => !esEjemplo(x)).sort((a,b) => b.ts - a.ts).slice(0, MAX_LOCAL);
return ejemplos.concat(reales);
```
Los ejemplos de la app **nunca se podan** (son la demostración de cómo se ve el muro vacío de contenido real); las publicaciones reales se quedan en las 150 más recientes. Sin esto, un dispositivo usado seis meses tendría un `localStorage` de varios megabytes y un arranque lento.

**`aplicarIdentidad()`** (1727) — la pieza que evita el clásico "el nombre se queda en blanco después de enviar". Con cuenta, `#repNombre` y `#postNombre` se llenan y se ponen `readOnly`; sin cuenta se desbloquean con placeholder "Puedes reportar como Anónimo". Se llama explícitamente después de cada `e.target.reset()`.

**Recuperación de contraseña** — `pedirRecuperacion(email)` (1596) → `leerEnlaceRecuperacion()` (1612) → `cambiarPassword(token, pass)` (1624). El token viaja en el fragmento `#access_token=…&type=recovery`; `iniciar()` lo lee, hace `history.replaceState` para limpiar la URL (para que el token no quede en el historial ni en capturas de pantalla) y abre `#modalNuevaPass`.

**Sincronización** — tres funciones gemelas:

| Función | Línea | Consulta | Orden |
|---|---|---|---|
| `ssyncPublicaciones()` | 1764 | `publicaciones?select=*&order=ts.desc&limit=120` | `ts.desc` |
| `ssyncReportes()` | 1795 | `reportes?select=*&order=ts.desc&limit=120` | `ts.desc` |
| `ssyncComments(post)` | 1819 | reutiliza `upsertNube('publicaciones', post)` | — |

> **El bug histórico que se corrigió aquí.** El `order` era `ts.asc` (antiguo primero) con `limit=200`. Con 200 publicaciones, nadie volvía a ver las nuevas: quedaban fuera del corte. Era una bomba de tiempo — no se había grabado aún, pero habría pasado. Ahora es `ts.desc`, y cada carga trae **lo más reciente primero**.

**El criterio de "no reenviar 150 filas en cada visita"** (comentario en 1776):
```js
// Solo se reintentan las que aún no se han podido subir
const localesNuevas = reportesLocales.filter(x => !vistos[x.id] && !x._sinc);
```
`_sinc = true` marca "ya está en la nube". Sin esta marca, cada visita reintentaría subir todo.

**`initNube()`** (1823) — el orquestador de arranque:
```js
nubeEstado('conectando');
restaurarSesion().then(() => {
  actualizarBotonCuenta();
  return fetch(NUBE.url + 'publicaciones?select=id&limit=1', { headers: cabecerasNube() });
}).then(r => {
  if (!r || !r.ok) throw new Error('HTTP ' + (r ? r.status : 0));
  nubeEstado('ok');
  return Promise.all([ssyncPublicaciones(), ssyncReportes()]);
}).catch(() => nubeEstado('sin'));
```
El sondeo `?select=id&limit=1` verifica conectividad con **una sola fila**, no con la tabla entera. Los tres estados que ve el usuario están en `#estadoNube`:

| Estado | Texto |
|---|---|
| `conectando` | ☁️ Conectando con la nube… |
| `ok` | ☁️ Datos sincronizados en la nube |
| `sin` | 💾 Datos guardados en este dispositivo (copia local) |

### 5.6 Módulo 8 — Gamificación (1962)

Ver [sección 9](#9-gamificación) completa.

### 5.7 Módulo 10 — Zonas (2150)

Seis colonias como rectángulos aproximados:

| id | Nombre | Extensión (lat, lng) | Tipos de vialidad consultadas |
|---|---|---|---|
| `centro` | Centro | 19.6975–19.7085, −103.4740…−103.4590 | primary, secondary, residential |
| `floresta` | La Floresta | 19.7070–19.7160, −103.4780…−103.4640 | secondary, residential, tertiary |
| `villas` | Villas del Padre | 19.6880–19.6965, −103.4670…−103.4550 | residential, secondary, tertiary |
| `estanzuela` | La Estanzuela | 19.6845–19.6935, −103.4830…−103.4680 | residential, secondary, tertiary |
| `agustin` | El Agustín | 19.7140–19.7245, −103.4700…−103.4560 | primary, secondary, residential |
| `rafael` | San Rafael | 19.6930–19.7030, −103.4585…−103.4460 | residential, tertiary, secondary |

```js
const CENTRO_CIUZ = [19.7020, -103.4640];
const INTERVALO_PUNTOS = 400;  // metros entre puntos de recolección
```

El comentario del módulo es explícito: *"Delimitaciones APROXIMADAS generadas por el sistema para poder agrupar vialidades por colonia. No son límites oficiales."* El polígono se dibuja punteado y con `interactive: false` (no captura clics).

`puntoDentro(p, poly)` implementa el algoritmo **ray casting** clásico para el test punto-en-polígono, usado para filtrar las vialidades que pertenecen a cada colonia.

### 5.8 Módulo 11 — Servicios externos (2176)

Ver [sección 6](#6-integraciones-externas-una-por-una) completa. Es el módulo con la arquitectura de respaldos más interesante del proyecto.

### 5.9 Módulo 12 — Mapa Leaflet (2440)

Variables de estado del mapa:
```js
let mapa = null;
let capaRuta, capaPuntos, capaZonas, marcadorUsuario, marcadorCamion, marcadorSeleccion, rutaUsuario;
let puntosActuales = [];    // puntos de la colonia activa
let rutaActiva = null;      // ruta de la colonia activa
let puntoSeleccionado = null;
```

**Iconos personalizados con `L.divIcon`** (en lugar de los PNG por defecto de Leaflet) — HTML y CSS propios:
- `iconoPunto(num, seleccion)`: círculo numerado `01`, `02`… con variante `.mk-punto-seleccion`.
- `iconoUsuario()`: punto con anillo pulsante animado (`.mk-pulso`).
- `iconoCamion()`: camión SVG con halo.

**Capas:** base (Mapbox u OSRM/OSM), `capaRuta` (polilínea), `capaPuntos` (marcadores numerados), `capaZonas` (polígonos de colonia, `dashArray: '6 6'`, `fillOpacity: 0.05`).

**El clic en el mapa es condicional** — solo captura cuando hay un modo activo:
```js
mapa.on('click', function(e){
  if (!estado.modoElegirMapa) return;
  if (estado.modoElegirMapa === 'usuario')  fijarUbicacionManual(e.latlng);
  else if (estado.modoElegirMapa === 'reporte'){ … }
});
```

**`mapa.invalidateSize()`** — imprescindible al volver a la vista de mapa, porque el contenedor tenía `display: none` y Leaflet midió un tamaño de 0:
```js
if (v === 'mapa' && mapa) setTimeout(() => mapa.invalidateSize(), 80);
```

### 5.10 Módulo 13 — Ubicación (2673)

```js
dataLayer.getUserLocation()  // navigator.geolocation
```
Configuración: `{ enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }` — 30 s de caché evita pedirle el GPS al usuario cada clic.

Los tres códigos de error del navegador se traducen a mensajes humanos:
```js
const mensajes = { 1: 'Permiso de ubicación rechazado.', 2: 'Ubicación no disponible.', 3: 'La ubicación tardó demasiado.' };
```

`calcularRutaHastaPunto(punto)` (2736) lanza OSRM con `usuario;destino` para dar la distancia y el tiempo a pie o en auto de un punto concreto.

### 5.11 Módulo 14 — Modo demostración (2755)

```js
const demo = { activo: false, distanciaM: 0, velocidadKmh: 22, ultimoTick: null, raf: null, avisoPunto: null };
```
Animación con `requestAnimationFrame`, velocidad 22 km/h. Cuando el camión simulado se acerca a menos de 5 minutos del punto del usuario, emite un toast **con el prefijo "(Demo)"** y una notificación con el mismo prefijo. Nunca dice "el camión está llegando".

### 5.12 Módulo 17 — Guía de residuos (2913)

**21 residuos** con palabras clave alternativas, emoji, categoría y la instrucción correcta:

| Categoría | Cantidad | Ejemplos |
|---|---|---|
| `organicos` | 6 | Plátano, restos de comida, cáscaras, hojas y jardín, cascarón, café |
| `reciclables` | 6 | Botella PET, cartón, papel, lata, vidrio, plástico duro |
| `noreciclables` | 4 | Colillas y papel sanitario, pañales, empaques metalizados, plástico sucio |
| `especiales` | 5 | Pilas, focos, medicamentos, electrónicos, aceite de cocina |

Ejemplo de entrada:
```js
{ n:'Botella PET', cl:['pet','botella','envase','garrafon'], cat:'reciclables', e:'🧴', c:'Reciclable: enjuágala, aplástala y deposítala separada.' }
```
`cl` son las **claves de búsqueda**: buscar "envase" encuentra "Botella PET". Combinado con `normalizar()`, buscar "cascara" (sin tilde) encuentra "Cáscaras de fruta".

Las tabs son navegables con teclado (`ArrowLeft`/`ArrowRight` mueven el foco entre ellas) y exponen `aria-selected`.

### 5.13 Módulo 18 — Reportes ciudadanos (3010)

**Compresión de imagen** (`comprimirFoto`, línea 3063):
```js
function comprimirFoto(img){
  let w = img.width, h = img.height, cal = 0.72;
  for (let intento = 0; intento < 6; intento++){
    if (w > 1000 || h > 1000){ const k = Math.min(1000/w, 1000/h); w = …; h = …; }
    cv.width = w; cv.height = h;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);   // ← fondo blanco
    ctx.drawImage(img, 0, 0, w, h);
    const url = cv.toDataURL('image/jpeg', cal);
    if (url.length <= 160 * 1024 || cal <= 0.4) return url;
    cal -= 0.12;
  }
  return cv.toDataURL('image/jpeg', 0.4);
}
```
Reduce a **máximo 1000×1000** y baja la calidad en escalones de 0.12 desde 0.72 hasta 0.4, buscando quedar bajo **160 KB**. En pruebas: una foto de 39 KB de entrada terminó en **10.8 KB** subida. El fondo blanco antes de dibujar evita el clásico PNG→JPEG con transparencia que sale negro.

Validaciones del formulario (`#formReporte`, 3118):
- Nombre ≤ 40 caracteres.
- Tipo obligatorio (Contenedor lleno · Basura en la calle · Camión no pasó · Ruta incorrecta · Otro).
- Descripción entre 15 y 500 caracteres, con contador en vivo (`#contadorRep`).
- Archivo: solo `image/*` y ≤ 5 MB en cliente.
- Si falla algo: toast + foco al primer campo inválido.

**Los `<img>` del muro de reportes usan carga diferida:**
```js
im.loading = 'lazy'; im.decoding = 'async'; im.referrerPolicy = 'no-referrer';
im.addEventListener('error', () => { if (im.parentNode) im.parentNode.removeChild(im); });
```
`referrerPolicy` evita mandar la URL de la app como `Referer` al CDN de imágenes. El `error` quita la imagen rota en vez de dejar el ícono de imagen tachada.

### 5.14 Módulo 21 — Errores globales (3536)

```js
window.addEventListener('error', function(e){
  if (e && e.target && e.target !== window) return;   // fallo de un RECURSO, no del código
  if (e && e.message && /leaflet|L\./i.test(e.message)) return;
  console.warn(e && e.error);
  toast('Ocurrió un problema inesperado, pero la app sigue funcionando.', 'error', 4000);
});
window.addEventListener('unhandledrejection', function(e){
  console.warn('Promesa rechazada:', e && e.reason);
  const m = String((e?.reason?.message || e?.reason?.error) || '');
  if (/fetch|network|failed|load failed|aborted/i.test(m)) return;  // sin red: ya avisamos
  toast('Algo no pudo sincronizarse. Tus datos siguen guardados en este dispositivo.', 'error', 5000);
});
```
Dos filtros que evitan spam de toasts: `error` ignora fallos de recursos (una fuente que no carga no es un error del código), y `unhandledrejection` ignora fallos de red (ya hay un aviso de "sin conexión").

### 5.15 Módulo 22 — `iniciar()` (3560)

El orquestador, en este orden exacto:

```js
function iniciar(){
  aplicarTema(estado.tema);
  initNube();                          // asíncrono, no bloquea
  actualizarHeaderNivel();
  pintarBotonNotif();
  pintarConciencia();
  renderReportes();
  renderMuro();
  renderInsignias();
  renderPerfil();
  verificarInsignias();                // recupera insignias de sesiones anteriores
  $('#pNombre').value = estado.nombrePerfil;
  $('#pColonia').value = estado.coloniaId;
  setDemoUI(estado.demo);
  aplicarIdentidad();
  actualizarBotonCuenta();

  // 1) Onboarding de primera visita (solo si no hay sesión guardada)
  if (!verOnboarding() && !obtenerSesion()){
    setTimeout(() => abrirModal('modalBienvenida'), 900);   // 900 ms para no tapar la app de golpe
  }

  // 2) ¿Viene de "Olvidé mi contraseña"? El token está en el hash de la URL
  const rec = leerEnlaceRecuperacion();
  if (rec){
    history.replaceState(null, '', location.pathname + location.search);  // limpia la URL
    if (rec.error) toast('El enlace de recuperación no es válido: ' + rec.error, 'error', 6000);
    else { tokenRecuperacion = rec.token; abrirModal('modalNuevaPass'); $('#npPass1').focus(); }
  }

  // 3) Mapa (o su ausencia)
  if (typeof L === 'undefined'){ …mensaje… } else {
    initMapa();
    $('#rutaSelect').value = estado.coloniaId;
    cargarRutaColonia(false);          // precarga en segundo plano
  }

  // 4) Reloj de "hace X min" cada 60 s
  setInterval(…, 60000);

  // 5) Ocultar loader: al load +350 ms, con red de seguridad a 4000 ms
}
```

Dos detalles que parecen menores y no lo son:
- Los **900 ms de retardo** del onboarding evitan que el modal tape el contenido antes de que el usuario vea qué es la app.
- El **doble ocultado del loader** (evento `load` y temporizador de 4 s) garantiza que nunca se quede una pantalla de carga eterna si un recurso externo se cuelga.

---

## 6. Integraciones externas (una por una)

| Servicio | Endpoint / URL | Para qué | Autenticación | Si falla |
|---|---|---|---|---|
| **Leaflet** | `unpkg.com/leaflet@1.9.4` (CSS + JS) | Motor del mapa | Ninguna | La app sigue sin mapa |
| **Mapbox Tiles** | `api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/512/{z}/{x}/{y}` | Teselas del mapa | Token público `pk.…` (URL restringida) | Vercel usa teselas de OSM |
| **Mapbox Directions** | `api.mapbox.com/directions/v5/mapbox/driving/{coords}` | Ruta por calles reales, rápido y confiable | Token público | Cae a Overpass + OSRM |
| **Overpass API** | 3 espejos + reintento | Vialidades reales por colonia (`way["highway"~…]`) | Ninguna | Copia local en `bym.osm.v1` |
| **OSRM** | `router.project-osrm.org/route/v1/driving/{lon,lat;…}` | Ruta abierta por calles | Ninguna | Último recurso: geometría local |
| **Nominatim** | `nominatim.openstreetmap.org/search?…` | Geocodificación de direcciones | Ninguna (User-Agent del navegador) | Mensaje "Geocodificación no disponible" |
| **Supabase Auth** | `…/auth/v1/` (`signup`, `token?grant_type=password`, `token?grant_type=refresh_token`, `recover`, `user`) | Cuentas | `apikey` + JWT | Sigue como invitado |
| **Supabase REST** | `…/rest/v1/` (PostgREST) | Filas de `publicaciones` y `reportes` | `apikey` + `Bearer` | Modo "copia local" |
| **Supabase Storage** | `…/storage/v1/object/` | Fotografías | `apikey` + `Bearer` | La foto queda en el dispositivo |
| **Vercel** | `basura-y-mas.vercel.app` | Hosting + cabeceras | — | — |
| **Google Fonts** | `fonts.googleapis.com` (Poppins 400–800) | Tipografía | Ninguna | Cae a la fuente del sistema |
| **Supabase SMTP** | *(pendiente)* | Correo real de recuperación | — | **El correo no llega a terceros** |

### 6.1 La cadena de respaldos de la ruta — el diseño central del módulo 11

Este es el fragmento más importante del módulo, y explica por qué la app sigue funcionando aunque se caigan tres servicios seguidos:

```js
async function construirRutaZona(coloniaId){
  if (rutas[coloniaId]) return rutas[coloniaId];          // 1) caché en memoria
  const zona = ZONAS[coloniaId];

  // 2) Mapbox: rápido, preciso, con token
  if (MAPBOX_TOKEN && navigator.onLine){
    try { return await mapboxRutaZona(coloniaId, zona); }
    catch(e){ console.warn('Mapbox no disponible; usando OpenStreetMap:', e.message); }
  }

  try {                                                     // 3) Overpass + encadenado propio
    const resultado = await overpassVialidades(zona, coloniaId);
    let geometria = await encadenarVialidades(resultado.ways, zona);
    if (!geometria || geometria.length < 10) throw new Error('No se pudo formar un recorrido continuo…');
    geometria = simplificar(geometria, 12);
    …
    const salida = { geometria, distanciaM, callePrincipal: nombreSeed, zona: zona.nombre,
      fuente: 'vialidades de OpenStreetMap' + (resultado.desdeCache ? ' (copia local)' : '') };
    guardarCacheRutas(coloniaId, salida);
    return salida;
  } catch (err) {
    // 4) Última ruta calculada, etiquetada como copia local
    const cr = leerCacheRutas()[coloniaId];
    if (cr?.geometria?.length > 1) return { ...cr, fuente: cr.fuente + ' (copia local)' };
    throw err;
  }
}
```

**Orden de preferencia:** Mapbox → Overpass (+Overpass) → geometría propia encadenada → OSRM → caché local.

**Los 4 espejos de Overpass** con reintento del principal al final:
```js
const SERVIDORES_OVERPASS = [
  'https://overpass-api.de/api/interpreter?data=',
  'https://overpass.kumi.systems/api/interpreter?data=',
  'https://overpass.private.coffee/api/interpreter?data='
];
const servidores = SERVIDORES_OVERPASS.concat([SERVIDORES_OVERPASS[0]]);  // ← reintento
```
El patrón `concat([el primero])` es deliberado: los espejos públicos de Overpass devuelven `504` con frecuencia, y el servidor principal suele recuperarse tras unos segundos.

**La consulta Overpass** se construye con el bounding box de cada colonia y los tipos de vía declarados en `ZONAS`:
```js
const q = '[out:json][timeout:25];way["highway"~"^(primary|secondary|residential)$"](bbox);out geom;';
```
Un espejo que responde pero con `elements: []` se considera fallo y se pasa al siguiente:
```js
if (!ways.length) throw new Error('El espejo respondió sin vialidades; probando otro servidor…');
```

**Todo con `AbortController` y tiempo máximo** (`fetchConTimeout`, 15 s por defecto, 20 s para Overpass). Sin esto, una petición colgada deja el spinner girando indefinidamente.

### 6.2 Los puntos de recolección — generados, no medidos

```js
async function distribuirPuntos(geometria, intervalo){
  const puntos = [];
  let acumulado = 0, siguiente = intervalo / 2;   // el primero a mitad del primer tramo
  for (let i = 1; i < geometria.length && puntos.length < 40; i++){
    const a = geometria[i-1], b = geometria[i];
    const seg = haversine(a, b);
    while (acumulado + seg >= siguiente && puntos.length < 40){
      const t = (siguiente - acumulado) / seg;
      puntos.push({ numero: puntos.length + 1, lat: …, lng: …, distanciaM: Math.round(siguiente),
        estado: 'Punto propuesto por el sistema', confirmado: false });
      siguiente += intervalo;
    }
    acumulado += seg;
  }
  return puntos;
}
```
Interpolar linealmente sobre la geometría, cada **400 m**, con tope de **40 puntos**. El campo `confirmado: false` y el `estado` textual son la garantía de honestidad: nadie puede confundir un punto calculado con un punto oficial del servicio de recolección.

---

## 7. Flujos de extremo a extremo

### 7.1 Arranque de la app

```
load ──► DOMContentLoaded ──► iniciar()
                                ├─► aplicarTema(estado.tema)
                                ├─► initNube()                     [async, no bloquea]
                                │     ├─► nubeEstado('conectando')
                                │     ├─► restaurarSesion()
                                │     │     ├─ POST /auth/v1/token?grant_type=refresh_token
                                │     │     ├─ OK  → guardarSesion + cargarPerfilRemoto
                                │     │     ├─ 401 → guardarSesion(null)  [modo invitado]
                                │     │     └─ red → sesión guardada tal cual
                                │     ├─ GET /rest/v1/publicaciones?select=id&limit=1
                                │     │     ├─ OK  → nubeEstado('ok') + ssyncPublicaciones() + ssyncReportes()
                                │     │     └─ no → nubeEstado('sin')
                                │     └─ PATCH /rest/v1/perfiles  (si hay sesión)
                                ├─► render*() de las 6 vistas
                                ├─► verificarInsignias()
                                ├─► onboarding (900 ms, solo primera visita sin sesión)
                                ├─► leerEnlaceRecuperacion()  → ¿#access_token en el hash?
                                └─► initMapa() + cargarRutaColonia()  [en segundo plano]
```

### 7.2 Crear una cuenta

```
Usuario escribe nombre + correo + contraseña  (≥ 8 caracteres)
   ▼
validar en cliente → #errRegNombre / #errRegEmail / #errRegPass / #errRegGeneral
   ▼
POST /auth/v1/signup  { email, password }   · cabecerasAnon()
   ├─ 200 → en este proyecto el correo NO se confirma (mailer_autoconfirm)
   │        → guardarSesion({ id, email, token: access_token, refresh: refresh_token })
   │        → toast de bienvenida
   └─ error (correo duplicado, contraseña débil) → mensaje legible
   ▼
Siguiente visita:  restaurarSesion() con refresh_token → sesión viva
   ▼
Perfil: el trigger on_auth_user_crea_perfil ya creó la fila
        con nombre = parte del correo antes de "@"
   ▼
PATCH /rest/v1/perfiles?id=eq.<uid>  { nombre: "Daniel Alvarez" }
   (política: with check (auth.uid() = id) — solo puedes editar tu perfil)
```

### 7.3 Publicar en la comunidad

```
Escribir tipo (Duda | Propuesta | Iniciativa | Aviso), colonia, texto (≤ 400)
   ▼
#formPost submit  (línea 3214)
   ▼
post = { id: uid(), nombre: nombreFirma(), colonia, tipo, texto, likes: 0,
          comentarios: [], ts: Date.now(), usuario_id: sesion?.id ?? null }
   ▼
dataLayer.createPost(post)
   ├─► publicaciones.unshift(post); guardar()      ← optimista: ya se ve en pantalla
   └─► upsertNube('publicaciones', post)
         ├─ copia = {...post} − {ejemplo, votado, _nube, _sinc}
         ├─ copia.usuario_id = sesion.id           ← el navegador lo propone…
         ├─ POST /rest/v1/publicaciones  (Prefer: resolution=merge-duplicates)
         │     el motor valida con la política RLS (el navegador no puede mentir)
         ├─ 401 → restaurarSesion() → reintento una vez
         └─ falla → _nube/_sinc = false → queda como local
   ▼
registrarAccion('participacion', …, PTS.participacion = 30)  → +30 puntos
verificarInsignias()  → si se desbloquea una: confeti + toast de logro
   ▼
e.target.reset() + aplicarIdentidad()   ← el nombre con cuenta no queda en blanco
```

### 7.4 Enviar un reporte con foto (el flujo más largo)

```
Elegir colonia · tipo · descripción (15–500) · [foto] · [ubicación]
   ▼
¿Foto?  FileReader.readAsDataURL(f)
            └─ Image() → comprimirFoto()  → máx 1000px, calidad 0.72→0.4, ≤160 KB
                          y preview en #fotoPreviewImg
   ▼
¿Ubicación?  #repUsarGPS  → navigator.geolocation
             #repElegirMapa → modoElegirMapa='reporte' → clic en el mapa
             → estado.ubicacionReporte = {lat,lng}; marcador de selección
   ▼
#formReporte submit (3118) → validación completa, foco al primer error
   ▼
reporte = { id: uid(), nombre, colonia, tipo, texto, ts, foto: estado.fotoData,
            ubicacion: {lat,lng} | null, estado: 'Registrado localmente', usuario_id }
   ▼
dataLayer.createReport(reporte)
   ├─► reportesLocales.push(reporte); guardar()        ← optimista
   ├─► subirFotoReporte(reporte)
   │      dataUrlABlob(dataURL) → Blob JPEG
   │      POST /storage/v1/object/reportes-fotos/reportes/<id>.jpg
   │           headers: Content-Type image/jpeg, x-upsert: true
   │      → OK  : reporte.foto = URL pública     ← la fila guarda la URL, no la imagen
   │      → no : reporte.foto = sigue el data URL local
   ├─► upsertNube('reportes', reporte)
   │      POST /rest/v1/reportes (Prefer: resolution=merge-duplicates)
   └─► reporte._sinc = ok
          ok  → estado = 'Sincronizado con la nube'
          no  → estado = 'Registrado localmente (copia local)'
   ▼
registrarAccion('reporte', …, PTS.reporte = 20)  → +20 puntos
verificarInsignias()   → desbloquea 📸 "Reportero ambiental" si es el primero con foto
   ▼
renderReportes()  →  <img loading="lazy" decoding="async" referrerPolicy="no-referrer">
   ▼
reset del formulario + aplicarIdentidad() + limpiar foto y ubicación
```

### 7.5 "Me importa" (like)

```
Clic en "Me importa"
   ▼
p.likes++; p.votado = true                    ← optimista, sin parpadeo
   ▼
upsertNube('publicaciones', p)
   ▼
PostgreSQL: BEFORE UPDATE → public.proteger_publicacion()
   ├─ ¿soy el dueño (auth.uid() = old.usuario_id)? → new.usuario_id = old.usuario_id; RETURN (edición libre)
   └─ no → RESTAURA id, nombre, colonia, tipo, texto, ts, usuario_id  ← el texto NO se puede tocar
           new.likes = greatest(old.likes, new.likes)                ← NUNCA baja
           comentarios: solo crecen; saneados (autor ≤40, texto ≤400, tope 60)
   ▼
Si alguien intenta mandar likes: 1000, no se aplica el 1000 — se aplica el mayor(old,new)
Si alguien intenta vaciar comentarios: se restauran los originales
Si alguien intenta renombrarse "Administrador": se restaura el nombre real
```

**El detalle sutil:** el trigger **restaura** en lugar de **rechazar**. Es la diferencia entre "el like falló" y "el like funcionó pero el texto volvió a su valor". Con `RAISE EXCEPTION`, cualquier cliente desactualizado (pestaña abierta desde hace una hora con likes viejos) perdería su like al publicar. Restaurando, el like se conserva y solo lo protegido vuelve.

### 7.6 Comentar

```
Clic en "Comentar (n)"  → despliega #com-<id>
   ▼
Formulario: input maxlength=200 + botón "Enviar"
   ▼
p.comentarios.push({ autor: nombreFirma(), texto: t, ts: Date.now() })
ssyncComments(p)  → upsertNube('publicaciones', p)   ← mismo UPSERT
   ▼
Trigger: sanea (autor ≤ 40, texto ≤ 400), limita a 60 comentarios, nunca permite borrar
   ▼
registrarAccion('participacion', 'Comentó…', PTS.ayuda = 5)  → +5 puntos
renderMuro()  → reabre el hilo del comentario
```

### 7.7 Consultar la ruta de tu colonia

```
Elegir colonia en #rutaSelect
   ▼
cargarRutaColonia(avisar)  (2574)
   ▼
construirRutaZona(id)
   ├─ ¿ya está en `rutas[]` (memoria)? → devolver
   ├─ Mapbox token + online? → mapboxRutaZona() → guardarCacheRutas() → ✔
   ├─ overpassVialidades()  → 3 espejos + reintento
   │      ├─ éxito → guardarCacheOSM(zonaId, ways) → encadenarVialidades()
   │      │            └─ ¿< 10 puntos? → lanzar error
   │      │            └─ simplificar(geometria, 12)   (Douglas-Peucker)
   │      │            └─ sumar distancias con haversine
   │      │            └─ guardarCacheRutas() → ✔
   │      └─ todos fallan → leerCacheOSM()[zonaId] → "vialidades de OSM (copia local)"
   └─ todo falló → leerCacheRutas()[id] → "(copia local)" → ✔
   ▼
distribuirPuntos(geometria, 400)  → puntos numerados
   ▼
pintarRuta() + pintarPuntos() en Leaflet
   ▼
Rellenar #listaPuntos: nº, distancia acumulada, tiempo estimado, "propuesto por el sistema"
   ▼
actualizar #estadoRutaChip y #fuenteDatosTexto  ← el usuario ve DE DÓNDE salió la ruta
```

---

## 8. Supabase: base de datos, RLS, trigger y Storage

Proyecto: `rmnnqggasqxlpntcffrz` · Plan **GRATUITO** · Org "Daniel3557's Org".
El archivo [`supabase-schema.sql`](supabase-schema.sql) es el **espejo exacto** de las dos migraciones aplicadas (`add_cuentas_usuario` y `endurecer_rls_moderacion`).

### 8.1 Tabla `perfiles`

```sql
create table if not exists public.perfiles (
  id        uuid primary key references auth.users(id) on delete cascade,
  nombre    text not null default 'Vecino',
  creado_en timestamptz not null default now(),
  constraint perfiles_nombre_max check (length(nombre) <= 40)
);
```

| Política | Rol | Operación | Condición |
|---|---|---|---|
| `perfiles_lectura_publica` | — | `SELECT` | `using (true)` |
| `perfiles_creacion_propia` | `authenticated` | `INSERT` | `auth.uid() = id` |
| `perfiles_actualizacion_propia` | `authenticated` | `UPDATE` | `using (auth.uid() = id) and check (auth.uid() = id)` |

**Trigger automático de alta:**
```sql
create or replace function public.crear_perfil_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, nombre)
  values (new.id, coalesce(nullif(trim(split_part(new.email, '@', 1)), ''), 'Vecino'))
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_crea_perfil
  after insert on auth.users for each row execute function public.crear_perfil_usuario();
```
`security definer` + `set search_path = public` son **obligatorios** en funciones de trigger sobre Supabase: sin `set search_path`, un usuario podría explotar el *search_path* para ejecutar código con permisos de la función.

### 8.2 Tabla `reportes`

```sql
create table if not exists public.reportes (
  id          text primary key,
  nombre      text not null default 'Anónimo',
  colonia     text not null,
  tipo        text not null,
  texto       text not null,
  foto        text,        -- URL pública en Storage (NO la imagen)
  ubicacion   jsonb,       -- { "lat": 19.70, "lng": -103.46 }
  estado      text not null default 'Sincronizado con la nube',
  ts          bigint not null,                       -- epoch millis
  usuario_id  uuid references auth.users(id) on delete set null,
  constraint reportes_texto_max   check (length(texto) <= 2000),
  constraint reportes_nombre_max check (length(nombre) <= 40),
  constraint reportes_tipo_max   check (length(tipo) <= 40)
);
```

**Decisiones de diseño que importan:**
- **`id text primary key` y no `uuid`.** El ID lo genera el navegador (`uid()`), lo que permite crear y volver a crear sin pedirle nada al servidor. Con `uuid` + `default gen_random_uuid()` también funcionaría, pero el cliente necesita el ID *antes* de subir la foto para nombrarla.
- **`ts bigint`, no `timestamptz`.** Coherencia total con `Date.now()` del JavaScript; sin conversiones nizona horaria.
- **`foto text` es una URL.** Antes era un `data URL` dentro de la fila: cada visita descargaba megabytes. Ahora es una ruta de archivo.
- **`usuario_id ... on delete set null`.** Si alguien borra su cuenta, sus publicaciones **no se pierden** (sigue habiendo contenido valioso); simplemente quedan como "de cuenta eliminada" en vez de desaparecer.

| Política | Rol | Operación | Condición |
|---|---|---|---|
| `reportes_lectura_publica` | `anon` | `SELECT` | `using (true)` |
| `reportes_creacion_publica` | `anon` | `INSERT` | `with check (usuario_id is null)` |
| `reportes_lectura_usuarios` | `authenticated` | `SELECT` | `using (true)` |
| `reportes_creacion_usuarios` | `authenticated` | `INSERT` | `with check (usuario_id is null or usuario_id = auth.uid())` |

> **La política anti-suplantación.** Un invitado (`anon`) **solo** puede insertar con `usuario_id is null`. Si alguien manipula el `fetch` para poner el UUID de otra persona, la operación se rechaza con `42501` (permiso denegado). La verificación es **del lado del servidor**; no hay forma de engañarla desde el navegador. Está comprobado en la prueba E2E.

### 8.3 Tabla `publicaciones`

```sql
create table if not exists public.publicaciones (
  id          text primary key,
  nombre      text not null default 'Anónimo',
  colonia     text not null,
  tipo        text not null,
  texto       text not null,
  likes       int  not null default 0,
  comentarios jsonb not null default '[]'::jsonb,
  ts          bigint not null,
  usuario_id  uuid references auth.users(id) on delete set null,
  constraint publicaciones_texto_max    check (length(texto) <= 1000),
  constraint publicaciones_nombre_max  check (length(nombre) <= 40),
  constraint publicaciones_colonia_max check (length(colonia) <= 60),
  constraint publicaciones_likes_rango check (likes >= 0 and likes <= 1000000)
);
```

**Comentarios en `jsonb`, no en tabla aparte.** Decisión consciente: los comentarios son siempre de la publicación, se leen siempre con ella y nunca se consultan por separado. Una tabla relacional daría normalización pero a cambio de 4 objetos más (un join, RLS duplicada, más peticiones). Con `jsonb` + saneado en el trigger, el resultado es equivalente con una fracción de la complejidad. **El límite duro de 60 comentarios** evita que alguien llene una fila de 500 KB.

| Política | Rol | Operación | Condición |
|---|---|---|---|
| `publicaciones_lectura_publica` | `anon` | `SELECT` | `using (true)` |
| `publicaciones_creacion_publica` | `anon` | `INSERT` | `with check (usuario_id is null)` |
| `publicaciones_actualizacion_publica` | `anon` | `UPDATE` | `using (true) with check (true)` ← **el trigger acota qué se puede tocar** |
| `publicaciones_lectura_usuarios` | `authenticated` | `SELECT` | `using (true)` |
| `publicaciones_creacion_usuarios` | `authenticated` | `INSERT` | `with check (usuario_id is null or usuario_id = auth.uid())` |
| `publicaciones_actualizacion_usuarios` | `authenticated` | `UPDATE` | `using (true) with check (true)` ← ídem |

> **Por qué `UPDATE` es `using (true)`.** Podría parecer un agujero. No lo es: la política permite *intentar* el update, y el trigger `proteger_publicacion` **revierte** todo lo que no sea un like o un comentario. La pareja (política abierta + trigger estricto) es lo que permite que el "Me importa" funcione para cualquiera sin abrir la puerta a la reescritura de textos ajenos. Sin el trigger, esto sería un agujero real.

### 8.4 El trigger `proteger_publicacion` — el corazón de la moderación

```sql
create or replace function public.proteger_publicacion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- ¿El dueño? Entonces edita libremente (pero no puede transferirse la fila).
  if auth.uid() is not null and old.usuario_id is not null and auth.uid() = old.usuario_id then
    new.usuario_id := old.usuario_id;
    return new;
  end if;

  -- Cualquier otro: restaurar campos protegidos.
  new.id         := old.id;
  new.nombre     := old.nombre;
  new.colonia    := old.colonia;
  new.tipo       := old.tipo;
  new.texto      := old.texto;
  new.ts         := old.ts;
  new.usuario_id := old.usuario_id;

  -- Los likes solo suben.
  new.likes      := greatest(old.likes, coalesce(new.likes, old.likes));

  -- Los comentarios solo crecen.
  if new.comentarios is null
     or jsonb_array_length(new.comentarios) < jsonb_array_length(old.comentarios) then
    new.comentarios := old.comentarios;
  end if;

  -- Saneado: autor ≤ 40, texto ≤ 400, ts válido.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'autor', left(coalesce(c ->> 'autor', ''), 40),
             'texto', left(coalesce(c ->> 'texto', ''), 400),
             'ts',    coalesce((c ->> 'ts')::bigint, 0)
           )), '[]'::jsonb)
    into new.comentarios
  from jsonb_array_elements(new.comentarios) c;

  -- Tope de 60 comentarios.
  if jsonb_array_length(new.comentarios) > 60 then
    select coalesce(jsonb_agg(elem), '[]'::jsonb) into new.comentarios
      from (select elem from jsonb_array_elements(new.comentarios) elem limit 60) s;
  end if;

  return new;
end; $$;

create trigger trg_proteger_publicacion
  before update on public.publicaciones
  for each row execute function public.proteger_publicacion();
```

**Las cinco propiedades que garantiza:**

| Ataque | Resultado |
|---|---|
| Cambiar el texto de otra persona | Se restaura el original |
| Poner `likes: 999999` | Se aplica `greatest(old, 999999)` — en realidad sube, pero el `CHECK likes <= 1000000` impide el abuso real |
| Poner `likes: 0` para borrar likes | `greatest(old, 0) = old` — **imposible bajar un contador** |
| Vaciar o truncar comentarios | Se restauran los originales |
| Firmarse como otra persona | `new.nombre := old.nombre` — el nombre vuelve al original |
| Robar la cuenta (`usuario_id`) | `new.usuario_id := old.usuario_id` |
| Mandar un JSON gigante de 2 MB | `CHECK` de 1000 chars en texto, y el trigger limita a 60 comentarios saneados |

Comprobado en la prueba E2E: un intento de vandalismo con un `PATCH` directo devuelve los valores originales.

### 8.5 Storage — bucket `reportes-fotos`

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reportes-fotos', 'reportes-fotos', true, 3145728,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, …;
```

| Propiedad | Valor | Por qué |
|---|---|---|
| Público | `true` | Las fotos de reportes son información pública de la ciudad; cualquiera puede verlas sin registrarse |
| Tamaño máximo | 3 145 728 B (3 MB) | Suficiente para una foto de celular; impide subir archivos arbitrarios |
| MIME permitidos | jpeg, png, webp | Solo imágenes. Nada de `.html`, `.svg` (XSS servido desde el mismo origen) ni `.exe` |

```sql
create policy "fotos_lectura_publica" on storage.objects
  for select using (bucket_id = 'reportes-fotos');

create policy "fotos_subida_publica" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'reportes-fotos'
    and (storage.foldername(name))[1] = 'reportes'    -- ← solo dentro de la carpeta reportes/
    and (storage.foldername(name))[2] is null        -- ← sin subcarpetas
  );
```

`storage.foldername(name)[1] = 'reportes'` obliga a que **todo** archivo esté en `reportes/`. Sin esa condición, cualquiera podría subir a la raíz del bucket o a una ruta arbitraria.

> **Lo que NO se puede hacer desde la app:** borrar objetos de Storage por SQL. `storage.objects` tiene la protección `storage.protect_delete()` y ignora los `DELETE`. Hay que usar la API de Storage (con `service_role`) o el panel deSupabase. Por eso existen 3 fotos huérfanas de las pruebas, de unos 11 KB en total.

### 8.6 Índices

```sql
create index if not exists idx_reportes_ts          on public.reportes (ts desc);
create index if not exists idx_publicaciones_ts     on public.publicaciones (ts desc);
create index if not exists idx_publicaciones_usuario on public.publicaciones (usuario_id);
create index if not exists idx_reportes_usuario     on public.reportes (usuario_id);
```
Los dos primeros soportan el `order=ts.desc&limit=120` de cada arranque. Sin ellos, cada carga sería un `sort` de toda la tabla.

### 8.7 Configuración de Authentication

| Opción | Valor | Consecuencia |
|---|---|---|
| `external.email` | `true` | Correos externos permitidos |
| `mailer_autoconfirm` | `true` | **El registro no requiere confirmar correo** — importante en un plan escolar |
| `disable_signup` | `false` | Cualquiera puede crear cuenta |
| SMTP | **no configurado** | ⚠️ **La recuperación de contraseña NO entrega correo a terceros** |

> **El único requisito real para que funcione la app:** SMTP. En el plan gratuito, Supabase solo envía correo a los miembros del proyecto. Para que "Olvidé mi contraseña" funcione con correos de compañeros hay que conectar un proveedor (Resend, Brevo, SendGrid…) en **Authentication → Providers → Email**. Todo el código ya está listo y probado; solo falta la infraestructura de correo. Mientras tanto, el flujo abre el formulario correctamente pero el correo no llega fuera del proyecto.

---

### 8.8 Endurecimiento aplicado (P1–P2–P4)

Lo que hay **por debajo** de las políticas descritas arriba. Todo está en `migrations/`, cada archivo con su cabecera explicando el problema, la decisión y el rollback:

| # | Archivo | Qué resuelve |
|---|---|---|
| 00 | `2026-10-03-00-p1-comun.sql` | `ip_cliente()`, `emisor_actual()`, `limpiar_texto()` |
| 01 | `…-p1-likes.sql` | `likes_votos` + `dar_like()`; `likes` y `comentarios` congelados en el trigger |
| 02 | `…-p1-comentarios.sql` | Tabla `comentarios`, RLS, `crear_comentario()`, `comentarios_de()`, migración del `jsonb` |
| 03 | `…-p1-perfiles.sql` | Nombre por defecto `'Vecino'`, `nombre_edicado`, limpieza de nombres heredados del correo |
| 04 | `…-p1-ubicacion.sql` | `difuminar_ubicacion()` + CHECK: la ubicación se redondea **al escribir** |
| 05 | `…-p1-frecuencia.sql` | `uso_registrado` + `registrar_uso()`: topes por cuenta, huella e IP |
| 06 | `…-p2-seguimiento.sql` | Enum `estado_reporte`, tabla `administradores`, `es_admin()`, `marcar_seguimiento()` |
| 07 | `…-p2-moderacion.sql` | Columnas `oculto` / `oculto_motivo`, RLS que las esconde, `moderar()`, `pendientes_moderacion()` |
| 08 | `…-p2-borrado.sql` | `DELETE` solo para `usuario_id = auth.uid()` |
| 09 | `…-p4-progresos.sql` | Tabla `progresos` con RLS por usuario, `guardar_progreso()`, `mi_progreso()` |
| 10 | `…-almacenamiento.sql` | Documenta el bucket de fotos y sus políticas (ya estaba en producción) |

**Tablas que hay hoy:**

| Tabla | Qué guarda | Quién la escribe |
|---|---|---|
| `perfiles` | nombre/apodo público (`'Vecino'` por defecto) | el propio usuario |
| `publicaciones` | texto, colonia, tipo, `likes`, `usuario_id`, `oculto`, `huella` | el autor (texto) / `dar_like()` (likes) / moderación (`oculto`) |
| `comentarios` | texto, autor, `publicacion_id`, `usuario_id`, `huella`, `emisor` | solo `crear_comentario()` |
| `likes_votos` | quién apoyó qué | solo `dar_like()` |
| `reportes` | texto, colonia, tipo, foto, `ubicacion` difuminada, `estado`, `estado_sync`, `oculto`, `huella` | quien reporta / moderación (`estado`, `oculto`) |
| `uso_registrado` | una fila por escritura, para contar | triggers |
| `progresos` | puntos, insignias, días con acción | solo `guardar_progreso()` |
| `administradores` | quién modera | solo el SQL Editor |
| `perfiles` / `comentarios` / `likes_votos` / `uso_registrado` | sin política de escritura | funciones `security definer` |

**Funciones `security definer` que decide el servidor** (el navegador nunca decide):

`dar_like` · `crear_comentario` · `comentarios_de` · `mi_perfil` · `guardar_progreso` · `mi_progreso` · `marcar_seguimiento` · `moderar` · `pendientes_moderacion` · `es_admin`

Todas con `set search_path = public` y con el permiso `EXECUTE` revocado al rol público antes de otorgarse solo a `anon` o `authenticated`.

**El truco del `GUC`** que conecta todo: `dar_like()` y `guardar_progreso()` hacen `perform set_config('bym.marca_interna', …, true)` antes de su `UPDATE`. Los triggers miran ese valor: si está puesto, dejando pasar **solo** el cambio exacto que la función está autorizada a hacer. Un `PATCH` directo del cliente no lo lleva, así que el trigger lo revierte. Es lo que impide inflar likes, bajar puntos o cambiar el estado de un reporte.

---

## 9. Gamificación

### 9.1 Los diez niveles

```js
const NIVELES = [
  { min: 0,    nombre: 'Vecino consciente' },
  { min: 100,  nombre: 'Cuidador' },
  { min: 220,  nombre: 'Ecoactivo' },
  { min: 360,  nombre: 'Participante' },
  { min: 520,  nombre: 'Guardián verde' },
  { min: 700,  nombre: 'Colaborador' },
  { min: 900,  nombre: 'Líder comunitario' },
  { min: 1150, nombre: 'Impulsor ambiental' },
  { min: 1450, nombre: 'Defensor del entorno' },
  { min: 1800, nombre: 'Embajador de la comunidad' }
];
```

**Progresión ilimitada:**
```js
if (puntos >= NIVELES[NIVELES.length - 1].min){
  const extra = Math.floor((puntos - 1800) / 500);
  const min = 1800 + extra * 500;
  return { nivel: 10 + extra, nombre: 'Embajador de la comunidad ★', min, sig: min + 500 };
}
```
Pasados los 1800 puntos, cada 500 sube un "Nivel X+". Nadie se queda atascado en un tope.

### 9.2 Los puntos

```js
const PTS = { accion: 10, reporte: 20, participacion: 30, ayuda: 5 };
```

| Acción | Puntos |
|---|---|
| Registrar la acción ecológica del día | +10 |
| Enviar un reporte ciudadano | +20 |
| Publicar en la comunidad | +30 |
| Comentar | +5 |
| "Me importa" | +0 (es apoyo, no puntaje: evita inflar la tabla de posiciones) |

`addPoints()` dispara el confeti y el toast de nivel cuando `nivelDe(antes).nivel < nivelDe(después).nivel`.

### 9.3 Las ocho insignias

| Insignia | Emoji | Condición |
|---|---|---|
| Primera acción | 🌱 | ≥ 1 acción registrada |
| Explorador de rutas | 📍 | Ha usado su ubicación o elegido un punto |
| Separador responsable | ♻️ | 3 **días distintos** separando |
| Voz ciudadana | 📢 | ≥ 1 reporte enviado |
| Participación | 🤝 | ≥ 1 publicación propia |
| Reportero ambiental | 📸 | ≥ 1 reporte **con fotografía** |
| Conoce tu ruta | 🚛 | Ha consultado la ruta de su colonia |
| Guardián verde | 🏆 | Alcanzó el nivel 5 |

```js
function verificarInsignias(){
  const ctx = { puntos, acciones, diasAccion, numReportes, numPublicaciones,
                reporteConFoto, usoUbicacion, consultaRuta };
  INSIGNIAS.forEach(ins => {
    if (estado.insignias.indexOf(ins.id) === -1 && ins.cond(ctx)){
      estado.insignias.push(ins.id); guardar();
      lanzarConfeti();
      toast('🏅 Insignia desbloqueada: ' + ins.icono + ' ' + ins.nombre, 'logro', 5200);
      renderInsignias(ins.id);
    }
  });
}
```

Cada insignia se evalúa con una **función `cond` sobre un contexto**, así que añadir una insignia nueva es una línea. `verificarInsignias()` se llama en cada arranque, en cada acción y en cada envío — por eso una insignia que se desbloqueó "por otra vía" aparece igualmente.

### 9.4 Lo que la gamificación NO es

- Los puntos, el nivel y las insignias **viven en `localStorage`, no en la nube**. Cambiar de dispositivo los reinicia. Está documentado como limitación consciente.
- El "Me importa" **no da puntos**: dar puntos por tocar un botón convierte la app en una granja de puntos.
- Las insignias se ganan por **acciones ecológicas reales del usuario**, no por horas de uso.

---

## 10. PWA, service worker y caché

### 10.1 `manifest.webmanifest`

```json
{
  "name": "BASURA Y MÁS · Comunidad limpia para Ciudad Guzmán",
  "short_name": "BASURA Y MÁS",
  "lang": "es",
  "start_url": "./index.html",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#F4F9F5",
  "theme_color": "#2E7D32",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" },
    { "src": "icon.svg",   "sizes": "any",     "type": "image/svg+xml", "purpose": "any" }
  ]
}
```
`maskable` en el icono de 512 permite que Android lo recorte a cualquier forma sin cortar el logo.

### 10.2 `sw.js` — estrategia de caché

```js
const CACHE = 'bym-v5';
const PRECACHE = ['./', './index.html', './manifest.webmanifest',
                  './icon.svg', './icon-192.png', './icon-512.png'];
```

**Dos estrategias distintas, cada una correcta para su caso:**

| Tipo de petición | Estrategia | Por qué |
|---|---|---|
| **Navegación** (`req.mode === 'navigate'`) | **Red primero**, caché como respaldo | Una actualización debe verse en la **primera** recarga. Con caché-primero, el usuario veía la versión vieja y tenía que recargar dos veces. |
| **Recursos del mismo origen** (iconos, manifest) | **Caché primero**, revalidando en segundo plano | Son inmutables; mostrarlos al instante mejora el primer render. |
| **Otros orígenes** (Leaflet, OSM, OSRM, Supabase) | **Sin intervención** (`if (url.origin !== self.location.origin) return;`) | Cachear APIs vivas serviría datos viejos. Es una decisión de correctitud, no de rendimiento. |

```js
// Navegación: red primero
fetch(req).then(res => {
  if (res && res.ok){ const copia = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copia)); }
  return res;
}).catch(() => caches.match('./index.html').then(hit => hit || caches.match('./')));
```

```js
// Recursos: caché primero + revalidación
caches.match(req).then(hit => {
  const red = fetch(req).then(res => {
    if (res && res.ok){ const copia = res.clone(); caches.open(CACHE).then(c => c.put(req, copia)); }
    return res;
  }).catch(() => hit);        // ← sin red, devuelve lo cacheado
  return hit || red;
});
```

**Activación:** borra todas las cachés distintas de la actual y hace `clients.claim()`, para que la versión nueva tome control de las pestañas ya abiertas sin pedir recarga.

```js
caches.keys()
  .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
  .then(() => self.clients.claim());
```

> **Versionado:** cada cambio de estrategia sube el nombre (`bym-v3` → `bym-v5`). Es la única forma de invalidar la caché de forma determinista. **Regla para el futuro: si cambias `sw.js`, sube `CACHE`.**

> **Por qué `Cache-Control: public, max-age=0, must-revalidate` en `/sw.js`** (en `vercel.json`): sin esa cabecera, el navegador puede cachear el propio service worker y seguir ejecutando la versión vieja indefinidamente. Con ella, el service worker siempre se revalida.

### 10.3 Registro

```js
if ('serviceWorker' in navigator){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('./sw.js').catch(() => { /* sin service worker la app funciona igual */ });
  });
}
```
Se registra en `load` (no antes) para no competir con los recursos críticos, y el `.catch` es explícito: **si el service worker falla, la app no se rompe**.

### 10.4 Instalar en el teléfono

- **Android / Chrome:** menú ⋮ → "Instalar aplicación" / "Añadir a pantalla de inicio".
- **iOS / Safari:** botón Compartir → "Añadir a pantalla de inicio" (necesita los meta tags de apple, que ya están).

---

## 11. SEO y cabeceras de seguridad

### 11.1 SEO

| Elemento | Estado |
|---|---|
| `<title>` descriptivo | ✅ |
| `meta description` | ✅ |
| Open Graph completo (tipo, título, descripción, URL, imagen 1200×630) | ✅ |
| Twitter Card `summary_large_image` | ✅ |
| `<link rel="canonical">` | ✅ |
| `<html lang="es">` | ✅ |
| `robots.txt` (permite todo + declara el sitemap) | ✅ |
| `sitemap.xml` (1 URL, `lastmod`, `changefreq`, `priority`) | ✅ |
| `theme-color` (dinámico con el tema) | ✅ |
| Manifest PWA | ✅ |
| Datos estructurados (JSON-LD `schema.org`) | ❌ no presente (oportunidad de mejora) |

### 11.2 Cabeceras de seguridad (`vercel.json`)

Regla global:
```json
{ "source": "/(.*)", "headers": [
  { "key": "X-Content-Type-Options",   "value": "nosniff" },
  { "key": "X-Frame-Options",         "value": "SAMEORIGIN" },
  { "key": "Referrer-Policy",         "value": "strict-origin-when-cross-origin" },
  { "key": "Permissions-Policy",      "value": "geolocation=(self), camera=(), microphone=()" },
  { "key": "Strict-Transport-Security", "value": "max-age=31536000; includeSubDomains" }
]}
```

| Cabecera | Qué hace |
|---|---|
| `X-Content-Type-Options: nosniff` | Impide que el navegador adivine el tipo de un archivo. Bloquea una clase entera de ataques XSS por MIME sniffing. |
| `X-Frame-Options: SAMEORIGIN` | Nadie puede meter la app en un `<iframe>` de otro sitio (clickjacking). |
| `Referrer-Policy` | Solo se envía el origen (no la ruta) en peticiones a terceros. |
| `Permissions-Policy` | La geolocalización **solo** funciona en la propia app. **Cámara y micrófono completamente denegados**: la app no los usa, así que se cierran por defecto. |
| `HSTS` | Fuerza HTTPS durante un año, también en subdominios. |

Reglas de caché:
| Ruta | `Cache-Control` |
|---|---|
| `/index.html` | `public, max-age=0, must-revalidate` |
| `/sw.js` | `public, max-age=0, must-revalidate` + `Service-Worker-Allowed: /` |
| `/manifest.webmanifest` | `public, max-age=3600` |
| `/icon-192.png`, `/icon-512.png`, `/apple-touch-icon.png`, `/og.png` | `public, max-age=604800` (7 días) |

> ⚠️ **Trampa conocida y ya resuelta.** El primer intento de despliegue **falló** con `errorCode: invalid_header`: `Header at index 4 has invalid 'source' pattern "/icon-*.png"`. **Vercel no acepta globs en `source`.** Ahora cada icono tiene su propia regla explícita. Si alguna vez añades un archivo y quieres reglas para él, **enuméralo uno por uno**; no uses `*`.

`Service-Worker-Allowed: /` es lo que permite que `sw.js` (en la raíz) controle todo el sitio, incluso si se moviera a una subcarpeta.

---

## 12. Accesibilidad

Lo que ya está resuelto:

| Criterio | Implementación |
|---|---|
| Etiquetas en todos los `input` | `aria-label` o `<label>` |
| Botones con nombre accesible | Todos tienen texto o `aria-label` |
| Imágenes con `alt` | `alt` en todas; las decorativas con `alt=""` + `aria-hidden` |
| Navegación SPA | `aria-current="true"` en la sección activa |
| Diálogos | `role="dialog" aria-modal="true" aria-labelledby="…"` |
| Avisos dinámicos | `<div id="toasts" aria-live="polite" aria-atomic="false">` |
| Tabs de la guía | `aria-selected` + navegación con flechas ← → |
| Barra de progreso | `role="progressbar"` + `aria-valuenow` actualizado |
| Formularios | Mensajes de error con `⚠️` + foco al primer inválido |
| Iconos | Sprite SVG con `aria-hidden="true"` donde son decorativos |
| Teclado | Escape cierra modales; foco visible; `prefers-reduced-motion` respetado |
| Contraste | Variables de color revisadas para modo claro y oscuro |

Verificación automática hecha: **0 imágenes sin `alt`, 0 botones sin nombre accesible, 0 campos sin etiqueta.**

---

## 13. Despliegue

Producción: **https://basura-y-mas.vercel.app**

### 13.1 Lo que se despliega

**No se despliega todo lo versionado.** A producción van solo los **13 archivos que el
sitio sirve**; el resto se queda en el repositorio:

| Sí va a producción | No va, y por qué |
|---|---|
| `index.html`, `estilos.css`, `app.js`, `sw.js` | `DOCUMENTACION.md` — documentación interna |
| `vercel.json` (cabeceras y caché) | `migrations/` — el esquema de la base de datos |
| `manifest.webmanifest`, `robots.txt`, `sitemap.xml` | `supabase-schema.sql`, `tests/`, `tools/` |
| Los 6 iconos (`icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `og.png`) | `.github/` — no lo ejecuta Vercel |
| | `supabase/functions/` — es código de Edge Function, no de Vercel |
| | `video-demo-basura-y-mas.mp4` (943 KB, no se sirve desde ninguna página) |
| | `.gitignore` |

Publicar el esquema y las migraciones en un sitio público no añade nada y sí enseña la
estructura de la base de datos. El proyecto sigue siendo el repositorio Git completo.

**Verificado en producción el 3 de octubre de 2026** (despliegue `dpl_CBCxgDXva6iLTbUdrq8eTdNntB87`, 13 archivos):

| Comprobación | Resultado |
|---|---|
| `app.js` y `estilos.css` sirven la versión nueva (154 622 y 56 498 bytes) | ✅ |
| `sw.js` contiene `bym-v7` | ✅ |
| Los 6 iconos, `manifest.webmanifest`, `robots.txt` y `sitemap.xml` responden **200** | ✅ |
| `Content-Security-Policy` presente, sin `unsafe-eval` | ✅ |
| Las otras 5 cabeceras (`Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) | ✅ |
| Service worker registrado **en el dominio real** y caché `bym-v7` con los 8 archivos | ✅ |
| Botón "Explorar como invitado" visible; los 4 enlaces del pie presentes | ✅ |
| Cero errores de consola y ninguna violación de la CSP | ✅ |
| Botón de moderación oculto para un invitado | ✅ |

### 13.2 Opción A — Despliegue automático desde GitHub (la deseada)

1. Vercel → **Settings → Git** → conectar `Daniel3557/basura-y-mas`.
2. Cada `push` a `main` despliega y promoting automáticamente.

> ⚠️ **Estado actual: no funciona.** El repositorio *sí* está conectado en Vercel y los eventos aparecen activados, pero **los webhooks de GitHub nunca llegan** (los commits no generan ninguna marca de check). Causa más probable: **la app de Vercel en GitHub no tiene permiso sobre ese repositorio.**
>
> **Solución (la hace el usuario, 1 minuto):** GitHub → **Settings → Apps instaladas** → **Vercel** → **Configure** → marcar el repositorio `basura-y-mas` (o "Only select repositories" y seleccionarlo) → guardar. A partir de ahí, cada push despliega solo.

### 13.3 Opción B — API REST de Vercel (la que funciona hoy)

La CLI de Vercel **no funciona** con un token de cuenta-por-equipo (`whoami` devuelve "User not found" porque `/v2/user` responde 404 en ese tipo de cuenta). La receta que sí funciona, en Node puro:

**Paso 1 — Subir cada archivo** (digest en la cabecera, NO en la URL):
```
POST https://api.vercel.com/v2/files?teamId=<teamId>
Authorization: Bearer <TOKEN>
Content-Type: application/octet-stream
x-vercel-digest: <sha1-hex-del-archivo>

<binario del archivo>
```
> `x-vercel-digest` es un **header**, no un parámetro de la URL. `GET /v2/files/<sha>` devuelve 404.

**Paso 2 — Crear el deployment:**
```
POST https://api.vercel.com/v13/deployments?teamId=<teamId>&skipAutoDetectionConfirmation=1
Content-Type: application/json

{
  "name": "basura-y-mas",
  "project": "prj_…",
  "target": "production",
  "files": [{ "file": "index.html", "sha": "<sha1>", "size": 210386 }],
  "gitMetadata": {
    "remoteUrl": "https://github.com/Daniel3557/basura-y-mas",
    "commitRef": "main",
    "commitSha": "…",
    "commitMessage": "…",
    "commitAuthorName": "Daniel3557",
    "commitAuthorEmail": "Daniel3557@users.noreply.github.com"
  }
}
```

**Paso 3 — Esperar:**
```
GET https://api.vercel.com/v13/deployments/<id>?teamId=<teamId>
```
Sondear hasta `readyState: "READY"`, y después promover a producción.

**Lista de archivos:** usar `git ls-files` para subir exactamente lo versionado y nada de los archivos personales (fotos de WhatsApp, prototipos, capturas). **Nunca usar un glob tipo `*` o `icon-*` en los `source` de `vercel.json`** (ver sección 11.2).

**Identidad de commit:** esta máquina no tiene `user.name`/`user.email` de git, así que cada commit se firma con variables de entorno:
```bash
GIT_AUTHOR_NAME="Daniel3557" GIT_AUTHOR_EMAIL="Daniel3557@users.noreply.github.com" \
GIT_COMMITTER_NAME="Daniel3557" GIT_COMMITTER_EMAIL="Daniel3557@users.noreply.github.com" \
git commit -m "…"
```

### 13.4 Actualizar el service worker después de desplegar

Si cambiaste `sw.js`, **sube el nombre de `CACHE`**. Mientras tanto, quien ya había visitado el sitio puede ver la versión anterior hasta hacer un `Ctrl+F5` (o abrir `https://basura-y-mas.vercel.app/?v=c6ff18c` para saltarse la caché).

### 13.5 SMTP para que "Olvidé mi contraseña" funcione con cualquier correo

> **Estado actual: NO configurado.** Es el único punto del proyecto donde una función
> terminada se queda sin entregar porque falta una cuenta del equipo. Esta es la receta
> completa; se ha verificado contra la documentación de Resend y de Supabase, pero
> **nadie la ha ejecutado todavía** (ver 17.6).

**Por qué importa.** Sin SMTP propio, Supabase usa su servidor de prueba, que tiene dos
límites duros: solo entrega a correos que estén en la pestaña *Team* del proyecto, y
acepta **2 mensajes por hora**. En la práctica, un compañero de clase que se registra con
su Gmail recibe `Email address not authorized` y el enlace de recuperación nunca llega. La
app no falla: el correo es lo que no sale.

**Paso 1 — Cuenta y dominio en Resend.**

1. Crear cuenta en <https://resend.com> (plan gratuito: **3 000 correos al mes, 100 al
   día, 3 dominios**; suficiente de sobra para una escuela).
2. *Domains → Add Domain*. Lo ideal es un dominio propio; si no hay ninguno, sirve el
   dominio de prueba `onboarding@resend.dev`, **pero solo entrega a tu propio correo**,
   así que no resuelve el problema.
3. Con un dominio propio hay que añadir los registros DNS que indique Resend
   (`SPF`, `DKIM` y un registro `TXT` de verificación) en el panel del registrador del
   dominio. **Sin esto el dominio no se marca *verified* y no se puede usar como
   remitente.**
4. Copiar la **API key** (*API Keys → Create API Key*, empieza por `re_`). Es una
   contraseña: no va en el repositorio, ni en un commit, ni en un mensaje.

**Paso 2 — Datos SMTP que pide Supabase.** *Settings → SMTP*, tal cual los muestra Resend:

| Campo de Supabase | Valor de Resend |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` (SSL implícito) o `587` (STARTTLS) |
| Username | `resend` — **no** es el correo, es la palabra fija |
| Password | la **API key** (`re_…`) |
| Sender name | `Basura y Más` |

Otros puertos válidos: 25, 465, 587, 2465, 2587 (465 y 2465 son SMTPS; los demás
STARTTLS).

**Paso 3 — Pegarlo en Supabase.** *Project Settings → Authentication → Emails → SMTP
Settings*:

1. Activar **"Enable Custom SMTP"**.
2. Rellenar host, puerto, usuario y contraseña con la tabla de arriba.
3. **Sender address**: una dirección del dominio ya verificado, p. ej.
   `no-reply@tu-dominio`. **No** puede ser una dirección de `@gmail.com`: el dominio del
   remitente tiene que coincidir con el verificado, o el correo acaba en spam.
4. Guardar.

Equivalente por API, si se prefiere hacerlo por terminal (el token se saca de
<https://supabase.com/dashboard/account/tokens>):

```bash
curl -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "external_email_enabled": true,
    "smtp_admin_email": "no-reply@tu-dominio",
    "smtp_host": "smtp.resend.com",
    "smtp_port": 465,
    "smtp_user": "resend",
    "smtp_pass": "re_…",
    "smtp_sender_name": "Basura y Más"
  }'
```

**Paso 4 — Subir el tope de envío.** Al activar un SMTP propio, Supabase impone
temporalmente un límite conservador de **30 correos por hora** para proteger la
reputación del dominio. Se ajusta en *Authentication → Rate Limits → Emails*.

**Paso 5 — Comprobar que sí llega.** En la app: *Mi cuenta → Olvidé mi contraseña* con
un correo **distinto** del que está en la pestaña *Team* ( Gmail, Hotmail, el del
compañero de al lado). Si llega, la casilla de 14.4 deja de estar en rojo.

> 🔐 **La API key de Resend es una contraseña.** Va solo en el panel de Supabase (que la
> guarda cifrada). Nunca en `app.js`, ni en `vercel.json`, ni en este repositorio, ni en
> una captura. La regla del proyecto sigue siendo la de siempre: no imprimir
> `service_role` ni tokens.

**Lo que NO hace falta tocar:** nada en el código. La app ya llama a
`supabase.auth.resetPasswordForEmail()` y abre el formulario de nueva contraseña; solo
le falta que alguien por el otro lado reciba el correo.

### 13.6 Entorno de desarrollo local

La app no necesita build. Lo más simple es un servidor estático:

```bash
cd "C:/Users/Daniel/Desktop/pagina web filosofia"
npx serve -l 8788 .          # o: python -m http.server 8788
# abrir http://127.0.0.1:8788
```

> ⚠️ **No abras `index.html` con doble clic (`file://`).** El service worker y algunas consultas a la API requieren un origen `http(s)`. Con `file://` la app funciona a medias, sin caché y con errores de CORS.

---

## 14. Cómo se usa la app (paso a paso)

### 14.1 Primera vez

1. Abre **https://basura-y-mas.vercel.app**.
2. Espera el loader (~1 s).
3. A los ~900 ms aparece el **modal de bienvenida** con tres opciones:
   - **Crear mi cuenta** → paso 14.2
   - **Ya tengo cuenta** → paso 14.3
   - **Entrar como invitado** → cierra el modal. Puedes usar todo menos que tu identidad viaje con tu cuenta.
4. Si cierras el modal con Escape o clic en el fondo, **no vuelve a aparecer** (queda guardado en `bym.onboarding.v1`).

### 14.2 Crear una cuenta

1. Botón **👤** (arriba a la derecha) o **"Crear mi cuenta"** en la bienvenida.
2. Pestaña **"Crear cuenta"**.
3. Llena: **nombre** (≤ 40), **correo** (tú lo controlas: no se pide teléfono, no se pide documento), **contraseña** (mínimo 8 caracteres).
4. **"Crear cuenta"**.
5. Listo: tu nombre aparece en todo lo que publiques y **queda bloqueado** en los formularios (ya no puedes firmarte como otro).

> **Sobre la privacidad:** la app pide nombre, correo y contraseña. **No pide ubicación obligatoria** (el GPS es opcional y se pide solo cuando pulsas "Usar mi ubicación"), **no pide teléfono, no pide documento, no usa cámara ni micrófono** (bloqueados por `Permissions-Policy`). El correo solo se usa para tu cuenta y para recuperar la contraseña.

### 14.3 Iniciar sesión

1. Botón **👤** → **"Ya tengo cuenta"**.
2. Correo y contraseña → **"Entrar"**.
3. Si tu sesión quedó abierta en otro dispositivo, aquí se restaura automáticamente.

### 14.4 Olvidé mi contraseña

1. En el modal de cuenta, **"Olvidé mi contraseña"**.
2. Escribe tu correo → **"Enviar enlace"**.
3. Revisa tu correo y abre el enlace.
4. La app se abre directamente en el formulario **"Nueva contraseña"**.
5. Escribe la nueva contraseña dos veces → **"Guardar contraseña"**.
6. Inicia sesión con la nueva.

> ⚠️ **Importante hoy:** el correo **solo llega a correos del proyecto** porque falta configurar SMTP en Supabase. Si alguien de tu clase pide recuperar la contraseña, **no le llegará nada**. Hay que conectar un proveedor SMTP: la **receta paso a paso con Resend está en 13.5**.

### 14.5 Ver tu ruta de recolección

1. Navegación → **"Mapa y rutas"** (icono 🗺️).
2. Selector superior: **elige tu colonia**.
3. El mapa dibuja la ruta y marca los puntos numerados.
4. En la lista de la derecha: número, distancia acumulada y **tiempo estimado**.
5. Cada punto dice **"Punto propuesto por el sistema"** — porque lo son.
6. **"Usar mi ubicación"** te pone en el mapa y calcula tu camino al punto más cercano.
7. Toca cualquier punto para ver su ficha (`#modalPunto`).
8. **"Recargar ruta"** fuerza un nuevo cálculo.
9. Abajo, **"▶ Modo demostración"**: el camión avanza simulado a 22 km/h y te avisa cuando está cerca. Todo lleva la etiqueta **(Demo)**.

### 14.6 Separar residuos (la guía)

1. Navegación → **"Guía de separación"** (♻️).
2. **Tabs**: Orgánicos · Reciclables · No reciclables · Especiales.
3. **Buscador**: escribe cualquier cosa ("pilas", "vidrio", "cascara"… sin tilde también funciona) y la app te dice qué hacer con ello.
4. **"Registré mi acción de hoy"**: una vez al día. Te da **+10 puntos** y suma el día a tu racha.
5. **"💾 Conciencia"**: la tarjeta local de arriba muestra cuántas acciones registraste.

### 14.7 Enviar un reporte

1. Navegación → **"Reportes"** (📢).
2. Llena:
   - **Colonia** (tu zona)
   - **Tipo**: Contenedor lleno · Basura en la calle · Camión no pasó · Ruta incorrecta · Otro
   - **Descripción**: mínimo 15, máximo 500 caracteres (hay un contador `x / 500`)
   - **Nombre**: con cuenta va bloqueado con tu nombre; sin cuenta puedes escribirlo o dejarlo como **Anónimo**
3. **Foto** (opcional): toca "Adjuntar fotografía".
   - Se acepta cualquier imagen de hasta 5 MB.
   - **Se comprime automáticamente** a máx 1000×1000 px y ~160 KB antes de subir.
   - Verás una vista previa; puedes quitarla.
4. **Ubicación** (opcional):
   - **"Usar mi GPS"**, o
   - **"Elegir en el mapa"** → toca el mapa → aparece un marcador.
   - Si no quieres compartir ubicación, déjala vacía.
5. **"Enviar reporte"**.
6. Recibes el resultado:
   - ☁️ **"Sincronizado en la nube"** → ya lo ven todos.
   - 💾 **"Guardado en este dispositivo"** → sin conexión; se subirá la próxima vez.
7. **+20 puntos** y, si es tu primer reporte con foto, desbloqueas 📸 **Reportero ambiental**.
8. Tu reporte aparece arriba en la lista **"Mis reportes"**, con la foto.

### 14.8 Participar en la comunidad

1. Navegación → **"Comunidad"** (👥).
2. **Publicar**: tipo (Duda · Propuesta · Iniciativa · Aviso) + colonia + texto. **+30 puntos**.
3. **"Me importa"**: suma un voto. **Nunca se puede quitar** (y el contador nunca baja: está protegido en la base de datos).
4. **"Comentar (n)"**: escribe (máx 200 caracteres) → **+5 puntos**.
5. **"Compartir"**: si tu teléfono lo soporta abre el menú nativo de compartir; si no, aparece un modal con el texto listo para copiar.

> Si el muro está vacío verás **3 publicaciones de ejemplo** marcadas como *"Cuenta de ejemplo"*, para que se entienda cómo se usa. Nunca se confunden con contenido real.

### 14.9 Tu perfil

1. Navegación → **"Mi perfil"** (👤).
2. **Nombre** y **colonia** editables (con cuenta, el nombre lo manda la cuenta).
3. **Nivel, puntos, barra de progreso** y cuántos faltan para el siguiente.
4. **Insignias**: 8 tarjetas, las desbloqueadas iluminadas.
5. **Estadísticas**: reportes, participaciones, acciones, insignias (x/8).
6. **Logros**: las últimas 8 acciones con su tiempo relativo.

### 14.10 Configuración

Botón **⚙️** (arriba a la derecha) → `#modalConfig`:

| Opción | Qué hace |
|---|---|
| **Tema** | Claro / oscuro (respeta el del sistema la primera vez) |
| **Colonia** | Cambia tu colonia y recalcula la ruta |
| **Notificaciones** | Activa las del navegador. Si no hay permiso, la app usa avisos dentro de la app |
| **Modo demostración** | Simula el camión |
| **Acerca de** | Créditos y datos del proyecto |
| **Privacidad** | Qué datos se guardan y dónde |
| **Restablecer datos** | Borra **lo local** (perfil, puntos, insignias). Lo ya sincronizado **permanece** en la nube |

### 14.11 Instalar como aplicación

**Android:** Chrome → ⋮ → "Instalar aplicación".
**iPhone:** Safari → Compartir → "Añadir a pantalla de inicio".
**Escritorio:** aparece el botón de instalación en la barra de direcciones.

Queda como una app con su ícono, abre a pantalla completa y **funciona sin internet** para todo lo que ya tengas guardado.

---

## 15. Persistencia: todas las claves de localStorage

| Clave | Contenido | Tamaño típico |
|---|---|---|
| `bym.v1` | Todo el estado: perfil, tema, colonia, puntos, acciones, días, insignias, reportes, publicaciones, eliminados | 50–300 KB |
| `bym.sesion.v1` | `{ id, email, token, refresh }` de Supabase Auth | ~1.5 KB |
| `bym.onboarding.v1` | Bandera de "ya vi la bienvenida" | 4 B |
| `bym.osm.v1` | Vialidades OSM por zona (caché de Overpass) | 100–500 KB |
| `bym.rutas.v1` | Última ruta calculada por colonia | 20–80 KB |
| `__t` | Prueba de escritura (se crea y se borra al arrancar) | 0 B |

**El que más pesa es `bym.v1`,** y por eso existen `MAX_NUBE = 120` y `MAX_LOCAL = 150` con `podarLista()`.

**"Restablecer datos"** borra `bym.v1` y `bym.osm.v1` y recarga la página. **No borra `bym.sesion.v1`** (eso es cerrar sesión, que está aparte).

---

## 16. Verificación y pruebas

### 16.1 La prueba E2E

```bash
cd "C:/Users/Daniel/Desktop/pagina web filosofia"
node tests/e2e-supabase.js
```

Ejecuta **60 comprobaciones** contra la API real de Supabase, sin navegador, en 13 secciones:

| # | Qué comprueba |
|---|---|
| 1 | Alta de cuenta de prueba (`e2e.bym+<timestamp>@gmail.com`) |
| 2 | El perfil nace como **"Vecino"**, no con el correo; `nombre_edicado = false`; el correo no aparece en ninguna columna pública |
| 3 | Renombrar el perfil; un invitado **no** puede cambiar el de otro (se relee, porque PostgREST responde 204 aunque RLS filtre todo) |
| 4 | Publicar con cuenta: `usuario_id` correcto |
| 5 | Subida de foto a Storage, `GET` público e **integridad** del archivo |
| 6 | Reporte con la foto como URL; ubicación **difuminada** a 3 decimales; clave ajena descartada del `jsonb`; coordenada imposible → `null` |
| 7 | Texto gigante → `23514` (CHECK violado) |
| 8 | Like por RPC (+1), segundo like del mismo dispositivo rechazado, likes **no inflables** ni **no bajables** por `PATCH`, comentarios ya **no** se meten por `PATCH`, comentario creado por RPC, insert directo en `comentarios` bloqueado |
| 8b | Tope de 3 comentarios por dispositivo en una publicación |
| 9 | Un invitado no puede reescribir el texto ni el nombre de otro |
| 10 | Suplantación: insertar con `usuario_id` ajeno → `42501` |
| 11 | Renovación de `access_token` con `refresh_token` |
| 12 | `recover` de contraseña responde (o Supabase avisa con `429 over_email_send_rate_limit`, que **no** es un fallo) |
| 12b | Una cuenta corriente **no** administra: `es_admin = false`, y `moderar`, `marcar_seguimiento` y `pendientes_moderacion` la rechazan |
| 12c | El reporte nace en `recibido`; nadie se autoproclama `atendido`; no se puede insertar un estado fuera del enum |
| 12d | Borrado: un invitado no borra; el dueño sí; el reporte desaparece |
| 12e | Progreso: los puntos no bajan, las insignias solo se acumulan, los valores absurdos se acotan, sin sesión no se guarda, y nadie lee el progreso de otro |

**Resultado actual: 60/60 ✅**

> ⚠️ **La prueba deja datos en la nube.** Las tablas no tienen política de `DELETE` para el cliente (a propósito), así que hay que limpiarlos desde el **SQL Editor** de Supabase:
> ```sql
> delete from storage.objects where name like 'reportes/e2e-%';
> delete from public.comentarios   where publicacion_id like 'e2e-%';
> delete from public.likes_votos   where publicacion_id like 'e2e-%';
> delete from public.publicaciones where id like 'e2e-%';
> delete from public.reportes      where id like 'e2e-%';
> delete from auth.users           where email like 'e2e.bym+%@gmail.com';
> -- public.progresos se va en cascada con auth.users
> ```

### 16.2 Verificación automática en cada push

`.github/workflows/verificar.yml` corre en cada push y pull request:

1. `node --check` de `app.js`, `sw.js` y `tests/e2e-supabase.js`.
2. Que `index.html` **no** vuelva a llevar `<style>` ni `<script>` incrustados (rompería la CSP).
3. Que los archivos referenciados existan y que `sw.js` los precachee.
4. Que `vercel.json`, `manifest.webmanifest` y el JSON-LD sean JSON válidos.
5. Que la CSP mencione **todos** los orígenes que la app usa de verdad, y que no contenga `unsafe-eval`.
6. El E2E completo contra Supabase.

**Necesita un secreto:** `Settings → Secrets and variables → Actions → SUPABASE_PUBLISHABLE_KEY`. Sin él el workflow **falla y lo dice**, en vez de saltarse las comprobaciones. La clave pública (`anon`) también está incrustada en `app.js`; el workflow la lee del secreto para poder rotarla sin tocar el código.

### 16.3 Verificación manual en navegador (realizada)

Sobre un servidor local (`npx serve -l 8788`) **y contra producción**, en Chromium:

| Comprobación | Resultado |
|---|---|
| Carga inicial, 5 vistas, 8 modales | Sin errores de consola |
| Sección 8 de la E2E hecha a mano desde la UI: "Me importa" | 2 → 3, botón en estado `votado`, +5 puntos |
| Comentario escrito desde la UI | 4 → 5 comentarios, persistido en `public.comentarios` con la huella del dispositivo como emisor |
| Comentarios cargados desde la tabla nueva | Se ve el recuento correcto en cada publicación |
| Contraste WCAG AA de los elementos nuevos (`.motivo-*`, `.bienvenida-valor`, `.footer-link`) en claro **y** en oscuro | Mínimo **5.15:1** (el mínimo exigido es 4.5:1) |
| Service worker tras extraer CSS y JS | Registrado, precarga `estilos.css` y `app.js` (caché `bym-v7`) |
| JSON-LD | Válido al parsearlo |
| **Sincronización sin bucle** (semillado en `localStorage` un reporte con `usuario_id` ajeno **sin** `_pendiente` y otro **con** ella) | En la red: **un solo** `POST /reportes` (201), ninguno a `publicaciones`, **ningún 401/403**. El que lleva `_pendiente` sube; el otro se queda como copia local |
| **Guardia de moderación** sin cuenta admin (botón forzado a visible y pulsado) | Toast "Esta sección es solo para cuentas administradoras del proyecto" y **no** cambia de vista |
| **Producción**: mismo origen, caché, enlaces y consola | Todo correcto (ver 13.1) |

### 16.4 Qué **no** hay

- **Sin pruebas unitarias.** No hay framework ni `npm test`.
- **Sin linter** ni formateador.
- **Sin tipos.** Todo JavaScript plano sin TypeScript.
- **El panel de moderación no se ha probado en un navegador real** con la cuenta administradora: no se dispone de su contraseña. Lo que sí se comprobó es la capa de la base de datos, simulando su JWT (`request.jwt.claims`) desde SQL.

---
## 17. Límites conocidos, pendientes y lo no verificado

Escrito sin adornos, porque un proyecto honesto vale más que uno que parezca perfecto.

### 17.1 Funcional

- **GPS de camiones no conectado.** `getVehiclePosition()` devuelve `null`. El modo demo lo simula y lo etiqueta, pero no hay datos municipales.
- **Los puntos de recolección son calculados, no oficiales.** Cada 400 m sobre la geometría real.
- **Las delimitaciones de colonia son aproximadas.** Rectángulos definidos a mano, no límites oficiales.
- **Los tiempos son estimaciones** de la ruta, no horarios del servicio de recolección.
- **No hay conexión con ningún sistema del municipio.** Los reportes los ve el equipo del proyecto; que lleguen al área de Servicios Públicos depende de que alguien los entregue a mano o por correo.
- **El estado de un reporte lo cambia una persona, no el municipio.** Que exista `en_revision` y `atendido` no significa que el municipio lo use todavía.

### 17.2 Privacidad

- **La huella del navegador se guarda** en `reportes.huella`, `publicaciones.huella` y `comentarios.huella`. No es un dato personal (no permite reconocer a nadie y se borra borrando el almacenamiento local), pero sí es un identificador. Se usa solo para poner topes por dispositivo.
- **La ubicación se difumina, no se borra.** Un reporte guarda la coordenada redondeada a ~100 m. Suficiente para saber en qué colonia está, no en qué casa. La persona que reporta podría no ver el punto exacto que eligió.
- **Las fotos son públicas** en el bucket `reportes-fotos`. Quien tenga la URL puede verlas y no hay forma de borrarlas desde la app.
- **El `IP` se usa para limitar**, no se guarda como columna, pero sí queda en los registros del servidor de Supabase mientras dura la petición.

### 17.3 Técnico

- **Falta SMTP** → la recuperación de contraseña **no llega a correos externos**. Es lo único que impide que la función de cuentas esté completa. (Ver la receta en la sección 13.)
- **Las fotos de un reporte borrado quedan huérfanas** en Storage: el borrado quita la fila, no el archivo.
- **3 fotos huérfanas** (~11 KB) de las pruebas antiguas; no se pueden borrar por SQL (protección `storage.protect_delete()`), hay que hacerlo desde el panel de Supabase.
- **El service worker no cachea la API.** Offline se ven datos guardados, pero no se sincroniza nada nuevo hasta que vuelva la red.
- **`reportes` no tiene política de `UPDATE`.** El texto de un reporte tampoco se puede corregir a mano desde la app: se considera un registro, no un borrador. La moderación lo cambia por función.
- **Los reportes de invitados (`usuario_id is null`) no se pueden borrar** desde la app: sin cuenta no hay forma de demostrar la autoría. Es una limitación consciente.
- **El progreso se combina con `greatest()`:** si alguien manipuló los puntos en un dispositivo y luego entra con su cuenta, se conserva el valor mayor. Nunca se retrocede, pero tampoco se puede "arreglar" un valor inflado desde la app.
- **La app sigue siendo un monolito** de ~145 KB de JavaScript en un solo archivo. Comfortable para un proyecto escolar; a escala real habría que dividirlo en módulos.

### 17.4 Seguridad — lo que hay que hacer a mano

- **Token de Vercel expuesto en el chat → revócalo** en <https://vercel.com/account/tokens>. *(Recordado en la petición P1.6; sigue pendiente de confirmar que lo hiciste.)*
- **Permisos de la app de Vercel en GitHub** → configúralos para recuperar el auto-despliegue (GitHub → Settings → Apps instaladas → Vercel → Configure). Mientras tanto los despliegues se hacen a mano por la API.
- **Verificar que `MAPBOX_TOKEN` sigue restringido por URL** en el panel de Mapbox. Es una clave pública (`pk.…`), no un secreto, pero conviene que solo sirva a este dominio.
- **El workflow de GitHub Actions necesita el secreto `SUPABASE_PUBLISHABLE_KEY`**; hasta ponerlo, no se ejecuta nada automáticamente.

### 17.5 Decisiones deliberadas (no son fallos)

| Decisión | Por qué |
|---|---|
| La ubicación se difumina al **guardar**, no al mostrar | Lo que no se guarda no se puede filtrar. Una vista con `select` por columna exigiría que la app usara siempre una función. |
| Los "me importa" no se pueden repetir desde el mismo dispositivo | Un contador que se puede inflar no informa de nada. |
| Los comentarios tienen tope por publicación (60) y por persona (3) | Evita que una sola persona llene el hilo. |
| Ocultar ≠ borrar | Nada se pierde y se puede justificar una medida con su motivo. |
| Sin CAPTCHA | Sin site key de Cloudflare no hay nada que probar, y una casilla a medio integrar aparenta una protección que no da. Los topes en SQL no dependen del cliente. |
| Sentry desactivado | Sin DSN no se carga ni un byte de un tercero. Es ayuda al desarrollo, no una dependencia. |
| El correo de destino del municipio está vacío | No se inventa ningún dato oficial. Mientras tanto funcionan el CSV y el resumen copiable. |

### 17.6 Pendiente de configurar (todo lo que necesita una cuenta del equipo)

| Qué | Dónde | Sin esto |
|---|---|---|
| SMTP con Resend | Supabase → Authentication → Providers → Email — **receta completa en 13.5** | "Olvidé mi contraseña" no entrega correo a nadie fuera del equipo |
| Correo de destino | `DESTINO.correo` en `app.js` | No hay envío automático al municipio |
| Desplegar `resumen-reportes` | `supabase functions deploy resumen-reportes` | Solo existen el CSV y el resumen manual |
| DSN de Sentry | `OBSERVABILIDAD.dsn` en `app.js` | Los errores en producción no se ven |
| Site key de Turnstile | (no implementado) | Los topes por IP son la única defensa |
| Secret del workflow | GitHub → Settings → Secrets → Actions | No hay verificación automática |
| **Borrar 22 fotos de prueba** del bucket | Supabase → Storage → `reportes-fotos` | Basura en el bucket, sin efecto en la app |

### 17.7 Las fotos de prueba que sobran en Storage

Cada corrida de `tests/e2e-supabase.js` sube una imagen al bucket `reportes-fotos` con
nombre `reportes/e2e-…`. **La limpieza automática de la cabecera del archivo no puede
borrarlas**: Postgres rechaza el borrado de `storage.objects` a propósito, para que nadie
pierda archivos por accidente:

```
ERROR: 42501: Direct deletion from storage tables is not allowed. Use the Storage API instead.
CONTEXT: PL/pgSQL function storage.protect_delete()
```

Por eso el E2E avisa de que hay filas que limpiar a mano. Estado real de la base de datos
(medido el 3 de octubre de 2026): **22 fotos huérfanas de prueba y 1 real** (la del
reporte de ponchito, que sí se conserva).

Para borrarlas, sin `service_role` y sin scripts:

1. Supabase → **Storage** → bucket `reportes-fotos`.
2. Ordenar por nombre; se ven todas agrupadas con el prefijo `e2e-`.
3. Seleccionar las `e2e-…`, borrar. **No borrar la que no empieza por `e2e-`.**

Sialguna vez hay demasiadas, la vía rápida es la Storage API desde Node con el
`service_role` (que **nunca** se escribe en un archivo ni se imprime):

```bash
# NO forma parte del proyecto: es una operación manual del dueño
curl -X DELETE "$SUPABASE_URL/storage/v1/object/reportes-fotos/reportes/e2e-....jpg" \
  -H "apikey: $SERVICE_ROLE" -H "Authorization: Bearer $SERVICE_ROLE"
```

> Lo mismo aplica a las fotos huérfanas que deja una cuenta borrada: la fila de
> `reportes` y el archivo van por separado, y borrar la fila no arrastra el archivo.

### 17.8 Sugerencias de mejora

- **Notificaciones push reales** (Supabase no las da; habría que pasar a Firebase o a un service worker push propio).
- **RSS/Atom** de los reportes para que el ayuntamiento los pueda consumir sin usar la web.
- **Separar `app.js` en módulos ES** cuando el monolito empiece a doler.
- **Pruebas unitarias** de `nivelDe()` e `INSIGNIAS`: son las funciones con más lógica de negocio y ninguna comprobación automática.

---
## 18. Glosario rápido

| Término | Significado aquí |
|---|---|
| **RLS** (*Row Level Security*) | Seguridad de PostgreSQL: cada fila tiene reglas de quién puede leerla, escribirla o modificarla, evaluadas en el servidor. |
| **PostgREST** | La API automática que Supabase expone sobre las tablas: `GET /rest/v1/tabla?select=*`. |
| **Trigger** | Código SQL que se ejecuta automáticamente en un `INSERT`/`UPDATE`. Aquí protege el contenido ajeno. |
| **`CHECK`** | Restricción que garantiza una condición en la base de datos (ej. `length(texto) <= 1000`). |
| **Bucket** | Carpeta de archivos en Supabase Storage, con sus propias políticas. |
| **`anon`** | El rol de la clave anónima de Supabase: puede leer lo público y crear filas, según RLS. |
| **`service_role`** | La clave **maestra** de Supabase: salta todas las políticas. **Nunca debe estar en el código.** |
| **JWT** | El token de sesión (codifica `{ sub: id_de_usuario, role: anon }`). Dura ~1 hora; se renueva con el `refresh_token`. |
| **UPSERT** | Insertar o actualizar según exista la clave primaria. En PostgREST: `Prefer: resolution=merge-duplicates`. |
| **Leaflet** | Librería de mapas en JavaScript que usa teselas de un proveedor. |
| **Overpass API** | Servicio para consultar datos de OpenStreetMap con consultas tipo SQL (Overpass QL). |
| **OSRM** | Motor de rutas *open source* que devuelve la geometría por calles reales. |
| **Nominatim** | Geocodificador de OpenStreetMap: texto → coordenadas. |
| **`haversine`** | Fórmula para distancia entre dos puntos de la esfera terrestre, en metros. |
| **Douglas-Peucker** (`simplificar`) | Algoritmo que reduce los puntos de una polilínea quitando los redundantes. |
| **Bounding box** | Rectángulo `minLat,minLng,maxLat,maxLng` usado para acotar consultas de Overpass. |
| **`divIcon`** | Marcador de Leaflet hecho de HTML y CSS en vez de una imagen. |
| **PWA** | *Progressive Web App*: web instalable, con ícono y funcionamiento offline. |
| **`prefers-reduced-motion`** | Consulta al sistema: ¿el usuario pidió menos animación? |
| **`prefers-color-scheme`** | Consulta al sistema: ¿el usuario usa tema oscuro? |
| **`env(safe-area-inset-*)`** | Espacio reservado en móviles con muesca o barra de gestos. |
| **`aria-live="polite"`** | Hace que los lectores de pantalla anuncien los cambios de una región. |
| **`AbortController`** | Permite cancelar un `fetch` cuando se pasa de tiempo. |
| **`viewport-fit=cover`** | Permite que el contenido llegue hasta los bordes con `safe-area-inset`. |

---

## Créditos

Proyecto escolar con fines educativos. **FILOSOFARTE · Filosofía II · CBTis 226 · Daniel Alvarez.**

- Datos cartográficos © colaboradores de [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL).
- Teselas y rutas por calles © [Mapbox](https://www.mapbox.com/about/maps/).
- Motor de Leaflet © [Leaflet](https://leafletjs.com/) (BSD-2-Clause).
- Rutas abiertas: [OSRM](http://project-osrm.org/) · Geocodificación: [Nominatim](https://nominatim.openstreetmap.org).
- Base de datos y cuentas: [Supabase](https://supabase.com).
- Hosting: [Vercel](https://vercel.com).

> *"El progreso sin conciencia no es progresión."*
