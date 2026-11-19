-- Bucket "avatars" (fotos de perfil). Crear primero el bucket con la API de Storage:
--   POST {SUPABASE_URL}/storage/v1/bucket
--   {"id":"avatars","name":"avatars","public":true,"file_size_limit":2097152,
--    "allowed_mime_types":["image/jpeg","image/png","image/webp"]}
-- Lectura pública (las fotos se muestran en la app). Escritura: cada persona solo en su carpeta
-- "<auth.uid()>/...". Reemplazar un archivo (upsert) necesita INSERT + SELECT + UPDATE.

create policy "avatars_select_propios" on storage.objects for select to authenticated
  using ( bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text );

create policy "avatars_insert_propios" on storage.objects for insert to authenticated
  with check ( bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text );

create policy "avatars_update_propios" on storage.objects for update to authenticated
  using ( bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text )
  with check ( bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text );

create policy "avatars_delete_propios" on storage.objects for delete to authenticated
  using ( bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text );
