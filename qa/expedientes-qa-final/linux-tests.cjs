// Prepare bounded Linux security tests without putting test tooling in the release image.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),runtime=path.join(__dirname,'.runtime/linux-tests');
const swc=require(`@next/swc-${process.platform}-${process.arch}${process.platform==='win32'?'-msvc':'-gnu'}`);
function compile(relative){
 const source=path.join(root,relative),target=path.join(runtime,relative);
 if(fs.statSync(source).isDirectory()){fs.mkdirSync(target,{recursive:true});for(const item of fs.readdirSync(source))compile(relative+'/'+item);return;}
 if(!relative.endsWith('.ts'))return;
 const code=swc.transformSync(fs.readFileSync(source,'utf8'),false,Buffer.from(JSON.stringify({filename:source,jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'commonjs'}}))).code;
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,code);
}
for(const directory of ['Backend/server','Backend/domain','shared'])compile(directory);
fs.mkdirSync(path.join(runtime,'tests'),{recursive:true});
for(const file of ['expedientes-institutional.test.cjs','expedientes.cjs','docx-fixture.cjs','expedientes-conversion.test.cjs'])fs.copyFileSync(path.join(root,'tests',file),path.join(runtime,'tests',file));
fs.writeFileSync(path.join(runtime,'tests/register-ts.cjs'),`const Module=require('node:module'),path=require('node:path');const resolve=Module._resolveFilename;Module._resolveFilename=function(name,...args){return resolve.call(this,name==='@backend/domain'?path.join(__dirname,'../Backend/domain/index.ts'):name,...args);};require.extensions['.ts']=require.extensions['.js'];`);
// Imports unbundled backend modules, including mariadb: use the dependencies
// build target, not the slim standalone runner. This suite is not real PDF QA.
const image=process.argv[2];if(!image||!/^territorio-paysandu:(?:qa-[a-z0-9.-]+-dependencies|expedientes-test-dependencies)$/.test(image))throw Error('Build Dockerfile --target dependencies and supply its explicit QA dependencies tag');
const args=['run','--rm','--user','1001:1001','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','1g','--cpus','1','--pids-limit','128','--tmpfs','/tmp:rw,noexec,nosuid,size=256m','--mount',`type=bind,source=${runtime},target=/qa,readonly`,'-e','NODE_PATH=/app/node_modules',image,'node','--test','/qa/tests/expedientes-institutional.test.cjs','/qa/tests/expedientes.cjs','/qa/tests/expedientes-conversion.test.cjs'];
const result=spawnSync('docker',args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:8*1024*1024});
fs.writeFileSync(path.join(__dirname,'linux-tests.log'),(result.stdout||'')+(result.stderr||''));
console.log((result.stdout||'').split('\n').slice(-12).join('\n'));if(result.status!==0)console.error(result.stderr||'Linux tests failed; see log');process.exitCode=result.status??1;
