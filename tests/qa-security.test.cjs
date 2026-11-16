require('./register-ts.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createMariaHttp}=require('../Backend/server/mariadb/http.ts');
const {padCode,documentId,publicDocument}=require('../Backend/server/expedientes/contracts.ts');
const {jsonBody}=require('../Backend/server/security.ts');

test('QA Docker allowlist includes shared policy and excludes environment secrets',()=>{
 const {readFileSync}=require('node:fs');const {resolve}=require('node:path');
 const ignore=readFileSync(resolve(__dirname,'../.dockerignore'),'utf8').split(/\r?\n/);
 for(const rule of ['**','!shared/','!shared/**','**/.env*','**/runtime.env','**/*.key']) assert.ok(ignore.includes(rule),rule);
});

test('QA forged client privileges cannot cross admin or document authorization boundaries',async()=>{
 const origin='http://127.0.0.1:3000';let calls=0;
 const auth={identify:async()=>({id:'synthetic',role:'atencion_publico',enabled:true,mustChangePassword:false,sessionExpiresAt:Date.now()+60000})};
 const adapter=async()=>{calls++;return Response.json({ok:true});};
 const handler=createMariaHttp(auth,origin,undefined,undefined,{enter:async()=>()=>{},user:async()=>{}},adapter,adapter);
 for(const [path,method] of [['admin/users','GET'],['admin/users','POST'],['admin/audit','GET'],['parcels/1/expedientes','GET'],['expedientes/doc/descarga','GET']]){
  const response=await handler(new Request(origin+'/api/'+path,{method,headers:{origin,cookie:'tp_maria_session='+'a'.repeat(43),'x-role':'administrator','x-user-id':'admin','content-type':'application/json'},...(method==='POST'?{body:JSON.stringify({role:'administrator',verified:true})}:{})}),path.split('/'));
  assert.equal(response.status,403,path);
 }
 assert.equal(calls,0);
});

test('QA hostile origin is rejected before login executes',async()=>{
 let calls=0;const handler=createMariaHttp({login:async()=>{calls++;throw Error('unexpected');}},'http://127.0.0.1:3000',undefined,undefined,{enter:async()=>()=>{},user:async()=>{}});
 const response=await handler(new Request('http://127.0.0.1:3000/api/auth/login',{method:'POST',headers:{origin:'https://attacker.invalid','content-type':'application/json'},body:'{}'}),['auth','login']);
 assert.equal(response.status,403);assert.equal(calls,0);
});

test('QA document identifiers reject traversal, SQL metacharacters and signed-bigint overflow',()=>{
 for(const value of ['../private','%2e%2e%2fprivate','a/b','a\\b','x\u0000','x\r\nheader','x?token=y',"1' OR 1=1--"])
  assert.throws(()=>documentId(value));
 for(const value of ['0','-1','01','1e3','9223372036854775808',"1 OR 1=1"])
  assert.throws(()=>padCode(value));
 assert.equal(padCode('9223372036854775807'),'9223372036854775807');
 const dto=publicDocument({id:'qa',padCod:'1',storageKey:'private.pdf',password:'secret',role:'administrator'});
 assert.equal(Object.hasOwn(dto,'storageKey'),false);assert.equal(Object.hasOwn(dto,'password'),false);assert.equal(Object.hasOwn(dto,'role'),false);
});

test('QA JSON parser rejects nonobject bodies and oversized input independent of content-length',async()=>{
 const request=body=>new Request('http://localhost/api/test',{method:'POST',headers:{'content-type':'application/json','content-length':'1'},body});
 for(const body of ['[]','null','true','"text"','{bad']) await assert.rejects(jsonBody(request(body)),e=>e.status===400);
 await assert.rejects(jsonBody(request(JSON.stringify({value:'x'.repeat(65536)}))),e=>e.status===413);
});
