// Explicit isolated QA only. No env files or shared DB configuration are read.
require('../../../../scripts/register-runtime-ts.cjs');
const {execFileSync}=require('node:child_process');
const {randomUUID,randomBytes}=require('node:crypto');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),mariadb=require('mariadb');
const {MariaCoordinator}=require('./persistent.ts');
const {StandaloneQuotaStore}=require('./index.ts');
const {StandaloneMemory}=require('./memory.ts');
const docker=(args,env=process.env)=>execFileSync('docker',args,{encoding:'utf8',env,windowsHide:true,stdio:['pipe','pipe','pipe']}).trim();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const label=randomUUID(),password=randomBytes(24).toString('hex');let id,admin;
 const coordinators=[];
 try {
  id=docker(['run','-d','--label','tp.standalone.qa='+label,'-p','127.0.0.1::3306','-e','MARIADB_ROOT_PASSWORD','mariadb:11.8.9'],{...process.env,MARIADB_ROOT_PASSWORD:password});
  const binding=docker(['port',id,'3306/tcp']);assert.match(binding,/^127\.0\.0\.1:\d+$/);
  const config={host:'127.0.0.1',port:Number(binding.split(':')[1]),user:'root',password,database:'auxiliares',connectTimeout:1000,queryTimeout:1500,socketTimeout:0};
  for(let i=0;i<60;i++) { try {admin=await mariadb.createConnection({...config,database:undefined});break;}catch{await delay(500);} }
  assert.ok(admin);admin.on('error',()=>{});await admin.query('CREATE DATABASE auxiliares');
  const migration=fs.readFileSync(path.join(__dirname,'sql/10-migrate.sql'),'utf8').replace(/^--.*$/gm,'');
  for(const sql of migration.split(';').map(x=>x.trim()).filter(Boolean))await admin.query(sql);
  const make=()=>{const c=new MariaCoordinator(()=>mariadb.createConnection(config));coordinators.push(c);return c;};
  const rules=[{key:'auth:global',capacity:30,period:60000,cost:1},{key:'auth:hour',capacity:300,period:3600000,cost:1}];
  // Freeze refill for this burst even on a slow CI host; also exercises backward clock handling.
  const reset=()=>admin.query("UPDATE auxiliares.FB_SECURITY_STANDALONE_V1 SET tokens=CASE bucket WHEN 'auth:global' THEN 30 ELSE 300 END,at_ms=UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000+60000");
  let c=make();assert.ok(await c.consume(rules)>0);console.log('PASS migration starts with empty budget');
  await reset();
  for(let i=0;i<30;i++)assert.equal(await c.consume(rules),0);
  for(let i=0;i<270;i++)assert.ok(await c.consume(rules)>0);
  console.log('PASS 300 consecutive attempts, global budget independent of IP/account');
  await delay(2500); // An idle connection must retain the instance lock.
  const second=make();await assert.rejects(second.consume([]),e=>e.status===503);second.close();
  console.log('PASS second coordinator denied while owner is active');
  c.close();c=make();assert.ok(await c.consume(rules)>0);
  console.log('PASS process/coordinator restart preserves attack budget');
  const before=await admin.query('SELECT tokens FROM auxiliares.FB_SECURITY_STANDALONE_V1 ORDER BY bucket');
  assert.ok(Number(before[1].tokens)>269&&Number(before[1].tokens)<272);
  const r=await Promise.allSettled(Array.from({length:300},()=>c.consume(rules)));
  assert.ok(r.some(x=>x.status==='rejected'&&x.reason.status===503));
  assert.ok(r.every(x=>x.status==='rejected'||x.value>0));
  console.log('PASS concurrency fails closed with no waiting queue or overspend');
  // Local preflight must reject before spending the persistent reservation.
  await reset();const full=new StandaloneQuotaStore(c,new StandaloneMemory(()=>0,0));
  await assert.rejects(full.consume(rules),e=>e.status===503);
  const reserved=await admin.query("SELECT tokens FROM auxiliares.FB_SECURITY_STANDALONE_V1 WHERE bucket='auth:global'");assert.equal(Number(reserved[0].tokens),30);
  console.log('PASS saturated local store does not consume persistent reservation');
  docker(['stop','--time','1',id]);await assert.rejects(c.consume([]),e=>e.status===503);
  console.log('PASS MariaDB outage fails closed');
  docker(['start',id]);config.port=Number(docker(['port',id,'3306/tcp']).split(':')[1]);await delay(5100);
  assert.equal(await c.consume([]),0);
  console.log('PASS MariaDB recovery re-acquires ownership and validates schema');
  await admin.end().catch(()=>{});admin=await mariadb.createConnection({...config,database:undefined});
  await admin.beginTransaction();
  await admin.query('SELECT bucket FROM auxiliares.FB_SECURITY_STANDALONE_V1 FOR UPDATE');
  await assert.rejects(c.consume(rules),e=>e.status===503);
  await admin.rollback();await delay(5100);
  assert.equal(await c.consume([]),0);
  console.log('PASS row lock timeout fails closed and recovers without budget reset');
  await admin.query('DROP TABLE auxiliares.FB_SECURITY_STANDALONE_V1');
  await assert.rejects(c.consume([]),e=>e.status===503);
  console.log('PASS missing migration blocks protected API');
 } finally {
  coordinators.forEach(c=>c.close());if(admin)await admin.end().catch(()=>{});
  if(id){assert.equal(docker(['inspect','--format','{{index .Config.Labels "tp.standalone.qa"}}',id]),label);docker(['rm','-f','-v',id]);}
 }
})().catch(e=>{console.error('FAIL isolated standalone QA',e.code??e.name);process.exitCode=1;});
