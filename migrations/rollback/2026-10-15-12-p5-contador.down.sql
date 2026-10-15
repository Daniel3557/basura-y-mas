-- Rollback de P5.21 · Contador de visitas propio
-- Deshace la tabla y la función (pierde el histórico de visitas).

drop function if exists public.registrar_visita();
drop table if exists public.visitas_contador;
