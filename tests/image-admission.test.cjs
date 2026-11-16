require('../scripts/register-runtime-ts.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {ImageAdmission}=require('../Backend/server/image-admission.ts');
const {RequestLimits,MemoryQuotaStore}=require('../Backend/server/request-limits.ts');
const req=signal=>new Request('http://localhost/api/parcel-image/survey',{signal});
const {admittedImageResponse}=require('../Backend/server/image-response.ts');
test('HTTP admission remains owned until body consumption or disconnect, without double release',async()=>{
 let released=0;const ac=new AbortController(),response=admittedImageResponse(new Response('payload'),()=>released++,ac.signal);await new Promise(r=>setTimeout(r,5));assert.equal(released,0);assert.equal(await response.text(),'payload');assert.equal(released,1);ac.abort();assert.equal(released,1);
 const cancel=new AbortController(),pending=admittedImageResponse(new Response('pending'),()=>released++,cancel.signal);cancel.abort();await pending.body.cancel();assert.equal(released,2);
});
test('30 images complete through six admissions; six slots remain for queries and login',async()=>{
 const limits=new RequestLimits(new MemoryQuotaStore(),{NODE_ENV:'development',IMAGE_PROVIDER:'filesystem'});let active=0,peak=0;
 const images=Array.from({length:30},async()=>{const release=await limits.enter(req(),['parcel-image','survey']);peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,5));active--;release();});
 const queries=await Promise.all(Array.from({length:6},()=>limits.enter(req(),['session'])));
 const login=await limits.enter(req(),['auth','login']);login();queries.forEach(r=>r());await Promise.all(images);assert.equal(peak,6);assert.equal(limits.activeApi,0);
});
test('image wait never exceeds global API ceiling and wakes when a query leaves',async()=>{
 const limits=new RequestLimits(new MemoryQuotaStore(),{NODE_ENV:'development',IMAGE_PROVIDER:'filesystem'});
 const queries=await Promise.all(Array.from({length:12},()=>limits.enter(req(),['session'])));let entered=false;
 const pending=limits.enter(req(),['parcel-image','survey']).then(r=>{entered=true;return r;});await new Promise(r=>setTimeout(r,5));assert.equal(entered,false);queries.pop()();const release=await pending;assert.equal(limits.activeApi,12);release();queries.forEach(r=>r());
});
test('FIFO saturation, queue deadline, cancellation and close release all waiters',async()=>{
 const gate=new ImageAdmission(1,1,20),release=await gate.acquire(),ac=new AbortController();const pending=gate.acquire(ac.signal);await assert.rejects(gate.acquire(),e=>e.code==='IMAGE_BUSY');ac.abort();await assert.rejects(pending,e=>e.status===499);
 await assert.rejects(gate.acquire(),e=>e.code==='IMAGE_QUEUE_TIMEOUT');const waiting=gate.acquire();gate.close();await assert.rejects(waiting);release();release();await assert.rejects(gate.acquire());
});
test('existing quota rejection is retained after image admission and frees its slot',async()=>{
 const limits=new RequestLimits({consume:async()=>3},{NODE_ENV:'development',IMAGE_PROVIDER:'filesystem'});
 await assert.rejects(limits.enter(req(),['parcel-image','survey']),e=>e.status===429&&e.retryAfter===3);assert.equal(limits.activeApi,0);
});
test('SFTP retains immediate global admission ceiling and invalid queue configuration fails closed',async()=>{
 const limits=new RequestLimits(new MemoryQuotaStore(),{NODE_ENV:'development',IMAGE_PROVIDER:'sftp'});const releases=await Promise.all(Array.from({length:12},()=>limits.enter(req(),['session'])));await assert.rejects(limits.enter(req(),['parcel-image','survey']),e=>e.status===429);releases.forEach(r=>r());assert.throws(()=>new RequestLimits(new MemoryQuotaStore(),{IMAGE_PROVIDER:'filesystem',IMAGES_HTTP_CONCURRENCY:'30'}),e=>e.code==='IMAGE_CONFIG');
});
