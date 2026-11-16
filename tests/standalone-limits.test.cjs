require('./register-ts.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {StandaloneMemory}=require('../Backend/server/rate-limiting/standalone/memory.ts');
const {StandaloneQuotaStore}=require('../Backend/server/rate-limiting/standalone/index.ts');
const {RequestLimits,configuredQuotaStore,RedisQuotaStore}=require('../Backend/server/request-limits.ts');
const {MariaCoordinator}=require('../Backend/server/rate-limiting/standalone/persistent.ts');
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
