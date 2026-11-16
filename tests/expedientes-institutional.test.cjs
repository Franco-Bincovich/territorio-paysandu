require('./register-ts.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {expedienteQuery,parseExpedienteName}=require('../shared/expedientes.ts');
const {InstitutionalCatalog}=require('../Backend/server/expedientes/institutional-catalog.ts');
const {InstitutionalFilesystemStorage,InstitutionalSftpStorage,MAX_DOCX_BYTES}=require('../Backend/server/expedientes/institutional-storage.ts');
const {createInstitutionalExpedientesHttp}=require('../Backend/server/expedientes/institutional-http.ts');
const {createMariaHttp}=require('../Backend/server/mariadb/http.ts');
const {RequestLimits,MemoryQuotaStore}=require('../Backend/server/request-limits.ts');
const {HttpError}=require('../Backend/server/security.ts');
const actor={verified:true,userId:'11111111-1111-4111-8111-111111111111',role:'collaborator',enabled:true,mustChangePassword:false,expiresAt:Date.now()+3600000};
const signal=()=>new AbortController().signal;
const name=(caso=1,padron=3389,localidad='PAYSANDU')=>`Expediente_${caso}_${padron}_${localidad}.docx`;
const query={localidad:'PAYSANDU',padron:'3389'};
const request=(h,route='expedientes',q=query,who=actor,method='GET',s)=>h(new Request(`http://localhost/api/${route}?${new URLSearchParams(q)}`,{method,signal:s}),route.split('/'),who);
const fixtureStorage=(names)=>({names:async()=>names,size:async()=>10,read:async()=>Buffer.alloc(10)});

test('institutional required fields, optional case, normalized numbers and exact locality tokens',()=>{
  assert.deepEqual(expedienteQuery({localidad:' PAYSANDU ',padron:' 003389 ',caso:'0264893'}),{localidad:'PAYSANDU',padron:'3389',caso:'264893'});
  assert.deepEqual(expedienteQuery(query),query);
  for(const v of [{padron:'3389'},{localidad:'PAYSANDU'},{...query,localidad:'Paysandú'},{...query,localidad:'GUICHON'},{...query,padron:'0'},{...query,padron:'../3389'},{...query,caso:'-1'},{...query,padron:'9223372036854775808'}])assert.equal(expedienteQuery(v),null);
  for(const n of ['Expediente_1_3389_GUICHON.docx','expediente_1_3389_PAYSANDU.docx','Expediente_1_3389_PAYSANDU.pdf','../'+name(),'Expediente_1_3389_PAYSANDU_extra.docx'])assert.equal(parseExpedienteName(n),null);
});
test('catalog all exact matches, similar parcels, different localities and repeated cases',async()=>{
  const c=new InstitutionalCatalog(fixtureStorage([name(1),name(2),name(1,13389),name(1,3389,'PAYSANDU_CHACRAS'),'invalid.docx']));
  assert.deepEqual((await c.search(query,signal())).map(d=>d.caseNumber),['1','2']);
  assert.equal((await c.search({...query,caso:'1'},signal())).length,1);
  assert.equal((await c.search({...query,padron:'999'},signal())).length,0);
  assert.equal((await c.search({...query,localidad:'PAYSANDU_CHACRAS'},signal()))[0].localidad,'PAYSANDU_CHACRAS');
});
test('two-field HTTP search returns complete filenames and retains case only as internal document association',async()=>{
  const bytes=require('./docx-fixture.cjs').docx();
  const h=createInstitutionalExpedientesHttp({...fixtureStorage([name(264893),name(264894),name(264893,13389),name(264893,3389,'PAYSANDU_CHACRAS')]),size:async()=>bytes.length,read:async()=>bytes});
  const response=await request(h,'expedientes',{localidad:'PAYSANDU',padron:'3389'});
  assert.equal(response.status,200);const {items,total}=await response.json();assert.equal(total,2);
  assert.deepEqual(items.map(x=>x.name),[name(264893),name(264894)]);
  for(const item of items){
    assert.equal(item.localidad,'PAYSANDU');assert.equal(item.padron,'3389');
    assert.equal((await request(h,`expedientes/${item.id}/descarga`,query)).status,400);
    const download=await request(h,`expedientes/${item.id}/descarga`,{...query,caso:item.caseNumber});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
  }
});
test('catalog normalized duplicate numbers and repeated directory entries fail closed',async()=>{
  for(const names of [[name(1),name('01')],[name(1),name(1)]]){
    const c=new InstitutionalCatalog(fixtureStorage(names));
    await assert.rejects(()=>c.search(query,signal()),e=>e.status===409);
  }
});
test('catalog bounded TTL detects external publication and invalidate is explicit',async()=>{
  let now=1000,reads=0,names=[name(1)];const c=new InstitutionalCatalog({...fixtureStorage([]),names:async()=>{reads++;return names;}},30,()=>now);
  assert.equal((await c.search(query,signal())).length,1);names=[name(1),name(2)];
  assert.equal((await c.search(query,signal())).length,1);assert.equal(reads,1);
  now+=31;assert.equal((await c.search(query,signal())).length,2);assert.equal(reads,2);
  names=[name(1)];c.invalidate();assert.equal((await c.search(query,signal())).length,1);
});
test('direct download rechecks fresh catalog, required association and ambiguity',async()=>{
  let names=[name(1)];const c=new InstitutionalCatalog({...fixtureStorage([]),names:async()=>names});
  const [doc]=await c.search(query,signal());
  for(const q of [query,{...query,caso:'2'},{...query,caso:'1',padron:'13389'},{...query,caso:'1',localidad:'PAYSANDU_CHACRAS'}])await assert.rejects(()=>c.find(doc.id,q,signal()),e=>[400,404].includes(e.status));
  assert.equal((await c.find(doc.id,{...query,caso:'1'},signal())).name,name(1));
  names.push(name('01'));await assert.rejects(()=>c.find(doc.id,{...query,caso:'1'},signal()),e=>e.status===409);
});
test('filesystem preserves original bytes, rejects missing, special, large and unsafe names',async t=>{
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'tp-exp-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const s=new InstitutionalFilesystemStorage(root),bytes=Buffer.from('fictitious original'),file=path.join(root,name());await fs.writeFile(file,bytes);
  const before=await fs.stat(file);assert.deepEqual(await s.read(name(),signal()),bytes);const after=await fs.stat(file);
  assert.equal(before.mtimeMs,after.mtimeMs);assert.equal(before.mode,after.mode);assert.deepEqual(await fs.readFile(file),bytes);
  await assert.rejects(()=>s.read('../'+name(),signal()),e=>e.status===400);
  await assert.rejects(()=>s.read(name(2),signal()),e=>e.status===404);
  await fs.mkdir(path.join(root,name(3)));await assert.rejects(()=>s.read(name(3),signal()),e=>e.status===503);
  const large=await fs.open(path.join(root,name(4)),'w');await large.truncate(MAX_DOCX_BYTES+1);await large.close();await assert.rejects(()=>s.read(name(4),signal()),e=>e.status===413);
  const abort=new AbortController();abort.abort();await assert.rejects(()=>s.read(name(),abort.signal),e=>e.status===499);
  await assert.rejects(()=>new InstitutionalFilesystemStorage(path.join(root,'absent')).names(signal()),e=>e.code==='EXPEDIENTES_DIRECTORY_UNAVAILABLE');
});
test('filesystem rejects symlinks to files and directories',async t=>{
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'tp-exp-link-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const original=path.join(root,'original');await fs.writeFile(original,'original');
  try{await fs.symlink(original,path.join(root,name()));}catch(e){if(['EPERM','EACCES'].includes(e.code)){t.skip('OS denies creation of test symlinks; Linux Docker check remains required');return;}throw e;}
  await assert.rejects(()=>new InstitutionalFilesystemStorage(root).read(name(),signal()),e=>e.status===503);
  const link=path.join(root,'directory-link');await fs.symlink(root,link,'junction');await assert.rejects(()=>new InstitutionalFilesystemStorage(link).names(signal()),e=>e.status===503);
});
test('SFTP metadata uses one shared transport admission and rejects alternate canonical roots',async()=>{
  let calls=0;const reader={read:async fn=>{calls++;return fn({directory:async()=>'/Satelitales/EXPEDIENTES_GENERADOS',file:async()=>({stat:{size:10}})},10);},close(){}};
  const storage=new InstitutionalSftpStorage(reader,'/Satelitales/EXPEDIENTES_GENERADOS');
  assert.deepEqual(await storage.sizes([name(1),name(2)],signal()),[10,10]);assert.equal(calls,1);
  const unsafe=new InstitutionalSftpStorage({...reader,read:fn=>fn({directory:async()=>'/secret'})},'/Satelitales/EXPEDIENTES_GENERADOS');
  await assert.rejects(()=>unsafe.names(signal()),e=>e.code==='EXPEDIENTES_STORAGE');
  let changed=false;
  const replaced=new InstitutionalSftpStorage({...reader,read:fn=>fn({directory:async()=>changed?'/outside':'/Satelitales/EXPEDIENTES_GENERADOS',filenames:async()=>{changed=true;return [name()];}})},'/Satelitales/EXPEDIENTES_GENERADOS');
  await assert.rejects(()=>replaced.names(signal()),e=>e.code==='EXPEDIENTES_STORAGE');
});
test('new HTTP endpoints enforce all three roles and validate query before storage',async()=>{
  let calls=0;const h=createInstitutionalExpedientesHttp({...fixtureStorage([]),names:async()=>{calls++;return [];}});
  for(const role of ['collaborator','administrator'])assert.equal((await request(h,undefined,query,{...actor,role})).status,200);
  assert.equal((await request(h,undefined,query,{...actor,role:'atencion_publico'})).status,403);
  for(const q of [{},{padron:'3389'},{localidad:'PAYSANDU'},{...query,padCod:'1'}])assert.equal((await request(h,undefined,q)).status,400);
  assert.equal(calls,1);
  for(const op of ['descarga','contenido','exportar'])assert.equal((await request(h,`expedientes/${'a'.repeat(64)}/${op}`,{...query,caso:'1'},{...actor,role:'atencion_publico'})).status,403);
  assert.equal((await request(h,undefined,query,actor,'POST')).status,405);
  assert.equal((await request(h,'expedientes/generar',query,actor,'POST')).status,404);
});
test('new HTTP rejects corrupt packages and sanitizes storage exceptions',async()=>{
  const h=createInstitutionalExpedientesHttp(fixtureStorage([name()]));const {items}=await (await request(h)).json();
  const bad=await request(h,`expedientes/${items[0].id}/descarga`,{...query,caso:'1'});assert.equal(bad.status,422);
  const unavailable=createInstitutionalExpedientesHttp({...fixtureStorage([]),names:async()=>{throw Error('/physical/secret credentials');}});
  const r=await request(unavailable);assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/physical|secret|credentials/);
});
test('new HTTP search concurrency is bounded and cancellation is controlled',async()=>{
  let finish;const pending=new Promise(resolve=>finish=resolve);
  const h=createInstitutionalExpedientesHttp({...fixtureStorage([]),names:async()=>{await pending;return [];}},{concurrency:1});
  const first=request(h);await new Promise(setImmediate);assert.equal((await request(h)).status,429);finish();assert.equal((await first).status,200);
  const abort=new AbortController();abort.abort();assert.equal((await request(h,'expedientes',query,actor,'GET',abort.signal)).status,503);
});
test('Maria dispatch recognizes search and refuses anonymous before document adapter',async()=>{
  let calls=0;const origin='http://localhost';
  const handler=createMariaHttp({identify:async()=>{throw new HttpError(401,'UNAUTHENTICATED','Acceso denegado');}},origin,undefined,undefined,new RequestLimits(new MemoryQuotaStore(),{}),undefined,async()=>{calls++;return Response.json({});});
  const response=await handler(new Request(origin+'/api/expedientes?localidad=PAYSANDU&padron=3389'),['expedientes']);
  assert.equal(response.status,401);assert.equal(calls,0);
});
test('real DOCX fixture downloads byte-identically with safe headers and read-only metadata',async t=>{
  const {docx}=require('./docx-fixture.cjs'),bytes=docx();
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'tp-exp-word-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const file=path.join(root,name());await fs.writeFile(file,bytes);const before=await fs.stat(file);
  const h=createInstitutionalExpedientesHttp(new InstitutionalFilesystemStorage(root),{concurrency:1});
  const {items}=await (await request(h)).json();
  for(const role of ['collaborator','administrator']){
    const response=await request(h,`expedientes/${items[0].id}/descarga`,{...query,caso:'1'},{...actor,role});
    assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/wordprocessingml/);
    assert.match(response.headers.get('content-disposition'),/^attachment; filename="Expediente_/);
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.equal((await request(h)).status,429); // slow client retains bounded admission
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  }
  const after=await fs.stat(file);assert.equal(before.mtimeMs,after.mtimeMs);assert.equal(before.mode,after.mode);assert.deepEqual(await fs.readFile(file),bytes);
  for(const q of [{...query,caso:'2'},{...query,caso:'1',padron:'13389'}])assert.equal((await request(h,`expedientes/${items[0].id}/descarga`,q)).status,404);
  await fs.unlink(file);assert.equal((await request(h,`expedientes/${items[0].id}/descarga`,{...query,caso:'1'})).status,404);
});
test('PDF HTTP contract uses converter and correct disposition (unit mock, not conversion evidence)',async()=>{
  const bytes=require('./docx-fixture.cjs').docx();let conversions=0;
  const h=createInstitutionalExpedientesHttp({...fixtureStorage([name()]),size:async()=>bytes.length,read:async()=>bytes},{convert:async(input,s)=>{assert.deepEqual(input,bytes);assert.equal(s.aborted,false);conversions++;return Buffer.from('%PDF-1.7\n%%EOF');}});
  const {items}=await(await request(h)).json();
  for(const [op,disposition] of [['contenido','inline'],['exportar','attachment']]){
    const response=await request(h,`expedientes/${items[0].id}/${op}`,{...query,caso:'1'});
    assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');assert.match(response.headers.get('content-disposition'),new RegExp('^'+disposition));await response.arrayBuffer();
  }
  assert.equal(conversions,2);
});
test('timeout retains admission until blocked storage settles, then releases it',async()=>{
  let finish;const blocked=new Promise(resolve=>finish=resolve);
  const h=createInstitutionalExpedientesHttp({...fixtureStorage([]),names:async()=>{await blocked;return [];}},{concurrency:1,timeoutMs:20});
  const first=request(h);await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal((await request(h)).status,429);finish();assert.equal((await first).status,503);
  assert.equal((await request(h)).status,200);
});
test('new document streams expire or abort and release admission without a retained buffer',async()=>{
  const bytes=require('./docx-fixture.cjs').docx();
  const h=createInstitutionalExpedientesHttp({...fixtureStorage([name()]),size:async()=>bytes.length,read:async()=>bytes},{concurrency:1,timeoutMs:20});
  const {items}=await(await request(h)).json(),route=`expedientes/${items[0].id}/descarga`;
  const response=await request(h,route,{...query,caso:'1'});assert.equal((await request(h)).status,429);
  await new Promise(resolve=>setTimeout(resolve,40));await assert.rejects(()=>response.arrayBuffer());assert.equal((await request(h)).status,200);
  const abort=new AbortController(),other=await request(h,route,{...query,caso:'1'},actor,'GET',abort.signal);abort.abort();await assert.rejects(()=>other.arrayBuffer());assert.equal((await request(h)).status,200);
});
