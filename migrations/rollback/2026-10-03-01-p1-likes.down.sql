-- ============================================================
-- ROLLBACK · 2026-10-03-01-p1-likes.sql
-- Devuelve el control de "me importa" al comportamiento anterior.
--
-- ADVERTENCIA DE REVERSIÓN
--   Al volver a permitir likes por UPDATE directo se reabre el problema
--   que corrige esta migración (cualquiera puede escribir likes=1000000).
--   SiVas a revertir, hazlo primero en la app: volver a usar
--   PATCH {likes:n} y después aplica este archivo.
-- ============================================================
drop function if exists public.dar_like(text, text);
drop table if exists public.likes_votos;

-- Trigger anterior (permite sumar likes con cualquier UPDATE, incluso el
-- dueño; los comentarios solo crecen y se sanean).
create or replace function public.proteger_publicacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n_comments integer;
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

  n_comments := jsonb_array_length(new.comentarios);
  if n_comments > 60 then
    select coalesce(jsonb_agg(elem), '[]'::jsonb) into new.comentarios
      from (select elem from jsonb_array_elements(new.comentarios) elem limit 60) s;
  end if;

  return new;
end;
$$;