-- Pure-function acceptance/rejection checks: does not write business data.
DO $qa$
declare
  p jsonb := '{"locality":"Paysandú","parcel":"17718","type":"General","description":"Prueba sintética de validación sin escrituras.","person":{"name":"PERSONA QA","relationship":"Titular","documentType":"CI","document":"00000001","phones":["099123456","024123456","099654321"],"phoneTypes":["Celular","Fijo","Celular"],"emails":["qa1@example.test","qa2@example.test","qa3@example.test"]}}';
  candidate jsonb;
begin
  perform private.validate_payload(p);
  perform private.validate_payload(p #- '{person,phoneTypes}');
  perform private.validate_payload(jsonb_set(p,'{person,document}','"0.000.001-2"'));
  perform private.validate_payload(jsonb_set(jsonb_set(p,'{person,documentType}','"RUT"'),'{person,document}','"001234567890"'));
  perform private.validate_payload(jsonb_set(jsonb_set(p,'{person,documentType}','"Otros"'),'{person,document}','"PAS-ABC.123"'));
  for candidate in
    select value from jsonb_array_elements(jsonb_build_array(
      jsonb_set(p,'{person,phones}','["099123456","099123456","099123456","099123456"]'),
      jsonb_set(p,'{person,emails}','["a@b.test","a@b.test","a@b.test","a@b.test"]'),
      jsonb_set(p,'{person,emails}','["a b@c.test"]'),
      jsonb_set(p,'{person,emails}','["a@b"]'),
      jsonb_set(p,'{person,document}','"123456"'),
      jsonb_set(p,'{person,document}','"123456789"'),
      jsonb_set(p,'{person,document}','"123 4567"'),
      jsonb_set(jsonb_set(p,'{person,documentType}','"RUT"'),'{person,document}','"12345678901"'),
      jsonb_set(p,'{person,phoneTypes}','["Celular"]'),
      jsonb_set(p,'{person,phoneTypes}','["Celular","Otro","Fijo"]'),
      jsonb_set(p,'{person,phoneTypes}','null')
    ))
  loop
    begin
      perform private.validate_payload(candidate);
      raise exception 'QA_EXPECTED_REJECTION';
    exception when sqlstate '22023' then null;
    end;
  end loop;
end;
$qa$;

