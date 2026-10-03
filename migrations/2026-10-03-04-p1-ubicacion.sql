-- ============================================================
-- BASURA Y MÁS · P1.4 · La ubicación de un reporte no se publica exacta
-- Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
-- ------------------------------------------------------------
-- PROBLEMA
--   reportes.ubicacion guardaba lat/lng con precisión de metros y la
--   tabla se lee sin cuenta (política "reportes_lectura_publica"). Eso
--   publicaba la dirección aproximada de la casa de quien reportó: con
--   6 decimales se puede localizar el portal.
--
-- DECISIÓN
--   No se guarda la coordenada exacta en ningún sitio. Se redondea al
--   escribir, a 3 decimales (~110 m en latitud, ~100 m en longitud),
--   de modo que la base de datos nunca contiene el punto real.
--   Se descarta además cualquier otra clave que llegue en el jsonb
--   (por ejemplo, un correo metido a mano dentro de "ubicacion").
--
--   Por qué no una vista con coordenadas difuminadas para el público:
--   PostgREST concede permisos por columna, no por fila, así que
--   ocultar solo a los invitados obligaría a que la app usara siempre
--   una función. Difuminar al escribir es más simple y más seguro:
--   lo que no se guarda, no se puede filtrar.
--
-- CONSECUENCIA VISIBLE (y deliberada)
--   El pin del reporte se ve desplazado unos metros. La app lo dice
--   con la marca "aprox." en la ficha y en la leyenda del mapa.
--
-- ROLLBACK: migrations/rollback/2026-10-03-04-p1-ubicacion.down.sql
-- ============================================================

-- ---------- Redondeo y saneado al escribir ----------
create or replace function public.difuminar_ubicacion()
returns trigger
language plpgsql
as $$
declare
  v_lat numeric;
  v_lng numeric;
begin
  if new.ubicacion is null or new.ubicacion = '{}'::jsonb then
    new.ubicacion := null;
    return new;
  end if;

  begin
    v_lat := round((new.ubicacion ->> 'lat')::numeric, 3);
    v_lng := round((new.ubicacion ->> 'lng')::numeric, 3);
  exception when others then
    v_lat := null;
    v_lng := null;
  end;

  -- Coordenadas imposibles o ausentes: se guarda sin ubicación.
  if v_lat is null or v_lng is null
     or v_lat < -90 or v_lat > 90
     or v_lng < -180 or v_lng > 180 then
    new.ubicacion := null;
    return new;
  end if;

  new.ubicacion := jsonb_build_object('lat', v_lat, 'lng', v_lng, 'aprox', true);
  return new;
end;
$$;

drop trigger if exists trg_difuminar_ubicacion on public.reportes;
create trigger trg_difuminar_ubicacion
  before insert or update of ubicacion on public.reportes
  for each row execute function public.difuminar_ubicacion();

-- ---------- Limpieza de lo que ya había ----------
update public.reportes
   set ubicacion = null
 where ubicacion is not null
   and (
     (ubicacion ->> 'lat') !~ '^-?\d+(\.\d+)?$'
     or (ubicacion ->> 'lng') !~ '^-?\d+(\.\d+)?$'
     or (ubicacion ->> 'lat')::numeric < -90 or (ubicacion ->> 'lat')::numeric > 90
     or (ubicacion ->> 'lng')::numeric < -180 or (ubicacion ->> 'lng')::numeric > 180
   );

update public.reportes
   set ubicacion = jsonb_build_object(
         'lat', round((ubicacion ->> 'lat')::numeric, 3),
         'lng', round((ubicacion ->> 'lng')::numeric, 3),
         'aprox', true)
 where ubicacion is not null;

-- ---------- Garantía de que nadie reintroduce coordenadas exactas ----------
alter table public.reportes
  drop constraint if exists reportes_ubicacion_aprox;
alter table public.reportes
  add constraint reportes_ubicacion_aprox check (
    ubicacion is null
    or (
      (ubicacion ->> 'lat') ~ '^-?\d+(\.\d{1,3})$'
      and (ubicacion ->> 'lng') ~ '^-?\d+(\.\d{1,3})$'
      and (ubicacion -> 'aprox') = 'true'::jsonb
      and (ubicacion - 'lat' - 'lng' - 'aprox') = '{}'::jsonb
    )
  );

-- ---------- Commentarios de las fotos: sin cambios ----------
-- Las fotografías siguen siendo una decisión de quien reporta. Lo que
-- no se hace aquí es analizarlas: no hay ninguna IA ni geolocalización
-- automática de imágenes en este proyecto.