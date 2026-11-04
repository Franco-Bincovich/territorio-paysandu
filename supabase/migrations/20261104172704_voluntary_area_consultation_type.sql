begin;
-- Extends accepted values only; no DML or changes to existing snapshots.
alter table public.consultations drop constraint consultations_type_check;
alter table public.consultations add constraint consultations_type_check check (type in ('General','Reclamo','Falta de documentación','Declaracion voluntaria de metros'));
create or replace function private.validate_payload(p jsonb) returns void language plpgsql immutable security invoker set search_path='' as $$
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
  if length(p->>'description') not between 20 and 10000 then raise exception 'INVALID_DESCRIPTION_LENGTH' using errcode='22023'; end if;
  if length(p->>'locality')>100 or length(p->>'parcel')>30 or p->>'parcel' !~ '^[0-9]+$' or p->>'type' not in ('General','Reclamo','Falta de documentación','Declaracion voluntaria de metros') then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
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
commit;
