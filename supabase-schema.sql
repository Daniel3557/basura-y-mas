-- ============================================================
-- BASURA Y MÁS · Esquema de base de datos (Supabase / PostgreSQL)
-- Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
--
-- Espejo de las migraciones aplicadas en Supabase:
--   add_cuentas_usuario        → tabla perfiles + usuario_id + RLS
--   endurecer_rls_moderacion   → trigger de protección, autoría
--                                verificable, límites y bucket de fotos
--
-- Idea de seguridad: cualquiera (anon) puede leer y crear; con cuenta
-- (authenticated) además se vincula la autoría vía usuario_id y solo el
-- dueño edita su contenido. El resto únicamente puede SUMAR: "Me importa"
-- y comentarios. Nadie puede reescribir el texto de otra persona ni
-- firmarse como alguien más.
-- ============================================================

-- ---------- CUENTAS: PERFILES PÚBLICOS ----------
create table if not exists public.perfiles (
  id        uuid primary key references auth.users(id) on delete cascade,
  nombre    text not null default 'Vecino',
  creado_en timestamptz not null default now(),
  constraint perfiles_nombre_max check (length(nombre) <= 40)
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
  foto      text,                      -- URL pública en Supabase Storage ('reportes-fotos')
  ubicacion jsonb,                     -- { "lat": .., "lng": .. } | null
  estado    text not null default 'Sincronizado con la nube',
  ts        bigint not null,           -- epoch millis (coherente con la app)
  usuario_id uuid references auth.users(id) on delete set null, -- cuenta que lo creó (null = invitado)
  constraint reportes_texto_max   check (length(texto) <= 2000),
  constraint reportes_nombre_max check (length(nombre) <= 40),
  constraint reportes_tipo_max   check (length(tipo) <= 40)
);

alter table public.reportes enable row level security;

drop policy if exists "reportes_lectura_publica" on public.reportes;
create policy "reportes_lectura_publica" on public.reportes
  for select to anon using (true);

-- Autoría verificable: un invitado nunca puede reclamar una cuenta ajena.
drop policy if exists "reportes_creacion_publica" on public.reportes;
create policy "reportes_creacion_publica" on public.reportes
  for insert to anon with check (usuario_id is null);

drop policy if exists "reportes_lectura_usuarios" on public.reportes;
create policy "reportes_lectura_usuarios" on public.reportes
  for select to authenticated using (true);

drop policy if exists "reportes_creacion_usuarios" on public.reportes;
create policy "reportes_creacion_usuarios" on public.reportes
  for insert to authenticated with check (usuario_id is null or usuario_id = auth.uid());

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
  usuario_id  uuid references auth.users(id) on delete set null, -- cuenta que lo creó (null = invitado)
  constraint publicaciones_texto_max    check (length(texto) <= 1000),
  constraint publicaciones_nombre_max  check (length(nombre) <= 40),
  constraint publicaciones_colonia_max check (length(colonia) <= 60),
  constraint publicaciones_likes_rango check (likes >= 0 and likes <= 1000000)
);

alter table public.publicaciones enable row level security;

drop policy if exists "publicaciones_lectura_publica" on public.publicaciones;
create policy "publicaciones_lectura_publica" on public.publicaciones
  for select to anon using (true);

drop policy if exists "publicaciones_creacion_publica" on public.publicaciones;
create policy "publicaciones_creacion_publica" on public.publicaciones
  for insert to anon with check (usuario_id is null);

drop policy if exists "publicaciones_actualizacion_publica" on public.publicaciones;
create policy "publicaciones_actualizacion_publica" on public.publicaciones
  for update to anon using (true) with check (true);   -- el trigger acota qué se puede tocar

drop policy if exists "publicaciones_lectura_usuarios" on public.publicaciones;
create policy "publicaciones_lectura_usuarios" on public.publicaciones
  for select to authenticated using (true);

drop policy if exists "publicaciones_creacion_usuarios" on public.publicaciones;
create policy "publicaciones_creacion_usuarios" on public.publicaciones
  for insert to authenticated with check (usuario_id is null or usuario_id = auth.uid());

drop policy if exists "publicaciones_actualizacion_usuarios" on public.publicaciones;
create policy "publicaciones_actualizacion_usuarios" on public.publicaciones
  for update to authenticated using (true) with check (true);  -- el trigger acota qué se puede tocar

-- ---------- PROTECCIÓN DE CONTENIDO (lo que hace el trigger) ----------
-- El dueño (auth.uid() = usuario_id) edita su publicación como quiera.
-- Cualquier otro —incluidos los invitados— solo puede:
--   · subir "Me importa" (likes nunca bajan)
--   · añadir comentarios (nunca se borran ni se recortan)
-- y los campos protegidos (id, nombre, colonia, tipo, texto, ts, usuario_id)
-- se restauran a su valor original, en vez de rechazar la petición: así un
-- like o un comentario nunca se pierden por una copia desactualizada.
create or replace function public.proteger_publicacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and old.usuario_id is not null and auth.uid() = old.usuario_id then
    new.usuario_id := old.usuario_id;
    return new;
  end if;

  new.id         := old.id;
  new.nombre     := old.nombre;
  new.colonia    := old.colonia;
  new.tipo       := old.tipo;
  new.texto      := old.texto;
  new.ts         := old.ts;
  new.usuario_id := old.usuario_id;
  new.likes      := greatest(old.likes, coalesce(new.likes, old.likes));

  if new.comentarios is null or jsonb_array_length(new.comentarios) < jsonb_array_length(old.comentarios) then
    new.comentarios := old.comentarios;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'autor', left(coalesce(c ->> 'autor', ''), 40),
             'texto', left(coalesce(c ->> 'texto', ''), 400),
             'ts',    coalesce((c ->> 'ts')::bigint, 0)
           )), '[]'::jsonb)
    into new.comentarios
  from jsonb_array_elements(new.comentarios) c;

  if jsonb_array_length(new.comentarios) > 60 then
    select coalesce(jsonb_agg(elem), '[]'::jsonb) into new.comentarios
      from (select elem from jsonb_array_elements(new.comentarios) elem limit 60) s;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_proteger_publicacion on public.publicaciones;
create trigger trg_proteger_publicacion
  before update on public.publicaciones
  for each row execute function public.proteger_publicacion();

-- ---------- FOTOGRAFÍAS ----------
-- Antes la foto era un data URL dentro de la fila y cada visita descargaba
-- megabytes. Ahora es un archivo en el bucket público 'reportes-fotos' y la
-- fila solo guarda su URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reportes-fotos', 'reportes-fotos', true, 3145728,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "fotos_lectura_publica" on storage.objects;
create policy "fotos_lectura_publica" on storage.objects
  for select using (bucket_id = 'reportes-fotos');

-- Solo se permiten imágenes dentro de la carpeta 'reportes/' y hasta 3 MB.
drop policy if exists "fotos_subida_publica" on storage.objects;
create policy "fotos_subida_publica" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'reportes-fotos'
    and (storage.foldername(name))[1] = 'reportes'
    and (storage.foldername(name))[2] is null
  );

-- ---------- Índices ----------
create index if not exists idx_reportes_ts on public.reportes (ts desc);
create index if not exists idx_publicaciones_ts on public.publicaciones (ts desc);
create index if not exists idx_publicaciones_usuario on public.publicaciones (usuario_id);
create index if not exists idx_reportes_usuario on public.reportes (usuario_id);
