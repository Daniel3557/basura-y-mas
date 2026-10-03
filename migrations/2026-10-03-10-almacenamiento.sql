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