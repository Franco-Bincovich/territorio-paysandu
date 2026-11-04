begin;
-- Schema only. Source values are imported separately, never committed.
create table public.prototype_parcels (
 locality text not null check(locality='Paysandú'),
 parcel text not null check(parcel='17718'),
 source_document text not null check(source_document='Territorio_Paysandu_v03_Expediente_17718.html'),
 source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
 institutionally_verified boolean not null default false check(not institutionally_verified),
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 imported_at timestamptz not null default now(),
 primary key(locality,parcel),
 check(payload->>'id'=parcel and payload->>'localidad'=locality),
 check(payload ?& array['id','localidad','address','area','built','detected','detectedPercent','zone','section','block','contact','document','phone','phone2','email','type'])
);
alter table public.prototype_parcels enable row level security;
revoke all on public.prototype_parcels from public,anon,authenticated;
grant select on public.prototype_parcels to authenticated;
grant all on public.prototype_parcels to service_role;
create policy prototype_parcels_read on public.prototype_parcels for select to authenticated using ((select private.can_access()));
-- No automatic key/data insertion. Authorized import atomically adds the source row
-- and key to the existing legacy-named allowlist, retaining consultation integrity.
commit;
