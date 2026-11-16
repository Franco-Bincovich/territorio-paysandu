require('./register-ts.cjs');
require.extensions['.css']=()=>{};
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {writesRequested,createConsultationHttp}=require('../Backend/server/consultations/http.ts');
const {webInput,view}=require('../Backend/server/consultations/contracts.ts');
const {parseInput}=require('../Backend/server/consultations/model.ts');
const {requireCompatibility}=require('../Backend/server/consultations/schema.ts');
const {renderToStaticMarkup}=require('react-dom/server');
const React=require('react');
const {ConsultationForm}=require('../Frontend/src/components/consultation-form.tsx');
const actor={verified:true,userId:randomUUID(),role:'collaborator',enabled:true,mustChangePassword:false,expiresAt:Date.now()+60000};
const body=()=>({idempotencyKey:randomUUID(),padCod:'900001',locality:'LOCALIDAD QA',parcel:'900002',person:{name:'QA',documentType:'CI',document:'0.000.001-2',relationship:'Presentante',phones:['000123456'],phoneTypes:['Celular'],emails:['qa@example.test']},type:'General',description:'Una descripción sintética para prueba.',address:{CALLE:'QA',PUERTA:'1',LOCALIDAD:'PAYSANDU'}});
test('consultation writes require all explicit local test flags and are off in production',()=>{
  const env={NODE_ENV:'development',AUTH_PROVIDER:'mariadb-test',MARIADB_AUTH_TEST_ENABLED:'true',INSTITUTIONAL_ENABLED:'true',CONSULTATIONS_WRITE_ENABLED:'true'};
  assert.equal(writesRequested(env),true);
  for(const key of Object.keys(env))assert.equal(writesRequested({...env,[key]:key==='NODE_ENV'?'production':'false'}),false);
  assert.equal(writesRequested({}),false);
});
test('web translation preserves normalized identity, address, phone types and safe BIGINT strings',()=>{
  const input=parseInput(webInput(body()));assert.equal(input.person.normalizedDocument,'00000012');assert.equal(input.address.PUERTA,'1');assert.equal(input.phones[0].type,'CELULAR');
  const row={ID_CONSULTA:9007199254740993n,PADCOD:9007199254740995n,ID_PERSONA:9007199254740997n,TIPO_DOCUMENTO:'OTROS',DOMICILIO_DECLARADO_JSON:'{"NUMERO":"1"}'};
  assert.equal(view(row).id,'9007199254740993');assert.equal(view(row).padCod,'9007199254740995');assert.equal(view(row).person.localPersonId,'9007199254740997');
  assert.throws(()=>webInput({...body(),person:{...body().person,verified:true}}));
  assert.throws(()=>parseInput(webInput({...body(),person:{...body().person,phoneTypes:[]}})));
});
test('capabilities and mutations fail closed on metadata mismatch or unavailable schema',async()=>{
  let writes=0;
  const handler=createConsultationHttp({create:async()=>{writes++;}},{},()=>requireCompatibility({getConnection:async()=>{throw Error('sensitive');}}),()=>true);
  await assert.rejects(handler(new Request('http://local/api/consultations',{method:'POST'}),['consultations'],actor),e=>e.status===503&&!e.message.includes('sensitive'));
  assert.equal(writes,0);
});
test('session/role guard runs before schema or repository work',async()=>{
  let touched=false;
  const handler=createConsultationHttp({}, {},async()=>{touched=true;},()=>true);
  for(const patch of [{verified:false},{expiresAt:0},{enabled:false},{mustChangePassword:true}])await assert.rejects(handler(new Request('http://local/api/consultations'),['consultations'],{...actor,...patch}));
  assert.equal(touched,false);
});
test('institutional form starts blocked and serializes all optional personal address slots',()=>{
  const html=renderToStaticMarkup(React.createElement(ConsultationForm,{parcel:{padCod:'900001',locality:'QA',parcel:'900002',address:''},onSaved:()=>{}}));
  for(const field of ['CALLE','PUERTA','LOCALIDAD','LOTE'])assert.ok(html.includes('name="address-'+field+'"'));
  assert.match(html,/no está habilitado o el modelo no está verificado/);
  assert.match(html,/<button[^>]*disabled[^>]*>Registrar consulta/);
  assert.ok(!html.includes('MARIADB_PASSWORD'));
});
