// Creates its own disposable container. Never reads application .env files.
const {spawnSync,spawn}=require('node:child_process');
const {randomUUID,randomBytes}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const mariadb=require('mariadb');
const root=path.resolve(__dirname,'..');
function statements(sql){
 let delimiter=';',buffer='';const result=[];
 for(const line of sql.split(/\r?\n/)){
  if(/^\s*DELIMITER\s+/i.test(line)){delimiter=line.trim().split(/\s+/)[1];continue;}
  if(!buffer.trim()&&(/^\s*--/.test(line)||!line.trim()))continue;
  buffer+=line+'\n';
  if(buffer.trimEnd().endsWith(delimiter)){result.push(buffer.trimEnd().slice(0,-delimiter.length));buffer='';}
 }
 if(buffer.trim())throw Error('INCOMPLETE_ISOLATED_SQL');return result;
}
function docker(args,env=process.env){
 const result=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,env,timeout:120000,maxBuffer:1024*1024});
 if(result.status!==0)throw new Error('ISOLATED_DOCKER_UNAVAILABLE');
 return result.stdout.trim();
}
async function main(){
 // No fallback to configured databases or an already-running container.
 docker(['info','--format','{{.ServerVersion}}']);
 const password=randomBytes(32).toString('hex'),marker=randomUUID();
 const name=`tp-admin-qa-${randomUUID()}`;
 let container,connection;
 try{
  container=docker(['run','--rm','--detach','--name',name,'--label','territorio.qa=disposable-admin',
   '--publish','127.0.0.1::3306','--tmpfs','/var/lib/mysql:rw,size=512m',
   '--env','MARIADB_ROOT_PASSWORD','--env','MARIADB_ROOT_HOST','mariadb:11.8.9'],
   {...process.env,MARIADB_ROOT_PASSWORD:password,MARIADB_ROOT_HOST:'%'});
  if(!/^[a-f0-9]{64}$/.test(container))throw new Error('ISOLATED_CONTAINER_ID_INVALID');
  const binding=docker(['port',container,'3306/tcp']);
  const matched=/^127\.0\.0\.1:(\d+)$/.exec(binding);
  if(!matched)throw new Error('ISOLATED_BINDING_INVALID');
  const config={host:'127.0.0.1',port:Number(matched[1]),user:'root',password,connectTimeout:1000,timezone:'+00:00',multipleStatements:false};
  for(let attempt=0;attempt<60;attempt++){
   try{connection=await mariadb.createConnection(config);break;}catch{await new Promise(resolve=>setTimeout(resolve,1000));}
  }
  if(!connection)throw new Error('ISOLATED_START_TIMEOUT');
  const version=(await connection.query('SELECT VERSION() AS version'))[0].version;
  if(!/^11\.8\.9-MariaDB/.test(version))throw new Error('ISOLATED_VERSION_MISMATCH');
  await connection.query('CREATE DATABASE auxiliares CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  await connection.query('USE auxiliares');
  await connection.query('CREATE TABLE TP_QA_DISPOSABLE_GUARD (MARKER CHAR(36) PRIMARY KEY)');
  await connection.query('INSERT INTO TP_QA_DISPOSABLE_GUARD VALUES (?)',[marker]);
  let fixture=fs.readFileSync(path.join(root,'tests/fixtures/admin-mariadb.sql'),'utf8').replace(/--[^\n]*/g,'');
  if(process.argv.includes('--mixed-collations')){
   fixture=fixture.replace(/(USER_ID|SESSION_ID|TOKEN_HASH|EVENT_ID|TARGET_ID) CHAR\((\d+)\)/g,'$1 CHAR($2) CHARACTER SET ascii COLLATE ascii_bin');
   fixture=fixture.replace(/(ACTOR_ID|REQUEST_ID) VARCHAR\(100\)/g,'$1 VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin');
   fixture=fixture.replace(/ENGINE=InnoDB/g,'ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
   const at=fixture.indexOf('CREATE TABLE TP_ADMIN_AUDIT_V1');
   fixture=fixture.slice(0,at)+fixture.slice(at).replace('COLLATE utf8mb4_unicode_ci','COLLATE utf8mb4_uca1400_ai_ci');
   console.log('Synthetic mixed collations: ascii_bin identifiers / unicode_ci users / uca1400 audit');
  }
  if(process.argv.includes('--migration')){
   fixture=fixture.replace(/^ (FIRST_NAME|LAST_NAME|EMAIL|CI|USERNAME_KEY|EMAIL_KEY|ACTOR_USERNAME|TARGET_USERNAME) .*\r?\n/gm,'').replace('USERNAME VARCHAR(100) NOT NULL,','USERNAME VARCHAR(100) NOT NULL UNIQUE,');
  }
  for(const statement of fixture.split(';').map(value=>value.trim()).filter(Boolean))await connection.query(statement);
  if(process.argv.includes('--migration')){
   const assert=require('node:assert/strict'),id=randomUUID();
   await connection.query("INSERT INTO FB_USUARIOS(USER_ID,USERNAME,ROLE,ENABLED,MUST_CHANGE_PASSWORD) VALUES (?,'Legacy.QA','collaborator',1,0)",[id]);
   await connection.query("INSERT INTO FB_USUARIOS_CREDENCIALES(USER_ID,PASSWORD_HASH) VALUES (?,'historical-hash-preserved')",[id]);
   const before=await connection.query('SELECT * FROM FB_USUARIOS WHERE USER_ID=?',[id]);
   const folder=path.join(root,'deploy/migrations/user-profile-v2');
   const apply=async file=>{for(const sql of statements(fs.readFileSync(path.join(folder,file),'utf8')))await connection.query(sql);};
   const invalidId=randomUUID();await connection.query("INSERT INTO FB_USUARIOS(USER_ID,USERNAME) VALUES (?,'Ｊimena')",[invalidId]);
   await assert.rejects(apply('10-migrate.sql'),e=>e.sqlState==='45000');
   assert.equal(Number((await connection.query("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='auxiliares' AND TABLE_NAME='FB_USUARIOS' AND COLUMN_NAME='FIRST_NAME'"))[0].n),0);
   await connection.query('DROP PROCEDURE TP_PROFILE_V2_MIGRATE');await connection.query('DELETE FROM FB_USUARIOS WHERE USER_ID=?',[invalidId]);
   console.log('PASS migration rejects unsupported legacy canonicalization before DDL');
   await connection.query('ALTER TABLE FB_USUARIOS MODIFY USERNAME VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL');
   const conflictId=randomUUID();await connection.query("INSERT INTO FB_USUARIOS(USER_ID,USERNAME) VALUES (?,'LEGACY.QA')",[conflictId]);
   await assert.rejects(apply('10-migrate.sql'),e=>e.sqlState==='45000');
   await connection.query('DROP PROCEDURE TP_PROFILE_V2_MIGRATE');await connection.query('DELETE FROM FB_USUARIOS WHERE USER_ID=?',[conflictId]);
   await connection.query('ALTER TABLE FB_USUARIOS MODIFY USERNAME VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL');
   console.log('PASS migration rejects existing case-only identity collisions before adding keys');
   await apply('00-preflight.sql');await apply('10-migrate.sql');await apply('20-postflight.sql');
   const after=(await connection.query('SELECT * FROM FB_USUARIOS WHERE USER_ID=?',[id]))[0];
   for(const key of Object.keys(before[0]))assert.deepEqual(after[key],before[0][key],key);
   assert.equal(after.FIRST_NAME,null);assert.equal(after.EMAIL,null);assert.equal(Buffer.from(after.USERNAME_KEY).toString(),'legacy.qa');
   assert.equal((await connection.query('SELECT PASSWORD_HASH FROM FB_USUARIOS_CREDENCIALES WHERE USER_ID=?',[id]))[0].PASSWORD_HASH,'historical-hash-preserved');
   assert.match(fs.readFileSync(path.join(folder,'90-recovery.sql'),'utf8'),/DDL cannot be undone by ROLLBACK/);
   console.log('PASS migration preflight/DDL/postflight preserve legacy identity/hash with null profiles; recovery is documented backup/forward repair');
  }
  await connection.end();connection=undefined;
  const code=await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,['--test','tests/admin-mariadb.integration.cjs'],{cwd:root,windowsHide:true,stdio:'inherit',
    env:{...process.env,TP_ADMIN_ISOLATED_CONFIG:JSON.stringify({...config,database:'auxiliares',marker}),TP_ADMIN_ISOLATED_RUN:'1'}});
   child.on('error',reject);child.on('exit',code=>resolve(code??1));
  });
  process.exitCode=code;
 }finally{
  try{if(connection)await connection.end();}
  finally{if(container&&/^[a-f0-9]{64}$/.test(container))docker(['rm','--force',container]);}
 }
}
if(require.main===module)main().catch(()=>{console.error('No se pudo completar QA MariaDB aislada. Verificar Docker Desktop/Linux y disponibilidad de mariadb:11.8.9. No se utilizó ninguna base configurada de la aplicación.');process.exitCode=1;});
