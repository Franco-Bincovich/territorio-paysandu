-- G2 personal test environment only. Institutional catalogue remains blocked.
-- Fail atomically if existing consultations have an unrecognized composite key.
begin;
create table private.synthetic_parcel_keys (
  locality text not null,
  parcel text not null,
  primary key (locality, parcel)
);
alter table private.synthetic_parcel_keys enable row level security;
revoke all on private.synthetic_parcel_keys from public, anon, authenticated;
grant select on private.synthetic_parcel_keys to service_role;
insert into private.synthetic_parcel_keys(locality,parcel) values
  ('LOCALIDAD SINTÉTICA','900001'),
  ('OTRA LOCALIDAD SINTÉTICA','900002'),
  ('LOCALIDAD SINTÉTICA','900003');
alter table public.consultations add constraint consultations_known_synthetic_parcel
  foreign key (locality,parcel) references private.synthetic_parcel_keys(locality,parcel);
commit;
