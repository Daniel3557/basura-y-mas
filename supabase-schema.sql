-- ============================================================
-- BASURA Y MÁS · Esquema de base de datos (Supabase / PostgreSQL)
-- Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
--
-- Dos tablas de contenido (reportes ciudadanos y publicaciones de comunidad),
-- la tabla perfiles para cuentas de usuario y la columna usuario_id que
-- vincula cada reporte/publicación con la cuenta que lo creó.
-- RLS activado: cualquiera (anon) puede leer y crear; con cuenta
-- (authenticated) además se vincula la autoría vía usuario_id.
-- ============================================================

-- ---------- CUENTAS: PERFILES PÚBLICOS ----------
create table if not exists public.perfiles (
  id        uuid primary key references auth.users(id) on delete cascade,
  nombre    text not null default 'Vecino',
  creado_en timestamptz not null default now()
);

alter table public.perfiles enable row level security;

drop policy if exists "perfiles_lectura_publica" on public.perfiles;
create policy "perfiles_lectura_publica" on public.perfiles
  for select using (true);

drop policy if exists "perfiles_creacion_propia" on public.perfiles;
create policy "perfiles_creacion_propia" on public.perfiles
  for insert to authenticated with check (auth.uid() = id);

drop policy if exists "perfiles_actualizacion_propia" on public.perfiles;
create policy "perfiles_actualizacion_propia" on public.perfiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Perfil automático al crear la cuenta (usa el inicio del correo
-- como nombre provisional; la app lo actualiza enseguida)
create or replace function public.crear_perfil_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfiles (id, nombre)
  values (
    new.id,
    coalesce(nullif(trim(split_part(new.email, '@', 1)), ''), 'Vecino')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_crea_perfil on auth.users;
create trigger on_auth_user_crea_perfil
  after insert on auth.users
  for each row execute function public.crear_perfil_usuario();

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
  ts        bigint not null,           -- epoch millis (coherente con la app)
  usuario_id uuid references auth.users(id) on delete set null  -- cuenta que lo creó (null = invitado)
);

alter table public.reportes enable row level security;

drop policy if exists "reportes_lectura_publica" on public.reportes;
create policy "reportes_lectura_publica" on public.reportes
  for select to anon using (true);

drop policy if exists "reportes_creacion_publica" on public.reportes;
create policy "reportes_creacion_publica" on public.reportes
  for insert to anon with check (true);

drop policy if exists "reportes_lectura_usuarios" on public.reportes;
create policy "reportes_lectura_usuarios" on public.reportes
  for select to authenticated using (true);

drop policy if exists "reportes_creacion_usuarios" on public.reportes;
create policy "reportes_creacion_usuarios" on public.reportes
  for insert to authenticated with check (true);

-- ---------- PUBLICACIONES DE COMUNIDAD ----------
create table if not exists public.publicaciones (
  id          text primary key,
  nombre      text not null default 'Anónimo',
  colonia     text not null,
  tipo        text not null,
  texto       text not null,
  likes       int  not null default 0,
  comentarios jsonb not null default '[]'::jsonb,
  ts          bigint not null,
  usuario_id  uuid references auth.users(id) on delete set null  -- cuenta que lo creó (null = invitado)
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

drop policy if exists "publicaciones_lectura_usuarios" on public.publicaciones;
create policy "publicaciones_lectura_usuarios" on public.publicaciones
  for select to authenticated using (true);

drop policy if exists "publicaciones_creacion_usuarios" on public.publicaciones;
create policy "publicaciones_creacion_usuarios" on public.publicaciones
  for insert to authenticated with check (true);

drop policy if exists "publicaciones_actualizacion_usuarios" on public.publicaciones;
create policy "publicaciones_actualizacion_usuarios" on public.publicaciones
  for update to authenticated using (true) with check (true);

-- Índices para listados por fecha
create index if not exists idx_reportes_ts on public.reportes (ts desc);
create index if not exists idx_publicaciones_ts on public.publicaciones (ts desc);
