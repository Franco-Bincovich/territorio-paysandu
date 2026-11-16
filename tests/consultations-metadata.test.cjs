require('./register-ts.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {readSchema}=require('../Backend/server/consultations/schema.ts');
test('restricted trigger metadata uses a fixed view only when explicitly enabled',async()=>{
 for(const [env,view] of [[{},false],[{CONSULTATIONS_SCHEMA_METADATA_VIEW:'true'},true]]){
  const queries=[];const result=await readSchema({query:async sql=>{queries.push(sql);return [];}},env);
  assert.equal(queries.some(q=>q.includes('FROM TP_CONSULTATION_TRIGGERS_V1')),view);
  assert.equal(queries.some(q=>q.includes('FROM information_schema.TRIGGERS')),!view);
  assert.equal(queries.some(q=>q.includes('FROM TP_CONSULTATION_CONSTRAINTS_V1')),view);
  assert.equal(queries.some(q=>q.includes('FROM TP_CONSULTATION_REFERENCES_V1')),view);
  assert.deepEqual(result.triggers,[]);assert.equal(queries.length,8);
 }
});
test('missing restricted metadata view rejects without falling back to incomplete metadata',async()=>{
 let direct=false;
 await assert.rejects(readSchema({query:async sql=>{
  if(sql.includes('FROM TP_CONSULTATION_TRIGGERS_V1'))throw Error('missing view');
  if(sql.includes('FROM information_schema.TRIGGERS'))direct=true;
  return [];
 }},{CONSULTATIONS_SCHEMA_METADATA_VIEW:'true'}),/missing view/);
 assert.equal(direct,false);
});
