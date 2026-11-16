require('./register-ts.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {ReadOnlySftp}=require('../Backend/server/sftp-images/reader.ts');
function fixture({truncate=false,grow=false,denied=false}={}){
 const expected=Buffer.alloc(400000);for(let i=0;i<expected.length;i++)expected[i]=i%251;
 const source=truncate?expected.subarray(0,150000):grow?Buffer.concat([expected,Buffer.from([1])]):expected;
 let active=0,peak=0,closed=false;const stat={size:expected.length,isFile:()=>true,isSymbolicLink:()=>false};
 const transport={open:(_path,mode,cb)=>{assert.equal(mode,'r');cb(null,Buffer.from('h'));},fstat:(_h,cb)=>cb(null,stat),close:(_h,cb)=>{assert.equal(active,0);closed=true;cb(null);},
 read:(_h,buffer,offset,length,position,cb)=>{active++;peak=Math.max(peak,active);setTimeout(()=>{active--;if(denied&&position===65536)return cb(Object.assign(Error(),{code:3}));const count=Math.max(0,Math.min(length,16384,source.length-position));if(count)source.copy(buffer,offset,position,position+count);cb(null,count);},position%3+1);}};
 const reader=new ReadOnlySftp(transport);reader.file=async()=>({file:'/safe/f.png',canonical:'/safe/f.png',stat});reader.realpath=async()=>'/safe/f.png';reader.lstat=async()=>stat;
 return {reader,expected,stats:()=>({active,peak,closed})};
}
test('bounded parallel reads reassemble exact bytes despite partial, out-of-order callbacks',async()=>{const f=fixture();assert.deepEqual(await f.reader.download('/safe','f.png',500000),f.expected);assert.deepEqual(f.stats(),{active:0,peak:4,closed:true});});
for(const mode of ['truncate','grow','denied'])test('reader rejects '+mode+' and drains reads before closing',async()=>{const f=fixture({[mode]:true});await assert.rejects(f.reader.download('/safe','f.png',500000),e=>e.code===(mode==='denied'?'IMAGE_ACCESS_DENIED':'IMAGE_INVALID'));assert.equal(f.stats().active,0);assert.equal(f.stats().closed,true);assert.ok(f.stats().peak<=4);});

function directoryFixture({denied=false}={}){let index=0,active=0,peak=0,closed=false;const pages=[[{filename:'a.png'},{filename:'.'}],[{filename:'b.png'}],[{filename:'c.png'}],false];const transport={opendir:(_dir,cb)=>cb(null,Buffer.from('d')),readdir:(_h,cb)=>{const i=index++;active++;peak=Math.max(peak,active);setTimeout(()=>{active--;if(denied&&i===1)return cb(Object.assign(Error(),{code:3}));cb(null,pages[i]??false);},8-i%4);},close:(_h,cb)=>{assert.equal(active,0);closed=true;cb(null);}};const reader=new ReadOnlySftp(transport);reader.directory=async()=>'/safe';return {reader,stats:()=>({active,peak,closed})};}
test('directory pages tolerate out-of-order replies and EOF in a bounded batch',async()=>{const f=directoryFixture();assert.deepEqual(await f.reader.filenames('/safe',3),['a.png','b.png','c.png']);assert.deepEqual(f.stats(),{active:0,peak:4,closed:true});});
test('directory limits and permission errors close handles after draining replies',async()=>{for(const denied of [false,true]){const f=directoryFixture({denied});await assert.rejects(f.reader.filenames('/safe',2),e=>e.code===(denied?'IMAGE_ACCESS_DENIED':'IMAGE_TOO_LARGE'));assert.equal(f.stats().active,0);assert.equal(f.stats().closed,true);}});
