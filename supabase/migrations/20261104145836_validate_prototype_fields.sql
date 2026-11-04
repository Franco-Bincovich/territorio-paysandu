begin;
alter table public.prototype_parcels add constraint prototype_fields_strings check (
 coalesce(jsonb_typeof(payload->'id')='string',false) and
 coalesce(jsonb_typeof(payload->'localidad')='string',false) and
 coalesce(jsonb_typeof(payload->'address')='string',false) and
 coalesce(jsonb_typeof(payload->'area')='string',false) and
 coalesce(jsonb_typeof(payload->'built')='string',false) and
 coalesce(jsonb_typeof(payload->'detected')='string',false) and
 coalesce(jsonb_typeof(payload->'detectedPercent')='string',false) and
 coalesce(jsonb_typeof(payload->'zone')='string',false) and
 coalesce(jsonb_typeof(payload->'section')='string',false) and
 coalesce(jsonb_typeof(payload->'block')='string',false) and
 coalesce(jsonb_typeof(payload->'contact')='string',false) and
 coalesce(jsonb_typeof(payload->'document')='string',false) and
 coalesce(jsonb_typeof(payload->'phone')='string',false) and
 coalesce(jsonb_typeof(payload->'phone2')='string',false) and
 coalesce(jsonb_typeof(payload->'email')='string',false) and
 coalesce(jsonb_typeof(payload->'type')='string',false));
commit;
