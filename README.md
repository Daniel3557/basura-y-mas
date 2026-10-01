# 🌎 BASURA Y MÁS

**Comunidad limpia para Ciudad Guzmán, Jalisco.**
Proyecto de **Filosofía II (FILOSOFARTE)** · **Daniel Alvarez** · **CBTis 226** · 2026

> “El progreso sin conciencia no es progresión.”

App web cívica y ecológica que conecta a la ciudadanía con la información de recolección, la separación de residuos y la participación comunitaria.

## ✨ Qué incluye

- **Mapa real de Ciudad Guzmán** (Leaflet + OpenStreetMap) con rutas de recolección dibujadas sobre vialidades reales y calculadas con **OSRM**.
- **Puntos de recolección** cada 400 m sobre la geometría real de cada ruta, con distancia y tiempo a pie (etiquetados como generados por el sistema).
- **Reportes ciudadanos** con fotografía y ubicación, **sincronizados en la nube (Supabase)** con respaldo local si no hay conexión.
- **Comunidad**: publicaciones, votos “Me importa”, comentarios y compartir.
- **Gamificación honesta**: puntos, 10 niveles e insignias por acciones ecológicas reales del usuario.
- **Modo demostración etiquetado** del recorrido del camión (nunca se presenta como GPS real).
- **PWA instalable** (manifest + service worker), modo oscuro y diseño responsivo desde 320 px.

## 🧭 Honestidad de los datos

- Vialidades y mapa: **OpenStreetMap** (datos reales).
- Rutas y tiempos: **OSRM** (cálculo real sobre vialidades).
- Puntos de recolección: **generados por el sistema** cada 400 m (etiquetados).
- GPS de camiones: **no conectado**; el modo demo está etiquetado como simulación.
- Si la nube no está disponible, los datos se guardan en el dispositivo con la etiqueta **“(copia local)”**.

## 🛠️ Tecnologías

- HTML + CSS + JavaScript en un solo `index.html` (sin frameworks ni proceso de build).
- [Leaflet](https://leafletjs.com/) · [OpenStreetMap](https://www.openstreetmap.org) · [OSRM](http://project-osrm.org/) · [Nominatim](https://nominatim.openstreetmap.org)
- [Supabase](https://supabase.com) (PostgreSQL con seguridad RLS) para sincronizar reportes y publicaciones.
- Esquema de base de datos con políticas RLS: [`supabase-schema.sql`](supabase-schema.sql)

## 🚀 Uso

1. Abre `index.html` en el navegador o visita la versión desplegada (Vercel).
2. Elige tu colonia y consulta su ruta de recolección con puntos y tiempos.
3. Envía reportes con foto, participa en la comunidad y sube de nivel.

## 🎬 Demo

Video de demostración: [`video-demo-basura-y-mas.mp4`](video-demo-basura-y-mas.mp4)

## 📜 Créditos

Proyecto escolar con fines educativos. Datos de mapa © colaboradores de [OpenStreetMap](https://www.openstreetmap.org/copyright).
