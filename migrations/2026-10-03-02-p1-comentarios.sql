-- ============================================================
-- BASURA Y MÁS · P1.2 · Comentarios que no se pueden tapar
-- Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
-- ------------------------------------------------------------
-- PROBLEMA
--   Los comentarios vivían dentro de publicaciones.comentarios (jsonb) y
--   cualquiera podía reescribir ese campo con un PATCH. El trigger los
--   acotaba a 60 por publicación, pero:
--     · un usuario podía escribir 60 comentarios de golpe y vaciar el
--       jsonb completo de la fila,
--     · un moderador no tenía forma de ocultar uno concreto,
--     · el texto no tenía índices ni consultas propias.
--
-- SOLUCIÓN
--   · Tabla public.comentarios con RLS: lectura pública, escritura solo
--     a través de la función crear_comentario().
--   · Límites dentro de la función: 60 por publicación, 3 por persona o
--     dispositivo en cada publicación.
--   · Con cuenta, el autor lo toma del perfil: nadie puede firmar como
--     otra persona. Sin cuenta, se usa el nombre que la persona escribió
--     (máx. 40 caracteres).
--   · Los comentarios que ya existían en el jsonb se migran tal cual y el
--     trigger deja de permitir cualquier cambio en esa columna.
--
-- ROLLBACK: migrations/rollback/2026-10-03-02-p1-comentarios.down.sql
-- ============================================================

create table if not exists public.comentarios (
  id             uuid primary key default gen_random_uuid(),
  publicacion_id text not null references public.publicaciones(id) on delete cascade,
  autor          text not null default 'Anónimo',
  texto          text not null,
  ts             bigint not null,
  usuario_id     uuid references auth.users(id) on delete set null,
  huella         text,
  emisor         text not null,
  constraint comentarios_texto_max check (length(texto) between 1 and 400),
  constraint comentarios_autor_max check (length(autor) <= 40)
);

alter table public.comentarios enable row level security;

drop policy if exists "comentarios_lectura_publica" on public.comentarios;
create policy "comentarios_lectura_publica" on public.comentarios
  for select using (true);
-- Sin política de INSERT/UPDATE/DELETE: solo las funciones security
-- definer escriben aquí. Un DELETE directo (salvo el dueño de la
-- publicación, vía cascade) no existe.

create index if not exists idx_comentarios_pub_ts on public.comentarios (publicacion_id, ts);
create index if not exists idx_comentarios_emisor_ts on public.comentarios (emisor, ts desc);

-- ---------- Migración de los comentarios que ya existían ----------
insert into public.comentarios (publicacion_id, autor, texto, ts, emisor)
select p.id,
       left(coalesce(nullif(trim(c ->> 'autor'), ''), 'Anónimo'), 40),
       left(trim(c ->> 'texto'), 400),
       case when (c ->> 'ts') ~ '^\d+$' then (c ->> 'ts')::bigint else 0 end,
       'migracion:' || p.id || ':' || x.ord
from public.publicaciones p,
     lateral jsonb_array_elements(coalesce(p.comentarios, '[]'::jsonb))
       with ordinality as x(c, ord)
where coalesce(trim(c ->> 'texto'), '') <> '';

-- ---------- Función única para comentar ----------
create or replace function public.crear_comentario(
  p_publicacion_id text,
  p_texto           text,
  p_autor           text default null,
  p_huella          text default null
)
returns public.comentarios
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_emisor text;
  v_texto  text;
  v_autor  text;
  v_fila   public.comentarios;
begin
  if not exists (select 1 from public.publicaciones where id = p_publicacion_id) then
    raise exception 'La publicación ya no existe.';
  end if;

  v_texto := public.limpiar_texto(p_texto, 400);
  if length(v_texto) < 2 then
    raise exception 'El comentario está vacío.';
  end if;

  v_emisor := public.emisor_actual(p_huella);

  -- Con cuenta el nombre sale del perfil (no del navegador).
  if v_uid is not null then
    v_autor := coalesce(
      nullif(public.limpiar_texto((select nombre from public.perfiles where id = v_uid), 40), ''),
      'Vecino'
    );
  else
    v_autor := coalesce(nullif(public.limpiar_texto(p_autor, 40), ''), 'Anónimo');
  end if;

  if (select count(*) from public.comentarios where publicacion_id = p_publicacion_id) >= 60 then
    raise exception 'Esta publicación ya tiene demasiados comentarios.';
  end if;

  if (select count(*) from public.comentarios
      where publicacion_id = p_publicacion_id and emisor = v_emisor) >= 3 then
    raise exception 'Ya escribiste varios comentarios aquí. Lee los demás antes de escribir otro.';
  end if;

  insert into public.comentarios (publicacion_id, autor, texto, ts, usuario_id, huella, emisor)
  values (
    p_publicacion_id,
    v_autor,
    v_texto,
    (extract(epoch from now()) * 1000)::bigint,
    v_uid,
    nullif(left(trim(coalesce(p_huella, '')), 64), ''),
    v_emisor
  )
  returning * into v_fila;

  return v_fila;
end;
$$;

revoke execute on function public.crear_comentario(text, text, text, text) from public;
grant  execute on function public.crear_comentario(text, text, text, text) to anon, authenticated;

-- ---------- Lectura agrupada para la app ----------
-- Una sola llamada trae los comentarios de hasta 100 publicaciones.
create or replace function public.comentarios_de(p_ids text[])
returns setof public.comentarios
language sql
stable
security definer
set search_path = public
as $$
  select c.* from public.comentarios c where c.publicacion_id = any(p_ids);
$$;

revoke execute on function public.comentarios_de(text[]) from public;
grant  execute on function public.comentarios_de(text[]) to anon, authenticated;