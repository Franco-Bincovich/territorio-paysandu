require('../../../scripts/register-runtime-ts.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {HistoricalIndex,HISTORICAL_REFRESH_MS}=require('./historical-index.ts');
const {SftpImages}=require('./provider.ts');
const {HttpError}=require('../security.ts');
const ref={padCod:'9001',parcel:'123',locality:'Paysandú Chacras'};
const file=(year,tag='')=>`${year}_PAYSANDU_CHACRAS_123${tag}.png`;
test('initial publication requires EOF; a valid empty index means absence',async()=>{
 let release;const index=new HistoricalIndex(()=>new Promise(r=>release=r));
 const pending=index.refresh();await Promise.resolve();assert.throws(()=>index.lookup(ref),e=>e.code==='IMAGE_CATALOG_UNAVAILABLE');
 release([]);assert.equal(await pending,true);assert.throws(()=>index.lookup(ref),e=>e.code==='IMAGE_NOT_FOUND');await index.stop();
});
test('more than 35000 names, exact keys, numeric splits, ANTES and ambiguity',async()=>{
 const names=Array.from({length:35001},(_,i)=>`1990_PAYSANDU_${10000+i}.png`);
 names.push(file(1890),file(2035,'_ANTES_COPIA_2'),'2000_PAYSANDU_CHACRAS_1230.png','1900_PAYSANDU_123.png','2000_LOC_123_456_ANTES.png');
 const index=new HistoricalIndex(async()=>names);await index.refresh();assert.equal(index.status().files,35006);
 assert.equal(index.lookup(ref).filename,file(2035,'_ANTES_COPIA_2'));
 assert.equal(index.lookup({...ref,locality:'PAYSANDU'}).year,1900);
 assert.equal(index.lookup({...ref,locality:'LOC',parcel:'123'}).year,2000);
 assert.equal(index.lookup({...ref,locality:'LOC_123',parcel:'456'}).year,2000);
 names.push(file(2035,'_antes_copia_2'));await index.refresh();assert.throws(()=>index.lookup(ref),e=>e.code==='IMAGE_AMBIGUOUS');await index.stop();
});
test('hourly fixed cadence, no reset on reads, no overlap, old snapshot during refresh',async()=>{
 let now=0,tick,interval,cancelled=0,calls=0,hold,block=false;let names=[file(2000)];
 const index=new HistoricalIndex(async()=>{calls++;if(block)await new Promise(r=>hold=r);return [...names];},{now:()=>now,schedule:(fn,ms)=>{tick=fn;interval=ms;return{};},cancel:()=>cancelled++});
 index.start();await index.refresh();assert.equal(interval,3600000);assert.equal(HISTORICAL_REFRESH_MS,3600000);
 for(let i=0;i<100;i++)index.lookup(ref);assert.equal(calls,1);
 now=3600000;block=true;names=[file(2000),file(2025,'_ANTES')];tick();await Promise.resolve();const p=index.refresh();tick();assert.equal(calls,2);assert.equal(index.lookup(ref).year,2000);
 hold();assert.equal(await p,true);assert.equal(index.lookup(ref).year,2025);assert.equal(index.status().lastSuccess,3600000);
 block=false;names=[file(1990)];now+=3600000;tick();await index.refresh();assert.equal(index.lookup(ref).year,1990);assert.equal(calls,3);
 await index.stop();assert.equal(cancelled,1);tick();assert.equal(await index.refresh(),false);assert.equal(calls,3);
});
test('failure or budget exhaustion never replaces an existing snapshot with partial data',async()=>{
 let names=[file(2000)],fail=false;const reports=[];
 const index=new HistoricalIndex(async()=>{if(fail)throw Error('/private/path credential');return names;},{maxEntries:3,maxBytes:2048,report:s=>reports.push(s)});
 await index.refresh();fail=true;assert.equal(await index.refresh(),false);assert.equal(index.lookup(ref).year,2000);
 assert.ok(!JSON.stringify(reports).includes('private'));assert.equal(index.status().error,'IMAGE_CONNECTION');
 fail=false;names=[file(1990),file(1980),file(1970),file(1960)];assert.equal(await index.refresh(),false);assert.equal(index.lookup(ref).year,2000);
 assert.equal(index.status().error,'IMAGE_INDEX_LIMIT');await index.stop();
 const bytes=new HistoricalIndex(async()=>[file(2000)],{maxBytes:1});assert.equal(await bytes.refresh(),false);assert.throws(()=>bytes.lookup(ref),e=>e.code==='IMAGE_CATALOG_UNAVAILABLE');await bytes.stop();
});
test('failed first construction waits for the next scheduled hour, not user activity',async()=>{
 let tick,calls=0;const index=new HistoricalIndex(async()=>{calls++;throw new HttpError(503,'IMAGE_TIMEOUT','safe');},{schedule:fn=>{tick=fn;return{};},cancel:()=>{}});
 index.start();await index.refresh();for(let i=0;i<30;i++)assert.throws(()=>index.lookup(ref),e=>e.code==='IMAGE_CATALOG_UNAVAILABLE');assert.equal(calls,1);
 tick();await index.refresh();assert.equal(calls,2);await index.stop();
});
test('stop aborts an in-flight build and prevents publication',async()=>{
 let signal;const index=new HistoricalIndex(s=>new Promise((_,reject)=>{signal=s;s.addEventListener('abort',()=>reject(Error('aborted')));}),{schedule:()=>({}),cancel:()=>{}});
 index.start();await Promise.resolve();await index.stop();assert.ok(signal.aborted);assert.equal(index.status().lastSuccess,null);assert.throws(()=>index.lookup(ref),e=>e.code==='IMAGE_CATALOG_UNAVAILABLE');
});
test('late completed traversal exceeds its deadline instead of publishing',async()=>{
 let mono=0;const index=new HistoricalIndex(async()=>{mono=10001;return[file(2000)];},{monotonic:()=>mono,timeoutMs:10000});
 assert.equal(await index.refresh(),false);assert.equal(index.status().error,'IMAGE_TIMEOUT');assert.throws(()=>index.lookup(ref),e=>e.code==='IMAGE_CATALOG_UNAVAILABLE');await index.stop();
});
test('30 historical lookups use names only; removed file errors do not poison other keys',async()=>{
 let scans=0,downloads=0,removed=false;
 const reader={read:async run=>run({filenames:async()=>{scans++;return[file(2000),'1990_PAYSANDU_999.png'];},download:async()=>{downloads++;if(removed)throw new HttpError(404,'IMAGE_NOT_FOUND','missing');return Buffer.from([137,80,78,71,13,10,26,10]);}},1024)};
 const images=new SftpImages({},reader);await images.historical.refresh();
 await Promise.all(Array.from({length:30},()=>images.download('historical',ref)));assert.equal(scans,1);assert.equal(downloads,30);
 removed=true;await assert.rejects(images.download('historical',ref),e=>e.code==='IMAGE_INDEXED_FILE_MISSING');assert.equal(images.historical.lookup({...ref,parcel:'999',locality:'PAYSANDU'}).year,1990);
 await images.historical.stop();
});
test('cross-bundle errors retain only approved codes and safe messages',async()=>{
 const {localImageError}=require('./config.ts');
 const foreign={code:'IMAGE_NOT_FOUND',status:500,message:'/private/credential'};
 const index={start(){},lookup(){throw foreign;}};
 const reader={read:async run=>run({lstat:async()=>{throw foreign;},directory:async()=>'/safe'},1024)};
 const provider=new SftpImages({},reader,index);const result=await provider.catalogue(ref);
 assert.equal(result[0].unavailableCode,'IMAGE_NOT_FOUND');assert.equal(result[0].unavailableReason,'Este padrón aún no registra imágenes históricas');
 assert.ok(!JSON.stringify(result).includes('private'));assert.equal(localImageError(foreign).status,404);
 assert.equal(localImageError({code:'UNKNOWN',status:200,message:'private'}).code,'IMAGE_CONNECTION');
});
test('raw filename byte budget rejects and drains before closing the directory',async()=>{
 const {ReadOnlySftp}=require('./reader.ts');let active=0,closed=false;
 const transport={opendir:(_p,cb)=>cb(null,Buffer.from('h')),readdir:(_h,cb)=>{active++;setImmediate(()=>{active--;cb(null,[{filename:file(2000)}]);});},close:(_h,cb)=>{assert.equal(active,0);closed=true;cb(null);}};
 const reader=new ReadOnlySftp(transport);reader.directory=async()=>'/safe';
 await assert.rejects(reader.filenames('/safe',100000,2),e=>e.code==='IMAGE_INDEX_LIMIT');assert.equal(closed,true);
});
