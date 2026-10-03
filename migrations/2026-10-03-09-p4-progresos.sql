-- ============================================================
-- BASURA Y MÁS · P4.18 · Puntos, nivel e insignias en la nube
-- Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
-- ------------------------------------------------------------
-- PROBLEMA
--   Los puntos, el nivel y las insignias vivían solo en el
--   localStorage del navegador. Si cambiabas de dispositivo perdías
--   todo el progreso, y no había forma de que nadie verificara que un
--   "nivel 3" fuera real.
--
-- SOLUCIÓN
--   Tabla public.progresos con una fila por cuenta:
--     · RLS estricta: cada quien solo lee y escribe su fila.
--     · El nivel NO se guarda: se calcula en la app a partir de los
--       puntos (niveles.js), porque es la regla del cliente y así se
--       puede corregir sin migrar datos.
--     · El número de puntos solo puede SUBIR (trigger), como ya
--       pasaba con los "me importa".
--     · Las insignias se guardan como lista de identificadores y solo
--       pueden añadirse, nunca quitarse.
--
-- PRINCIPIO QUE NO SE ROMPE
--   localStorage sigue siendo la copia de trabajo. La nube es un
--   espejo opcional: sin conexión, o sin cuenta, la app funciona
--   exactamente igual que antes. Al entrar con sesión se sube lo que
--   haya y se descarga lo más alto que exista entre nube y local
--   (nunca se baja un progreso que la persona ya habia conseguido).
--
-- ROLLBACK: migrations/rollback/2026-10-03-09-p4-progresos.down.sql
-- ============================================================

create table if not exists public.progresos (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  puntos       int  not null default 0,
  insignias    text[] not null default '{}',
  dias_accion  text[] not null default '{}',   -- días 'AAAAMMDD' con acción
  actualizado  timestamptz not null default now(),
  constraint progresos_puntos_rango check (puntos >= 0 and puntos <= 1000000)
);

alter table public.progresos enable row level security;

drop policy if exists "progresos_lectura_propia" on public.progresos;
create policy "progresos_lectura_propia" on public.progresos
  for select to authenticated using (auth.uid() = usuario_id);

drop policy if exists "progresos_escritura_propia" on public.progresos;
create policy "progresos_escritura_propia" on public.progresos
  for insert to authenticated with check (auth.uid() = usuario_id);

-- No hay política de UPDATE: los cambios pasan por la función, que
-- aplica las reglas (solo sube, solo añade insignias).

-- ---------- Puntos e insignias solo pueden subir ----------
create or replace function public.guardar_progreso(
  p_puntos      int,
  p_insignias   text[] default '{}',
  p_dias_accion text[] default '{}'
)
returns public.progresos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_fila  public.progresos;
  v_puntos int;
  v_ins   text[];
  v_dias  text[];
begin
  if v_uid is null then
    raise exception 'Necesitas iniciar sesión para guardar tu progreso.';
  end if;

  -- El cliente NUNCA es la fuente de verdad: los valores se acotan
  -- aquí y se combinan con lo que ya había.
  v_puntos := greatest(0, least(coalesce(p_puntos, 0), 1000000));
  v_ins    := coalesce(p_insignias, '{}');
  v_dias   := coalesce(p_dias_accion, '{}');

  perform set_config('bym.marca_interna', 'progreso', true);

  insert into public.progresos (usuario_id, puntos, insignias, dias_accion, actualizado)
  values (v_uid, v_puntos, v_ins, v_dias, now())
  on conflict (usuario_id) do update
    set puntos      = greatest(progresos.puntos, excluded.puntos),
        insignias   = (select coalesce(array_agg(distinct x), '{}')
                         from unnest(progresos.insignias || excluded.insignias) x),
        dias_accion = (select coalesce(array_agg(distinct x), '{}')
                         from unnest(progresos.dias_accion || excluded.dias_accion) x),
        actualizado = now()
  returning * into v_fila;

  return v_fila;
end;
$$;

revoke execute on function public.guardar_progreso(int, text[], text[]) from public;
grant  execute on function public.guardar_progreso(int, text[], text[]) to authenticated;

-- ---------- Leer el propio progreso ----------
create or replace function public.mi_progreso()
returns public.progresos
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fila public.progresos;
begin
  if auth.uid() is null then
    raise exception 'Necesitas iniciar sesión.';
  end if;
  select * into v_fila from public.progresos where usuario_id = auth.uid();
  return v_fila;
end;
$$;

revoke execute on function public.mi_progreso() from public;
grant  execute on function public.mi_progreso() to authenticated;

create index if not exists idx_progresos_actualizado on public.progresos (actualizado desc);