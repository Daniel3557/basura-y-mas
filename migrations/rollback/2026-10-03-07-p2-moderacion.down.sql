-- ============================================================
-- ROLLBACK · 2026-10-03-07-p2-moderacion.sql
--
-- Lo oculto vuelve a estar visible. El contenido NO se borra, así que
-- este rollback es reversible de verdad.
-- ============================================================

drop function if exists public.pendientes_moderacion();
drop function if exists public.moderar(text, text, boolean, text);

drop policy if exists "reportes_lectura_publica" on public.reportes;
create policy "reportes_lectura_publica" on public.reportes for select to anon using (true);
drop policy if exists "reportes_lectura_usuarios" on public.reportes;
create policy "reportes_lectura_usuarios" on public.reportes for select to authenticated using (true);
drop policy if exists "publicaciones_lectura_publica" on public.publicaciones;
create policy "publicaciones_lectura_publica" on public.publicaciones for select to anon using (true);
drop policy if exists "publicaciones_lectura_usuarios" on public.publicaciones;
create policy "publicaciones_lectura_usuarios" on public.publicaciones for select to authenticated using (true);

-- El trigger vuelve a la versión de P1.1 (sin conocer `oculto`).
-- Aplica 2026-10-03-01-p1-likes.sql, o en su defecto la versión sin las
-- dos líneas de `oculto`, ANTES de borrar las columnas.
create or replace function public.proteger_publicacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marca text := current_setting('bym.marca_interna', true);
begin
  new.id          := old.id;
  new.ts          := old.ts;
  new.usuario_id  := old.usuario_id;
  new.comentarios := old.comentarios;
  new.likes       := case
                       when v_marca = 'like' and new.likes = old.likes + 1 then new.likes
                       else old.likes
                     end;

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

alter table public.reportes      drop column if exists oculto_motivo;
alter table public.reportes      drop column if exists oculto;
alter table public.publicaciones drop column if exists oculto_motivo;
alter table public.publicaciones drop column if exists oculto;