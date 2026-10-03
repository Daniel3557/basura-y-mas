-- ============================================================
-- BASURA Y MÁS · P2.8 · Moderación: ocultar y mostrar
-- Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
-- ------------------------------------------------------------
-- PROBLEMA
--   No había ninguna forma de apartar un reporte con datos
--   offending o una publicación con insultos: la única opción era
--   borrarla de la base de datos a mano desde el SQL Editor.
--
-- SOLUCIÓN
--   · Columna `oculto` en reportes y publicaciones (ocultar ≠ borrar:
--     nada se pierde y se puede volver a mostrar).
--   · RLS: lo oculto no lo ve nadie salvo su autor y las cuentas
--     administradoras.
--   · Las funciones ocultar()/mostrar() solo funcionan para admin.
--   · El trigger de contenido no puede saltarse `oculto` con un
--     UPDATE normal: hace falta pasar por la función.
--
-- DECISIÓN
--   `oculto` no es lo mismo que "borrado". Se eligió así porque el
--   proyecto es escolar y puede haber que justificar una medida: se
--   guarda el motivo y se puede revertir.
--
-- ROLLBACK: migrations/rollback/2026-10-03-07-p2-moderacion.down.sql
-- ============================================================

-- ---------- Columnas de moderación ----------
alter table public.reportes      add column if not exists oculto boolean not null default false;
alter table public.reportes      add column if not exists oculto_motivo text;
alter table public.publicaciones add column if not exists oculto boolean not null default false;
alter table public.publicaciones add column if not exists oculto_motivo text;

comment on column public.reportes.oculto is 'Apartado de la vista pública por moderación. No se borra: se puede volver a mostrar.';

-- ---------- RLS: lo oculto sale de la vista pública ----------
drop policy if exists "reportes_lectura_publica" on public.reportes;
create policy "reportes_lectura_publica" on public.reportes
  for select to anon
  using (
    not oculto
    or (auth.uid() is not null and usuario_id = auth.uid())
    or public.es_admin(auth.uid())
  );

drop policy if exists "reportes_lectura_usuarios" on public.reportes;
create policy "reportes_lectura_usuarios" on public.reportes
  for select to authenticated
  using (
    not oculto
    or (auth.uid() is not null and usuario_id = auth.uid())
    or public.es_admin(auth.uid())
  );

drop policy if exists "publicaciones_lectura_publica" on public.publicaciones;
create policy "publicaciones_lectura_publica" on public.publicaciones
  for select to anon
  using (
    not oculto
    or (auth.uid() is not null and usuario_id = auth.uid())
    or public.es_admin(auth.uid())
  );

drop policy if exists "publicaciones_lectura_usuarios" on public.publicaciones;
create policy "publicaciones_lectura_usuarios" on public.publicaciones
  for select to authenticated
  using (
    not oculto
    or (auth.uid() is not null and usuario_id = auth.uid())
    or public.es_admin(auth.uid())
  );

-- ---------- El trigger de contenido no toca `oculto` ----------
create or replace function public.proteger_publicacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marca text := current_setting('bym.marca_interna', true);
begin
  -- Nadie cambia esto con un UPDATE normal.
  new.id          := old.id;
  new.ts          := old.ts;
  new.usuario_id  := old.usuario_id;
  new.comentarios := old.comentarios;
  new.likes       := case
                       when v_marca = 'like' and new.likes = old.likes + 1 then new.likes
                       else old.likes
                     end;
  new.oculto       := old.oculto;
  new.oculto_motivo := old.oculto_motivo;

  if auth.uid() is not null and old.usuario_id is not null and auth.uid() = old.usuario_id then
    return new;
  end if;

  new.nombre  := old.nombre;
  new.colonia := old.colonia;
  new.tipo    := old.tipo;
  new.texto   := old.texto;

  return new;
end;
$$;

-- ---------- Función única de moderación ----------
-- Sirve para reportes y publicaciones: comprueba la tabla por el
-- prefijo del id que le llega.
create or replace function public.moderar(
  p_tabla  text,
  p_id     text,
  p_oculto boolean,
  p_motivo text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_admin(auth.uid()) then
    raise exception 'Solo una cuenta administradora puede moderar.';
  end if;

  if p_tabla = 'reportes' then
    if not exists (select 1 from public.reportes where id = p_id) then
      raise exception 'Ese reporte ya no existe.';
    end if;
    perform set_config('bym.marca_interna', 'moderacion', true);
    update public.reportes set oculto = p_oculto, oculto_motivo = public.limpiar_texto(p_motivo, 200) where id = p_id;
  elsif p_tabla = 'publicaciones' then
    if not exists (select 1 from public.publicaciones where id = p_id) then
      raise exception 'Esa publicación ya no existe.';
    end if;
    perform set_config('bym.marca_interna', 'moderacion', true);
    update public.publicaciones set oculto = p_oculto, oculto_motivo = public.limpiar_texto(p_motivo, 200) where id = p_id;
  else
    raise exception 'Tabla no permitida.';
  end if;

  return true;
end;
$$;

revoke execute on function public.moderar(text, text, boolean, text) from public;
grant  execute on function public.moderar(text, text, boolean, text) to authenticated;

-- ---------- Listado de moderación ----------
-- Devuelve lo oculto (y lo recién creado) para el panel, incluyendo
-- lo que RLS esconde del resto.
create or replace function public.pendientes_moderacion()
returns table (
  tabla        text,
  id           text,
  nombre       text,
  colonia      text,
  tipo         text,
  texto        text,
  estado       text,
  oculto       boolean,
  oculto_motivo text,
  usuario_id   uuid,
  ubicacion    text,
  likes        int,
  n_comentarios bigint,
  ts           bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.es_admin(auth.uid()) then
    raise exception 'Solo una cuenta administradora puede ver este listado.';
  end if;

  return query
  select 'reportes', r.id, r.nombre, r.colonia, r.tipo, r.texto, r.estado::text, r.oculto, r.oculto_motivo,
         r.usuario_id,
         case when r.ubicacion is null then ''
              else r.ubicacion ->> 'lat' || ', ' || r.ubicacion ->> 'lng' || ' (±100 m)' end,
         null::int, null::bigint, r.ts
    from public.reportes r
  union all
  select 'publicaciones', p.id, p.nombre, p.colonia, p.tipo, p.texto, null::text, p.oculto, p.oculto_motivo,
         p.usuario_id, ''::text, p.likes,
         (select count(*) from public.comentarios c where c.publicacion_id = p.id), p.ts
    from public.publicaciones p
   order by ts desc
  limit 200;
end;
$$;

revoke execute on function public.pendientes_moderacion() from public;
grant  execute on function public.pendientes_moderacion() to authenticated;