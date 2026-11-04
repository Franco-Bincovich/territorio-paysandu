-- DRAFT ONLY, NOT APPLIED. Coordinator must inspect remote schema/policies first,
-- generate a migration with supabase migration new, and verify rollback/preconditions.
-- No image objects or reference rows are created here.
begin;
create table public.parcel_images (
  locality text not null check (locality = 'Paysandú'),
  parcel text not null check (parcel = '17718'),
  kind text not null check (kind in ('historical','survey')),
  bucket text not null,
  filename text not null check (filename ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'),
  object_path text not null,
  source text not null check (length(source) between 1 and 200),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  hosting_authorized_at timestamptz not null,
  authorization_reference text not null check (length(authorization_reference) > 0),
  primary key (locality,parcel,kind), unique (bucket,object_path),
  check (bucket = case kind when 'historical' then 'imagenes-satelitales' else 'imagenes-catastro' end),
  check (object_path = 'paysandu/17718/' || kind || '/' || filename)
);
alter table public.parcel_images enable row level security;
revoke all on public.parcel_images from public, anon, authenticated;
grant select on public.parcel_images to authenticated;
grant all on public.parcel_images to service_role;
create policy parcel_images_read on public.parcel_images for select to authenticated
using ((select private.can_access()));
-- Fail if buckets already exist: inspect, never silently overwrite configuration.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
('imagenes-catastro','imagenes-catastro',false,10485760,array['image/png','image/jpeg','image/webp']),
('imagenes-satelitales','imagenes-satelitales',false,10485760,array['image/png','image/jpeg','image/webp']);
create policy prototype_images_read on storage.objects for select to authenticated using (
  storage.allow_only_operation('object.get_authenticated') and (select private.can_access()) and exists (
    select 1 from public.parcel_images i where i.bucket = bucket_id and i.object_path = name
  )
);
-- Restrictive guard prevents an unrelated permissive policy from exposing these buckets.
create policy prototype_images_guard on storage.objects as restrictive for select to authenticated using (
  bucket_id not in ('imagenes-catastro','imagenes-satelitales') or (
    (select auth.uid()) is not null and storage.allow_only_operation('object.get_authenticated') and (select private.can_access()) and exists (
      select 1 from public.parcel_images i where i.bucket = bucket_id and i.object_path = name
    )
  )
);
create policy prototype_images_anon_guard on storage.objects as restrictive for select to anon
using (bucket_id not in ('imagenes-catastro','imagenes-satelitales'));
create policy prototype_images_no_insert on storage.objects as restrictive for insert to public
with check (bucket_id not in ('imagenes-catastro','imagenes-satelitales'));
create policy prototype_images_no_update on storage.objects as restrictive for update to public
using (bucket_id not in ('imagenes-catastro','imagenes-satelitales'))
with check (bucket_id not in ('imagenes-catastro','imagenes-satelitales'));
create policy prototype_images_no_delete on storage.objects as restrictive for delete to public
using (bucket_id not in ('imagenes-catastro','imagenes-satelitales'));
commit;
