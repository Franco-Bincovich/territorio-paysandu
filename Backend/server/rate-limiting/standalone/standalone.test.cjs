require('../../../../scripts/register-runtime-ts.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {StandaloneMemory}=require('./memory.ts');
const {StandaloneQuotaStore}=require('./index.ts');
const {RequestLimits,configuredQuotaStore,RedisQuotaStore}=require('../../request-limits.ts');
const {MariaCoordinator}=require('./persistent.ts');
const rule=(key,capacity=2,period=1000,cost=1)=>({key,capacity,period,cost});
test('standalone atomic admission, gradual refill and bounded state refuse eviction',async()=>{
 let now=0;const m=new StandaloneMemory(()=>now,2);
 assert.equal(await m.consume([rule('a')]),0);
 assert.equal(await m.consume([rule('a')]),0);
 assert.equal(await m.consume([rule('a'),rule('b')]),1);
 assert.equal(await m.consume([rule('b',2,1000,2)]),0);
 await assert.rejects(m.consume([rule('c')]),e=>e.status===503);
 now=500;assert.equal(await m.consume([rule('a')]),0);
 assert.equal(await m.consume([rule('a')]),1);
 now=3000;assert.equal(await m.consume([rule('c')]),0);
 await assert.rejects(m.consume([rule('c'),rule('c')]),e=>e.status===503);
});
test('300 parallel admissions cannot overspend a joint batch',async()=>{
 const m=new StandaloneMemory(()=>0);
 const results=await Promise.all(Array.from({length:300},()=>m.consume([rule('global',30),rule('hour',300,3600000)])));
 assert.equal(results.filter(x=>x===0).length,30);
 assert.equal(results.filter(x=>x===1).length,270);
 assert.equal(await m.consume([rule('hour',300,3600000,270)]),0);
});
test('all existing route/user/byte limits use standalone and fail closed',async()=>{
 let persistentCalls=0;
 const store=new StandaloneQuotaStore({consume:async()=>{persistentCalls++;return 0;}},new StandaloneMemory(()=>0));
 const secret='a'.repeat(64),limits=new RequestLimits(store,{NODE_ENV:'production',SECURITY_PROXY_SECRET:secret});
 const req=(i,method='GET')=>new Request('https://qa.invalid/api/',{method,headers:{'x-tp-proxy-token':secret,'x-tp-client-ip':`192.0.2.${i}`}});
 for(let i=1;i<=30;i++)(await limits.enter(req(i,'POST'),['auth','login']))();
 for(let i=0;i<270;i++)await assert.rejects(limits.enter(req(i%200+1,'POST'),['auth','login']),e=>e.status===429&&e.retryAfter===2);
 for(const [segments,method,allowed] of [[['search'],'GET',60],[['consultations'],'POST',10],[['parcel-image','x'],'GET',10]]) {
  const user=segments.join('/');for(let i=0;i<allowed;i++)await limits.user(user,req(1,method),segments);
  await assert.rejects(limits.user(user,req(1,method),segments),e=>e.status===429);
 }
 assert.ok(persistentCalls>300);
 const failed=new StandaloneQuotaStore({consume:async()=>{throw Object.assign(new Error(),{status:503});}});
 await assert.rejects(failed.consume([rule('a')]),e=>e.status===503);
});
test('configuration preserves Redis default and rejects unknown providers',()=>{
 assert.ok(configuredQuotaStore({NODE_ENV:'production'}) instanceof RedisQuotaStore);
 assert.ok(configuredQuotaStore({SECURITY_RATE_LIMIT_PROVIDER:'standalone'}) instanceof StandaloneQuotaStore);
 assert.throws(()=>configuredQuotaStore({SECURITY_RATE_LIMIT_PROVIDER:'typo'}),e=>e.status===503);
});
test('persistent coordinator refuses second owner, SQL faults, and concurrent queueing',async()=>{
 let destroyed=false;
 const c=new MariaCoordinator(async()=>({query:async()=>[{owned:0}],destroy:()=>{destroyed=true;}}));
 await assert.rejects(c.consume([]),e=>e.status===503);assert.equal(destroyed,true);
 let resolve;const pending=new MariaCoordinator(()=>new Promise(r=>{resolve=r;}));
 const first=pending.consume([]);
 await assert.rejects(pending.consume([]),e=>e.status===503);
 resolve({query:async()=>{throw new Error('private driver message');},destroy:()=>{}});
 await assert.rejects(first,e=>e.status===503&&!e.message.includes('private'));
});
test('HTTP Retry-After, 503 and logout retain their contracts with standalone',async()=>{
 const {createMariaHttp}=require('../../mariadb/http.ts');
 const origin='http://127.0.0.1:3105';
 const store=new StandaloneQuotaStore({consume:async()=>0},new StandaloneMemory(()=>0));
 const limits=new RequestLimits(store,{});
 let calls=0;
 const {HttpError}=require('../../security.ts');
 const handler=createMariaHttp({login:async()=>{calls++;throw new HttpError(401,'INVALID_CREDENTIALS','Credenciales inválidas.');}},origin,undefined,undefined,limits);
 const req=()=>new Request(origin+'/api/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username:'rotating-'+calls,password:'synthetic-only'})});
 for(let i=0;i<10;i++)assert.equal((await handler(req(),['auth','login'])).status,401);
 const denied=await handler(req(),['auth','login']);assert.equal(denied.status,429);assert.equal(denied.headers.get('retry-after'),'6');assert.equal(calls,10);
 const failed=new RequestLimits(new StandaloneQuotaStore({consume:async()=>{throw Object.assign(new Error(),{status:503});}}),{});
 await assert.rejects(failed.enter(req(),['auth','login']),e=>e.status===503);
 (await failed.enter(req(),['auth','logout']))();
});
test('API global/source, generic reads and per-user quotas retain their capacities',async()=>{
 const secret='b'.repeat(64),env={NODE_ENV:'production',SECURITY_PROXY_SECRET:secret};
 const req=i=>new Request('https://qa.invalid/api/',{headers:{'x-tp-proxy-token':secret,'x-tp-client-ip':`192.0.2.${i}`}});
 const make=()=>new RequestLimits(new StandaloneQuotaStore({consume:async()=>0},new StandaloneMemory(()=>0)),env);
 let limits=make();for(let i=0;i<180;i++)(await limits.enter(req(1),['search']))();
 await assert.rejects(limits.enter(req(1),['search']),e=>e.status===429&&e.retryAfter===1);
 limits=make();for(let i=0;i<600;i++)(await limits.enter(req(i%200+1),['search']))();
 await assert.rejects(limits.enter(req(201),['search']),e=>e.status===429);
 limits=make();for(let i=0;i<60;i++)await limits.user('reader',req(1),['session']);
 await assert.rejects(limits.user('reader',req(1),['session']),e=>e.status===429);
});
test('joint local rejection never spends persistent global quotas',async()=>{
 let reserved=0;const store=new StandaloneQuotaStore({consume:async rules=>{reserved+=rules.length;return 0;}},new StandaloneMemory(()=>0));
 const rules=[rule('auth:global',30),rule('source',1)];assert.equal(await store.consume(rules),0);
 assert.equal(await store.consume(rules),1);assert.equal(reserved,1);
});
test('admission queue is bounded and simultaneous batches cannot overspend',async()=>{
 let release;let first=true;
 const coordinator={consume:async()=>{if(first){first=false;await new Promise(r=>{release=r;});}return 0;}};
 const store=new StandaloneQuotaStore(coordinator,new StandaloneMemory(()=>0));
 const pending=Array.from({length:300},()=>store.consume([rule('bounded',3)]));
 // Attach rejection handlers before yielding to the microtask queue.
 const resultsPromise=Promise.allSettled(pending);await new Promise(r=>setImmediate(r));release();
 const results=await resultsPromise;
 assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value===0).length,3);
 assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value>0).length,12);
 assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===503).length,285);
});
