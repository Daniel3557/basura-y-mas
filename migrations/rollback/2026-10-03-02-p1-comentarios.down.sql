-- ============================================================
-- ROLLBACK · 2026-10-03-02-p1-comentarios.sql
--
-- ADVERTENCIA
--   Este rollback NO copia los comentarios de vuelta al campo jsonb:
--   volver a permitirlos por UPDATE directo reabre el problema que
--   corrige la migración. Para revertir de verdad hay que exportar
--   primero el contenido (copiar public.comentarios a un jsonb).
--
--   Opción A (revertir de golpe, aceptando perder los comentarios):
--     1) Ejecuta este archivo.
--     2) Deshaz el commit de index.html de P1.2 y vuelve a subir.
--
--   Opción B (conservarlos): antes de ejecutar este archivo, genera el
--   jsonb de cada publicación y luego aplícalo a mano:
--     update public.publicaciones p
--        set comentarios = (
--          select coalesce(jsonb_agg(jsonb_build_object(
--                   'autor', c.autor, 'texto', c.texto, 'ts', c.ts
--                 ) order by c.ts), '[]'::jsonb)
--            from public.comentarios c where c.publicacion_id = p.id
--        );
-- ============================================================

drop function if exists public.comentarios_de(text[]);
drop function if exists public.crear_comentario(text, text, text, text);
drop table if exists public.comentarios;

-- Tras el DROP, proteger_publicacion() vuelve a funcionar con el jsonb
-- (la migración P1.1 ya lo congela, así que los comentarios antiguos
-- siguen sin poder editarse por PATCH).