-- ============================================================
-- ROLLBACK · 2026-10-03-03-p1-perfiles.sql
--
-- ADVERTENCIA
--   Revertir esto vuelve a publicar el correo de cada persona como
--   nombre visible. Si ya se limpiaron los nombres, esta migración
--   NO los restaura: el correo se perdió de forma intencionada y no
--   se puede adivinar (habría que leerlo de auth.users).
-- ============================================================

drop function if exists public.mi_perfil();

-- La columna se conserva: el app la sigue enviando y borrarla
-- rompería el PATCH del perfil. Si prefieres el esquema original:
--   alter table public.perfiles drop column if exists nombre_edicado;

-- Volver al comportamiento anterior (nombre = parte del correo).
-- No recomendado: deja el correo a la vista de cualquiera.
-- create or replace function public.crear_perfil_usuario()
-- returns trigger language plpgsql security definer set search_path = public
-- as $$
-- begin
--   insert into public.perfiles (id, nombre)
--   values (new.id, coalesce(nullif(trim(split_part(new.email, '@', 1)), ''), 'Vecino'))
--   on conflict (id) do nothing;
--   return new;
-- end;
-- $$;