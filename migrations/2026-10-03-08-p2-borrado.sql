-- ============================================================
-- BASURA Y MÁS · P2.10 · Que cada quien pueda borrar lo suyo
-- Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
-- ------------------------------------------------------------
-- PROBLEMA
--   Los botones de "eliminar" solo borraban del dispositivo: el
--   reporte seguía en la base de datos para todo el mundo. No había
--   ninguna política de borrado, porque sin ella cualquiera podría
--   vaciar la tabla (era el precio de que los datos no se perdieran).
--
-- SOLUCIÓN
--   Se abre el borrado, pero solo para la cuenta que creó la fila:
--     for delete to authenticated using (usuario_id = auth.uid())
--   Las filas de invitados (usuario_id is null) NO se pueden borrar
--   desde la app: sin cuenta no hay forma de demostrar que eres el
--   autor. Es una limitación consciente, no un olvido.
--
-- CONSECUENCIA
--   Al borrar una publicación sus comentarios se van con ella
--   (ON DELETE CASCADE) y también sus "me importa" (likes_votos).
--   Los reportes se borran solos; el archivo de la foto, no: queda en
--   el almacenamiento (ver "Limitaciones conocidas" en DOCUMENTACION).
--
-- ROLLBACK: migrations/rollback/2026-10-03-08-p2-borrado.down.sql
-- ============================================================

drop policy if exists "publicaciones_borrado_propio" on public.publicaciones;
create policy "publicaciones_borrado_propio" on public.publicaciones
  for delete to authenticated
  using (usuario_id = auth.uid());

drop policy if exists "reportes_borrado_propio" on public.reportes;
create policy "reportes_borrado_propio" on public.reportes
  for delete to authenticated
  using (usuario_id = auth.uid());

-- Índices que ya estaban, pero que ahora también usa el borrado.
create index if not exists idx_reportes_usuario on public.reportes (usuario_id);
create index if not exists idx_publicaciones_usuario on public.publicaciones (usuario_id);