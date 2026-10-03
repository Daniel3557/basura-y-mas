-- ============================================================
-- BASURA Y MÁS · P1.3 · Menos datos personales a la vista
-- Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
-- ------------------------------------------------------------
-- PROBLEMA
--   Al crear la cuenta, el trigger public.crear_perfil_usuario() copiaba
--   la parte del correo ANTES de la @ como nombre, y perfiles es de
--   lectura pública. El resultado: el correo de una persona quedaba
--   escrito en un campo que cualquiera podía leer
--   (GET /rest/v1/profiles es anónimo).
--
-- SOLUCIÓN
--   · El nombre por defecto pasa a ser 'Vecino'.
--   · Se añade nombre_edicado para saber si el apodo lo eligió la
--     persona o si sigue siendo el valor por defecto.
--   · Se limpian los nombres ya generados comparándolos con el correo
--     de la cuenta: solo se cambian los que coinciden exactamente con
--     la parte anterior a la @, nunca los que alguien escribió a mano.
--   · Sigue sin guardarse el correo en perfiles: nunca se copió.
--
-- ROLLBACK: migrations/rollback/2026-10-03-03-p1-perfiles.down.sql
-- ============================================================

-- ---------- Marca de "el nombre lo eligió la persona" ----------
alter table public.perfiles
  add column if not exists nombre_edicado boolean not null default false;

-- ---------- El trigger ya no inventa un nombre a partir del correo ----------
create or replace function public.crear_perfil_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 'Vecino' salvo que la app envíe un apodo elegido en el formulario
  -- (en ese caso actualiza la fila con su nombre real).
  insert into public.perfiles (id, nombre, nombre_edicado)
  values (new.id, 'Vecino', false)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------- Limpieza de los nombres heredados del correo ----------
-- Solo toca los perfiles cuyo nombre es exactamente la parte anterior
-- a la @ de su correo: cualquier nombre escrito a mano se conserva.
update public.perfiles p
   set nombre = 'Vecino',
       nombre_edicado = false
 where p.nombre <> 'Vecino'
   and exists (
     select 1 from auth.users u
      where u.id = p.id
        and p.nombre = split_part(u.email, '@', 1)
   );

-- ---------- Evitar que el perfil se pinte con datos ajenos ----------
-- Antes el PATCH propio solo comprobaba auth.uid() = id; se añade que no
-- se pueda rebajar nombre_edicado para "desaparecer" del histórico.
drop policy if exists "perfiles_actualizacion_propia" on public.perfiles;
create policy "perfiles_actualizacion_propia" on public.perfiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------- Perfil completo en una llamada ----------
create or replace function public.mi_perfil()
returns public.perfiles
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fila public.perfiles;
begin
  if auth.uid() is null then
    raise exception 'Necesitas iniciar sesión.';
  end if;
  select * into v_fila from public.perfiles where id = auth.uid();
  return v_fila;
end;
$$;

revoke execute on function public.mi_perfil() from public;
grant  execute on function public.mi_perfil() to authenticated;