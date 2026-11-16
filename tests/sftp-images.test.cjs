require('./register-ts.cjs');require.extensions['.css']=()=>{};

const {test}=require('node:test');const assert=require('node:assert/strict');

const {selectHistorical,selectSurvey,surveyExtensions,imagePadCod,sftpConfiguration,noSurvey}=require('../Backend/server/sftp-images/config.ts');

const {SftpImages,mediaType}=require('../Backend/server/sftp-images/provider.ts');

const {createMariaHttp}=require('../Backend/server/mariadb/http.ts');

const {createInstitutionalHttp}=require('../Backend/server/institutional/http.ts');

const {HttpError}=require('../Backend/server/security.ts');

const ref={padCod:'900900',locality:'Paysandú Chacras',parcel:'5901'};

const name=(year,suffix='')=>`${year}_PAYSANDU_CHACRAS_5901${suffix}.png`;

test('historical exact locality and parcel; never use PadCod as filename identity',()=>{

 assert.equal(selectHistorical(['2020_PAYSANDU_5901.png','2020_PAYSANDU_CHACRAS_15901.png','2020_PAYSANDU_CHACRAS_900900.png',name(2016)],ref).filename,name(2016));

 assert.throws(()=>selectHistorical(['2016_PAYSANDU_CHACRAS_59010.png'],ref),e=>e.code==='IMAGE_NOT_FOUND');

 assert.equal(selectHistorical(['2016_PAYSANDU_829.png'],{padCod:'999',locality:'Paysandú',parcel:'829'}).year,2016);

});

test('ANTES token has priority, then oldest year; DESPUES has no special ranking',()=>{

 assert.equal(selectHistorical([name(2016),name(2025,'_Antes')],ref).year,2025);

 assert.equal(selectHistorical([name(2016,'_XANTESY'),name(2025,'_ANTES')],ref).year,2025);

 assert.equal(selectHistorical([name(2016,'_DESPUES'),name(2025)],ref).year,2016);

 assert.equal(selectHistorical([name(2025,'_ANTES'),name(2024,'_antes')],ref).year,2024);

});

test('ties use ordinal case-folded filename order; case-only collisions fail closed',()=>{

 const candidates=[name(2016,'_B'),name(2016,'_A')];assert.equal(selectHistorical(candidates,ref).filename,name(2016,'_A'));assert.equal(selectHistorical(candidates.reverse(),ref).filename,name(2016,'_A'));

 assert.throws(()=>selectHistorical([name(2016,'_Antes'),name(2016,'_ANTES')],ref),e=>e.code==='IMAGE_AMBIGUOUS');

});

test('identity pin and sftp-lectura are mandatory; no admin or trust-on-first-use',()=>{

 const env={SFTP_IMAGES_ENABLED:'true',SFTP_IMAGES_HOST:'qa.test',SFTP_IMAGES_USER:'sftp-lectura',SFTP_IMAGES_PASSWORD:'synthetic',SFTP_IMAGES_HOST_KEY_SHA256:'SHA256:'+Buffer.alloc(32,1).toString('base64').replace(/=+$/,''),SFTP_IMAGES_HOST_KEY_VERIFIED:'true'};

 assert.equal(sftpConfiguration(env).username,'sftp-lectura');

 assert.throws(()=>sftpConfiguration({...env,SFTP_IMAGES_USER:'sftp-admin'}));

 assert.throws(()=>sftpConfiguration({...env,SFTP_IMAGES_HOST_KEY_VERIFIED:'false'}),e=>e.code==='IMAGE_HOST_KEY_UNVERIFIED');

 for(const id of ['../1','0','1/2','1?file=x','9223372036854775808'])assert.throws(()=>imagePadCod(id));

});

test('invalid binary content is rejected; PNG/JPEG/WebP/PDF signature recognition',()=>{

 assert.equal(mediaType(Buffer.from([137,80,78,71,13,10,26,10])),'image/png');assert.equal(mediaType(Buffer.from('%PDF-1.7')),'application/pdf');assert.equal(mediaType(Buffer.from([255,216,255])),'image/jpeg');assert.equal(mediaType(Buffer.from('RIFF0000WEBP')),'image/webp');assert.throws(()=>mediaType(Buffer.from('<html>')),e=>e.code==='IMAGE_INVALID');

});

test('empty directories yield both exact required texts with approved survey convention',async()=>{

 const fake={read:async run=>run({filenames:async()=>[],directory:async()=>'/safe',lstat:async()=>{throw new HttpError(404,'IMAGE_NOT_FOUND','missing');},directoryCount:async()=>0},1024)};

 const provider=new SftpImages({},fake);await provider.historical.refresh();const result=await provider.catalogue(ref);assert.equal(result[0].unavailableReason,'Este padrón aún no registra imágenes históricas');assert.equal(result[1].unavailableReason,noSurvey);

 const unrelated=await new SftpImages({},{read:async run=>run({filenames:async()=>[],directory:async()=>'/safe',lstat:async()=>{throw new HttpError(404,'IMAGE_NOT_FOUND','missing');}},1024)}).catalogue(ref);assert.equal(unrelated[1].unavailableCode,'IMAGE_NOT_FOUND');

});

test('image endpoints authenticate before SFTP and reject caller-supplied paths',async()=>{

 let touched=false;

 const provider={catalogue:async()=>{touched=true;return [];},download:async()=>{touched=true;return Response.json({});}};

 const repository={imageParcel:async()=>ref};

 const institutional=createInstitutionalHttp(repository,provider);

 const unauthorized=createMariaHttp({identify:async()=>{throw new HttpError(401,'UNAUTHENTICATED','Iniciá sesión.');}},'http://127.0.0.1:3105',institutional);

 const req=(path)=>new Request('http://127.0.0.1:3105/api/'+path,{headers:{host:'127.0.0.1:3105'}});

 assert.equal((await unauthorized(req('parcel-image/historical?padCod=900900'),['parcel-image','historical'])).status,401);assert.equal(touched,false);

 const auth=createMariaHttp({identify:async()=>({id:'qa',username:'qa',role:'collaborator',enabled:true,mustChangePassword:false})},'http://127.0.0.1:3105',institutional);

 assert.equal((await auth(req('parcel-image/historical?padCod=900900&path=/PDFs/other.png'),['parcel-image','historical'])).status,400);assert.equal(touched,false);

});



test('survey exact institutional parcel and normalized compound locality; no PadCod fallback',()=>{

 const ext=surveyExtensions({});

 const names=['parcela_5901_PAYSANDU.png','parcela_15901_PAYSANDU_CHACRAS.png','parcela_900900_PAYSANDU_CHACRAS.png','parcela_5901_PAYSANDU_CHACRAS.png'];

 assert.equal(selectSurvey(names,ref,ext).filename,'parcela_5901_PAYSANDU_CHACRAS.png');

 assert.equal(selectSurvey(['parcela_5901_paysandu_chacras.PNG'],{...ref,locality:'  Paysandú   Chacras '},ext).extension,'png');

 for(const name of ['parcela_59010_PAYSANDU_CHACRAS.png','parcela_5901_PAYSANDU.png','parcela_5901_PAYSANDU_CHACRAS_ANTES.png','parcela_5901_PAYSANDU_CHACRAS.svg','parcela_5901_PAY\u017fANDU_CHACRAS.png','../parcela_5901_PAYSANDU_CHACRAS.png','parcela_5901_PAYSANDU_CHACRAS.png.exe'])assert.throws(()=>selectSurvey([name],ref,ext),e=>e.code==='IMAGE_NOT_FOUND');

 for(const ext of ['jpg','jpeg','webp','pdf'])assert.throws(()=>selectSurvey(['parcela_5901_PAYSANDU_CHACRAS.'+ext],ref,ext),e=>e.code==='IMAGE_NOT_FOUND');

});

test('survey multiple extensions and case aliases fail closed, never choose arbitrarily',()=>{

 for(const names of [['parcela_5901_PAYSANDU_CHACRAS.png','parcela_5901_PAYSANDU CHACRAS.png'],['parcela_5901_PAYSANDU_CHACRAS.png','parcela_5901_paysandu_chacras.PNG']])assert.throws(()=>selectSurvey(names,ref,surveyExtensions({})),e=>e.code==='IMAGE_AMBIGUOUS');

 assert.throws(()=>surveyExtensions({SFTP_IMAGES_SURVEY_EXTENSIONS:'png,svg'}),e=>e.code==='IMAGE_CONFIG');

 assert.throws(()=>surveyExtensions({SFTP_IMAGES_SURVEY_EXTENSIONS:'png,PNG'}),e=>e.code==='IMAGE_CONFIG');

 assert.throws(()=>selectSurvey([], {...ref,locality:'../x'},['png']),e=>e.code==='IMAGE_AMBIGUOUS');

});

test('survey provider keeps API PadCod, validates binary content and emits only a safe ambiguity event',async()=>{

 const calls=[];let bytes=Buffer.from([137,80,78,71,13,10,26,10]);let names=['parcela_5901_PAYSANDU_CHACRAS.png'];

 const fake={read:async run=>run({filenames:async()=>names,directory:async()=>'/safe',lstat:async file=>{if(!names.includes(file.split('/').at(-1)))throw new HttpError(404,'IMAGE_NOT_FOUND','missing');return {};},file:async(dir,name)=>{calls.push(name);return {stat:{size:bytes.length,mtime:1}};},download:async()=>bytes},1024)};

 const provider=new SftpImages({},fake);let c=await provider.catalogue(ref);assert.match(c[1].url,/padCod=900900/);assert.equal(calls[0],names[0]);assert.equal((await provider.download('survey',ref)).headers.get('content-type'),'image/png');

 bytes=Buffer.from([137,80,78,71,13,10,26,10]);

 bytes=Buffer.from('%PDF-1.7');names=['parcela_5901_PAYSANDU_CHACRAS.png'];await assert.rejects(provider.download('survey',ref),e=>e.code==='IMAGE_INVALID');

 names=['parcela_5901_PAYSANDU_CHACRAS.png','parcela_5901_PAYSANDU CHACRAS.png'];const logs=[],warn=console.warn;try{console.warn=v=>logs.push(v);c=await provider.catalogue(ref);}finally{console.warn=warn;}

 assert.equal(c[1].unavailableCode,'IMAGE_AMBIGUOUS');assert.equal(c[1].url,null);assert.deepEqual(JSON.parse(logs[0]),{event:'image_resolution',slot:'survey',code:'IMAGE_AMBIGUOUS'});

});



 test('real server names distinguish same parcel across localities and safe separators',()=>{

 const names=['parcela_829_PAYSANDU.png','parcela_156_PAYSANDU.png','parcela_156_PAYSANDU CHACRAS.png'];

 for(const locality of ['Paysandú Chacras','PAYSANDU_CHACRAS',' Paysandú__  Chacras '])assert.equal(selectSurvey(names,{padCod:'999',parcel:'156',locality},['png']).filename,names[2]);

 assert.equal(selectSurvey(names,{padCod:'999',parcel:'156',locality:'Paysandú'},['png']).filename,names[1]);

 for(const locality of ['../Paysandu','Paysandu/Chacras','Paysandu-Chacras'])assert.throws(()=>selectSurvey(names,{...ref,locality},['png']));

 });

 test('provider uses real directories and distinguishes missing files from SFTP failures',async()=>{

 const paths=[];const fake={read:async run=>run({filenames:async dir=>{paths.push(dir);assert.ok(dir.endsWith('HISTORICAS'),'current directory must never be listed');return [];},directory:async()=>'/safe',lstat:async file=>{if(!file.endsWith('parcela_156_PAYSANDU CHACRAS.png'))throw new HttpError(404,'IMAGE_NOT_FOUND','missing');return {};},file:async()=>({stat:{size:8,mtime:1}})},1024)};

 const provider=new SftpImages({},fake);await provider.historical.refresh();const result=await provider.catalogue({padCod:'999',parcel:'156',locality:'Paysandú Chacras'});

 assert.deepEqual(paths,['/Satelitales/IMAGENES_HISTORICAS']);assert.equal(result[0].unavailableCode,'IMAGE_NOT_FOUND');assert.ok(result[1].url);

 for(const code of ['IMAGE_CONNECTION','IMAGE_ACCESS_DENIED','IMAGE_AUTHENTICATION','IMAGE_CONFIG']){

 const failed=await new SftpImages({},{read:async()=>{throw new HttpError(503,code,'Error SFTP');}}).catalogue(ref);

 assert.equal(failed[0].unavailableCode,'IMAGE_CATALOG_UNAVAILABLE');assert.equal(failed[1].unavailableCode,code);assert.equal(failed[1].unavailableReason,'Error SFTP');

 }

 });


test('same-reference concurrent catalogues share work separately from initial index',async()=>{let connections=0,release;const fake={read:async(run,operation)=>{connections++;if(operation!=='historical-index')await new Promise(r=>release=r);return run({filenames:async()=>[]},1024);}};const provider=new SftpImages({},fake);await provider.historical.refresh();const a=provider.catalogue(ref),b=provider.catalogue({...ref});assert.equal(a,b);release();await Promise.all([a,b]);assert.equal(connections,2);assert.equal(provider.pendingCatalogues.size,0);});
test('institutional pool failure stops image lookup before SFTP, without disguising it as transport failure',async()=>{let touched=false;const handler=createInstitutionalHttp({imageParcel:async()=>{throw new HttpError(503,'INSTITUTIONAL_UNAVAILABLE','Fuente institucional no disponible.');}},{catalogue:async()=>{touched=true;},download:async()=>{touched=true;}});await assert.rejects(handler(new Request('http://localhost/api/parcel-images?padCod=900900'),['parcel-images']),e=>e.code==='INSTITUTIONAL_UNAVAILABLE');assert.equal(touched,false);});

test('current exact names do not enumerate after the separate index scan',async()=>{let names=['parcela_5901_PAYSANDU_CHACRAS.png'];let lists=0;const reader={read:async run=>run({directory:async()=>'/safe',filenames:async()=>{lists++;return [];},lstat:async file=>{if(!names.includes(file.split('/').at(-1)))throw new HttpError(404,'IMAGE_NOT_FOUND','missing');return {};},download:async()=>Buffer.from([137,80,78,71,13,10,26,10])},1024)};const provider=new SftpImages({},reader);await provider.historical.refresh();assert.equal((await provider.download('survey',ref)).status,200);names.push('parcela_5901_PAYSANDU CHACRAS.png');await assert.rejects(provider.download('survey',ref),e=>e.code==='IMAGE_AMBIGUOUS');names=['parcela_5901_paysandu_chacras.PNG'];await assert.rejects(provider.download('survey',ref),e=>e.code==='IMAGE_NOT_FOUND');assert.equal(lists,1);});
