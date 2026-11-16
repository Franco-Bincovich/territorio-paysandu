// Linux-only filesystem semantics; run compiled copies in the production image.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
if(!process.env.QA_COMPILED)require('../scripts/register-runtime-ts.cjs');
const base=process.env.QA_COMPILED||'../Backend/server',ext=process.env.QA_COMPILED?'.js':'.ts';
const {FilesystemReader,filesystemEnvironment}=require(base+'/filesystem-images/reader'+ext),{SftpImages}=require(base+'/sftp-images/provider'+ext);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhRkAAAAASUVORK5CYII=','base64');
test('filesystem selection, isolation, errors, symlinks, permissions, index and cancellation',{skip:process.platform!=='linux'},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tp-fs-')),survey=path.join(dir,'survey'),historical=path.join(dir,'historical');await fs.mkdir(survey);await fs.mkdir(historical);
 const env={IMAGE_PROVIDER:'filesystem',FILESYSTEM_IMAGES_SURVEY_DIRECTORY:survey,FILESYSTEM_IMAGES_HISTORICAL_DIRECTORY:historical,FILESYSTEM_IMAGES_MAX_BYTES:'1024',FILESYSTEM_IMAGES_TIMEOUT_MS:'500'},reader=new FilesystemReader(env),provider=new SftpImages(env,reader);
 const ref={padCod:'9001',parcel:'123',locality:'Paysandú'};
 try{
  for(const invalid of ['/','/data/../etc','relative','/data/actuales/'])assert.throws(()=>filesystemEnvironment({...env,FILESYSTEM_IMAGES_SURVEY_DIRECTORY:invalid}),e=>e.code==='IMAGE_CONFIG');
  const missingRoot=path.join(dir,'missing-root'),missingReader=new FilesystemReader({...env,FILESYSTEM_IMAGES_SURVEY_DIRECTORY:missingRoot});await assert.rejects(missingReader.read(r=>r.directory(missingRoot)),e=>e.code==='IMAGE_CONFIG');missingReader.close();
  assert.equal(await provider.historical.refresh(),true);assert.ok((await provider.catalogue(ref)).every(x=>!x.url));
  await fs.writeFile(path.join(survey,'parcela_123_PAYSANDU.png'),png);
  for(const name of ['2000_PAYSANDU_123.png','2020_PAYSANDU_123_ANTES.png','2010_PAYSANDU_123_ANTES.png','1890_OTRA_123.png','1800_PAYSANDU_1234.png'])await fs.writeFile(path.join(historical,name),png);
  await provider.historical.refresh();assert.equal(provider.historical.lookup(ref).year,2010);assert.equal((await provider.catalogue(ref))[0].historicalYear,2010);assert.equal((await provider.catalogue(ref))[1].historicalYear,undefined);assert.equal((await provider.download('survey',ref)).status,200);
  assert.deepEqual(Buffer.from(await(await provider.download('historical',ref)).arrayBuffer()),png);
  await fs.unlink(path.join(historical,'2010_PAYSANDU_123_ANTES.png'));await assert.rejects(provider.download('historical',ref),e=>e.code==='IMAGE_INDEXED_FILE_MISSING');await fs.unlink(path.join(historical,'2020_PAYSANDU_123_ANTES.png'));await provider.historical.refresh();assert.equal(provider.historical.lookup(ref).year,2000);
  await assert.rejects(provider.download('survey',{...ref,locality:'OTRA'}),e=>e.code==='IMAGE_NOT_FOUND');await assert.rejects(provider.download('survey',{...ref,parcel:'1234'}),e=>e.code==='IMAGE_NOT_FOUND');
  await assert.rejects(reader.read(r=>r.download(survey,'../security.ts',1024)),e=>e.status===403);await assert.rejects(reader.read(r=>r.download('/etc','passwd.png',1024)),e=>e.status===403);
  const leaf=path.join(survey,'parcela_124_PAYSANDU.png');await fs.symlink('/etc/passwd',leaf);await assert.rejects(provider.download('survey',{...ref,parcel:'124'}),e=>e.status===403);
  const alias=path.join(dir,'alias');await fs.symlink(survey,alias);const aliasReader=new FilesystemReader({...env,FILESYSTEM_IMAGES_SURVEY_DIRECTORY:alias});await assert.rejects(aliasReader.read(r=>r.directory(alias)),e=>e.status===403);aliasReader.close();
  require('node:child_process').execFileSync('mkfifo',[path.join(survey,'parcela_125_PAYSANDU.png')]);await assert.rejects(provider.download('survey',{...ref,parcel:'125'}),e=>e.status===403);
  await fs.writeFile(path.join(survey,'parcela_126_PAYSANDU.png'),'invalid');await assert.rejects(provider.download('survey',{...ref,parcel:'126'}),e=>e.status===415);
  await fs.writeFile(path.join(survey,'parcela_127_PAYSANDU.png'),Buffer.alloc(1025));await assert.rejects(provider.download('survey',{...ref,parcel:'127'}),e=>e.status===413);
  const denied=path.join(survey,'parcela_128_PAYSANDU.png');await fs.writeFile(denied,png);await fs.chmod(denied,0);await assert.rejects(provider.download('survey',{...ref,parcel:'128'}),e=>e.status===403);await fs.chmod(denied,0o600);
  const ac=new AbortController();ac.abort();await assert.rejects(provider.download('survey',ref,ac.signal),e=>e.status===499);
  const running=new AbortController();await assert.rejects(reader.read(async r=>{running.abort();return r.download(survey,'parcela_123_PAYSANDU.png',1024);},'test',running.signal),e=>e.status===499);
  await assert.rejects(reader.read(async r=>{await new Promise(resolve=>setTimeout(resolve,510));return r.directory(survey);}),e=>e.code==='IMAGE_TIMEOUT');
 }finally{reader.close();await provider.historical.stop();await fs.rm(dir,{recursive:true,force:true});}
});
