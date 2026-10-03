-- ============================================================
-- ROLLBACK · 2026-10-03-10-almacenamiento.sql
--
-- AVISO
--   Quitar las políticas deja las fotos sin poder subirse desde la
--   app (los reportes con fotografía dejan de sincronizar, aunque la
--   fila se guarda). NO se borra el bucket: los archivos que ya están
--   subidos se quedan ahí. Para vaciarlo hay que ir al panel de
--   Supabase → Storage (o usar la service_role, que no existe en el
--   navegador).
-- ============================================================

drop policy if exists "fotos_subida_publica" on storage.objects;
drop policy if exists "fotos_lectura_publica" on storage.objects;
-- El bucket se conserva: borrarlo eliminaría las fotos ya subidas.