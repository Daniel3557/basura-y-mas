-- ============================================================
-- ROLLBACK · 2026-10-03-06-p2-seguimiento.sql
--
-- OJO CON EL ORDEN
--   La función marcar_seguimiento usa el tipo estado_reporte en su
--   firma, así que hay que borrarla ANTES que el tipo.
--
--   Los estados que ya se hubieran puesto ('en_revision',
--   'atendido') NO quedan guardados en ningún sitio al revertir.
-- ============================================================

drop trigger if exists trg_estados_legales on public.reportes;
drop function if exists public.reportes_solo_estado_legales();
drop function if exists public.marcar_seguimiento(text, public.estado_reporte);
drop function if exists public.es_admin(uuid);

alter table public.reportes drop column if exists estado;
alter table public.reportes rename column estado_sync to estado;
drop type if exists public.estado_reporte;

drop table if exists public.administradores;