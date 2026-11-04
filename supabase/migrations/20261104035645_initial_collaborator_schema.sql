-- Draft migration source; apply only to the isolated, approved Supabase project.
begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create table public.profiles (
  user_id uuid primary key references auth.users(id),
  username text not null unique check (length(username) between 1 and 100),
  role text not null default 'collaborator' check (role = 'collaborator'),
  enabled boolean not null default true,
  must_change_password boolean not null default true,
  password_changed_at timestamptz
);
create unique index profiles_username_ci on public.profiles(lower(username));
create table private.session_activity (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  last_seen timestamptz not null default now()
);
create table public.consultations (
  id uuid primary key default gen_random_uuid(),
  locality text not null,
  parcel text not null,
  type text not null check (type in ('General','Reclamo','Falta de documentación')),
  description text not null check (length(description) between 1 and 10000),
  person jsonb not null,
  original_snapshot jsonb not null,
  creator_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0)
);
create index consultations_parcel on public.consultations(locality,parcel,created_at desc);
create index consultations_creator on public.consultations(creator_user_id);
create index consultations_created on public.consultations(created_at desc,id);
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid not null unique references public.consultations(id),
  locality text not null,
  parcel text not null,
  person jsonb not null,
  created_at timestamptz not null default now()
);
create index contacts_parcel on public.contacts(locality,parcel);
create table private.consultation_revisions (
  consultation_id uuid not null references public.consultations(id),
  version integer not null,
  actor_id uuid not null references auth.users(id),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key (consultation_id,version)
);
create table private.idempotency (
  actor_id uuid not null references auth.users(id),
  request_key uuid not null,
  payload jsonb not null,
  consultation_id uuid not null references public.consultations(id),
  primary key(actor_id,request_key)
);
create table private.login_attempts (
  key_hash text primary key,
  window_start timestamptz not null,
  attempts integer not null
);

alter table public.profiles enable row level security;
alter table public.consultations enable row level security;
alter table public.contacts enable row level security;
alter table private.session_activity enable row level security;
alter table private.consultation_revisions enable row level security;
alter table private.idempotency enable row level security;
alter table private.login_attempts enable row level security;
revoke all on public.profiles, public.consultations, public.contacts from anon, authenticated;
grant select on public.profiles, public.consultations, public.contacts to authenticated;

create function private.session_id() returns uuid language plpgsql stable security invoker set search_path='' as $$
begin
  return nullif(auth.jwt()->>'session_id','')::uuid;
exception when invalid_text_representation then return null;
end;
$$;

-- Definer required to inspect auth.sessions and non-exposed activity; never user metadata.
create function private.can_access() returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles p
    join auth.sessions s on s.user_id=p.user_id
    join private.session_activity a on a.session_id=s.id and a.user_id=p.user_id
    where p.user_id=auth.uid() and p.enabled and not p.must_change_password
      and p.role='collaborator' and s.id=private.session_id()
      and (s.not_after is null or s.not_after>now())
      and (p.password_changed_at is null or s.created_at>=p.password_changed_at)
      and a.last_seen>now()-interval '60 minutes'
  );
$$;
create policy profile_self on public.profiles for select to authenticated using (user_id=(select auth.uid()));
create policy consultation_read on public.consultations for select to authenticated using ((select private.can_access()));
create policy contact_read on public.contacts for select to authenticated using ((select private.can_access()));

create function private.touch_auth_session() returns boolean language plpgsql security definer set search_path='' as $$
declare sid uuid:=private.session_id(); uid uuid:=auth.uid(); seen timestamptz; started timestamptz;
begin
  if uid is null or sid is null then return false; end if;
  select s.created_at into started from auth.sessions s join public.profiles p on p.user_id=s.user_id
    where s.id=sid and s.user_id=uid and p.enabled and p.role='collaborator'
      and (s.not_after is null or s.not_after>now())
      and (p.password_changed_at is null or s.created_at>=p.password_changed_at);
  if not found then return false; end if;
  select last_seen into seen from private.session_activity where session_id=sid for update;
  if found then
    if seen<=now()-interval '60 minutes' then return false; end if;
    update private.session_activity set last_seen=now() where session_id=sid;
  else
    if started<now()-interval '5 minutes' then return false; end if;
    insert into private.session_activity(session_id,user_id) values(sid,uid) on conflict do nothing;
  end if;
  return true;
end;
$$;
create function public.touch_auth_session() returns boolean language sql security invoker set search_path='' as $$ select private.touch_auth_session(); $$;
create function private.touch_session() returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if not private.touch_auth_session() then return false; end if;
  return private.can_access();
end;
$$;
create function public.touch_session() returns boolean language sql security invoker set search_path='' as $$ select private.touch_session(); $$;

create function private.password_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.encrypted_password is distinct from new.encrypted_password and coalesce(new.encrypted_password,'')<>'' then
    update public.profiles set must_change_password=true,password_changed_at=clock_timestamp() where user_id=new.id;
    delete from private.session_activity where user_id=new.id;
  end if;
  return new;
end;
$$;
create trigger paysandu_password_changed after update of encrypted_password on auth.users for each row execute function private.password_changed();

-- Only the trusted backend can finalize the user-initiated change after fresh login.
-- A hash change alone (including an administrator reset/rehash) never opens business access.
create function private.finalize_password_change(p_user_id uuid,p_session_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.profiles p set must_change_password=false
    where p.user_id=p_user_id and p.enabled and p.role='collaborator'
      and p.must_change_password and p.password_changed_at>now()-interval '5 minutes'
      and exists(select 1 from auth.sessions s where s.id=p_session_id and s.user_id=p.user_id
        and s.created_at>=p.password_changed_at and (s.not_after is null or s.not_after>now()));
  return found;
end;
$$;
create function public.finalize_password_change(p_user_id uuid,p_session_id uuid) returns boolean language sql security invoker set search_path='' as $$ select private.finalize_password_change(p_user_id,p_session_id); $$;

create function private.validate_payload(p jsonb) returns void language plpgsql immutable security invoker set search_path='' as $$
declare field text; item jsonb; person jsonb:=p->'person'; doc text;
begin
  if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(person) is distinct from 'object' then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(p) k where k not in ('locality','parcel','type','description','person'))
    or exists(select 1 from jsonb_object_keys(person) k where k not in ('name','documentType','document','relationship','phones','emails')) then
    raise exception 'INVALID_FIELD' using errcode='22023';
  end if;
  foreach field in array array['locality','parcel','type','description'] loop
    if jsonb_typeof(p->field) is distinct from 'string' or length(btrim(p->>field))=0 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  end loop;
  if length(p->>'locality')>100 or length(p->>'parcel')>30 or p->>'parcel' !~ '^[0-9]+$' or length(p->>'description')>10000 or p->>'type' not in ('General','Reclamo','Falta de documentación') then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  foreach field in array array['name','documentType','document','relationship'] loop
    if jsonb_typeof(person->field) is distinct from 'string' or length(btrim(person->>field)) not between 1 and 300 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  end loop;
  doc:=regexp_replace(person->>'document','[.[:space:]-]','','g');
  if person->>'documentType' not in ('CI','RUT') or length(person->>'document')>30
    or (person->>'documentType'='CI' and doc !~ '^[0-9]{7,8}$')
    or (person->>'documentType'='RUT' and doc !~ '^[0-9]{12}$') then raise exception 'INVALID_DOCUMENT' using errcode='22023'; end if;
  if length(person->>'name')>200 or length(person->>'relationship')>100 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  foreach field in array array['phones','emails'] loop
    if jsonb_typeof(person->field) is distinct from 'array' then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
    if jsonb_array_length(person->field)=0 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
    for item in select value from jsonb_array_elements(person->field) loop
      if jsonb_typeof(item) is distinct from 'string' or length(btrim(item #>> '{}')) not between 1 and 320 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
      if field='emails' and (item #>> '{}') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID_EMAIL' using errcode='22023'; end if;
      if field='emails' and length(item #>> '{}')>254 then raise exception 'INVALID_EMAIL' using errcode='22023'; end if;
      if field='phones' and (item #>> '{}') !~ '^\+?[0-9 ()-]{6,40}$' then raise exception 'INVALID_PHONE' using errcode='22023'; end if;
      if field='phones' and length(regexp_replace(item #>> '{}','[^0-9]','','g'))<6 then raise exception 'INVALID_PHONE' using errcode='22023'; end if;
    end loop;
  end loop;
end;
$$;

create function private.create_consultation(p_payload jsonb,p_idempotency_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); row public.consultations; previous private.idempotency;
begin
  if uid is null or not private.can_access() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  perform private.validate_payload(p_payload);
  if p_idempotency_key is null then raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023'; end if;
  -- Serializes only retries for the same user/key; collisions cause waiting, never data loss.
  perform pg_advisory_xact_lock(hashtextextended(uid::text||p_idempotency_key::text,0));
  select * into previous from private.idempotency where actor_id=uid and request_key=p_idempotency_key;
  if found then
    if previous.payload<>p_payload then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
    select * into row from public.consultations where id=previous.consultation_id;
    return to_jsonb(row);
  end if;
  insert into public.consultations(locality,parcel,type,description,person,original_snapshot,creator_user_id)
    values(p_payload->>'locality',p_payload->>'parcel',p_payload->>'type',p_payload->>'description',p_payload->'person',p_payload,uid) returning * into row;
  insert into public.contacts(consultation_id,locality,parcel,person) values(row.id,row.locality,row.parcel,row.person);
  insert into private.consultation_revisions(consultation_id,version,actor_id,snapshot) values(row.id,1,uid,to_jsonb(row));
  insert into private.idempotency(actor_id,request_key,payload,consultation_id) values(uid,p_idempotency_key,p_payload,row.id);
  return to_jsonb(row);
end;
$$;
create function public.create_consultation(p_payload jsonb,p_idempotency_key uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.create_consultation(p_payload,p_idempotency_key); $$;

create function private.protect_consultation() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.id<>old.id or new.creator_user_id<>old.creator_user_id or new.created_at<>old.created_at or new.original_snapshot<>old.original_snapshot or new.locality<>old.locality or new.parcel<>old.parcel then
    raise exception 'IMMUTABLE_FIELD' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger consultation_immutable before update on public.consultations for each row execute function private.protect_consultation();

create function private.edit_consultation(p_id uuid,p_expected_version integer,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); row public.consultations;
begin
  if uid is null or not private.can_access() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  perform private.validate_payload(p_payload);
  select * into row from public.consultations where id=p_id and creator_user_id=uid for update;
  if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_expected_version is null or row.version<>p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  if row.locality<>p_payload->>'locality' or row.parcel<>p_payload->>'parcel' then raise exception 'IMMUTABLE_FIELD' using errcode='42501'; end if;
  update public.consultations set type=p_payload->>'type',description=p_payload->>'description',person=p_payload->'person',version=version+1,updated_at=now() where id=p_id returning * into row;
  insert into private.consultation_revisions(consultation_id,version,actor_id,snapshot) values(row.id,row.version,uid,to_jsonb(row));
  return to_jsonb(row);
end;
$$;
create function public.edit_consultation(p_id uuid,p_expected_version integer,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.edit_consultation(p_id,p_expected_version,p_payload); $$;

create function private.consume_login_attempt(p_key text) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if p_key is null or length(p_key)<>64 or p_key !~ '^[a-f0-9]+$' then raise exception 'INVALID_KEY'; end if;
  insert into private.login_attempts(key_hash,window_start,attempts) values(p_key,now(),1)
  on conflict(key_hash) do update set
    window_start=case when private.login_attempts.window_start<=now()-interval '15 minutes' then now() else private.login_attempts.window_start end,
    attempts=case when private.login_attempts.window_start<=now()-interval '15 minutes' then 1 else least(private.login_attempts.attempts+1,1000000) end
  returning attempts into n;
  return n<=5;
end;
$$;
create function public.consume_login_attempt(p_key text) returns boolean language sql security invoker set search_path='' as $$ select private.consume_login_attempt(p_key); $$;

revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.touch_auth_session(),public.touch_session(),public.create_consultation(jsonb,uuid),public.edit_consultation(uuid,integer,jsonb),public.consume_login_attempt(text),public.finalize_password_change(uuid,uuid) from public,anon,authenticated;
grant execute on function private.session_id(),private.can_access(),private.touch_auth_session(),private.touch_session(),private.create_consultation(jsonb,uuid),private.edit_consultation(uuid,integer,jsonb) to authenticated;
grant execute on function public.touch_auth_session(),public.touch_session(),public.create_consultation(jsonb,uuid),public.edit_consultation(uuid,integer,jsonb) to authenticated;
grant execute on function private.consume_login_attempt(text),public.consume_login_attempt(text) to service_role;
grant execute on function private.finalize_password_change(uuid,uuid),public.finalize_password_change(uuid,uuid) to service_role;
commit;
