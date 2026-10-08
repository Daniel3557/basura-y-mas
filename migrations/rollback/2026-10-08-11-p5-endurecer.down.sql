-- ============================================================
-- BASURA Y MÁS · Rollback de P5.19 · Refuerzo de seguridad
-- --------------------------------------------------------------
-- Al revertir, el trigger vuelve a restaurar solo los campos de
-- contenido y vuelve a dejar sueltas foto, huella y estado_sync
-- (es el agujero de la auditoría: no recomendado, pero documentado).
-- ============================================================

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
  new.oculto      := old.oculto;
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

alter function public.limpiar_texto(text, int) reset search_path;
alter function public.difuminar_ubicacion()    reset search_path;
alter function public.reportes_solo_estado_legales() reset search_path;
