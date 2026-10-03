-- ============================================================
-- BASURA Y MÁS · P1.1 · Likes que no se pueden inflar
-- Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
-- ------------------------------------------------------------
-- PROBLEMA
--   El trigger proteger_publicacion() hacía
--     new.likes := greatest(old.likes, new.likes)
--   así que un PATCH directo con {"likes": 1000000} se aceptaba y,
--   como nunca bajaba, el número quedaba inflado para siempre.
--
-- SOLUCIÓN
--   · Los likes solo cambian dentro de la función dar_like(), que suma
--     exactamente +1 y nada más.
--   · El trigger vuelve a congelar `likes` en CUALQUIER UPDATE directo,
--     incluido el del dueño de la publicación.
--   · La función recuerda quién apoyó (cuenta o huella del dispositivo)
--     para que un mismo dispositivo no pueda repetir el apoyo.
--
-- NOTA DE COHERENCIA
--   La app debe llamar  POST /rest/v1/rpc/dar_like
--   mientras siga usando PATCH {likes:n} los likes ya no se moverán.
--   Es el cambio de index.html que acompaña a esta migración.
-- ============================================================

-- ---------- Quien_privó ---------- (nunca se expone al cliente)
create table if not exists public.likes_votos (
  publicacion_id text not null references public.publicaciones(id) on delete cascade,
  emisor         text not null,      -- 'u:<uuid>' (cuenta) o 'd:<huella>' (dispositivo)
  ts             bigint not null,
  primary key (publicacion_id, emisor)
);

alter table public.likes_votos enable row level security;
-- Sin políticas: solo las funciones security definer tocan esta tabla.

create index if not exists idx_likes_votos_ts on public.likes_votos (ts desc);

-- ---------- Funciones auxiliares compartidas ----------
-- Se definen en 2026-10-03-00-p1-comun.sql:
--   public.ip_cliente()    → IP de la petición
--   public.emisor_actual() → cuenta > huella del dispositivo > IP

-- ---------- Función única que suma un "me importa" ----------
create or replace function public.dar_like(p_publicacion_id text, p_huella text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emisor text;
  v_nuevos int;
begin
  if nullif(trim(coalesce(p_publicacion_id, '')), '') is null then
    raise exception 'Falta la publicación.';
  end if;

  v_emisor := public.emisor_actual(p_huella);
  if v_emisor = 'anon' then
    raise exception 'No se pudo registrar el apoyo: inicia sesión o recarga la página.';
  end if;

  if not exists (select 1 from public.publicaciones where id = p_publicacion_id) then
    raise exception 'La publicación ya no existe.';
  end if;

  -- Un voto por emisor y por publicación (una sola vez).
  if exists (select 1 from public.likes_votos
              where publicacion_id = p_publicacion_id and emisor = v_emisor) then
    raise exception 'Ya registraste tu apoyo en esta publicación.';
  end if;

  insert into public.likes_votos (publicacion_id, emisor, ts)
  values (p_publicacion_id, v_emisor, (extract(epoch from now()) * 1000)::bigint);

  -- Marca interna: el trigger deja pasar EXACTAMENTE este +1.
  perform set_config('bym.marca_interna', 'like', true);

  update public.publicaciones
     set likes = coalesce(likes, 0) + 1
   where id = p_publicacion_id
  returning likes into v_nuevos;

  return v_nuevos;
end;
$$;

revoke execute on function public.dar_like(text, text) from public;
grant  execute on function public.dar_like(text, text) to anon, authenticated;

-- ---------- Trigger: `likes` y `comentarios` quedan congelados ----------
-- Reglas (más estrictas que antes):
--   · likes      → solo cambian vía dar_like(); el resto se restaura.
--   · comentarios → restaurados siempre (el dueño tampoco los edita).
--   · el dueño   → edita nombre, colonia, tipo, texto y oculto (P2).
--   · los demás  → no cambian nada salvo lo que ya se restauraba.
create or replace function public.proteger_publicacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marca text := current_setting('bym.marca_interna', true);
begin
  -- Campos que nadie cambia nunca por UPDATE directo.
  new.id          := old.id;
  new.ts          := old.ts;
  new.usuario_id  := old.usuario_id;
  new.comentarios := old.comentarios;
  new.likes       := case
                       when v_marca = 'like' and new.likes = old.likes + 1 then new.likes
                       else old.likes
                     end;

  -- El dueño puede corregir su publicación (nunca sus likes ni comentarios).
  if auth.uid() is not null and old.usuario_id is not null and auth.uid() = old.usuario_id then
    return new;
  end if;

  new.nombre  := old.nombre;
  new.colonia := old.colonia;
  new.tipo    := old.tipo;
  new.texto   := old.texto;

  return new;
end;
$$;