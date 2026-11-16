require('./register-ts.cjs');
require.extensions['.css']=()=>{};
const {test}=require('node:test'),assert=require('node:assert/strict');
const {SftpImages}=require('../Backend/server/sftp-images/provider.ts');
const {HttpError}=require('../Backend/server/security.ts');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {ImageViewer}=require('../Frontend/src/components/parcel-view.tsx');
const ref={padCod:'999',parcel:'829',locality:'Paysandú'};
test('selected filename year is the only public historical date; selection and retry stay unchanged',async()=>{
 let names=['2000_PAYSANDU_829.png','2018_PAYSANDU_829_ANTES.png','1990_OTRA_829.png'],fail=false;
 const reader={read:async run=>run({filenames:async()=>names,file:async()=>{if(fail)throw new HttpError(503,'IMAGE_READ','unavailable');return {stat:{size:8,mtime:Date.now()}};}},1024)};
 const p=new SftpImages({},reader);
 try{
 await p.historical.refresh();let c=await p.catalogue(ref);assert.equal(c[0].historicalYear,2018);assert.equal(c[1].historicalYear,undefined);
 assert.ok(!JSON.stringify(c).includes('2018_PAYSANDU'));assert.ok(!JSON.stringify(c).includes('/Satelitales'));
 names=names.filter(n=>!n.includes('ANTES'));await p.historical.refresh();assert.equal((await p.catalogue(ref))[0].historicalYear,2000);
 assert.equal((await p.catalogue({...ref,locality:'OTRA'}))[0].historicalYear,1990);
 assert.equal((await p.catalogue({...ref,parcel:'830'}))[0].historicalYear,undefined);
 fail=true;assert.equal((await p.catalogue(ref))[0].url,null);fail=false;assert.equal((await p.catalogue(ref))[0].historicalYear,2000);
 names=['PAYSANDU_829_ANTES.png'];await p.historical.refresh();assert.equal((await p.catalogue(ref))[0].historicalYear,undefined);
 }finally{await p.historical.stop();}
});
test('viewer renders filename year or Sin datos immediately after source',()=>{
 for(const [year,expected] of [[2018,'2018'],[undefined,'Sin datos'],[NaN,'Sin datos'],[0,'Sin datos'],[10000,'Sin datos']]){
 const html=renderToStaticMarkup(React.createElement(ImageViewer,{images:[{kind:'historical',source:'Archivo institucional',historicalYear:year}]}));
 assert.ok(html.includes('Fuente: Archivo institucional</p><p class="meta">Fecha de la imagen: '+expected+'</p>'));
 }
});
