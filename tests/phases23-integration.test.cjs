require('./register-ts.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createMariaHttp}=require('../Backend/server/mariadb/http.ts');
const {RequestLimits,MemoryQuotaStore}=require('../Backend/server/request-limits.ts');
const {HttpError}=require('../Backend/server/security.ts');
const {routeTemplate,currentRequestId}=require('../Backend/server/observability.ts');
const origin='http://127.0.0.1:3000';
const request=(path,method='GET',body)=>new Request(`${origin}/api/${path}`,{method,headers:{origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const identity=()=>({id:randomUUID(),username:'fixture',role:'administrator',enabled:true,mustChangePassword:false,sessionExpiresAt:Date.now()+60000,sessionHash:'a'.repeat(64)});
const limits=()=>new RequestLimits(new MemoryQuotaStore(),{});

test('new route templates are parameterized and document listing precedes legacy parcel matching',()=>{
 for(const [path,template] of [
  ['admin/users','/api/admin/users'],['admin/users/private-id','/api/admin/users/{id}'],
  ['admin/users/private-id/reset-password','/api/admin/users/{id}/reset-password'],
  ['parcels/123/expedientes','/api/parcels/{padCod}/expedientes'],
  ['expedientes/private-id/contenido','/api/expedientes/{id}/contenido'],
  ['expedientes/private-id/descarga','/api/expedientes/{id}/descarga'],
 ])assert.equal(routeTemplate(path.split('/')),template);
});

test('HTTP integration derives principal from session only and supplies internal request correlation',async()=>{
 const user=identity();let captured,correlation;
 const handler=createMariaHttp({identify:async()=>user},origin,undefined,undefined,limits(),async(req,segments,actor)=>{
  captured=actor;correlation=currentRequestId();return Response.json({ok:true});
 });
 const response=await handler(request('admin/users','POST',{role:'collaborator',actor:{userId:'forged'}}),['admin','users']);
 assert.equal(response.status,200);assert.equal(captured.userId,user.id);assert.equal(captured.role,'administrator');
 assert.equal(captured.sessionHash,user.sessionHash);assert.equal(response.headers.get('x-request-id'),correlation);
});

test('new endpoints never invoke adapters for unauthenticated or password-restricted sessions',async()=>{
 for(const code of ['UNAUTHENTICATED','PASSWORD_CHANGE_REQUIRED']){
  let calls=0;const adapter=async()=>{calls++;return Response.json({});};
  const handler=createMariaHttp({identify:async()=>{throw new HttpError(code==='UNAUTHENTICATED'?401:403,code,'Acceso denegado');}},origin,undefined,undefined,limits(),adapter,adapter);
  for(const path of ['admin/users','parcels/1/expedientes','expedientes/x/contenido','expedientes/x/descarga']){
   const response=await handler(request(path),path.split('/'));
   assert.equal(response.status,code==='UNAUTHENTICATED'?401:403);
  }
  assert.equal(calls,0);
 }
});

test('new endpoints retain origin and method protection before adapter dispatch',async()=>{
 let calls=0;const adapter=async()=>{calls++;return Response.json({});};
 const handler=createMariaHttp({identify:async()=>identity()},origin,undefined,undefined,limits(),adapter,adapter);
 const wrongOrigin=new Request(`${origin}/api/admin/users`,{method:'POST',headers:{origin:'https://evil.invalid'}});
 assert.equal((await handler(wrongOrigin,['admin','users'])).status,403);
 const method=await handler(request('expedientes/x/descarga','DELETE'),['expedientes','x','descarga']);
 assert.equal(method.status,405);assert.equal(method.headers.get('allow'),'GET');assert.equal(calls,0);
});

test('session response allowlist never exposes the internal hash',async()=>{
 const handler=createMariaHttp({identify:async()=>identity()},origin,undefined,undefined,limits());
 const result=await handler(request('session'),['session']);
 const body=await result.json();assert.equal(body.user.role,'administrator');
 assert.doesNotMatch(JSON.stringify(body),/sessionHash|passwordHash|tokenHash/);
});

test('admin password work shares authentication concurrency and has distinct actor budgets',async()=>{
 const limiter=limits(),post=request('admin/users','POST',{});
 const first=await limiter.enter(request('auth/login','POST',{}),['auth','login']);
 const second=await limiter.enter(post,['admin','users']);
 await assert.rejects(limiter.enter(post,['admin','users','id','reset-password']),e=>e.status===429);
 first();second();const third=await limiter.enter(post,['admin','users']);third();
 const id=randomUUID();for(let n=0;n<3;n++)await limiter.user(id,post,['admin','users']);
 await assert.rejects(limiter.user(id,post,['admin','users']),e=>e.status===429);
 await limiter.user(id,request('admin/users'),['admin','users']);
});

test('legacy provider cannot enter administration or document adapters',async()=>{
 const previous=process.env.AUTH_PROVIDER;process.env.AUTH_PROVIDER='supabase';
 try{
  const {dispatch}=require('../Backend/server/auth-dispatch.ts');
  for(const path of ['admin/users','parcels/1/expedientes','expedientes/x/contenido']){
   const response=await dispatch(request(path),path.split('/'));
   assert.equal(response.status,403);assert.equal((await response.json()).error.code,'FORBIDDEN');
  }
 }finally{if(previous===undefined)delete process.env.AUTH_PROVIDER;else process.env.AUTH_PROVIDER=previous;}
});
