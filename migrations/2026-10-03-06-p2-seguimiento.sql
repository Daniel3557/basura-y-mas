-- ============================================================
-- BASURA Y MÁS · P2.7 · Estados de reporte de verdad
-- Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
-- ------------------------------------------------------------
-- PROBLEMA
--   La columna reportes.estado era texto libre y, además, no significaba
--   un estado del reporte: guardaba el estado de SINCRONIZACIÓN que
--   escribía la propia app ("Sincronizado con la nube" / "Registrado
--   localmente (copia local)"). No había forma de saber si un reporte
--   estaba recibido, en revisión o ya atendido.
--
-- DECISIÓN (por qué NO se recicló la columna)
--   Se RENOMBRA la existente a estado_sync (sigue siendo la nota
--   técnica que escribe el navegador) y se crea una columna nueva
--   `estado` de tipo enum. Así el nombre que pide el producto
--   significa lo que debe significar, y el dato técnico no se
--   mezcla con el estado de seguimiento.
--
--   Los reportes que ya existían quedan como 'recibido': es la única
--   etiqueta honesta, porque nadie ha revisado todavía ninguno.
--
--   Nota: `reportes` NO tiene política de UPDATE para nadie. El texto de
--   un reporte tampoco se puede corregir desde la app a mano (la
--   moderación lo cambia por función). Es una decisión consciente: los
--   reportes se consideran un registro, no un borrador.
--
-- ROLLBACK: migrations/rollback/2026-10-03-06-p2-seguimiento.down.sql
-- ============================================================

-- ---------- El tipo enum ----------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'estado_reporte') then
    create type public.estado_reporte as enum ('recibido', 'en_revision', 'atendido');
  end if;
end
$$;

-- ---------- Renombrar la nota técnica ----------
alter table public.reportes rename column estado to estado_sync;

-- ---------- El estado real del reporte ----------
alter table public.reportes
  add column if not exists estado public.estado_reporte not null default 'recibido';

comment on column public.reportes.estado_sync is
  'Nota técnica que escribe la app: "Sincronizado con la nube" o "Registrado localmente (copia local)". No es el estado del reporte.';
comment on column public.reportes.estado is
  'Estado del reporte: recibido → en_revision → atendido. Solo lo cambia la moderación.';

-- ---------- Par de seguridad: el cliente no se autoproclama atendido ----------
-- En INSERT el estado se fuerza a 'recibido' (si no, bastaba con crear
-- el reporte ya "atendido" para saltarse la moderación) y en UPDATE
-- solo cambia si viene de la función de moderación.
create or replace function public.reportes_solo_estado_legales()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.estado := 'recibido';
    return new;
  end if;

  if current_setting('bym.marca_interna', true) is null
     and new.estado is distinct from old.estado then
    new.estado := old.estado;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_estados_legales on public.reportes;
create trigger trg_estados_legales
  before insert or update on public.reportes
  for each row execute function public.reportes_solo_estado_legales();

-- ---------- Quiénes pueden moderar ----------
-- Tabla mínima y explícita: solo se modifica desde el SQL Editor.
-- No se puede ampliar desde el navegador porque no hay ninguna
-- política de escritura para el rol anónimo ni para los usuarios.
create table if not exists public.administradores (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  desde     timestamptz not null default now(),
  nota      text
);

alter table public.administradores enable row level security;
-- Lectura solo para la propia sesión (el panel necesita saber si lo es):
drop policy if exists "administradores_lectura_propia" on public.administradores;
create policy "administradores_lectura_propia" on public.administradores
  for select to authenticated using (usuario_id = auth.uid());

create or replace function public.es_admin(p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.administradores where usuario_id = p_uid);
$$;

revoke execute on function public.es_admin(uuid) from public;
grant  execute on function public.es_admin(uuid) to authenticated;

-- ---------- Moderación: cambiar el estado (solo administradores) ----------
create or replace function public.marcar_seguimiento(p_id text, p_estado public.estado_reporte)
returns public.estado_reporte
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado public.estado_reporte;
begin
  if not exists (select 1 from public.administradores where usuario_id = auth.uid()) then
    raise exception 'Solo una cuenta administradora puede cambiar el estado.';
  end if;
  if not exists (select 1 from public.reportes where id = p_id) then
    raise exception 'Ese reporte ya no existe.';
  end if;

  perform set_config('bym.marca_interna', 'estado', true);

  update public.reportes set estado = p_estado where id = p_id returning estado into v_estado;
  return v_estado;
end;
$$;

revoke execute on function public.marcar_seguimiento(text, public.estado_reporte) from public;
grant  execute on function public.marcar_seguimiento(text, public.estado_reporte) to authenticated;