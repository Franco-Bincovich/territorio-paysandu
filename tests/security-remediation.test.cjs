require('./register-ts.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID,randomBytes}=require('node:crypto');
const {RequestLimits,MemoryQuotaStore,RedisQuotaStore,LimitError}=require('../Backend/server/request-limits.ts');
const {createMariaHttp}=require('../Backend/server/mariadb/http.ts');
const {ConsultationReads,historyQuery,historySnapshot}=require('../Backend/server/consultations/reads.ts');
const {createConsultationHttp}=require('../Backend/server/consultations/http.ts');
const {structuredLogger}=require('../Backend/server/observability.ts');
const origin='http://127.0.0.1:3105';
const request=(path='search',method='GET',body)=>new Request(origin+'/api/'+path,{method,headers:{host:'127.0.0.1:3105',origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
test('atomic token buckets recover with time and do not consume unrelated quotas on denial',async()=>{
 let now=0;const store=new MemoryQuotaStore(()=>now),r={key:'q',capacity:2,period:1000,cost:1};
 assert.equal(await store.consume([r]),0);assert.equal(await store.consume([r]),0);assert.equal(await store.consume([r]),1);
 assert.equal(await store.consume([r,{...r,key:'untouched'}]),1);assert.equal(await store.consume([{...r,key:'untouched',cost:2}]),0);now=1000;assert.equal(await store.consume([r]),0);
});
test('distinct unknown login accounts are limited before the authentication adapter; Retry-After and recovery',async()=>{
 let now=0,calls=0;const limits=new RequestLimits(new MemoryQuotaStore(()=>now),{});
 const handler=createMariaHttp({login:async()=>{calls++;const e=new Error();e.status=401;throw e;}},origin,undefined,undefined,limits);
 for(let i=0;i<10;i++)await handler(request('auth/login','POST',{username:'unknown'+i,password:randomBytes(16).toString('hex')}),['auth','login']);
 const denied=await handler(request('auth/login','POST',{username:'other',password:'not-real'}),['auth','login']);assert.equal(denied.status,429);assert.ok(Number(denied.headers.get('retry-after'))>0);assert.equal(calls,10);
 now+=60000;await handler(request('auth/login','POST',{username:'fresh',password:'not-real'}),['auth','login']);assert.equal(calls,11);
});
test('expensive authentication has bounded inflight work, no waiting queue, released after failure',async()=>{
 const limits=new RequestLimits(new MemoryQuotaStore(),{});const r=request('auth/login','POST',{});
 const releases=await Promise.all([limits.enter(r,['auth','login']),limits.enter(r,['auth','login'])]);await assert.rejects(limits.enter(r,['auth','login']),e=>e instanceof LimitError);releases.forEach(f=>f());const release=await limits.enter(r,['auth','login']);release();release();
});
test('search/user, writes and image byte reservations are enforced before private adapters',async()=>{
 const limits=new RequestLimits(new MemoryQuotaStore(()=>0),{});let calls=0;const actor={id:randomUUID(),role:'collaborator',enabled:true,mustChangePassword:false};
 const handler=createMariaHttp({identify:async()=>actor},origin,async()=>{calls++;return Response.json({});},undefined,limits);
 for(let i=0;i<60;i++)assert.equal((await handler(request(),['search'])).status,200);
 assert.equal((await handler(request(),['search'])).status,429);assert.equal(calls,60);
 const imageUser=randomUUID();for(let i=0;i<10;i++)await limits.user(imageUser,request('parcel-image/historical'),['parcel-image','historical']);await assert.rejects(limits.user(imageUser,request(),['parcel-image','historical']),e=>e.status===429);
 const writer=randomUUID();for(let i=0;i<10;i++)await limits.user(writer,request('consultations','POST',{}),['consultations']);await assert.rejects(limits.user(writer,request('consultations','POST',{}),['consultations']),e=>e.status===429);
});
test('production rejects missing proxy identity and does not trust arbitrary forwarded IP; Redis plaintext rejected',async()=>{
 const secret=randomBytes(32).toString('hex'),limits=new RequestLimits(new MemoryQuotaStore(),{NODE_ENV:'production',SECURITY_PROXY_SECRET:secret});
 await assert.rejects(limits.enter(request(),['search']),e=>e.status===403);
 const trusted=new Request(origin+'/api/search',{headers:{'x-tp-proxy-token':secret,'x-tp-client-ip':'192.0.2.1','x-forwarded-for':'192.0.2.99'}});(await limits.enter(trusted,['search']))();
 await assert.rejects(new RedisQuotaStore({NODE_ENV:'production',SECURITY_REDIS_HOST:'127.0.0.1',SECURITY_REDIS_USER:'qa',SECURITY_REDIS_PASSWORD:secret,SECURITY_REDIS_TLS:'false'}).consume([{key:'x',capacity:1,period:1000,cost:1}]),e=>e.status===503);
});
test('history cursor covers all versions without duplicates, with bounded SQL and sanitized snapshots',async()=>{
 const actor={verified:true,userId:randomUUID(),role:'collaborator',enabled:true,mustChangePassword:false,expiresAt:Date.now()+60000};const versions=Array.from({length:103},(_,i)=>103-i);let queries=0;
 const reads=new ConsultationReads({getConnection:async()=>({query:async(sql,p)=>{
  if(sql.includes('FROM FB_CONSULTAS_HISTORIAL')){queries++;assert.match(sql,/ORDER BY h.VERSION DESC LIMIT \?/);const cursor=p.length===3?Number(p[1]):Infinity;return versions.filter(v=>v<cursor).slice(0,p.at(-1)).map(VERSION=>({VERSION,DATOS_NUEVOS:{nombre_completo:'QA',actualiza_contacto:1,referencias_cp_json:{private:'not returned'},domicilio_declarado_json:{CALLE:'QA',secret:'not returned'}},DATOS_ANTERIORES:null}));}
  if(sql.includes('SELECT q.*'))return [{ID_CONSULTA:'1',PADCOD:'2',ID_PERSONA:'3',VERSION:103,TIPO_DOCUMENTO:'OTROS'}];return [];
 },rollback:async()=>{},release:async()=>{}})});
 const all=[];let cursor;do{const query=new URLSearchParams({historyPageSize:'20'});if(cursor)query.set('historyBefore',cursor);const r=await reads.detail('1',actor,query);assert.ok(r.history.length<=20);assert.equal(r.history[0].after.actualiza_contacto,undefined);assert.deepEqual(r.history[0].after.domicilio_declarado_json,{CALLE:'QA'});all.push(...r.history.map(h=>h.version));cursor=r.historyPagination.nextBeforeVersion;}while(cursor);
 assert.deepEqual(all,versions);assert.equal(queries,6);assert.equal(historySnapshot(null),null);
 for(const q of ['unexpected=x','historyPageSize=51','historyPageSize=1&historyPageSize=2','historyBefore=0'])assert.throws(()=>historyQuery(new URLSearchParams(q)));
 const h=createConsultationHttp({},reads,async()=>{},()=>true);await assert.rejects(h(request('consultations/1?unexpected=x'),['consultations','1'],actor),e=>e.status===400);
});
test('telemetry only emits generated correlation, template, status and duration, never inbound content',()=>{
 const old=console.info,events=[];console.info=x=>events.push(JSON.parse(x));try{structuredLogger({event:'http.request.completed',requestId:randomUUID(),route:'/api/search',status:429,durationMs:1,password:'DO_NOT_LOG',document:'DO_NOT_LOG',ip:'DO_NOT_LOG'});}finally{console.info=old;}
 assert.deepEqual(Object.keys(events[0]).sort(),['event','requestId','route','status','durationMs'].sort());assert.ok(!JSON.stringify(events).includes('DO_NOT_LOG'));
});
test('logout remains bounded and available when Redis fails, protected requests fail closed',async()=>{
 const limits=new RequestLimits({consume:async()=>{throw new (require('../Backend/server/security.ts').HttpError)(503,'SECURITY_UNAVAILABLE','No disponible.');}},{});
 await assert.rejects(limits.enter(request(),['search']),e=>e.status===503);
 const release=await limits.enter(request('auth/logout','POST',{}),['auth','logout']);release();
});
test('slow JSON cannot hold an admitted authentication slot indefinitely',async()=>{
 const {jsonBody}=require('../Backend/server/security.ts');let cancelled=false;
 const body=new ReadableStream({cancel(){cancelled=true;}});
 await assert.rejects(jsonBody(new Request(origin+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body,duplex:'half'})),e=>e.status===408&&e.code==='BODY_TIMEOUT');assert.equal(cancelled,true);
});
