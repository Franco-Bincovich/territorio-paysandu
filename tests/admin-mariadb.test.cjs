require('./register-ts.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {MariaAdminRepository}=require('../Backend/server/admin/mariadb-repository.ts');
const {AdminService}=require('../Backend/server/admin/service.ts');
const {HttpError}=require('../Backend/server/security.ts');
const actorId=randomUUID(),targetId=randomUUID();
const actor={verified:true,userId:actorId,role:'administrator',enabled:true,mustChangePassword:false,expiresAt:Date.now()+60000,sessionHash:'a'.repeat(64)};
const event={actorId,targetId,action:'update',result:'success',at:new Date().toISOString(),reason:'Cambio autorizado de rol',requestId:randomUUID()};
const columns={FB_USUARIOS:{USER_ID:'char',USERNAME:'varchar',ROLE:'varchar',ENABLED:'tinyint',MUST_CHANGE_PASSWORD:'tinyint',ADMIN_REVISION:'bigint',DELETED_AT:'datetime',FIRST_NAME:'varchar',LAST_NAME:'varchar',EMAIL:'varchar',CI:'varchar',USERNAME_KEY:'varbinary',EMAIL_KEY:'varbinary'},FB_USUARIOS_CREDENCIALES:{USER_ID:'char',PASSWORD_HASH:'varchar',CREATED_AT:'datetime',PASSWORD_UPDATED_AT:'datetime'},FB_USUARIOS_SESIONES:{USER_ID:'char',TOKEN_HASH:'char',REVOKED_AT:'datetime',EXPIRES_AT:'datetime',LAST_ACTIVITY_AT:'datetime'},TP_ADMIN_AUDIT_V1:{EVENT_ID:'char',ACTOR_ID:'varchar',TARGET_ID:'char',ACTION:'varchar',RESULT:'varchar',OCCURRED_AT:'datetime',REASON:'varchar',REQUEST_ID:'varchar',ERROR_CODE:'varchar',BEFORE_JSON:'longtext',AFTER_JSON:'longtext',ACTOR_USERNAME:'varchar',TARGET_USERNAME:'varchar'}};
const row=(id,role='administrator')=>({USER_ID:id,USERNAME:id===actorId?'fixture-admin':'fixture-target',ROLE:role,ENABLED:1,MUST_CHANGE_PASSWORD:0,ADMIN_REVISION:1,deleted_iso:null});
function mock(options={}){
 const calls=[],users=[row(actorId),row(targetId,'atencion_publico')];
 const c={query:async(sql,params=[])=>{
  calls.push({sql,params});
  if(sql.includes('SELECT DATABASE'))return [{database_name:'auxiliares'}];
  if(sql.includes('information_schema.TABLES'))return Object.keys(columns).map(TABLE_NAME=>({TABLE_NAME,ENGINE:options.badEngine?'MyISAM':'InnoDB'}));
  if(sql.includes('information_schema.COLUMNS'))return Object.entries(columns).flatMap(([TABLE_NAME,fields])=>Object.entries(fields).map(([COLUMN_NAME,DATA_TYPE])=>({TABLE_NAME,COLUMN_NAME,DATA_TYPE,CHARACTER_MAXIMUM_LENGTH:2000,IS_NULLABLE:['FIRST_NAME','LAST_NAME','EMAIL','CI','USERNAME_KEY','EMAIL_KEY','ACTOR_USERNAME','TARGET_USERNAME','DELETED_AT','REVOKED_AT','TARGET_ID','ERROR_CODE','BEFORE_JSON','AFTER_JSON'].includes(COLUMN_NAME)?'YES':'NO'})));
  if(sql.includes('information_schema.STATISTICS'))return [['FB_USUARIOS','USER_ID'],['FB_USUARIOS','USERNAME_KEY'],['FB_USUARIOS','EMAIL_KEY'],['FB_USUARIOS_CREDENCIALES','USER_ID'],['FB_USUARIOS_SESIONES','TOKEN_HASH'],['TP_ADMIN_AUDIT_V1','EVENT_ID']].map(([TABLE_NAME,columns_list])=>({TABLE_NAME,columns_list,NON_UNIQUE:0}));
  if(sql.includes('GET_LOCK')&&options.lockLost)throw Error('response lost');
  if(sql.includes('GET_LOCK'))return [{acquired:options.lockTimeout?0:1}];
  if(sql.includes('RELEASE_LOCK'))return [{released:options.releaseFailure?0:1}];
  if(sql.includes('USER_ID IN'))return sql.includes('CREDENCIALES')?users.map(x=>({USER_ID:x.USER_ID})):users;
  if(sql.includes('expires_ms'))return options.revoked?[]:[{expires_ms:Date.now()+60000}];
  if(sql.startsWith('INSERT INTO FB_USUARIOS'))return {affectedRows:1};
  if(sql.startsWith('UPDATE FB_USUARIOS_CREDENCIALES'))return {affectedRows:1};
  if(sql.startsWith('UPDATE FB_USUARIOS SET')){if(options.duplicate)throw Object.assign(new Error('SQL secret fixture'),{code:'ER_DUP_ENTRY'});return {affectedRows:options.stale?0:1};}
  if(sql.startsWith('INSERT INTO TP_ADMIN_AUDIT')){if(options.auditFailure)throw Error('SQL secret fixture');return {affectedRows:1};}
  if(sql.startsWith('SELECT USER_ID FROM FB_USUARIOS WHERE ROLE'))return options.lastAdmin?[]:[{USER_ID:actorId}];
  if(sql.includes('COUNT(*)'))return [{total:2}];
  if(sql.includes('FROM FB_USUARIOS WHERE USER_ID=?'))return users.filter(x=>x.USER_ID===params[0]);
  if(sql.includes('FROM FB_USUARIOS WHERE USERNAME_KEY=?'))return users.filter(x=>x.USERNAME===params[0].toString());
  if(sql.includes('FROM FB_USUARIOS WHERE EMAIL_KEY=?'))return [];
  if(sql.includes('FROM FB_USUARIOS'))return users;
  return [];
 },beginTransaction:async()=>calls.push('begin'),commit:async()=>{calls.push('commit');if(options.commitLost)throw Error('lost');},rollback:async()=>{calls.push('rollback');if(options.rollbackLost)throw Error('lost');},release:async()=>calls.push('release'),destroy:()=>calls.push('destroy')};
 return {repo:new MariaAdminRepository({getConnection:async()=>c}),calls,users};
}
test('Maria admin list binds literal search/pagination and keeps actor locks before session',async()=>{
 const {repo,calls}=mock();const service=new AdminService(repo);
 const result=await service.list(actor,{page:2,pageSize:1,q:"_%'",role:'atencion_publico',enabled:true},{requestId:event.requestId});
 assert.equal(result.total,2);
 const query=calls.find(x=>x.sql?.includes('ORDER BY USERNAME'));
 assert.deepEqual(query.params,[Buffer.from("_%'"),Buffer.from("_%'"),"_%'",'atencion_publico',1,1,1]);assert.match(query.sql,/COALESCE\(USERNAME_KEY/);
 assert.ok(calls.findIndex(x=>x.sql?.includes('CREDENCIALES WHERE USER_ID IN'))<calls.findIndex(x=>x.sql?.includes('expires_ms')));
 assert.ok(calls.findIndex(x=>x.sql?.startsWith('INSERT INTO TP_ADMIN_AUDIT'))<calls.indexOf('commit'));
});
test('Maria admin patch checks revision, revokes sessions and audits before commit',async()=>{
 const {repo,calls}=mock();const service=new AdminService(repo);
 const result=await service.patch(actor,targetId,{expectedRevision:1,role:'collaborator',reason:event.reason},{requestId:event.requestId});
 assert.equal(result.user.revision,2);
 const update=calls.find(x=>x.sql?.startsWith('UPDATE FB_USUARIOS SET'));
 assert.match(update.sql,/WHERE USER_ID=\? AND ADMIN_REVISION=\?/);assert.equal(update.params.at(-1),1);
 assert.ok(calls.findIndex(x=>x.sql?.startsWith('UPDATE FB_USUARIOS_SESIONES'))<calls.indexOf('commit'));
 assert.ok(calls.findIndex(x=>x.sql?.includes('RELEASE_LOCK'))>calls.indexOf('commit'));
});
test('Maria admin last-administrator check and audit failure roll back mutations',async()=>{
 for(const options of [{lastAdmin:true},{auditFailure:true},{stale:true}]){
  const {repo,calls}=mock(options);const service=new AdminService(repo);
  await assert.rejects(service.patch(actor,targetId,{expectedRevision:1,enabled:false,reason:event.reason},{requestId:event.requestId}),e=>e instanceof HttpError&&!e.message.includes('SQL secret'));
  assert.ok(calls.includes('rollback'));assert.ok(!calls.includes('commit'));
 }
});
test('Maria admin rejects revoked sessions before data mutations and records denial separately',async()=>{
 const {repo,calls}=mock({revoked:true});const service=new AdminService(repo);
 await assert.rejects(service.patch(actor,targetId,{expectedRevision:1,enabled:false,reason:event.reason},{requestId:event.requestId}),e=>e.code==='UNAUTHENTICATED');
 assert.ok(!calls.some(x=>x.sql?.startsWith('UPDATE')));
 const audit=calls.find(x=>x.sql?.startsWith('INSERT INTO TP_ADMIN_AUDIT'));assert.equal(audit.params[4],'denied');
 assert.ok(calls.indexOf('rollback')<calls.indexOf(audit));
});
test('Maria admin schema mismatch, lock timeout and duplicate names return controlled failures',async()=>{
 for(const [options,code] of [[{badEngine:true},'ADMIN_SCHEMA_INCOMPATIBLE'],[{lockTimeout:true},'ADMIN_BUSY'],[{duplicate:true},'IDENTITY_CONFLICT']]){
  const {repo}=mock(options);
  await assert.rejects(repo.transaction(actor,targetId,async tx=>{const old=await tx.get(targetId);await tx.put({...old,revision:2});}),e=>e.code===code&&!e.message.includes('SQL secret'));
 }
});
test('Maria admin credential persistence binds hashes only; release failure destroys connection',async()=>{
 const {repo}=mock();
 await assert.rejects(repo.transaction(actor,targetId,tx=>tx.credential(targetId,{passwordHash:'plain text'})),e=>e.code==='ADMIN_UNAVAILABLE');
 await repo.transaction(actor,targetId,tx=>tx.credential(targetId,{passwordHash:'$argon2id$synthetic'}));
 const broken=mock({releaseFailure:true});assert.equal(await broken.repo.transaction(actor,null,async()=>'confirmed'),'confirmed');assert.ok(broken.calls.includes('destroy'));
 const prior=mock({releaseFailure:true});await assert.rejects(prior.repo.transaction(actor,null,async()=>{throw new HttpError(409,'VERSION_CONFLICT','Conflict');}),e=>e.code==='VERSION_CONFLICT');assert.ok(prior.calls.includes('destroy'));
});
test('Maria admin audit snapshots omit hashes tokens and arbitrary extra properties',async()=>{
 const {repo,calls}=mock();const publicUser={id:targetId,username:'fixture',role:'atencion_publico',enabled:true,mustChangePassword:false,revision:1,passwordHash:'hidden-secret',token:'hidden-token'};
 await repo.transaction(actor,targetId,tx=>tx.audit({...event,before:publicUser,after:publicUser}));
 const insert=calls.find(x=>x.sql?.startsWith('INSERT INTO TP_ADMIN_AUDIT'));assert.doesNotMatch(JSON.stringify(insert.params),/hidden-secret|hidden-token|passwordHash/);
});

test('Maria admin destroys uncertain connections and never reports a confirmed rollback or commit',async()=>{
 for(const [options,operation,code] of [
  [{commitLost:true},async()=>null,'ADMIN_COMMIT_UNCERTAIN'],
  [{rollbackLost:true},async()=>{throw new HttpError(409,'VERSION_CONFLICT','Conflict');},'ADMIN_UNAVAILABLE'],
  [{lockLost:true},async()=>null,'ADMIN_UNAVAILABLE'],
 ]){
  const {repo,calls}=mock(options);await assert.rejects(repo.transaction(actor,null,operation),e=>e.code===code);
  assert.ok(calls.includes('destroy'));
 }
});

test('Maria admin successful commit survives lock cleanup failure without false denial',async()=>{
 const {repo,calls}=mock({releaseFailure:true});const service=new AdminService(repo);
 const result=await service.patch(actor,targetId,{expectedRevision:1,role:'collaborator',reason:event.reason},{requestId:event.requestId});
 assert.equal(result.user.revision,2);assert.ok(calls.includes('commit'));assert.ok(calls.includes('destroy'));
 const audits=calls.filter(x=>x.sql?.startsWith('INSERT INTO TP_ADMIN_AUDIT'));
 assert.equal(audits.length,1);assert.equal(audits[0].params[4],'success');
});


test('Maria admin create writes user and Argon2 credential with DB timestamps before success audit',async()=>{
 const {repo,calls}=mock(),service=new AdminService(repo,Date.now,async()=>'$argon2id$synthetic');
 const result=await service.create(actor,{firstName:'Persona',lastName:'QA',email:'fixture@example.test',username:'new.fixture',role:'atencion_publico',reason:event.reason,temporalPassword:'Rio claro terreno 8462',confirmPassword:'Rio claro terreno 8462'},'',{requestId:event.requestId});
 assert.equal(result.user.mustChangePassword,true);
 const credentials=calls.find(x=>x.sql?.startsWith('INSERT INTO FB_USUARIOS_CREDENCIALES'));
 assert.match(credentials.sql,/PASSWORD_UPDATED_AT/);assert.match(credentials.sql,/UTC_TIMESTAMP/);assert.equal(credentials.params[1],'$argon2id$synthetic');
 assert.ok(calls.indexOf(credentials)<calls.findIndex(x=>x.sql?.startsWith('INSERT INTO TP_ADMIN_AUDIT')));
 assert.doesNotMatch(JSON.stringify(calls),/Rio claro/);
});
