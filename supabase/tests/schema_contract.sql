-- Read-only assertions after applying schema in an approved disposable database.
-- Functional multi-user tests are in tests/database, with auth fixture stubs.
begin;
do $$
declare t text;
begin
  foreach t in array array['profiles','consultations','contacts'] loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=t and c.relrowsecurity) then
      raise exception 'RLS missing: %',t;
    end if;
    if has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE') then
      raise exception 'Unexpected direct DML: %',t;
    end if;
    if has_table_privilege('anon','public.'||t,'SELECT') then
      raise exception 'Anonymous SELECT: %',t;
    end if;
  end loop;
  if has_function_privilege('anon','public.create_consultation(jsonb,uuid)','EXECUTE') then raise exception 'Anonymous mutation'; end if;
  if has_function_privilege('authenticated','public.consume_login_attempt(text)','EXECUTE') then raise exception 'Public limiter access'; end if;
  if has_function_privilege('authenticated','public.finalize_password_change(uuid,uuid)','EXECUTE') then raise exception 'Public password gate bypass'; end if;
  if not has_function_privilege('service_role','public.consume_login_attempt(text)','EXECUTE') then raise exception 'Missing server limiter access'; end if;
  if not exists(select 1 from pg_trigger where tgname='paysandu_password_changed' and not tgisinternal) then raise exception 'Missing password trigger'; end if;
end;
$$;
rollback;
