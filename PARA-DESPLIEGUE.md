# Qué falta por hacer en Supabase · 8 de octubre de 2026

Esta guía es para copiar y pegar. Solo hay **una cosa técnica obligatoria** (el SQL
del paso 1) y dos ajustes de paneles web. Si algo sale con error, cópiame el
mensaje exacto y lo reviso.

---

## 1. Correr el SQL de refuerzo de seguridad (obligatorio, 2 minutos)

Este SQL cierra un hueco real que encontré en la auditoría: aunque el trigger
`proteger_publicacion()` ya congelaba el contenido de una publicación, dejaba
sueltas tres columnas (**foto**, **huella** y **estado_sync**), y un anónimo
malintencionado podía reescribirlas en filas ajenas (cambiar la huella para
esquivar los topes de frecuencia, o apuntar la foto de otro reporte a otro
archivo). También fija el `search_path` de tres funciones que el asesor de
Supabase marcaba como advertencia.

**No cambia nada visible de la app** — los usuarios no notarán diferencia y los
dueños siguen pudiendo corregir sus publicaciones.

### Pasos

1. Entra a https://supabase.com/dashboard → proyecto **rmnnqggasqxlpntcffrz**.
2. Menú lateral izquierdo → **SQL Editor** → botón **New query** (o "+").
3. Copia **todo** el bloque de abajo y pégalo tal cual.
4. Botón **Run** (o Ctrl+Enter).
5. Debe decir algo como `Success. No rows returned`. Si sale un error,
   cópiame el texto.

### El SQL (cópialo completo, del BEGIN al END inclusive)

```sql
begin;

-- Refuerzo P5.19: la fila entera se congela para quien no es dueño.
-- Antes quedaban sueltas foto, huella y estado_sync (auditoría 2026-10-08).
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
  new.likes       := case
                       when current_setting('bym.marca_interna', true) = 'like'
                            and new.likes = old.likes + 1 then new.likes
                       else old.likes
                     end;
  new.oculto      := old.oculto;
  new.oculto_motivo := old.oculto_motivo;

  -- El dueño puede corregir su publicación.
  if auth.uid() is not null and old.usuario_id is not null
     and auth.uid() = old.usuario_id then
    return new;
  end if;

  -- Quien no es dueño: la fila entera vuelve a como estaba.
  return old;
end;
$$;

-- search_path fijo en tres funciones (advertencia del asesor de Supabase).
alter function public.limpiar_texto(text, int) set search_path = public;
alter function public.difuminar_ubicacion()    set search_path = public;
alter function public.reportes_solo_estado_legales() set search_path = public;

commit;
```

(El SQL también quedó guardado en el repositorio como
[migrations/2026-10-08-11-p5-endurecer.sql](migrations/2026-10-08-11-p5-endurecer.sql);
si algún día quieres revertirlo, hay un rollback en
`migrations/rollback/2026-10-08-11-p5-endurecer.down.sql`.)

---

## 2. Activar la protección de contraseñas filtradas (recomendado, 1 minuto)

El asesor de seguridad de Supabase lo marca como advertencia: impide que un
usuario use una contraseña que ya apareció en filtraciones públicas (Have I Been
Pwned). Es un botón, no SQL.

1. En el mismo proyecto de Supabase → **Authentication** (menú lateral) →
   pestaña **Policies** (arriba).
2. Busca **"Leaked Password Protection"** → actívalo (**Enable**).

---

## 3. Revisar los avisos que van a quedar (informativos, no toques nada)

Después del paso 1, el asesor de seguridad puede seguir mostrando dos avisos
sobre `likes_votos` y `uso_registrado`: *"RLS enabled but no policy"*.
**Es correcto y a propósito**: son tablas internas que solo las funciones del
servidor (security definer) tocan; el cliente anónimo no necesita ninguna
política y por eso no puede leerlas ni escribirlas. No las toques.

(los avisos de las tres funciones y los UPDATE abiertos **sí** se van con el
SQL del paso 1.)

---

## Verificación (opcional pero sugerida)

En el mismo SQL Editor, después de correr el paso 1, pega esto y dale Run.
Debería listar la función con `search_path = public`:

```sql
select proname, proconfig
from pg_proc
where proname in ('proteger_publicacion','limpiar_texto','difuminar_ubicacion','reportes_solo_estado_legales');
```

Cualquier cosa que no entienda del resultado, pégamela y la leo contigo.
