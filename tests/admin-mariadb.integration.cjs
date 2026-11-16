// Opt-in SQL integration, exclusively through scripts/test-admin-mariadb.cjs.
// The runner creates a new container and marker; no application .env is loaded.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const enabled=process.env.TP_ADMIN_ISOLATED_RUN==='1';

test('MariaDB 11.8.9 disposable administration integration',{skip:!enabled},async t=>{
 require('./register-ts.cjs');
 const mariadb=require('mariadb');
 const {MariaAdminRepository}=require('../Backend/server/admin/mariadb-repository.ts');
 const {AdminService}=require('../Backend/server/admin/service.ts');
 const config=JSON.parse(process.env.TP_ADMIN_ISOLATED_CONFIG??'{}');
 assert.equal(config.host,'127.0.0.1');assert.equal(config.database,'auxiliares');
 assert.match(config.marker??'',/^[a-f0-9-]{36}$/);assert.ok(Number.isInteger(config.port)&&config.port>0&&config.port<=65535);
 const {marker,...connectionConfig}=config;
 const pool=mariadb.createPool({...connectionConfig,connectionLimit:8,multipleStatements:false,queryTimeout:5000,acquireTimeout:5000});
 const query=(sql,params=[])=>pool.query(sql,params);
 async function guard(){
  assert.match((await query('SELECT VERSION() AS version'))[0].version,/^11\.8\.9-MariaDB/);
  const rows=await query('SELECT MARKER FROM TP_QA_DISPOSABLE_GUARD');
  assert.equal(rows.length,1);assert.equal(rows[0].MARKER,marker);
 }
 const repository=new MariaAdminRepository(pool),service=new AdminService(repository);
 const reason='Prueba sintética aislada de administración';
 const context=()=>({requestId:randomUUID()});
 let actors,users;
 async function seed(){
  await guard();
  for(const table of ['TP_ADMIN_AUDIT_V1','FB_USUARIOS_SESIONES','FB_USUARIOS_CREDENCIALES','FB_USUARIOS'])await query(`DELETE FROM ${table}`);
  actors=[];users=[];
  for(const [index,role] of ['administrator','administrator','atencion_publico','collaborator'].entries()){
   const id=randomUUID(),username=`qa_person_${index}`,sessionHash=createHash('sha256').update(randomBytes(32)).digest('hex');
   await query('INSERT INTO FB_USUARIOS (USER_ID,USERNAME,USERNAME_KEY,ROLE,ENABLED,MUST_CHANGE_PASSWORD) VALUES (?,?,?,?,1,0)',[id,username,username.toLowerCase(),role]);
   await query('INSERT INTO FB_USUARIOS_CREDENCIALES (USER_ID,PASSWORD_HASH) VALUES (?,?)',[id,'synthetic-hash-never-real']);
   await query(`INSERT INTO FB_USUARIOS_SESIONES (SESSION_ID,USER_ID,TOKEN_HASH,CREATED_AT,LAST_ACTIVITY_AT,EXPIRES_AT)
     VALUES (?,?,?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),TIMESTAMPADD(HOUR,1,UTC_TIMESTAMP(6)))`,[randomUUID(),id,sessionHash]);
   const actor={verified:true,userId:id,role,enabled:true,mustChangePassword:false,expiresAt:Date.now()+3600000,sessionHash};
   users.push({id,username});actors.push(actor);
  }
 }
 try{
  await guard();
  await t.test('list pagination, parameterized filters and sanitized audit',async()=>{
   await seed();
   const result=await service.list(actors[0],{page:1,pageSize:2,q:'qa_person'},context());
   assert.equal(result.total,4);assert.equal(result.items.length,2);
   assert.doesNotMatch(JSON.stringify(result),/synthetic-hash|passwordHash|TOKEN_HASH/);
   const exact=await service.list(actors[0],{page:1,pageSize:20,q:'qa_person_2',role:'atencion_publico'},context());
   assert.equal(exact.total,1);assert.equal(exact.items[0].id,users[2].id);
   const injection=await service.list(actors[0],{page:1,pageSize:20,q:"' OR 1=1 --"},context());assert.equal(injection.total,0);
   const events=await service.auditLog(actors[0],{page:1,pageSize:20,q:''},context());
   assert.ok(events.items.length>=3);assert.doesNotMatch(JSON.stringify(events),/synthetic-hash|passwordHash|TOKEN_HASH/);
  });
  await t.test('same-revision concurrent edits commit once and audit denial separately',async()=>{
   await seed();
   const results=await Promise.allSettled([
    service.patch(actors[0],users[2].id,{expectedRevision:1,username:'qa_renamed_a'},context()),
    service.patch(actors[1],users[2].id,{expectedRevision:1,username:'qa_renamed_b'},context()),
   ]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   assert.equal(results.find(r=>r.status==='rejected').reason.code,'VERSION_CONFLICT');
   const row=(await query('SELECT ADMIN_REVISION FROM FB_USUARIOS WHERE USER_ID=?',[users[2].id]))[0];assert.equal(Number(row.ADMIN_REVISION),2);
   const events=await query('SELECT RESULT FROM TP_ADMIN_AUDIT_V1 WHERE TARGET_ID=?',[users[2].id]);
   assert.deepEqual(events.map(e=>e.RESULT).sort(),['denied','success']);
  });
  await t.test('simultaneous self-demotions cannot remove the last active administrator',async()=>{
   await seed();
   const results=await Promise.allSettled([0,1].map(index=>service.patch(actors[index],users[index].id,{expectedRevision:1,role:'atencion_publico'},context())));
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   assert.equal(results.find(r=>r.status==='rejected').reason.code,'LAST_ADMIN_REQUIRED');
   assert.equal(Number((await query("SELECT COUNT(*) AS n FROM FB_USUARIOS WHERE ROLE='administrator' AND ENABLED=1 AND DELETED_AT IS NULL"))[0].n),1);
  });
  await t.test('disable, role change and logical deletion revoke sessions and retain identity',async()=>{
   await seed();
   await service.patch(actors[0],users[2].id,{expectedRevision:1,enabled:false},context());
   await service.patch(actors[0],users[3].id,{expectedRevision:1,role:'atencion_publico'},context());
   const removed=await service.remove(actors[0],users[1].id,{expectedRevision:1},context());
   assert.equal(removed.user.enabled,false);assert.ok(removed.user.deletedAt);
   assert.equal(Number((await query('SELECT COUNT(*) AS n FROM FB_USUARIOS'))[0].n),4);
   for(const user of users.slice(1))assert.equal(Number((await query('SELECT COUNT(*) AS n FROM FB_USUARIOS_SESIONES WHERE USER_ID=? AND REVOKED_AT IS NULL',[user.id]))[0].n),0);
   await assert.rejects(service.patch(actors[0],users[1].id,{expectedRevision:2,enabled:true},context()),error=>error.code==='USER_DELETED');
  });
  await t.test('revoked and disabled actors cannot use a stale in-memory administrator principal',async()=>{
   await seed();
   await query('UPDATE FB_USUARIOS_SESIONES SET REVOKED_AT=UTC_TIMESTAMP(6) WHERE TOKEN_HASH=?',[actors[1].sessionHash]);
   await assert.rejects(service.patch(actors[1],users[2].id,{expectedRevision:1,enabled:false},context()),error=>[401,403].includes(error.status));
   await query('UPDATE FB_USUARIOS SET ENABLED=0 WHERE USER_ID=?',[actors[0].userId]);
   await assert.rejects(service.list(actors[0],{page:1,pageSize:20,q:''},context()),error=>[401,403].includes(error.status));
   assert.equal(Number((await query('SELECT ADMIN_REVISION FROM FB_USUARIOS WHERE USER_ID=?',[users[2].id]))[0].ADMIN_REVISION),1);
  });
  await t.test('uniqueness conflicts preserve user state and failed transaction rolls back audit',async()=>{
   await seed();
   await assert.rejects(service.patch(actors[0],users[2].id,{expectedRevision:1,username:users[3].username},context()),error=>error.code==='USERNAME_CONFLICT');
   await assert.rejects(repository.transaction(actors[0],users[2].id,async tx=>{
    const user=await tx.get(users[2].id);await tx.put({...user,enabled:false,revision:2});
    await tx.audit({actorId:actors[0].userId,targetId:users[2].id,action:'update',result:'success',at:new Date().toISOString(),reason,requestId:randomUUID()});
    throw new Error('SYNTHETIC_ABORT');
   }));
   assert.equal(Number((await query('SELECT ADMIN_REVISION FROM FB_USUARIOS WHERE USER_ID=?',[users[2].id]))[0].ADMIN_REVISION),1);
   assert.equal(Number((await query("SELECT COUNT(*) AS n FROM TP_ADMIN_AUDIT_V1 WHERE RESULT='success'"))[0].n),0);
  });
  await t.test('manual temporary credentials persist only Argon2id and reset atomically',async()=>{
   await seed();
   const argon2=require('argon2');
   const temporalPassword=randomBytes(24).toString('base64url');
   const input={username:'qa_new',role:'atencion_publico',firstName:'Persona',lastName:'Ficticia QA',email:'qa-new@example.test',temporalPassword,confirmPassword:temporalPassword};
   const created=await service.create(actors[0],input,randomUUID(),context());
   assert.equal(created.user.mustChangePassword,true);assert.doesNotMatch(JSON.stringify(created),new RegExp(temporalPassword));
   const credential=(await query('SELECT PASSWORD_HASH FROM FB_USUARIOS_CREDENCIALES WHERE USER_ID=?',[created.user.id]))[0];
   assert.match(credential.PASSWORD_HASH,/^\$argon2id\$/);assert.equal(await argon2.verify(credential.PASSWORD_HASH,temporalPassword),true);
   await assert.rejects(service.create(actors[0],input,randomUUID(),context()),error=>error.code==='USERNAME_CONFLICT');
   const reset=await service.reset(actors[0],users[2].id,{expectedRevision:1,temporalPassword,confirmPassword:temporalPassword},randomUUID(),context());
   assert.equal(reset.user.mustChangePassword,true);assert.equal(reset.user.revision,2);
   assert.equal(Number((await query('SELECT COUNT(*) AS n FROM FB_USUARIOS_SESIONES WHERE USER_ID=? AND REVOKED_AT IS NULL',[users[2].id]))[0].n),0);
   await assert.rejects(service.reset(actors[0],users[2].id,{expectedRevision:1,temporalPassword,confirmPassword:temporalPassword},randomUUID(),context()),error=>error.code==='VERSION_CONFLICT');
   const events=await query('SELECT BEFORE_JSON,AFTER_JSON,REASON FROM TP_ADMIN_AUDIT_V1');
   assert.ok(!JSON.stringify(events).includes(temporalPassword));assert.doesNotMatch(JSON.stringify(events),/argon2id|PASSWORD_HASH/);
  });
  await t.test('audit persistence failure rolls back user update and records only rejection',async()=>{
   await seed();
   await query("ALTER TABLE TP_ADMIN_AUDIT_V1 ADD CONSTRAINT CHK_QA_REJECT_UPDATE_SUCCESS CHECK(NOT(ACTION='update' AND RESULT='success'))");
   try{
    await assert.rejects(service.patch(actors[0],users[2].id,{expectedRevision:1,enabled:false},context()),error=>error.status===503);
    const row=(await query('SELECT ENABLED,ADMIN_REVISION FROM FB_USUARIOS WHERE USER_ID=?',[users[2].id]))[0];
    assert.equal(Number(row.ENABLED),1);assert.equal(Number(row.ADMIN_REVISION),1);
    assert.equal(Number((await query('SELECT COUNT(*) AS n FROM FB_USUARIOS_SESIONES WHERE USER_ID=? AND REVOKED_AT IS NULL',[users[2].id]))[0].n),1);
    const events=await query('SELECT RESULT FROM TP_ADMIN_AUDIT_V1');assert.deepEqual(events.map(event=>event.RESULT),['denied']);
   }finally{await query('ALTER TABLE TP_ADMIN_AUDIT_V1 DROP CONSTRAINT CHK_QA_REJECT_UPDATE_SUCCESS');}
  });
  await t.test('profiles enforce canonical uniqueness and deleted identity can be recreated without restoring history',async()=>{
   await seed();
   const temporalPassword=randomBytes(24).toString('base64url');
   const input={username:'Jimena.QA',firstName:'Jimena',lastName:'Ficticia',email:'Jimena.QA@example.test',role:'collaborator',temporalPassword,confirmPassword:temporalPassword};
   const first=await service.create(actors[0],input,'',context());
   assert.equal(first.user.username,'Jimena.QA');assert.equal(first.user.firstName,'Jimena');assert.equal(first.user.ci,null);
   const {MariaAuthStore}=require('../Backend/server/mariadb/store.ts');const store=new MariaAuthStore(pool);
   for(const name of ['Jimena.QA','jimena.qa','JIMENA.QA'])assert.equal((await store.findUser(name)).id,first.user.id);
   const argon2=require('argon2'),credential=(await query('SELECT PASSWORD_HASH FROM FB_USUARIOS_CREDENCIALES WHERE USER_ID=?',[first.user.id]))[0];
   assert.equal(await argon2.verify(credential.PASSWORD_HASH,temporalPassword),true);
   assert.equal(await argon2.verify(credential.PASSWORD_HASH,temporalPassword.toUpperCase()),false);
   await assert.rejects(service.create(actors[0],{...input,username:'JIMENA.QA',email:'other@example.test'},'',context()),e=>e.code==='USERNAME_CONFLICT');
   await assert.rejects(service.create(actors[0],{...input,username:'other.qa',email:'JIMENA.QA@EXAMPLE.TEST'},'',context()),e=>e.code==='EMAIL_CONFLICT');
   const edited=await service.patch(actors[0],first.user.id,{expectedRevision:1,firstName:'Jimena editada',ci:'1.234.567-8',role:'atencion_publico'},context());
   assert.equal(edited.user.firstName,'Jimena editada');assert.equal(edited.user.ci,'12345678');
   const removed=await service.remove(actors[0],first.user.id,{expectedRevision:2},context());assert.ok(removed.user.deletedAt);
   const active=await service.list(actors[0],{page:1,pageSize:50,q:'Jimena.QA'},context());assert.equal(active.total,0);
   const second=await service.create(actors[0],input,'',context());assert.notEqual(second.user.id,first.user.id);assert.equal(second.user.mustChangePassword,true);
   assert.equal((await store.findUser('JIMENA.QA')).id,second.user.id);
   const raced=await Promise.allSettled([
    service.create(actors[0],{...input,username:'Raced.QA',email:'race-a@example.test'},'',context()),
    service.create(actors[1],{...input,username:'RACED.QA',email:'race-b@example.test'},'',context()),
   ]);
   assert.equal(raced.filter(x=>x.status==='fulfilled').length,1);
   assert.equal(raced.find(x=>x.status==='rejected').reason.code,'USERNAME_CONFLICT');
   const old=(await query('SELECT USERNAME,DELETED_AT,USERNAME_KEY,EMAIL_KEY FROM FB_USUARIOS WHERE USER_ID=?',[first.user.id]))[0];
   assert.equal(old.USERNAME,'Jimena.QA');assert.ok(old.DELETED_AT);assert.equal(old.USERNAME_KEY,null);assert.equal(old.EMAIL_KEY,null);
   const audit=await service.auditLog(actors[0],{page:1,pageSize:50,q:''},context());
   const history=audit.items.filter(e=>e.targetId===first.user.id);assert.ok(history.length>=3);
   assert.ok(history.every(e=>e.targetUsername==='Jimena.QA'));
   assert.ok(history.every(e=>e.actorUsername===users[0].username));
   assert.ok(history.every(e=>e.reason&&!e.reason.includes(temporalPassword)));assert.doesNotMatch(JSON.stringify(history),/PASSWORD_HASH|argon2id/);
  });
  await t.test('revocation while operation waits for admin serialization prevents the mutation',async()=>{
   await seed();
   const blocker=await pool.getConnection();
   let pending;
   try{
    assert.equal(Number((await blocker.query("SELECT GET_LOCK('tp.auxiliares.admin.v1',3) AS acquired"))[0].acquired),1);
    pending=service.patch(actors[0],users[2].id,{expectedRevision:1,enabled:false},context());
    // Catch promptly to avoid an unhandled rejection if a slow machine exceeds lock timeout.
    const settled=pending.then(value=>({value}),error=>({error}));
    await query('UPDATE FB_USUARIOS_SESIONES SET REVOKED_AT=UTC_TIMESTAMP(6) WHERE TOKEN_HASH=?',[actors[0].sessionHash]);
    await blocker.query("SELECT RELEASE_LOCK('tp.auxiliares.admin.v1')");
    const result=await settled;assert.ok(result.error);assert.equal(result.error.status,401);
    assert.equal(Number((await query('SELECT ADMIN_REVISION FROM FB_USUARIOS WHERE USER_ID=?',[users[2].id]))[0].ADMIN_REVISION),1);
   }finally{await blocker.query("SELECT RELEASE_LOCK('tp.auxiliares.admin.v1')");await blocker.release();}
  });
 }finally{await pool.end();}
});
