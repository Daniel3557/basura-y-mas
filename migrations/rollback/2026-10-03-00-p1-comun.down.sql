-- ============================================================
-- ROLLBACK · 2026-10-03-00-p1-comun.sql
-- Deja la base de datos como estaba antes de aplicar esta migración.
-- ============================================================
drop function if exists public.limpiar_texto(text, int);
drop function if exists public.emisor_actual(text);
drop function if exists public.ip_cliente();

-- AVISO: al borrar ip_cliente() también se pierde para el resto del
-- sistema. Aplica este rollback solo si también reviertes las tareas
-- que lo usan (likes, comentarios y límites de frecuencia).