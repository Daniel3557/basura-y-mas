-- ============================================================
-- BASURA Y MÁS · P1.0 · Utilidades compartidas
-- Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
-- ------------------------------------------------------------
-- Infraestructura que usan varias tareas de seguridad:
--   · ip_cliente()      → IP real de la petición (cabeceras de Vercel/Supabase)
--   · emisor_actual()   → "quién está haciendo esto": cuenta, huella o IP
--   · limpiar_texto()   → saneado común de lo que escribe la gente
--
-- Este archivo se aplica PRIMERO. Si algo falla, se detiene la cadena.
-- ============================================================

-- ---------- IP de la petición ----------
-- PostgREST expone las cabeceras en el GUC 'request.headers'.
-- Si no están disponibles devuelve null (y los límites por IP se
-- saltan: es preferible no molestar a la gente a dejar la app rota).
create or replace function public.ip_cliente()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_json jsonb;
  v_ip   text;
begin
  begin
    v_json := current_setting('request.headers', true)::jsonb;
  exception when others then
    return null;
  end;

  if v_json is null then return null; end if;

  v_ip := coalesce(
    nullif(trim(v_json ->> 'cf-connecting-ip'), ''),
    nullif(trim(split_part(coalesce(v_json ->> 'x-forwarded-for', ''), ',', 1)), ''),
    nullif(trim(v_json ->> 'x-real-ip'), '')
  );

  return nullif(v_ip, '');
end;
$$;

-- ---------- Identidad del emisor ----------
-- Prioridad: cuenta iniciada > huella del dispositivo > IP.
-- La huella es un identificador aleatorio que genera el navegador;
-- NO es un identificador personal y se puede borrar borrando el
-- almacenamiento local.
create or replace function public.emisor_actual(p_huella text default null)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is not null then 'u:' || auth.uid()::text
    when nullif(trim(coalesce(p_huella, '')), '') is not null then 'd:' || left(trim(p_huella), 64)
    when public.ip_cliente() is not null then 'ip:' || public.ip_cliente()
    else 'anon'
  end;
$$;

-- ---------- Saneado de texto ----------
-- Una sola función para texto de usuarios: recorta, quita el
-- espacio sobrante y acota la longitud. Nunca devuelve null.
create or replace function public.limpiar_texto(p_texto text, p_max int)
returns text
language sql
immutable
as $$
  select left(coalesce(nullif(trim(coalesce(p_texto, '')), ''), ''), greatest(p_max, 1));
$$;