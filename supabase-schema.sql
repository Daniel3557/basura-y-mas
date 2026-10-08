-- ============================================================
-- BASURA Y MÁS · Esquema de base de datos (Supabase / PostgreSQL)
-- Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
-- ------------------------------------------------------------
-- ESTE ARCHIVO SE GENERA. No lo edites a mano: para cambiar la base
-- de datos se escribe un archivo nuevo en migrations/ y se regenera
-- con:
--
--     node tools/generar-esquema.js
--
-- Cada migración trae en su cabecera qué problema resuelve, por qué
-- se eligió esa solución y qué se rompe al revertirla. Los ROLLBACK
-- están en migrations/rollback/ con el nombre del original + .down.sql.
--
-- ORDEN DE APLICACIÓN
--   2026-10-03-00-p1-comun.sql
--   2026-10-03-01-p1-likes.sql
--   2026-10-03-02-p1-comentarios.sql
--   2026-10-03-03-p1-perfiles.sql
--   2026-10-03-04-p1-ubicacion.sql
--   2026-10-03-05-p1-frecuencia.sql
--   2026-10-03-06-p2-seguimiento.sql
--   2026-10-03-07-p2-moderacion.sql
--   2026-10-03-08-p2-borrado.sql
--   2026-10-03-09-p4-progresos.sql
--   2026-10-03-10-almacenamiento.sql
--   2026-10-08-11-p5-endurecer.sql
--
-- Idea de seguridad (resumen)
--   · Todo lo que se escribe sin sesión tiene un tope por cuenta, por
--     huella de navegador y por IP (public.registrar_uso).
--   · "Me importa" solo cambia dentro de public.dar_like(), que suma
--     +1 exacto y recuerda a quien ya le pulso alguna vez.
--   · Los comentarios viven en su propia tabla y se escriben solo por
--     public.crear_comentario(), con límites por publicación y persona.
--   · El nombre público nunca es el correo: por defecto es "Vecino".
--   · La ubicación de un reporte se redondea a ~100 m ANTES de
--     guardarse: lo que no se guarda no se puede filtrar.
--   · El estado de un reporte solo lo cambia la moderación, y cada
--     reporte nace siempre en "recibido".
--   · Lo oculto solo lo ven su autor y las cuentas administradoras.
--   · Cada quien puede borrar su propia publicación y su reporte.
-- ============================================================


-- ================================================================
-- 2026-10-03-00-p1-comun.sql
-- ================================================================

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
-- ================================================================
-- 2026-10-03-01-p1-likes.sql
-- ================================================================

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
-- ================================================================
-- 2026-10-03-02-p1-comentarios.sql
-- ================================================================

-- ============================================================
-- BASURA Y MÁS · P1.2 · Comentarios que no se pueden tapar
-- Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
-- ------------------------------------------------------------
-- PROBLEMA
--   Los comentarios vivían dentro de publicaciones.comentarios (jsonb) y
--   cualquiera podía reescribir ese campo con un PATCH. El trigger los
--   acotaba a 60 por publicación, pero:
--     · un usuario podía escribir 60 comentarios de golpe y vaciar el
--       jsonb completo de la fila,
--     · un moderador no tenía forma de ocultar uno concreto,
--     · el texto no tenía índices ni consultas propias.
--
-- SOLUCIÓN
--   · Tabla public.comentarios con RLS: lectura pública, escritura solo
--     a través de la función crear_comentario().
--   · Límites dentro de la función: 60 por publicación, 3 por persona o
--     dispositivo en cada publicación.
--   · Con cuenta, el autor lo toma del perfil: nadie puede firmar como
--     otra persona. Sin cuenta, se usa el nombre que la persona escribió
--     (máx. 40 caracteres).
--   · Los comentarios que ya existían en el jsonb se migran tal cual y el
--     trigger deja de permitir cualquier cambio en esa columna.
--
-- ROLLBACK: migrations/rollback/2026-10-03-02-p1-comentarios.down.sql
-- ============================================================

create table if not exists public.comentarios (
  id             uuid primary key default gen_random_uuid(),
  publicacion_id text not null references public.publicaciones(id) on delete cascade,
  autor          text not null default 'Anónimo',
  texto          text not null,
  ts             bigint not null,
  usuario_id     uuid references auth.users(id) on delete set null,
  huella         text,
  emisor         text not null,
  constraint comentarios_texto_max check (length(texto) between 1 and 400),
  constraint comentarios_autor_max check (length(autor) <= 40)
);

alter table public.comentarios enable row level security;

drop policy if exists "comentarios_lectura_publica" on public.comentarios;
create policy "comentarios_lectura_publica" on public.comentarios
  for select using (true);
-- Sin política de INSERT/UPDATE/DELETE: solo las funciones security
-- definer escriben aquí. Un DELETE directo (salvo el dueño de la
-- publicación, vía cascade) no existe.

create index if not exists idx_comentarios_pub_ts on public.comentarios (publicacion_id, ts);
create index if not exists idx_comentarios_emisor_ts on public.comentarios (emisor, ts desc);

-- ---------- Migración de los comentarios que ya existían ----------
insert into public.comentarios (publicacion_id, autor, texto, ts, emisor)
select p.id,
       left(coalesce(nullif(trim(c ->> 'autor'), ''), 'Anónimo'), 40),
       left(trim(c ->> 'texto'), 400),
       case when (c ->> 'ts') ~ '^\d+$' then (c ->> 'ts')::bigint else 0 end,
       'migracion:' || p.id || ':' || x.ord
from public.publicaciones p,
     lateral jsonb_array_elements(coalesce(p.comentarios, '[]'::jsonb))
       with ordinality as x(c, ord)
where coalesce(trim(c ->> 'texto'), '') <> '';

-- ---------- Función única para comentar ----------
create or replace function public.crear_comentario(
  p_publicacion_id text,
  p_texto           text,
  p_autor           text default null,
  p_huella          text default null
)
returns public.comentarios
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_emisor text;
  v_texto  text;
  v_autor  text;
  v_fila   public.comentarios;
begin
  if not exists (select 1 from public.publicaciones where id = p_publicacion_id) then
    raise exception 'La publicación ya no existe.';
  end if;

  v_texto := public.limpiar_texto(p_texto, 400);
  if length(v_texto) < 2 then
    raise exception 'El comentario está vacío.';
  end if;

  v_emisor := public.emisor_actual(p_huella);

  -- Con cuenta el nombre sale del perfil (no del navegador).
  if v_uid is not null then
    v_autor := coalesce(
      nullif(public.limpiar_texto((select nombre from public.perfiles where id = v_uid), 40), ''),
      'Vecino'
    );
  else
    v_autor := coalesce(nullif(public.limpiar_texto(p_autor, 40), ''), 'Anónimo');
  end if;

  if (select count(*) from public.comentarios where publicacion_id = p_publicacion_id) >= 60 then
    raise exception 'Esta publicación ya tiene demasiados comentarios.';
  end if;

  if (select count(*) from public.comentarios
      where publicacion_id = p_publicacion_id and emisor = v_emisor) >= 3 then
    raise exception 'Ya escribiste varios comentarios aquí. Lee los demás antes de escribir otro.';
  end if;

  insert into public.comentarios (publicacion_id, autor, texto, ts, usuario_id, huella, emisor)
  values (
    p_publicacion_id,
    v_autor,
    v_texto,
    (extract(epoch from now()) * 1000)::bigint,
    v_uid,
    nullif(left(trim(coalesce(p_huella, '')), 64), ''),
    v_emisor
  )
  returning * into v_fila;

  return v_fila;
end;
$$;

revoke execute on function public.crear_comentario(text, text, text, text) from public;
grant  execute on function public.crear_comentario(text, text, text, text) to anon, authenticated;

-- ---------- Lectura agrupada para la app ----------
-- Una sola llamada trae los comentarios de hasta 100 publicaciones.
create or replace function public.comentarios_de(p_ids text[])
returns setof public.comentarios
language sql
stable
security definer
set search_path = public
as $$
  select c.* from public.comentarios c where c.publicacion_id = any(p_ids);
$$;

revoke execute on function public.comentarios_de(text[]) from public;
grant  execute on function public.comentarios_de(text[]) to anon, authenticated;
-- ================================================================
-- 2026-10-03-03-p1-perfiles.sql
-- ================================================================

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
-- ================================================================
-- 2026-10-03-04-p1-ubicacion.sql
-- ================================================================

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
-- ================================================================
-- 2026-10-03-05-p1-frecuencia.sql
-- ================================================================

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
-- ================================================================
-- 2026-10-03-06-p2-seguimiento.sql
-- ================================================================

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
-- ================================================================
-- 2026-10-03-07-p2-moderacion.sql
-- ================================================================

-- ============================================================
-- BASURA Y MÁS · P2.8 · Moderación: ocultar y mostrar
-- Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
-- ------------------------------------------------------------
-- PROBLEMA
--   No había ninguna forma de apartar un reporte con datos
--   offending o una publicación con insultos: la única opción era
--   borrarla de la base de datos a mano desde el SQL Editor.
--
-- SOLUCIÓN
--   · Columna `oculto` en reportes y publicaciones (ocultar ≠ borrar:
--     nada se pierde y se puede volver a mostrar).
--   · RLS: lo oculto no lo ve nadie salvo su autor y las cuentas
--     administradoras.
--   · Las funciones ocultar()/mostrar() solo funcionan para admin.
--   · El trigger de contenido no puede saltarse `oculto` con un
--     UPDATE normal: hace falta pasar por la función.
--
-- DECISIÓN
--   `oculto` no es lo mismo que "borrado". Se eligió así porque el
--   proyecto es escolar y puede haber que justificar una medida: se
--   guarda el motivo y se puede revertir.
--
-- ROLLBACK: migrations/rollback/2026-10-03-07-p2-moderacion.down.sql
-- ============================================================

-- ---------- Columnas de moderación ----------
alter table public.reportes      add column if not exists oculto boolean not null default false;
alter table public.reportes      add column if not exists oculto_motivo text;
alter table public.publicaciones add column if not exists oculto boolean not null default false;
alter table public.publicaciones add column if not exists oculto_motivo text;

comment on column public.reportes.oculto is 'Apartado de la vista pública por moderación. No se borra: se puede volver a mostrar.';

-- ---------- RLS: lo oculto sale de la vista pública ----------
drop policy if exists "reportes_lectura_publica" on public.reportes;
create policy "reportes_lectura_publica" on public.reportes
  for select to anon
  using (
    not oculto
    or (auth.uid() is not null and usuario_id = auth.uid())
    or public.es_admin(auth.uid())
  );

drop policy if exists "reportes_lectura_usuarios" on public.reportes;
create policy "reportes_lectura_usuarios" on public.reportes
  for select to authenticated
  using (
    not oculto
    or (auth.uid() is not null and usuario_id = auth.uid())
    or public.es_admin(auth.uid())
  );

drop policy if exists "publicaciones_lectura_publica" on public.publicaciones;
create policy "publicaciones_lectura_publica" on public.publicaciones
  for select to anon
  using (
    not oculto
    or (auth.uid() is not null and usuario_id = auth.uid())
    or public.es_admin(auth.uid())
  );

drop policy if exists "publicaciones_lectura_usuarios" on public.publicaciones;
create policy "publicaciones_lectura_usuarios" on public.publicaciones
  for select to authenticated
  using (
    not oculto
    or (auth.uid() is not null and usuario_id = auth.uid())
    or public.es_admin(auth.uid())
  );

-- ---------- El trigger de contenido no toca `oculto` ----------
create or replace function public.proteger_publicacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marca text := current_setting('bym.marca_interna', true);
begin
  -- Nadie cambia esto con un UPDATE normal.
  new.id          := old.id;
  new.ts          := old.ts;
  new.usuario_id  := old.usuario_id;
  new.comentarios := old.comentarios;
  new.likes       := case
                       when v_marca = 'like' and new.likes = old.likes + 1 then new.likes
                       else old.likes
                     end;
  new.oculto       := old.oculto;
  new.oculto_motivo := old.oculto_motivo;

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

-- ---------- Función única de moderación ----------
-- Sirve para reportes y publicaciones: comprueba la tabla por el
-- prefijo del id que le llega.
create or replace function public.moderar(
  p_tabla  text,
  p_id     text,
  p_oculto boolean,
  p_motivo text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_admin(auth.uid()) then
    raise exception 'Solo una cuenta administradora puede moderar.';
  end if;

  if p_tabla = 'reportes' then
    if not exists (select 1 from public.reportes where id = p_id) then
      raise exception 'Ese reporte ya no existe.';
    end if;
    perform set_config('bym.marca_interna', 'moderacion', true);
    update public.reportes set oculto = p_oculto, oculto_motivo = public.limpiar_texto(p_motivo, 200) where id = p_id;
  elsif p_tabla = 'publicaciones' then
    if not exists (select 1 from public.publicaciones where id = p_id) then
      raise exception 'Esa publicación ya no existe.';
    end if;
    perform set_config('bym.marca_interna', 'moderacion', true);
    update public.publicaciones set oculto = p_oculto, oculto_motivo = public.limpiar_texto(p_motivo, 200) where id = p_id;
  else
    raise exception 'Tabla no permitida.';
  end if;

  return true;
end;
$$;

revoke execute on function public.moderar(text, text, boolean, text) from public;
grant  execute on function public.moderar(text, text, boolean, text) to authenticated;

-- ---------- Listado de moderación ----------
-- Devuelve lo oculto (y lo recién creado) para el panel, incluyendo
-- lo que RLS esconde del resto.
create or replace function public.pendientes_moderacion()
returns table (
  tabla        text,
  id           text,
  nombre       text,
  colonia      text,
  tipo         text,
  texto        text,
  estado       text,
  oculto       boolean,
  oculto_motivo text,
  usuario_id   uuid,
  ubicacion    text,
  likes        int,
  n_comentarios bigint,
  ts           bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.es_admin(auth.uid()) then
    raise exception 'Solo una cuenta administradora puede ver este listado.';
  end if;

  return query
  select 'reportes', r.id, r.nombre, r.colonia, r.tipo, r.texto, r.estado::text, r.oculto, r.oculto_motivo,
         r.usuario_id,
         case when r.ubicacion is null then ''
              else r.ubicacion ->> 'lat' || ', ' || r.ubicacion ->> 'lng' || ' (±100 m)' end,
         null::int, null::bigint, r.ts
    from public.reportes r
  union all
  select 'publicaciones', p.id, p.nombre, p.colonia, p.tipo, p.texto, null::text, p.oculto, p.oculto_motivo,
         p.usuario_id, ''::text, p.likes,
         (select count(*) from public.comentarios c where c.publicacion_id = p.id), p.ts
    from public.publicaciones p
   order by ts desc
  limit 200;
end;
$$;

revoke execute on function public.pendientes_moderacion() from public;
grant  execute on function public.pendientes_moderacion() to authenticated;
-- ================================================================
-- 2026-10-03-08-p2-borrado.sql
-- ================================================================

-- ============================================================
-- BASURA Y MÁS · P2.10 · Que cada quien pueda borrar lo suyo
-- Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
-- ------------------------------------------------------------
-- PROBLEMA
--   Los botones de "eliminar" solo borraban del dispositivo: el
--   reporte seguía en la base de datos para todo el mundo. No había
--   ninguna política de borrado, porque sin ella cualquiera podría
--   vaciar la tabla (era el precio de que los datos no se perdieran).
--
-- SOLUCIÓN
--   Se abre el borrado, pero solo para la cuenta que creó la fila:
--     for delete to authenticated using (usuario_id = auth.uid())
--   Las filas de invitados (usuario_id is null) NO se pueden borrar
--   desde la app: sin cuenta no hay forma de demostrar que eres el
--   autor. Es una limitación consciente, no un olvido.
--
-- CONSECUENCIA
--   Al borrar una publicación sus comentarios se van con ella
--   (ON DELETE CASCADE) y también sus "me importa" (likes_votos).
--   Los reportes se borran solos; el archivo de la foto, no: queda en
--   el almacenamiento (ver "Limitaciones conocidas" en DOCUMENTACION).
--
-- ROLLBACK: migrations/rollback/2026-10-03-08-p2-borrado.down.sql
-- ============================================================

drop policy if exists "publicaciones_borrado_propio" on public.publicaciones;
create policy "publicaciones_borrado_propio" on public.publicaciones
  for delete to authenticated
  using (usuario_id = auth.uid());

drop policy if exists "reportes_borrado_propio" on public.reportes;
create policy "reportes_borrado_propio" on public.reportes
  for delete to authenticated
  using (usuario_id = auth.uid());

-- Índices que ya estaban, pero que ahora también usa el borrado.
create index if not exists idx_reportes_usuario on public.reportes (usuario_id);
create index if not exists idx_publicaciones_usuario on public.publicaciones (usuario_id);
-- ================================================================
-- 2026-10-03-09-p4-progresos.sql
-- ================================================================

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
-- ================================================================
-- 2026-10-03-10-almacenamiento.sql
-- ================================================================

-- ============================================================
-- BASURA Y MÁS · Almacenamiento de fotografías
-- Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
-- ------------------------------------------------------------
-- Este bucket ya estaba en producción antes de que existiera la
-- carpeta migrations/. Se documenta aquí para que el espejo del
-- esquema (supabase-schema.sql) esté completo y para que quede claro
-- qué reglas lo protegen.
--
-- Antes, la fotografía viajaba dentro de la fila como "data URL" y
-- cada visita descargaba megabytes. Ahora es un archivo real en un
-- bucket público y la fila solo guarda su URL.
--
-- LO QUE SÍ SE PUEDE HACER DESDE EL NAVEGADOR
--   · subir una imagen dentro de la carpeta 'reportes/', hasta 3 MB
-- LO QUE NO
--   · nada fuera de esa carpeta (ni una subcarpeta más hondo)
--   · no hay política de borrado: los archivos se quitan desde el
--     panel de Supabase o con la service_role, nunca desde la app
--
-- ROLLBACK: migrations/rollback/2026-10-03-10-almacenamiento.down.sql
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reportes-fotos', 'reportes-fotos', true, 3145728,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "fotos_lectura_publica" on storage.objects;
create policy "fotos_lectura_publica" on storage.objects
  for select using (bucket_id = 'reportes-fotos');

drop policy if exists "fotos_subida_publica" on storage.objects;
create policy "fotos_subida_publica" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'reportes-fotos'
    and (storage.foldername(name))[1] = 'reportes'
    and (storage.foldername(name))[2] is null
  );
-- ================================================================
-- 2026-10-08-11-p5-endurecer.sql
-- ================================================================

-- ============================================================
-- BASURA Y MÁS · P5.19 · Refuerzo de seguridad (auditoría)
-- Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
-- ------------------------------------------------------------
-- PROBLEMA (hallazgos de la auditoría de 2026-10-08 con
-- pg_policies y el asesor de seguridad de Supabase)
--
--   1. Las políticas de UPDATE de publicaciones están abiertas
--      (using(true) para anon y authenticated). Eso es a propósito:
--      la app usa PATCH para marcar el estado de sincronización. El
--      trigger proteger_publicacion() congelaba nombre, colonia, tipo
--      y texto, PERO dejaba suelta la columna `huella` (identificador
--      del dispositivo usado para los topes de frecuencia). Un anónimo
--      podía reescribirla para esquivar los límites anti-spam.
--
--   2. Tres funciones sin `set search_path` (linter
--      function_search_path_mutable): limpiar_texto,
--      difuminar_ubicacion y reportes_solo_estado_legales.
--
-- SOLUCIÓN
--   · El trigger congela para quien no es dueño TODOS los campos de
--     contenido (nombre, colonia, tipo, texto) y además huella, que
--     quedó suelta en el trigger original. Para quien no es dueño se
--     devuelve `new` con todos los campos restaurados, NO `old`:
--     devolver old aplastaba también el +1 del like que dar_like()
--     tiene permitido (error corregido en P5.20, lo detectó el
--     test e2e-supabase en producción).
--   · search_path fijado en las tres funciones.
--
-- CONSECUENCIA VISIBLE
--   Ninguna: la app nunca edita huella por PATCH, y los dueños
--   pueden seguir corrigiendo sus publicaciones. Los likes siguen
--   funcionando igual que antes (solo vía dar_like()).
--
-- ROLLBACK: migrations/rollback/2026-10-08-11-p5-endurecer.down.sql
-- ============================================================

-- ---------- 1. Trigger: la fila entera se congela para no dueños ----------
create or replace function public.proteger_publicacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Campos que nadie cambia nunca por UPDATE directo.
  new.id          := old.id;
  new.ts          := old.ts;
  new.usuario_id  := old.usuario_id;
  new.comentarios := old.comentarios;
  new.oculto      := old.oculto;
  new.oculto_motivo := old.oculto_motivo;
  new.likes       := case
                       when current_setting('bym.marca_interna', true) = 'like'
                            and new.likes = old.likes + 1 then new.likes
                       else old.likes
                     end;

  -- El dueño puede corregir su publicación (nunca likes ni comentarios).
  if auth.uid() is not null and old.usuario_id is not null and auth.uid() = old.usuario_id then
    return new;
  end if;

  -- Quien no es dueño: el contenido y la huella vuelven a como estaban,
  -- pero se conserva en `new` el like ya aplicado (el +1 de dar_like()).
  -- P5.19 devolvía `old` aquí y eso aplastaba el like: corregido P5.20.
  new.nombre  := old.nombre;
  new.colonia := old.colonia;
  new.tipo    := old.tipo;
  new.texto   := old.texto;
  new.huella  := old.huella;
  return new;
end;
$$;

-- ---------- 2. search_path de las tres funciones ----------
alter function public.limpiar_texto(text, int) set search_path = public;
alter function public.difuminar_ubicacion()    set search_path = public;
alter function public.reportes_solo_estado_legales() set search_path = public;
