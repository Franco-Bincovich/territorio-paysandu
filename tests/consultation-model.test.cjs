require('./register-ts.cjs');
const { test }=require('node:test');
const assert=require('node:assert/strict');
const { randomUUID }=require('node:crypto');
const { parseInput,fingerprint,authorize,checkEvidence }=require('../Backend/server/consultations/model.ts');
const { ConsultationRepository }=require('../Backend/server/consultations/repository.ts');
const { institutionalVerifier }=require('../Backend/server/consultations/verification.ts');
const input=()=>({idempotencyKey:randomUUID(),parcel:{padCod:'900001',locality:'QA',parcel:'900002'},
  person:{name:'PERSONA QA',documentType:'RUT',document:'00.000.000.000-1'},relationship:{text:'DECLARACION QA'},
  phones:[{type:'CELULAR',value:'000123456'}],emails:['qa@example.test'],type:'GENERAL',description:'Descripción ficticia para validación aislada.'});
const actor=()=>({verified:true,userId:randomUUID(),role:'collaborator',enabled:true,mustChangePassword:false,expiresAt:Date.now()+60000});
const evidence=i=>({source:'institutional',verifiedAt:new Date().toISOString(),...i.parcel});
test('original document and leading zero retained; PadCod stays a string',()=>{
  const raw=input(), parsed=parseInput(raw);
  assert.equal(parsed.person.document,raw.person.document);assert.equal(parsed.person.normalizedDocument,'000000000001');
  assert.equal(typeof parsed.parcel.padCod,'string');
});
test('five complete contact slots accepted, overlength and empty contact arrays rejected',()=>{
  const raw=input();assert.equal(parseInput({...raw,phones:Array(5).fill(raw.phones[0])}).phones.length,5);
  assert.throws(()=>parseInput({...raw,phones:Array(6).fill(raw.phones[0])}));
  assert.throws(()=>parseInput({...raw,phones:[{type:'FIJO',value:'0'.repeat(31)}]}));
  assert.throws(()=>parseInput({...raw,emails:[]}));
});
test('address omission/empty fields create no record and canonical address ordering stabilizes fingerprint',()=>{
  const raw=input();assert.equal(parseInput({...raw,address:{CALLE:' '}}).address,null);
  assert.equal(fingerprint(parseInput({...raw,address:{CALLE:'QA',PUERTA:'1',LOCALIDAD:'PAYSANDU'}})),fingerprint(parseInput({...raw,address:{LOCALIDAD:'PAYSANDU',PUERTA:'1',CALLE:'QA'}})));
});
test('untrusted actor and institutional IDs cannot be smuggled in input',()=>{
  const raw=input();assert.throws(()=>parseInput({...raw,userId:randomUUID()}));
  assert.throws(()=>parseInput({...raw,person:{...raw.person,ID_PERSONA_CP:'900003'}}));
  assert.throws(()=>parseInput({...raw,parcel:{...raw.parcel,padCod:'90071992547409939999'}}));
});
test('sessions with wrong role, mandatory change or expiry are denied',()=>{
  const a=actor();authorize(a,Date.now());
  for(const override of [{role:'admin'},{verified:false},{mustChangePassword:true},{expiresAt:0}])assert.throws(()=>authorize({...a,...override},Date.now()));
});
test('institutional proof must match parcel, be current, and tie links/address to a person',()=>{
  const i=parseInput(input());checkEvidence(i,evidence(i),Date.now());
  for(const e of [{...evidence(i),padCod:'900009'},{...evidence(i),verifiedAt:'2000-01-01T00:00:00Z'},{...evidence(i),conCod:'900003'}])
    assert.throws(()=>checkEvidence(i,e,Date.now()));
});
test('verification failure is sanitized and occurs before any SQL connection',async()=>{
  let connected=false;const pool={getConnection:async()=>{connected=true;throw Error();}};
  const repo=new ConsultationRepository(pool,async()=>{throw Error('private driver diagnostic');});
  await assert.rejects(repo.create(input(),actor()),e=>e.status===503&&!e.message.includes('private'));
  assert.equal(connected,false);
});
test('missing migration marker fails closed with rollback and no business writes',async()=>{
  const calls=[];const c={query:async sql=>{calls.push(sql);return [];},beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:async()=>calls.push('release'),destroy:()=>{}};
  await assert.rejects(new ConsultationRepository({getConnection:async()=>c},async i=>evidence(i)).create(input(),actor()),e=>e.status===503);
  assert.ok(calls.includes('rollback'));assert.ok(!calls.includes('commit'));assert.ok(!calls.some(x=>/^(INSERT|UPDATE|DELETE)/.test(x)));
});
test('institutional verifier uses SELECT only, rejects ambiguous people and does not match names',async()=>{
  const calls=[];
  const read=async run=>run({query:async(sql,params)=>{calls.push({sql,params});assert.match(sql,/^SELECT /);
    if(sql.includes('AGM_CIU_PADRONES'))return [{PadCod:'900001'}];
    return [{ID_PERSONA_CP:'900003'},{ID_PERSONA_CP:'900004'}];}});
  await assert.rejects(institutionalVerifier(read)(parseInput(input())),e=>e.code==='AMBIGUOUS_INSTITUTIONAL_IDENTITY');
  assert.ok(calls[1].sql.includes("DOCUMENTO_VALIDO = 'SI'"));assert.ok(!calls.some(c=>c.sql.includes('NOMBRE_CP')));
  calls.length=0;
  const local=parseInput({...input(),person:{name:'PERSONA QA',documentType:'OTROS',document:'QA-LOCAL'}});
  const proof=await institutionalVerifier(read)(local);
  assert.equal(calls.length,1);assert.equal(proof.personId,undefined);
});

test('personal address requires street, Puerta and one approved locality; department is fixed',()=>{
 const raw=input(),address={CALLE:' CALLE QA ',PUERTA:' 42 ',LOCALIDAD:'Paysandú Chacras'};
 for(const key of ['CALLE','PUERTA','LOCALIDAD']){const a={...address};delete a[key];assert.throws(()=>parseInput({...raw,address:a}),e=>e.status===400);}
 for(const a of [{...address,LOCALIDAD:'OTRA'},{...address,DEPARTAMENTO:'OTRO'},{CALLE:'QA',NUMERO:'42',LOCALIDAD:'PAYSANDU'}])assert.throws(()=>parseInput({...raw,address:a}),e=>e.status===400);
 const parsed=parseInput({...raw,address:{...address,BLOCK:' ',DEPTO:null,CODIGO_POSTAL:null}}).address;
 assert.deepEqual(parsed,{CALLE:'CALLE QA',LOCALIDAD:'PAYSANDU CHACRAS',DEPARTAMENTO:'PAYSANDU',PUERTA:'42'});
});
test('address normalization has deterministic fingerprints and frontend follows the same optional rules',()=>{
 const {formPersonalAddress,addressFieldErrors}=require('../Frontend/src/components/consultation-validation.ts');
 const raw=input(),f=new FormData();assert.equal(formPersonalAddress(f),null);assert.deepEqual(addressFieldErrors(null),{});assert.deepEqual(require('../Backend/domain/personal-address.ts').personalAddressErrors({CALLE:null,PUERTA:null,LOCALIDAD:null}),{});
 f.set('address-CALLE','CALLE QA');assert.ok(addressFieldErrors(formPersonalAddress(f))['address-PUERTA']);assert.ok(addressFieldErrors(formPersonalAddress(f))['address-LOCALIDAD']);
 f.set('address-PUERTA','1');f.set('address-LOCALIDAD','PAYSANDU');assert.deepEqual(addressFieldErrors(formPersonalAddress(f)),{});
 assert.equal(fingerprint(parseInput({...raw,address:formPersonalAddress(f)})),fingerprint(parseInput({...raw,address:{CALLE:'CALLE QA',PUERTA:'1',LOCALIDAD:'Paysandú'}})));
});
test('retired address fields remain readable but cannot be written through web contract',()=>{
 const {webInput,view}=require('../Backend/server/consultations/contracts.ts');
 const body={person:{phones:[],phoneTypes:[]},address:{NUMERO:'OLD'}};assert.throws(()=>webInput(body),e=>e.status===400);
 const row={ID_CONSULTA:'1',PADCOD:'2',ID_PERSONA:'3',DOMICILIO_DECLARADO_JSON:JSON.stringify({NUMERO:'OLD',PH:'QA',REFERENCIA:'QA'})};assert.equal(view(row).address.NUMERO,'OLD');
});

test('institutional address evidence compares PUERTA without aliasing legacy NUMERO',async()=>{
 const inputValue=parseInput({...input(),address:{CALLE:'QA',PUERTA:'42',LOCALIDAD:'PAYSANDU'}});let addressSql='';
 const verify=institutionalVerifier(async run=>run({query:async(sql,params)=>{
  if(sql.includes('AGM_CIU_PADRONES'))return [{PadCod:inputValue.parcel.padCod}];
  if(sql.includes('SELECT DISTINCT ID_PERSONA_CP'))return [{ID_PERSONA_CP:'900201'}];
  if(sql.includes('AGM_CIU_DOMICILIOS')){addressSql=sql;assert.ok(params.includes('42'));return [{ID_DOMICILIO_CP:'900401'}];}
  return [];
 }}));assert.equal((await verify(inputValue)).addressId,'900401');assert.match(addressSql,/PUERTA <=> \?/);assert.doesNotMatch(addressSql,/NUMERO <=>/);
});
