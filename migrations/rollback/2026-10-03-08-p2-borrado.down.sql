-- ============================================================
-- ROLLBACK · 2026-10-03-08-p2-borrado.sql
--
-- Vuelve la tabla a ser inborrable desde la app. El contenido ya
-- borrado NO se recupera.
-- ============================================================

drop policy if exists "publicaciones_borrado_propio" on public.publicaciones;
drop policy if exists "reportes_borrado_propio" on public.reportes;