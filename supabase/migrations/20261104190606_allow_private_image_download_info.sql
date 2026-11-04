begin;
alter policy prototype_images_read on storage.objects using (
storage.allow_any_operation(array['object.get_authenticated_info','object.get_authenticated'])
and (select private.can_access())
and exists (select 1 from public.parcel_images i where i.bucket=bucket_id and i.object_path=name)
);
alter policy prototype_images_guard on storage.objects using (
bucket_id not in ('imagenes-catastro','imagenes-satelitales') or (
(select auth.uid()) is not null
and storage.allow_any_operation(array['object.get_authenticated_info','object.get_authenticated'])
and (select private.can_access())
and exists (select 1 from public.parcel_images i where i.bucket=bucket_id and i.object_path=name)
));
commit;
