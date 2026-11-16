require('./register-ts.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {AdminService}=require('../Backend/server/admin/service.ts');
const {createAdminHttp,configuredAdminHttp}=require('../Backend/server/admin/http.ts');
const {parseRole,canEditConsultation,requireCapability}=require('../Backend/server/authorization.ts');
const {listQuery,createInput,patchInput}=require('../Backend/server/admin/contracts.ts');
const {createMariaAuth,hashPassword,tokenHash}=require('../Backend/server/mariadb/auth.ts');
const profile={firstName:'Persona',lastName:'Ficticia',email:'qa-profile@example.test'};
const temporary={temporalPassword:'Rio claro terreno 8462',confirmPassword:'Rio claro terreno 8462'};
const now=Date.now(),context={requestId:randomUUID()},reason='Cambio solicitado de prueba';
function fixture(){
  const admin={id:randomUUID(),username:'admin.test',role:'administrator',enabled:true,mustChangePassword:false,revision:1};
  const other={id:randomUUID(),username:'other.test',role:'administrator',enabled:true,mustChangePassword:false,revision:1};
  const collaborator={id:randomUUID(),username:'collaborator.test',role:'collaborator',enabled:true,mustChangePassword:false,revision:1};
  const principal=user=>({verified:true,userId:user.id,role:user.role,enabled:user.enabled,mustChangePassword:user.mustChangePassword,expiresAt:now+3600000,sessionHash:user.id});
  let state={users:new Map([admin,other,collaborator].map(u=>[u.id,u])),sessions:new Set([admin.id,other.id,collaborator.id]),credentials:new Map(),audits:[]};
  let queue=Promise.resolve(),auditFailure=false;
  const repository={
    async transaction(actor,target,run){let release;const prior=queue;queue=new Promise(r=>release=r);await prior;const draft=structuredClone(state);
      const tx={principal:async a=>{const u=draft.users.get(a.userId);return u&&draft.sessions.has(a.sessionHash)?principal(u):null;},get:async id=>draft.users.get(id)??null,
        findUsername:async name=>[...draft.users.values()].find(u=>!u.deletedAt&&u.username.normalize('NFKC').toLowerCase()===name.normalize('NFKC').toLowerCase())??null,
        findEmail:async email=>[...draft.users.values()].find(u=>!u.deletedAt&&u.email?.toLowerCase()===email.toLowerCase())??null,
        list:async q=>{const rows=[...draft.users.values()].filter(u=>(q.deleted||!u.deletedAt)&&u.username.toLowerCase().includes(q.q.toLowerCase())&&(q.role===undefined||u.role===q.role)&&(q.enabled===undefined||u.enabled===q.enabled)).sort((a,b)=>a.username.localeCompare(b.username)||a.id.localeCompare(b.id));return {items:rows.slice((q.page-1)*q.pageSize,q.page*q.pageSize),total:rows.length};},
        listAudit:async q=>({items:draft.audits.slice((q.page-1)*q.pageSize,q.page*q.pageSize),total:draft.audits.length}),
        put:async u=>draft.users.set(u.id,u),activeAdministrators:async()=>[...draft.users.values()].filter(u=>u.role==='administrator'&&u.enabled&&!u.deletedAt).length,
        revokeSessions:async id=>draft.sessions.delete(id),credential:async(id,c)=>draft.credentials.set(id,c),
        audit:async e=>{if(auditFailure)throw Error('private database error');draft.audits.push(e);}};
      try{const result=await run(tx);state=draft;return result;}finally{release();}
    },denied:async e=>state.audits.push(e)
  };
  const service=new AdminService(repository,()=>now,async secret=>{assert.equal(secret,temporary.temporalPassword);return '$argon2id$test-only-hash';});
  return {admin,other,collaborator,actor:principal(admin),principal,repository,service,get state(){return state;},failAudit(){auditFailure=true;}};
}
const rejectsCode=(promise,code)=>assert.rejects(promise,e=>e.code===code);
test('central roles reject unknown values and enforce collaborator ownership',()=>{
  const f=fixture();assert.equal(parseRole('administrator'),'administrator');assert.throws(()=>parseRole('admin'));assert.throws(()=>requireCapability(f.actor,'unknown'));
  assert.equal(canEditConsultation(f.actor,f.collaborator.id),true);assert.equal(canEditConsultation(f.principal(f.collaborator),f.admin.id),false);assert.equal(canEditConsultation(f.principal(f.collaborator),f.collaborator.id),true);
});
test('admin contract strictly validates role, fields, booleans and pagination',()=>{
  for(const q of ['page=0','pageSize=51','q=a&q=b','enabled=1','role=admin','page=100001&pageSize=50','extra=yes'])assert.throws(()=>listQuery(new URLSearchParams(q)));
  assert.equal(createInput({...profile,username:'  ABC.Test ',role:'collaborator',reason,...temporary}).username,'ABC.Test');
  assert.throws(()=>createInput({...profile,username:'test',role:'root',reason,...temporary}));assert.throws(()=>createInput({...profile,username:'test',role:'collaborator',reason,enabled:true}));assert.throws(()=>patchInput({expectedRevision:1,reason,enabled:'false'}));
});
test('collaborator cannot enumerate users or create them',async()=>{
  const f=fixture();await rejectsCode(f.service.list(f.principal(f.collaborator),listQuery(new URLSearchParams()),context),'FORBIDDEN');
  await rejectsCode(f.service.create(f.principal(f.collaborator),{},randomUUID(),context),'FORBIDDEN');
});
test('list pagination, search and public DTO never expose secrets',async()=>{
  const f=fixture();f.state.users.get(f.admin.id).passwordHash='private';const r=await f.service.list(f.actor,listQuery(new URLSearchParams('q=admin&pageSize=1')),context);assert.equal(r.total,1);assert.equal(r.items.length,1);assert.equal(JSON.stringify(r).includes('private'),false);
});
test('manual temporary create stores hash only, mandates change and rejects repeat by username',async()=>{
 const f=fixture(),input={...profile,username:' New.Test ',role:'collaborator',reason,...temporary};
 const result=await f.service.create(f.actor,input,'',context);
 assert.equal(result.user.username,'New.Test');assert.equal(result.user.mustChangePassword,true);
 assert.equal(f.state.users.size,4);assert.deepEqual(f.state.credentials.get(result.user.id),{passwordHash:'$argon2id$test-only-hash'});
 assert.doesNotMatch(JSON.stringify(result),/argon2|Rio claro|encryptedDelivery/);
 assert.doesNotMatch(JSON.stringify(f.state.audits),/Rio claro|passwordHash/);
 await rejectsCode(f.service.create(f.actor,input,'',context),'USERNAME_CONFLICT');assert.equal(f.state.credentials.size,1);
});

test('unique canonical username conflict rolls back',async()=>{
  const f=fixture();await rejectsCode(f.service.create(f.actor,{...profile,username:'ADMIN.TEST',role:'collaborator',reason,...temporary},randomUUID(),context),'USERNAME_CONFLICT');assert.equal(f.state.users.size,3);assert.equal(f.state.credentials.size,0);
});
test('concurrent canonical username creation commits only once',async()=>{
  const f=fixture(),input={...profile,username:'concurrent.test',role:'collaborator',reason,...temporary};const results=await Promise.allSettled([f.service.create(f.actor,input,randomUUID(),context),f.service.create(f.actor,input,randomUUID(),context)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'USERNAME_CONFLICT');assert.equal(f.state.credentials.size,1);
});
test('concurrent password resets with stale revision commit one credential',async()=>{
  const f=fixture(),input={expectedRevision:1,reason,...temporary};const results=await Promise.allSettled([f.service.reset(f.actor,f.collaborator.id,input,randomUUID(),context),f.service.reset(f.actor,f.collaborator.id,input,randomUUID(),context)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'VERSION_CONFLICT');assert.equal(f.state.users.get(f.collaborator.id).revision,2);assert.equal(f.state.credentials.size,1);
});
test('username changes increment revision and revoke sessions; stale edits conflict',async()=>{
  const f=fixture();const r=await f.service.patch(f.actor,f.collaborator.id,{expectedRevision:1,reason,username:'new.name'},context);assert.equal(r.user.revision,2);assert.equal(r.requiresLogin,false);assert.equal(f.state.sessions.has(f.collaborator.id),false);await rejectsCode(f.service.patch(f.actor,f.collaborator.id,{expectedRevision:1,reason,enabled:false},context),'VERSION_CONFLICT');
});
test('role change and disable each revoke all target sessions',async()=>{
  for(const change of [{role:'administrator'},{enabled:false}]){const f=fixture();await f.service.patch(f.actor,f.collaborator.id,{expectedRevision:1,reason,...change},context);assert.equal(f.state.sessions.has(f.collaborator.id),false);}
});
test('no-op audits the request without changing revision or revoking sessions',async()=>{
  const f=fixture();await f.service.patch(f.actor,f.collaborator.id,{expectedRevision:1,reason,enabled:true},context);assert.equal(f.state.users.get(f.collaborator.id).revision,1);assert.equal(f.state.sessions.has(f.collaborator.id),true);assert.equal(f.state.audits.length,1);assert.deepEqual(f.state.audits[0].before,f.state.audits[0].after);
});
test('last active administrator is protected with rollback',async()=>{
  const f=fixture();f.state.users.get(f.other.id).enabled=false;await rejectsCode(f.service.patch(f.actor,f.admin.id,{expectedRevision:1,reason,role:'collaborator'},context),'LAST_ADMIN_REQUIRED');assert.equal(f.state.users.get(f.admin.id).role,'administrator');assert.equal(f.state.sessions.has(f.admin.id),true);
});
test('concurrent administrator self-demotions leave one active administrator',async()=>{
  const f=fixture();const results=await Promise.allSettled([f.service.patch(f.actor,f.admin.id,{expectedRevision:1,reason,role:'collaborator'},context),f.service.patch(f.principal(f.other),f.other.id,{expectedRevision:1,reason,role:'collaborator'},context)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal([...f.state.users.values()].filter(u=>u.role==='administrator'&&u.enabled&&!u.deletedAt).length,1);
});
test('revoked or demoted actor is revalidated inside transaction',async()=>{
  const f=fixture();f.state.sessions.delete(f.actor.sessionHash);await rejectsCode(f.service.patch(f.actor,f.collaborator.id,{expectedRevision:1,reason,enabled:false},context),'UNAUTHENTICATED');assert.equal(f.state.users.get(f.collaborator.id).enabled,true);
});
test('manual reset revokes sessions, requires change, preserves disabled state and rejects stale replay',async()=>{
 const f=fixture();f.state.users.get(f.collaborator.id).enabled=false;
 const input={expectedRevision:1,reason,...temporary},r=await f.service.reset(f.actor,f.collaborator.id,input,'',context);
 assert.equal(r.user.enabled,false);assert.equal(r.user.mustChangePassword,true);assert.equal(f.state.sessions.has(f.collaborator.id),false);
 assert.doesNotMatch(JSON.stringify(r),/Rio claro|passwordHash|credentialDelivery/);
 await rejectsCode(f.service.reset(f.actor,f.collaborator.id,input,'',context),'VERSION_CONFLICT');assert.equal(f.state.users.get(f.collaborator.id).revision,2);
});

test('audit failure rolls back user, credential and revocation',async()=>{
  const f=fixture();f.failAudit();await rejectsCode(f.service.reset(f.actor,f.collaborator.id,{expectedRevision:1,reason,...temporary},randomUUID(),context),'ADMIN_UNAVAILABLE');assert.equal(f.state.users.get(f.collaborator.id).revision,1);assert.equal(f.state.credentials.size,0);assert.equal(f.state.sessions.has(f.collaborator.id),true);assert.equal(f.state.audits[0].result,'denied');assert.equal(JSON.stringify(f.state.audits).includes('private database'),false);
});
test('manual temporary contract requires confirmation and policy with no mutation',async()=>{
 const f=fixture();
 for(const change of [{temporalPassword:'short',confirmPassword:'short'},{confirmPassword:'different'},{temporalPassword:undefined}]){
  await assert.rejects(f.service.create(f.actor,{...profile,username:'new',role:'collaborator',reason,...temporary,...change},'',context),e=>e.status===400);
 }
 assert.equal(f.state.users.size,3);assert.equal(f.state.credentials.size,0);
});

test('HTTP endpoints enforce authorization, safe headers and create/reset status codes',async()=>{
  const f=fixture(),http=createAdminHttp(f.service),request=(method,path,body)=>new Request('https://test/api/'+path,{method,headers:{'Content-Type':'application/json','Idempotency-Key':randomUUID()},...(body?{body:JSON.stringify(body)}:{})});
  await rejectsCode(http(request('GET','admin/users'),['admin','users'],f.principal(f.collaborator)),'FORBIDDEN');
  const created=await http(request('POST','admin/users',{...profile,username:'http.test',role:'collaborator',reason,...temporary}),['admin','users'],f.actor);assert.equal(created.status,201);assert.equal(created.headers.get('Cache-Control'),'private, no-store');
  const reset=await http(request('POST','admin/users/'+f.collaborator.id+'/reset-password',{expectedRevision:1,reason,...temporary}),['admin','users',f.collaborator.id,'reset-password'],f.actor);assert.equal(reset.status,202);
  const method=await http(request('DELETE','admin/users'),['admin','users'],f.actor);assert.equal(method.status,405);assert.equal(method.headers.get('Allow'),'GET, POST');
});
test('configured administration honors explicit enablement and composes the supplied repository',async()=>{
  const f=fixture(),request=new Request('https://test/api/admin/users');
  await rejectsCode(configuredAdminHttp(f.repository,{})(request,['admin','users'],f.actor),'ADMIN_DISABLED');
  const active=configuredAdminHttp(f.repository,{ADMINISTRATION_ENABLED:'true'});
  const response=await active(request,['admin','users'],f.actor);assert.equal(response.status,200);assert.equal((await response.json()).items.length,3);
  const caps=await active(new Request('https://test/api/admin/capabilities'),['admin','capabilities'],f.actor);
  assert.deepEqual((await caps.json()).users,{list:true,edit:true,delete:true,create:true,resetPassword:true});
});
test('authentication accepts both roles, rejects unknown roles, keeps temporary credentials valid and revokes password sessions',async()=>{
  const password='Fictitious-password-123',passwordHash=await hashPassword(password),users=new Map(),sessions=new Map();
  for(const role of ['administrator','collaborator','unknown'])users.set(role,{id:randomUUID(),username:role,role,enabled:true,mustChangePassword:false,passwordHash});
  const store={reserveAttempt:async()=>true,findUser:async name=>users.get(name)??null,issueSession:async s=>{sessions.set(s.tokenHash,s);return true;},sessionWithUser:async hash=>{const session=sessions.get(hash);return session?{session,user:[...users.values()].find(u=>u.id===session.userId)}:null;},revokeSession:async hash=>sessions.delete(hash),changePassword:async(hash,expected,next)=>{const session=sessions.get(hash),u=[...users.values()].find(u=>u.id===session?.userId);if(!u||u.passwordHash!==expected)return false;u.passwordHash=next;u.mustChangePassword=false;for(const [key,s] of sessions)if(s.userId===u.id)sessions.delete(key);return true;}};
  const auth=await createMariaAuth(store,()=>now);
  for(const role of ['administrator','collaborator']){const login=await auth.login(role,password);assert.equal(login.user.role,role);assert.equal((await auth.identify(login.token)).role,role);assert.equal((await auth.identify(login.token)).sessionHash,tokenHash(login.token));}
  await rejectsCode(auth.login('unknown',password),'INVALID_LOGIN');const invalidSession=await auth.login('collaborator',password);users.get('collaborator').role='unknown';await rejectsCode(auth.identify(invalidSession.token),'FORBIDDEN');const admin=users.get('administrator');admin.mustChangePassword=true;assert.equal((await auth.login('administrator',password)).mustChangePassword,true);
  const login=await auth.login('administrator',password);await rejectsCode(auth.identify(login.token),'PASSWORD_CHANGE_REQUIRED');await auth.changePassword(login.token,password,'New-fictitious-password-123','New-fictitious-password-123');await rejectsCode(auth.identify(login.token),'UNAUTHENTICATED');assert.equal(admin.mustChangePassword,false);
});
test('atencion_publico cannot administer and is accepted for create and role changes',async()=>{
  const f=fixture(),publicActor={...f.principal(f.collaborator),role:'atencion_publico'};
  await rejectsCode(f.service.list(publicActor,listQuery(new URLSearchParams()),context),'FORBIDDEN');
  const created=await f.service.create(f.actor,{...profile,username:'public.test',role:'atencion_publico',reason,...temporary},randomUUID(),context);
  assert.equal(created.user.role,'atencion_publico');
  const updated=await f.service.patch(f.actor,f.collaborator.id,{expectedRevision:1,reason,role:'atencion_publico'},context);
  assert.equal(updated.user.role,'atencion_publico');assert.equal(f.state.sessions.has(f.collaborator.id),false);
});
test('soft deletion retains identity, disables account, revokes sessions and audits atomically',async()=>{
  const f=fixture(),old={...f.collaborator};const r=await f.service.remove(f.actor,old.id,{expectedRevision:1,reason},context);
  assert.equal(f.state.users.size,3);assert.equal(r.user.id,old.id);assert.equal(r.user.username,old.username);
  assert.equal(r.user.enabled,false);assert.equal(r.user.deletedAt,new Date(now).toISOString());assert.equal(r.user.revision,2);
  assert.equal(f.state.sessions.has(old.id),false);assert.equal(f.state.audits.at(-1).action,'delete');
  await rejectsCode(f.service.patch(f.actor,old.id,{expectedRevision:2,reason,enabled:true},context),'USER_DELETED');
  await rejectsCode(f.service.reset(f.actor,old.id,{expectedRevision:2,reason,...temporary},randomUUID(),context),'USER_DELETED');
  const recreated=await f.service.create(f.actor,{...profile,username:old.username,role:'atencion_publico',...temporary},randomUUID(),context);assert.notEqual(recreated.user.id,old.id);assert.equal(recreated.user.mustChangePassword,true);
});
test('soft deletion protects last admin and rolls back on audit failure',async()=>{
  const f=fixture();f.state.users.get(f.other.id).enabled=false;
  await rejectsCode(f.service.remove(f.actor,f.admin.id,{expectedRevision:1,reason},context),'LAST_ADMIN_REQUIRED');
  assert.equal(f.state.users.get(f.admin.id).enabled,true);assert.equal(f.state.users.get(f.admin.id).deletedAt,undefined);
  f.failAudit();await rejectsCode(f.service.remove(f.actor,f.collaborator.id,{expectedRevision:1,reason},context),'ADMIN_UNAVAILABLE');
  assert.equal(f.state.users.get(f.collaborator.id).enabled,true);assert.equal(f.state.sessions.has(f.collaborator.id),true);
});
test('HTTP DELETE performs soft deletion; administrative audit is scoped and sanitized',async()=>{
  const f=fixture(),http=createAdminHttp(f.service);
  const response=await http(new Request('https://test/api/admin/users/'+f.collaborator.id,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:1,reason})}),['admin','users',f.collaborator.id],f.actor);
  assert.equal(response.status,200);assert.equal((await response.json()).user.enabled,false);
  f.state.audits[0].passwordHash='secret';f.state.audits[0].after.passwordHash='secret';
  const audit=await http(new Request('https://test/api/admin/audit'),['admin','audit'],f.actor);
  assert.equal(audit.status,200);const result=await audit.json();assert.equal(result.items[0].action,'delete');assert.equal(JSON.stringify(result).includes('secret'),false);
  await rejectsCode(http(new Request('https://test/api/admin/audit'),['admin','audit'],f.principal(f.collaborator)),'FORBIDDEN');
});


test('manual credential operations revalidate session before hashing and commit',async()=>{
 const f=fixture();let hashed=0;const service=new AdminService(f.repository,()=>now,async()=>{hashed++;return '$argon2id$test';});
 f.state.sessions.delete(f.actor.sessionHash);
 await rejectsCode(service.create(f.actor,{...profile,username:'new',role:'atencion_publico',reason,...temporary},'',context),'UNAUTHENTICATED');
 assert.equal(hashed,0);assert.equal(f.state.credentials.size,0);
 const g=fixture();const racing=new AdminService(g.repository,()=>now,async()=>{g.state.sessions.delete(g.actor.sessionHash);return '$argon2id$test';});
 await rejectsCode(racing.reset(g.actor,g.collaborator.id,{expectedRevision:1,reason,...temporary},'',context),'UNAUTHENTICATED');
 assert.equal(g.state.credentials.size,0);assert.equal(g.state.users.get(g.collaborator.id).revision,1);
});

test('HTTP invalid contracts are audited once without storing untrusted body secrets',async()=>{
 const f=fixture(),http=createAdminHttp(f.service);
 await rejectsCode(http(new Request('https://test/api/admin/users/'+f.collaborator.id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:1,reason,enabled:false,password:'not-to-log'})}),['admin','users',f.collaborator.id],f.actor),'VALIDATION');
 assert.equal(f.state.audits.length,1);assert.equal(f.state.audits[0].code,'VALIDATION');assert.doesNotMatch(JSON.stringify(f.state.audits),/not-to-log|password/);
 const before=f.state.audits.length;
 await rejectsCode(http(new Request('https://test/api/admin/users'),['admin','users'],f.principal(f.collaborator)),'FORBIDDEN');
 assert.equal(f.state.audits.length,before+1);
});
test('outer HTTP RBAC persists a denied administration audit without invoking user operations',async()=>{
 const {createMariaHttp}=require('../Backend/server/mariadb/http.ts');
 const f=fixture(),origin='http://127.0.0.1:3000',user=f.collaborator;
 const handler=createMariaHttp({identify:async()=>({id:user.id,username:user.username,role:user.role,enabled:true,mustChangePassword:false,sessionExpiresAt:now+60000,sessionHash:user.id})},origin,undefined,undefined,{enter:async()=>()=>{},user:async()=>{}},createAdminHttp(f.service));
 const response=await handler(new Request(origin+'/api/admin/users'),['admin','users']);
 assert.equal(response.status,403);assert.equal(f.state.audits.length,1);assert.equal(f.state.audits[0].actorId,user.id);assert.equal(f.state.audits[0].code,'FORBIDDEN');
});


test('schema incompatibility and uncertain commits retain diagnostics without false denied audit',async()=>{
 const {HttpError}=require('../Backend/server/security.ts');
 for(const code of ['ADMIN_SCHEMA_INCOMPATIBLE','ADMIN_COMMIT_UNCERTAIN']){
  let audits=0;const repository={transaction:async()=>{throw new HttpError(503,code,'Estado no disponible');},denied:async()=>{audits++;throw Error('must not attempt unavailable or ambiguous audit');}};
  const f=fixture(),http=createAdminHttp(new AdminService(repository));
  await rejectsCode(http(new Request('https://test/api/admin/users'),['admin','users'],f.actor),code);assert.equal(audits,0);
 }
});


test('HTTP sanitizes unexpected transaction failures and records a single rejection',async()=>{
 const f=fixture();let denials=0;
 const repository={transaction:async()=>{throw Error('private SQL diagnostic');},denied:async event=>{denials++;assert.equal(event.code,'ADMIN_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(event),/private SQL/);}};
 const http=createAdminHttp(new AdminService(repository));
 await rejectsCode(http(new Request('https://test/api/admin/users'),['admin','users'],f.actor),'ADMIN_UNAVAILABLE');assert.equal(denials,1);
});


test('credential audit redacts a manually repeated temporary password from reason',async()=>{
 const f=fixture();await f.service.create(f.actor,{...profile,username:'redacted',role:'atencion_publico',reason:'Se asigna '+temporary.temporalPassword,...temporary},'',context);
 assert.doesNotMatch(JSON.stringify(f.state.audits),/Rio claro/);
});


test('manual create uses real Argon2id and never persists the supplied plaintext',async()=>{
 const f=fixture(),service=new AdminService(f.repository,()=>now);
 const result=await service.create(f.actor,{...profile,username:'real.hash.fixture',role:'atencion_publico',reason,...temporary},'',context);
 const credential=f.state.credentials.get(result.user.id);assert.match(credential.passwordHash,/^\$argon2id\$/);
 assert.equal(await require('argon2').verify(credential.passwordHash,temporary.temporalPassword),true);
 assert.deepEqual(Object.keys(credential),['passwordHash']);assert.doesNotMatch(JSON.stringify([...f.state.users,...f.state.credentials,...f.state.audits]),/Rio claro/);
});
test('credential write failure cannot leave a newly created account partially successful',async()=>{
 const f=fixture();const repository={...f.repository,transaction:(actor,target,run)=>f.repository.transaction(actor,target,tx=>run({...tx,credential:async()=>{throw Error('private failure');}}))};
 const service=new AdminService(repository,()=>now,async()=>'$argon2id$test');
 await rejectsCode(service.create(f.actor,{...profile,username:'failed.fixture',role:'atencion_publico',reason,...temporary},'',context),'ADMIN_UNAVAILABLE');
 assert.equal(f.state.users.size,3);assert.equal(f.state.credentials.size,0);assert.equal(f.state.audits.filter(e=>e.result==='success').length,0);
});




test('new profiles require name surname and unique normalized email while legacy role edits preserve nulls',async()=>{
 const f=fixture();
 await rejectsCode(f.service.create(f.actor,{username:'missing.profile',role:'collaborator',...temporary},'',context),'VALIDATION');
 const a=await f.service.create(f.actor,{...profile,username:'Profile.User',role:'atencion_publico',...temporary},'',context);
 assert.equal(a.user.firstName,profile.firstName);assert.equal(a.user.ci,null);
 await rejectsCode(f.service.create(f.actor,{...profile,email:'QA-PROFILE@EXAMPLE.TEST',username:'Other.User',role:'collaborator',...temporary},'',context),'EMAIL_CONFLICT');
 const patched=await f.service.patch(f.actor,f.collaborator.id,{expectedRevision:1,role:'atencion_publico'},context);
 assert.equal(patched.user.firstName,null);assert.equal(f.state.audits.at(-1).reason,'Cambio de rol');
 assert.equal(f.state.audits.at(-1).actorUsername,'admin.test');
 assert.equal(f.state.audits.at(-1).targetUsername,'collaborator.test');
});
test('profile text, email, CI and username limits are validated without inventing historical profile data',()=>{
 const input={...profile,username:'Jimena',role:'collaborator',...temporary};
 assert.equal(createInput({...input,ci:'1.234.567-8'}).ci,'12345678');
 for(const ci of ['..1234567','123----4567','123','abc'])assert.throws(()=>createInput({...input,ci}));
 for(const email of ['bad','a@b','a\nb@example.test'])assert.throws(()=>createInput({...input,email}));
 assert.throws(()=>createInput({...input,username:'𐐀'.repeat(60)}));
 assert.equal(createInput({...input,username:'𐐀'.repeat(40)}).username.length,80);
});
