-- Dashboard uploads may retain a root filename; bucket/kind and exact parcel
-- constraints, admin-only writes and object-to-reference RLS remain unchanged.
begin;
alter table public.parcel_images drop constraint parcel_images_check1;
alter table public.parcel_images add constraint parcel_images_object_path_check
check (object_path = filename or object_path = 'paysandu/17718/' || kind || '/' || filename);
commit;
-- Rollback: remove only the two registered root references, then restore the
-- original path check. Never delete/move storage.objects via SQL.
