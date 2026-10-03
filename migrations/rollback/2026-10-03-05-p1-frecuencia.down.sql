-- ============================================================
-- ROLLBACK · 2026-10-03-05-p1-frecuencia.sql
--
-- ADVERTENCIA
--   Esto deja la aplicación SIN ningún límite de escritura: la llave
--   anónima vuelve a poder escribir sin freno. Úsalo solo para
--   depurar, y vuelve a aplicar la migración en cuanto puedas.
-- ============================================================

drop trigger if exists trg_frecuencia_publicaciones on public.publicaciones;
drop trigger if exists trg_frecuencia_reportes on public.reportes;
drop trigger if exists trg_frecuencia_comentarios on public.comentarios;
drop function if exists public.registrar_uso();
drop table if exists public.uso_registrado;

drop index if exists public.idx_reportes_huella_ts;
drop index if exists public.idx_publicaciones_huella_ts;
-- Las columnas `huella` se conservan: el app las sigue enviando y
-- borrarlas devolvería un 400 en cada publicación o reporte.
--   alter table public.reportes      drop column if exists huella;
--   alter table public.publicaciones drop column if exists huella;