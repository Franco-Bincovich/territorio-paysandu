// LOCAL QA. Creates only a new labeled OpenSSH container, never a real connection.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {randomBytes,randomUUID,createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const docker=(args,env=process.env)=>cp.execFileSync('docker',args,{encoding:'utf8',windowsHide:true,env,stdio:['pipe','pipe','pipe']}).trim();
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhRkAAAAASUVORK5CYII=','base64');
async function fixture(){
 const runId=randomUUID(),password=randomBytes(32).toString('base64url'),dir=path.resolve(__dirname,'../Docs/sftp-qa-'+runId);
 fs.mkdirSync(path.join(dir,'Satelitales','IMAGENES_HISTORICAS'),{recursive:true});fs.mkdirSync(path.join(dir,'Satelitales','IMAGENES_ACTUALES'));fs.mkdirSync(path.join(dir,'PDFs'));
 const id=docker(['run','-d','--label','tp.sftp.qa='+runId,'--publish','127.0.0.1::22','--mount',`type=bind,source=${path.join(dir,'Satelitales')},target=/home/sftp-lectura/Satelitales,readonly`,'--mount',`type=bind,source=${path.join(dir,'PDFs')},target=/home/sftp-lectura/PDFs,readonly`,'-e','SFTP_USERS','atmoz/sftp:debian@sha256:54efe2a6cda236d713042e17a836d970342eea5a7568e4f60800432cec4da205'],{...process.env,SFTP_USERS:'sftp-lectura:'+password+':1001'});
 async function close(){assert.equal(docker(['inspect','--format','{{index .Config.Labels "tp.sftp.qa"}}',id]),runId);docker(['rm','-f','-v',id]);}
 try{
  let key;for(let n=0;n<60;n++){try{key=docker(['exec',id,'cat','/etc/ssh/ssh_host_ed25519_key.pub']);if(key)break;}catch{}await new Promise(r=>setTimeout(r,300));}
  if(!key)throw Error('QA SSH startup');
  const host=key.split(/\s+/)[1],binding=docker(['port',id,'22/tcp']);assert.match(binding,/^127\.0\.0\.1:\d+$/);
  let ready=false;for(let n=0;n<60;n++){
   ready=await new Promise(resolve=>{const socket=require('node:net').connect({host:'127.0.0.1',port:Number(binding.split(':')[1])});let done=false;const timer=setTimeout(()=>finish(false),1500);const finish=value=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();resolve(value);};socket.on('error',()=>finish(false));socket.on('close',()=>finish(false));socket.on('data',data=>finish(data.toString().startsWith('SSH-')));});
   if(ready)break;await new Promise(r=>setTimeout(r,300));
  }if(!ready)throw Error('QA SSH not listening');
  const env={SFTP_IMAGES_ENABLED:'true',SFTP_IMAGES_HOST:'127.0.0.1',SFTP_IMAGES_PORT:binding.split(':')[1],SFTP_IMAGES_USER:'sftp-lectura',SFTP_IMAGES_PASSWORD:password,SFTP_IMAGES_HOST_KEY_VERIFIED:'true',SFTP_IMAGES_HOST_KEY_SHA256:'SHA256:'+createHash('sha256').update(Buffer.from(host,'base64')).digest('base64').replace(/=+$/,''),SFTP_IMAGES_TIMEOUT_MS:'5000'};
  return {id,dir,env,close,png,docker,put(name,bytes=png){fs.writeFileSync(path.join(dir,'Satelitales','IMAGENES_HISTORICAS',name),bytes);}};
 }catch(error){await close();throw error;}
}
module.exports={fixture};
