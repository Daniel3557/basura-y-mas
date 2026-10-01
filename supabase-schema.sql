-- ============================================================
-- BASURA Y MÁS · Esquema de base de datos (Supabase / PostgreSQL)
-- Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
--
-- Dos tablas: reportes ciudadanos y publicaciones de comunidad.
-- RLS activado: cualquiera (anon) puede leer y crear; sin cuenta no
-- se puede editar ni borrar contenido ajeno desde la API REST.
-- ============================================================

-- ---------- REPORTES CIUDADANOS ----------
create table if not exists public.reportes (
  id        text primary key,
  nombre    text not null default 'Anónimo',
  colonia   text not null,
  tipo      text not null,
  texto     text not null,
  foto      text,                      -- data URL JPEG reducido (≤1280 px)
  ubicacion jsonb,                     -- { "lat": .., "lng": .. } | null
  estado    text not null default 'Sincronizado con la nube',
  ts        bigint not null            -- epoch millis (coherente con la app)
);

alter table public.reportes enable row level security;

drop policy if exists "reportes_lectura_publica" on public.reportes;
create policy "reportes_lectura_publica" on public.reportes
  for select to anon using (true);

drop policy if exists "reportes_creacion_publica" on public.reportes;
create policy "reportes_creacion_publica" on public.reportes
  for insert to anon with check (true);

-- ---------- PUBLICACIONES DE COMUNIDAD ----------
create table if not exists public.publicaciones (
  id          text primary key,
  nombre      text not null default 'Anónimo',
  colonia     text not null,
  tipo        text not null,
  texto       text not null,
  likes       int  not null default 0,
  comentarios jsonb not null default '[]'::jsonb,
  ts          bigint not null
);

alter table public.publicaciones enable row level security;

drop policy if exists "publicaciones_lectura_publica" on public.publicaciones;
create policy "publicaciones_lectura_publica" on public.publicaciones
  for select to anon using (true);

drop policy if exists "publicaciones_creacion_publica" on public.publicaciones;
create policy "publicaciones_creacion_publica" on public.publicaciones
  for insert to anon with check (true);

drop policy if exists "publicaciones_actualizacion_publica" on public.publicaciones;
create policy "publicaciones_actualizacion_publica" on public.publicaciones
  for update to anon using (true) with check (true);

-- Índices para listados por fecha
create index if not exists idx_reportes_ts on public.reportes (ts desc);
create index if not exists idx_publicaciones_ts on public.publicaciones (ts desc);
