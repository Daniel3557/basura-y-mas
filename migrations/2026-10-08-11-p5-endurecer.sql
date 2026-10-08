-- ============================================================
-- BASURA Y MÁS · P5.19 · Refuerzo de seguridad (auditoría)
-- Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
-- ------------------------------------------------------------
-- PROBLEMA (hallazgos de la auditoría de 2026-10-08 con
-- pg_policies y el asesor de seguridad de Supabase)
--
--   1. Las políticas de UPDATE de publicaciones están abiertas
--      (using(true) para anon y authenticated). Eso es a propósito:
--      la app usa PATCH para marcar el estado de sincronización. El
--      trigger proteger_publicacion() congela los campos de contenido,
--      PERO dejaba sin congelar tres columnas: foto, huella y
--      estado_sync. Un anónimo (o un usuario con sesión que no es el
--      dueño) podía reescribirlas de cualquier fila que supiera
--      localizar (p. ej. cambiar la huella para esquivar los topes
--      de frecuencia, o apuntar la foto de otro reporte a otro
--      archivo).
--
--   2. Tres funciones sin `set search_path` (linter
--      function_search_path_mutable): limpiar_texto,
--      difuminar_ubicacion y reportes_solo_estado_legales.
--
-- SOLUCIÓN
--   · El trigger congela la fila COMPLETA para quien no es el dueño:
--     devuelve old tal cual. Para el dueño sigue valiendo la edición
--     de sus campos de contenido.
--   · search_path fijado en las tres funciones.
--
-- CONSECUENCIA VISIBLE
--   Ninguna: la app nunca edita foto/huella/estado_sync por PATCH,
--   y los dueños pueden seguir corrigiendo sus publicaciones.
--
-- ROLLBACK: migrations/rollback/2026-10-08-11-p5-endurecer.down.sql
-- ============================================================

-- ---------- 1. Trigger: la fila entera se congela para no dueños ----------
create or replace function public.proteger_publicacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Campos que nadie cambia nunca por UPDATE directo.
  new.id          := old.id;
  new.ts          := old.ts;
  new.usuario_id  := old.usuario_id;
  new.comentarios := old.comentarios;
  new.likes       := case
                       when current_setting('bym.marca_interna', true) = 'like'
                            and new.likes = old.likes + 1 then new.likes
                       else old.likes
                     end;
  new.oculto      := old.oculto;
  new.oculto_motivo := old.oculto_motivo;

  -- El dueño puede corregir su publicación.
  if auth.uid() is not null and old.usuario_id is not null and auth.uid() = old.usuario_id then
    return new;
  end if;

  -- Quien no es dueño: la fila entera vuelve a como estaba. Antes
  -- quedaban sueltas foto, huella y estado_sync (auditoría P5.19).
  return old;
end;
$$;

-- ---------- 2. search_path de las tres funciones ----------
alter function public.limpiar_texto(text, int) set search_path = public;
alter function public.difuminar_ubicacion()    set search_path = public;
alter function public.reportes_solo_estado_legales() set search_path = public;
