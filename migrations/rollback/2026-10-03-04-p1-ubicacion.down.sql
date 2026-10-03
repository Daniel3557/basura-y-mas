-- ============================================================
-- ROLLBACK · 2026-10-03-04-p1-ubicacion.sql
--
-- ADVERTENCIA
--   Revertir esto vuelve a guardar la coordenada EXACTA de cada reporte
--   en una tabla que se lee sin cuenta. Eso es justo lo que esta
--   migración evita: no lo hagas si hay reportes de personas reales.
--
--   Además, las coordenadas precisas ya se perdieron al redondear: no
--   hay forma de recuperarlas. Solo se puede volver a aceptar el
--   formato nuevo (con "aprox": true) en las filas siguientes.
-- ============================================================

drop trigger if exists trg_difuminar_ubicacion on public.reportes;
drop function if exists public.difuminar_ubicacion();
alter table public.reportes drop constraint if exists reportes_ubicacion_aprox;

-- No se restoresn las coordenadas originales a propósito. Si de verdad
-- hace falta, habría que volver a capturarlas desde el dispositivo.