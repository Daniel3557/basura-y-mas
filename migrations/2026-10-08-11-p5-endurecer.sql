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
--      trigger proteger_publicacion() congelaba nombre, colonia, tipo
--      y texto, PERO dejaba suelta la columna `huella` (identificador
--      del dispositivo usado para los topes de frecuencia). Un anónimo
--      podía reescribirla para esquivar los límites anti-spam.
--
--   2. Tres funciones sin `set search_path` (linter
--      function_search_path_mutable): limpiar_texto,
--      difuminar_ubicacion y reportes_solo_estado_legales.
--
-- SOLUCIÓN
--   · El trigger congela para quien no es dueño TODOS los campos de
--     contenido (nombre, colonia, tipo, texto) y además huella, que
--     quedó suelta en el trigger original. Para quien no es dueño se
--     devuelve `new` con todos los campos restaurados, NO `old`:
--     devolver old aplastaba también el +1 del like que dar_like()
--     tiene permitido (error corregido en P5.20, lo detectó el
--     test e2e-supabase en producción).
--   · search_path fijado en las tres funciones.
--
-- CONSECUENCIA VISIBLE
--   Ninguna: la app nunca edita huella por PATCH, y los dueños
--   pueden seguir corrigiendo sus publicaciones. Los likes siguen
--   funcionando igual que antes (solo vía dar_like()).
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
  new.oculto      := old.oculto;
  new.oculto_motivo := old.oculto_motivo;
  new.likes       := case
                       when current_setting('bym.marca_interna', true) = 'like'
                            and new.likes = old.likes + 1 then new.likes
                       else old.likes
                     end;

  -- El dueño puede corregir su publicación (nunca likes ni comentarios).
  if auth.uid() is not null and old.usuario_id is not null and auth.uid() = old.usuario_id then
    return new;
  end if;

  -- Quien no es dueño: el contenido y la huella vuelven a como estaban,
  -- pero se conserva en `new` el like ya aplicado (el +1 de dar_like()).
  -- P5.19 devolvía `old` aquí y eso aplastaba el like: corregido P5.20.
  new.nombre  := old.nombre;
  new.colonia := old.colonia;
  new.tipo    := old.tipo;
  new.texto   := old.texto;
  new.huella  := old.huella;
  return new;
end;
$$;

-- ---------- 2. search_path de las tres funciones ----------
alter function public.limpiar_texto(text, int) set search_path = public;
alter function public.difuminar_ubicacion()    set search_path = public;
alter function public.reportes_solo_estado_legales() set search_path = public;
