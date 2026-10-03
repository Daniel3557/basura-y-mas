-- ============================================================
-- ROLLBACK · 2026-10-03-09-p4-progresos.sql
--
-- La app sigue funcionando sin esta tabla: el progreso vuelve a
-- vivir solo en localStorage. Los puntos ya guardados en la nube se
-- PERDERÁN (salvo que se copien antes con un INSERT en una tabla
-- propia).
-- ============================================================

drop function if exists public.mi_progreso();
drop function if exists public.guardar_progreso(int, text[], text[]);
drop table if exists public.progresos;