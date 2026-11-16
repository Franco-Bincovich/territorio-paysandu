require('./register-ts.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createExpedientesHttp,configuredExpedientesHttp}=require('../Backend/server/expedientes/http.ts');
const {FilesystemExpedientesStorage}=require('../Backend/server/expedientes/storage.ts');
const {DocumentGeneration}=require('../Backend/server/expedientes/generation.ts');
const actor={verified:true,userId:'11111111-1111-4111-8111-111111111111',role:'collaborator',enabled:true,mustChangePassword:false,expiresAt:Date.now()+3600000};
const bytes=Buffer.from('%PDF-1.7\nfictional fixture\n%%EOF');
const doc={id:'doc-1',padCod:'123',reference:'EXP 1',name:'Plano ficticio',storageKey:'fixture.pdf',documentType:'PDF',mimeType:'application/pdf',size:bytes.length,incorporatedAt:'2026-11-14T00:00:00Z',available:true};
const policy={canReadParcel:async()=>true,canReadDocument:async()=>true};
const catalog={list:async()=>({items:[doc],total:1}),find:async()=>doc};
const make=(c=catalog,p=policy,s={read:async()=>bytes},o={})=>createExpedientesHttp(c,p,s,o);
const req=(route,query='',method='GET',signal)=>new Request(`http://localhost/api/${route}${query}`,{method,signal});
const run=(handler,route='parcels/123/expedientes',query='',who=actor,method='GET')=>handler(req(route,query,method),route.split('/'),who);
const fixtureContract={id:'fictional-only-v1',documentType:'PDF',load:async padCod=>({padCod}),render:async source=>Buffer.from(`%PDF-1.7\nFICTICIO ${source.padCod}\n%%EOF`)};
const generateRequest=(handler,who=actor,body={padCod:'123',contractId:'fictional-only-v1'})=>handler(new Request('http://localhost/api/expedientes/generar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),['expedientes','generar'],who);
test('only collaborator and administrator retain authorized listing and download',async()=>{for(const role of ['collaborator','administrator']){assert.equal((await run(make(),undefined,'',{...actor,role})).status,200);const r=await run(make(),'expedientes/doc-1/descarga','',{...actor,role});assert.equal(r.status,200);await r.arrayBuffer();}});
test('document generation is forbidden for every role, including legacy service',async()=>{
  for(const role of ['atencion_publico','collaborator','administrator']) {
    const who={...actor,role},service=new DocumentGeneration([fixtureContract],policy);
    assert.equal((await generateRequest(make(catalog,policy,undefined,{generation:service}),who)).status,403);
    await assert.rejects(()=>service.generate(who,'123',fixtureContract.id,new AbortController().signal),e=>e.status===403);
  }
});
test('listing is paginated and excludes storage keys',async()=>{const r=await run(make());assert.equal(r.status,200);const b=await r.json();assert.equal(b.items[0].padCod,'123');assert.equal(b.items[0].storageKey,undefined);assert.equal(b.page,1);assert.equal(b.pageSize,20);});
test('content and download have safe separate dispositions',async()=>{for(const [operation,disposition]of [['contenido','inline'],['descarga','attachment']]){const r=await run(make(),`expedientes/doc-1/${operation}`);assert.equal(r.status,200);assert.match(r.headers.get('content-disposition'),new RegExp('^'+disposition));assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal(r.headers.get('cache-control'),'private, no-store');assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);}});
test('anonymous, disabled, expired and mandatory password are denied',async()=>{for(const a of [undefined,{...actor,enabled:false},{...actor,expiresAt:0},{...actor,mustChangePassword:true}]){const r=await make()(req('parcels/123/expedientes'),['parcels','123','expedientes'],a);assert.ok([401,403].includes(r.status));}});
test('parcel and document policy rechecked for direct access',async()=>{for(const p of [{...policy,canReadParcel:async()=>false},{...policy,canReadDocument:async()=>false}]){assert.equal((await run(make(catalog,p),'expedientes/doc-1/contenido')).status,403);assert.equal((await run(make(catalog,p))).status,403);}});
test('PadCod strict validation and bounded pagination',async()=>{for(const code of ['0','01','-1','1.1','9223372036854775808','../x'])assert.equal((await make()(req('parcels/123/expedientes'),['parcels',code,'expedientes'],actor)).status,400);for(const query of ['?page=0','?pageSize=51','?page=99999&pageSize=50','?page=1&page=2','?unknown=x'])assert.equal((await run(make(),undefined,query)).status,400);});
test('HTTP rejects MIME, size and signature inconsistencies from adapters',async()=>{
  assert.equal((await run(make({...catalog,find:async()=>({...doc,mimeType:'text/html'})}),'expedientes/doc-1/contenido')).status,503);
  assert.equal((await run(make(catalog,policy,{read:async()=>Buffer.from('short')}),'expedientes/doc-1/contenido')).status,413);
  assert.equal((await run(make(catalog,policy,{read:async()=>Buffer.alloc(bytes.length)}),'expedientes/doc-1/contenido')).status,415);
});
test('listing does not serialize unexpected adapter fields',async()=>{
  const r=await run(make({...catalog,list:async()=>({items:[{...doc,passwordHash:'secret'}],total:1,internalPath:'secret'})}));
  assert.doesNotMatch(await r.text(),/secret|internalPath|passwordHash|storageKey/);
});
test('catalog association mismatch is not exposed',async()=>{assert.equal((await run(make({...catalog,list:async()=>({items:[{...doc,padCod:'456'}],total:1})}))).status,503);assert.equal((await run(make({...catalog,find:async()=>({...doc,id:'other'})}),'expedientes/doc-1/contenido')).status,503);});
test('missing and unavailable documents',async()=>{for(const item of [null,{...doc,available:false}])assert.equal((await run(make({...catalog,find:async()=>item}),'expedientes/doc-1/descarga')).status,404);});
test('storage exceptions sanitized',async()=>{const r=await run(make(catalog,policy,{read:async()=>{throw new Error('C:\\private\\secret ENOENT');}}),'expedientes/doc-1/contenido');assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/private|secret|ENOENT/);});
test('write methods rejected',async()=>{assert.equal((await run(make(),undefined,'',actor,'POST')).status,405);});
test('configured production adapter fails explicitly without fixtures',async()=>{await assert.rejects(()=>run(configuredExpedientesHttp()),e=>e.code==='EXPEDIENTES_CONFIGURATION_PENDING'&&e.status===503);});
test('bounded concurrent operations reject excess',async()=>{let finish;const blocked=new Promise(resolve=>finish=resolve);const h=make({...catalog,list:async()=>{await blocked;return {items:[doc],total:1};}},policy,undefined,{concurrency:1});const first=run(h);await new Promise(setImmediate);assert.equal((await run(h)).status,429);finish();assert.equal((await first).status,200);assert.equal((await run(h)).status,200);});
test('slow response retains admission until consumed or cancelled',async()=>{
  const h=make(catalog,policy,undefined,{concurrency:1});
  const slow=await run(h,'expedientes/doc-1/contenido');assert.equal(slow.status,200);
  assert.equal((await run(h)).status,429);
  await slow.body.cancel();assert.equal((await run(h)).status,200);
  const next=await run(h,'expedientes/doc-1/descarga');assert.deepEqual(Buffer.from(await next.arrayBuffer()),bytes);
  assert.equal((await run(h)).status,200);
});
test('unconsumed body expires and releases admission',async()=>{
  const h=make(catalog,policy,undefined,{concurrency:1,timeoutMs:20});
  const slow=await run(h,'expedientes/doc-1/contenido');assert.equal((await run(h)).status,429);
  await new Promise(resolve=>setTimeout(resolve,40));
  await assert.rejects(()=>slow.arrayBuffer());assert.equal((await run(h)).status,200);
});
test('request abort cancels outstanding body and releases admission',async()=>{
  const h=make(catalog,policy,undefined,{concurrency:1});const controller=new AbortController();
  const response=await h(req('expedientes/doc-1/contenido','','GET',controller.signal),['expedientes','doc-1','contenido'],actor);
  assert.equal((await run(h)).status,429);controller.abort();
  await assert.rejects(()=>response.arrayBuffer());assert.equal((await run(h)).status,200);
});
test('read timeout does not release admission while storage is still running',async()=>{
  let finish;const storageDone=new Promise(resolve=>finish=resolve);
  const h=make(catalog,policy,{read:async()=>{await storageDone;return bytes;}},{concurrency:1,timeoutMs:10});
  const response=run(h,'expedientes/doc-1/contenido');await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal((await run(h)).status,429);finish();assert.equal((await response).status,499);
  assert.equal((await run(h)).status,200);
});
test('real local fixture storage validates contents and safe paths',async(t)=>{const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'tp-exp-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'fixture.pdf'),bytes);const store=new FilesystemExpedientesStorage(root);const signal=new AbortController().signal;assert.deepEqual(Buffer.from(await store.read(doc,signal)),bytes);
  await assert.rejects(()=>store.read({...doc,storageKey:'missing.pdf'},signal),e=>e.status===404);
  for(const key of ['../fixture.pdf','/fixture.pdf','C:\\fixture.pdf','sub/fixture.pdf','fixture.txt','..pdf'])await assert.rejects(()=>store.read({...doc,storageKey:key},signal));
  await assert.rejects(()=>store.read({...doc,size:bytes.length+1},signal),e=>e.status===413);
  await assert.rejects(()=>new FilesystemExpedientesStorage(root,4).read(doc,signal),e=>e.status===413);
  await fs.writeFile(path.join(root,'bad.pdf'),'not a pdf');await assert.rejects(()=>store.read({...doc,storageKey:'bad.pdf',size:9},signal),e=>e.status===415);
  await fs.mkdir(path.join(root,'directory.pdf'));await assert.rejects(()=>store.read({...doc,storageKey:'directory.pdf'},signal));
  const controller=new AbortController();controller.abort();await assert.rejects(()=>store.read(doc,controller.signal),e=>e.status===499);
});
test('symbolic links are rejected without following the target',async(t)=>{const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'tp-exp-link-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'fixture.pdf'),bytes);try{await fs.symlink(path.join(root,'fixture.pdf'),path.join(root,'link.pdf'));}catch(e){if(e.code==='EPERM'){t.skip('Windows account lacks symlink privilege');return;}throw e;}await assert.rejects(()=>new FilesystemExpedientesStorage(root).read({...doc,storageKey:'link.pdf'},new AbortController().signal));});
test('root directory symlink or Windows junction is rejected',async(t)=>{
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'tp-exp-junction-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const real=path.join(root,'real'),link=path.join(root,'link');await fs.mkdir(real);await fs.writeFile(path.join(real,'fixture.pdf'),bytes);
  try { await fs.symlink(real,link,process.platform==='win32'?'junction':'dir'); }
  catch(e) { if(e.code==='EPERM') {t.skip('Windows sandbox denies directory symlinks/junctions');return;} throw e; }
  await assert.rejects(()=>new FilesystemExpedientesStorage(link).read(doc,new AbortController().signal),e=>e.code==='EXPEDIENTES_STORAGE');
});




test('public attention cannot list, preview or download documents even with permissive resource policy',async()=>{
 for(const route of ['parcels/123/expedientes','expedientes/doc-1/contenido','expedientes/doc-1/descarga']){
  let calls=0;const h=make({list:async()=>{calls++;return {items:[doc],total:1};},find:async()=>{calls++;return doc;}});
  assert.equal((await run(h,route,'',{...actor,role:'atencion_publico'})).status,403);assert.equal(calls,0);
 }
});
