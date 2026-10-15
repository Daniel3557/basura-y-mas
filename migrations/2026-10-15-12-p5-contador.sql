-- ============================================================
-- BASURA Y MÁS · P5.21 · Contador de visitas propio (sin Vercel Analytics)
-- Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
-- ------------------------------------------------------------
-- PROBLEMA
--   Vercel cambió su Web Analytics a plan de pago ($20 USD/mes, plan Pro).
--   Para un proyecto escolar eso está fuera de alcance, así que la app
--   usa un contador propio: una tablita de una fila que suma +1 por
--   visita. El cliente solo PUEDE llamar a la función; no puede poner
--   el contador en el número que quiera ni leer tablas ajenas.
--
-- DISEÑO
--   · visitas_contador: una fila (id=1) con total grande (bigint).
--   · registrar_visita(): security definer, sin argumentos; suma +1 y
--     regresa el total. El cliente no ve la tabla (RLS sin políticas),
--     solo el número que devuelve la función.
--   · Anti-inflado en el cliente: sessionStorage cuenta la visita una
--     vez por sesión del navegador (una pestaña recargada no suma).
--     El servidor no confía en eso para nada crítico: es solo un
--     contador público de curiosidad, no un dato de seguridad.
--
-- ROLLBACK: migrations/rollback/2026-10-15-12-p5-contador.down.sql
-- ============================================================

begin;

-- ---------- 1. La tabla del contador (una sola fila, id fijo 1) ----------
create table if not exists public.visitas_contador (
  id    int primary key default 1 check (id = 1),
  total bigint not null default 0,
  ts    bigint not null default (extract(epoch from now()) * 1000)::bigint
);

insert into public.visitas_contador (id, total) values (1, 0)
on conflict (id) do nothing;

alter table public.visitas_contador enable row level security;
-- Sin políticas a propósito: el cliente anónimo no lee ni escribe la
-- tabla directamente; solo la función security definer la toca.

-- ---------- 2. La función que el cliente puede llamar ----------
create or replace function public.registrar_visita()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total bigint;
begin
  update public.visitas_contador
     set total = total + 1,
         ts    = (extract(epoch from now()) * 1000)::bigint
   where id = 1
  returning total into v_total;

  -- Si alguien borró la fila, se recrea en el acto.
  if v_total is null then
    insert into public.visitas_contador (id, total) values (1, 1)
    on conflict (id) do update set total = visitas_contador.total + 1
    returning total into v_total;
  end if;

  return v_total;
end;
$$;

revoke execute on function public.registrar_visita() from public;
grant execute on function public.registrar_visita() to anon, authenticated;

commit;
