-- ============================================================
-- BASURA Y MÁS · P1.5 · Límites de frecuencia
-- Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
-- ------------------------------------------------------------
-- PROBLEMA
--   Con la llave anónima, cualquiera podía escribir en el proyecto
--   desde un script: mil publicaciones, mil reportes o mil
--   comentarios por minuto. No hay CAPTCHA y no lo habrá pronto (ver
--   "CAPTCHA" más abajo), así que el límite tiene que vivir aquí, en
--   la base de datos: es lo único que el navegador no puede esquivar.
--
-- CÓMO SE CUENTA
--   public.uso_registrado guarda una fila por cada escritura. El
--   emisor se calcula en este orden:
--     1. cuenta iniciada  ('u:<uuid>')   → no se puede esquivar
--     2. huella del navegador ('d:<id>') → se borra borrando el
--                                         almacenamiento local
--     3. IP de la conexión ('ip:<ip>')    → cubre los que limpian
--                                         el navegador o falsifican
--                                         la huella
--   Hay tres topes: por hora, por día y por IP y hora.
--
-- TABLA DE TOPES (suben con el uso real del proyecto)
--   publicaciones :  6/hora · 25/día · 40/hora por IP
--   reportes      :  8/hora · 30/día · 60/hora por IP
--   comentarios   :  5/hora · 20/día · 60/hora por IP
--   (comentarios además tienen sus propios topes por publicación:
--    60 en total y 3 por persona o dispositivo)
--
-- CAPTCHA · POR QUÉ NO SE PUSO UNO
--   Cloudflare Turnstile exigiría registrar el dominio en Cloudflare y
--   pegar una site key en el código; sin esa clave no se puede ni
--   probar, y una casilla a medio integrar es peor que no tenerla
--   (parece seguridad y no la da). El plan B, que ya está aplicado,
--   son estos límites en SQL: no dependen del cliente. Si más adelante
--   se registra el dominio, se añade el widget y la clave, pero los
--   límites deben quedarse igual.
--
-- ROLLBACK: migrations/rollback/2026-10-03-05-p1-frecuencia.down.sql
-- ============================================================

create table if not exists public.uso_registrado (
  id     bigint generated always as identity primary key,
  emisor text   not null,
  tabla  text   not null,
  ts     timestamptz not null default now()
);

alter table public.uso_registrado enable row level security;
-- Sin políticas: nadie lee ni escribe esta tabla desde el cliente.
-- Solo la función disparadora (security definer).

create index if not exists idx_uso_emisor_ts on public.uso_registrado (emisor, tabla, ts desc);
create index if not exists idx_uso_ts on public.uso_registrado (ts desc);

-- ---------- Huella del navegador en las tablas de contenido ----------
alter table public.publicaciones add column if not exists huella text;
alter table public.reportes      add column if not exists huella text;

-- ---------- Trigger de frecuencia ----------
create or replace function public.registrar_uso()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tabla  text := tg_table_name;
  v_huella text := nullif(left(trim(coalesce(new.huella, '')), 64), '');
  v_emisor text;
  v_ip     text;
  v_hora   int;
  v_dia    int;
  v_ip_h   int;
  v_n      bigint;
begin
  -- 1. No contar las escrituras internas (las funciones de la app).
  if current_setting('bym.marca_interna', true) is not null then
    return null;
  end if;

  v_emisor := public.emisor_actual(v_huella);
  v_ip     := public.ip_cliente();

  v_hora := case v_tabla when 'publicaciones' then 6 when 'reportes' then 8 else 5 end;
  v_dia  := case v_tabla when 'publicaciones' then 25 when 'reportes' then 30 else 20 end;
  v_ip_h := case v_tabla when 'publicaciones' then 40 when 'reportes' then 60 else 60 end;

  select count(*) into v_n from public.uso_registrado
   where emisor = v_emisor and tabla = v_tabla and ts > now() - interval '1 hour';
  if v_n >= v_hora then
    raise exception 'Límite de frecuencia: llevas demasiadas acciones en poco tiempo. Espera un momento e inténtalo de nuevo.';
  end if;

  select count(*) into v_n from public.uso_registrado
   where emisor = v_emisor and tabla = v_tabla and ts > now() - interval '1 day';
  if v_n >= v_dia then
    raise exception 'Límite de frecuencia: alcanzaste el máximo de hoy. Inténtalo mañana.';
  end if;

  if v_ip is not null then
    select count(*) into v_n from public.uso_registrado
     where emisor = 'ip:' || v_ip and tabla = v_tabla and ts > now() - interval '1 hour';
    if v_n >= v_ip_h then
      raise exception 'Límite de frecuencia: demasiadas acciones desde esta conexión. Inténtalo más tarde.';
    end if;
  end if;

  insert into public.uso_registrado (emisor, tabla) values (v_emisor, v_tabla);

  -- Limpieza barata: se conservan dos días para poder contar el día
  -- completo y se borra lo viejo de vez en cuando (2 % de las veces).
  if random() < 0.02 then
    delete from public.uso_registrado where ts < now() - interval '2 days';
  end if;

  return null;
end;
$$;

drop trigger if exists trg_frecuencia_publicaciones on public.publicaciones;
create trigger trg_frecuencia_publicaciones
  after insert on public.publicaciones
  for each row execute function public.registrar_uso();

drop trigger if exists trg_frecuencia_reportes on public.reportes;
create trigger trg_frecuencia_reportes
  after insert on public.reportes
  for each row execute function public.registrar_uso();

drop trigger if exists trg_frecuencia_comentarios on public.comentarios;
create trigger trg_frecuencia_comentarios
  after insert on public.comentarios
  for each row execute function public.registrar_uso();

-- ---------- Índice para contar por huella ----------
create index if not exists idx_reportes_huella_ts on public.reportes (huella, ts desc) where huella is not null;
create index if not exists idx_publicaciones_huella_ts on public.publicaciones (huella, ts desc) where huella is not null;