import test from 'node:test';
import assert from 'node:assert/strict';
import {runHostedQa,ORIGIN} from '../../scripts/qa-hosted-auth.mjs';
const input={confirmation:'kmimekswqpsuspkrxdet:two-synthetic-qa-users',accounts:[{username:'Paysandu-QA-A',password:'synthetic-old-A-only',newPassword:'synthetic-new-A-only'},{username:'Paysandu-QA-B',password:'synthetic-old-B-only',newPassword:'synthetic-new-B-only'}]};
test('refuses unconfirmed execution before any request',async()=>{await assert.rejects(runHostedQa({...input,confirmation:''},()=>assert.fail('network must not run')),/EXECUTION_CONFIRMATION_REQUIRED/);});
test('Vercel protection stops before credential transmission',async()=>{const seen=[];await assert.rejects(runHostedQa(input,async(url,options)=>{seen.push({url,options});return new Response('Login',{status:401,headers:{'content-type':'text/html'}});}),/PROTECTION_OR_NON_JSON_RESPONSE/);assert.equal(seen.length,1);assert.equal(seen[0].url,ORIGIN+'/api/session');assert.equal(seen[0].options.body,undefined);assert.equal(seen[0].options.redirect,'manual');});
test('does not accept a generic JSON401 from protection as app login boundary',async()=>{let calls=0;await assert.rejects(runHostedQa(input,async()=>{calls++;return Response.json({error:{code:'SSO'}},{status:401});}),/APPLICATION_AUTH_BOUNDARY/);assert.equal(calls,1);});
test('wrong passwords do not trigger changes or business writes',async()=>{const paths=[];await assert.rejects(runHostedQa(input,async(url)=>{paths.push(url);return paths.length===1?Response.json({error:{code:'UNAUTHENTICATED'}},{status:401}):Response.json({error:{code:'INVALID_LOGIN'}},{status:401});}),/FIRST_LOGIN_0/);assert.deepEqual(paths,[ORIGIN+'/api/session',ORIGIN+'/api/auth/login']);});
test('successful synthetic transport covers full journey without reporting secrets',async()=>{
  const changed=[false,false];let saved;let idempotency;const seen=[];
  const fake=async(url,options)=>{
    const path=new URL(url).pathname;const body=options.body?JSON.parse(options.body):undefined;
    const index=Number(options.headers.cookie?.split('=')[1]??0);seen.push(path);
    assert.ok(options.signal instanceof AbortSignal);
    const reply=(data,status=200,cookie)=>Response.json(data,{status,headers:cookie?{'set-cookie':cookie}:{}});
    if(path==='/api/session')return reply({error:{code:'UNAUTHENTICATED'}},401);
    if(path==='/api/auth/login'){
      const i=input.accounts.findIndex(a=>a.username===body.username);
      if(i<0 || body.password!==(changed[i]?input.accounts[i].newPassword:input.accounts[i].password))return reply({error:{code:'INVALID_LOGIN'}},401);
      return reply({mustChangePassword:!changed[i]},200,`qa=${i}; Path=/; HttpOnly`);
    }
    if(path==='/api/auth/password'){changed[index]=true;return reply({mustChangePassword:false});}
    if(path==='/api/auth/logout')return reply({ok:true},200,'qa=; Max-Age=0');
    if(path==='/api/consultations' && options.method==='GET')return reply({error:{code:'PASSWORD_CHANGE_REQUIRED'}},403);
    if(path==='/api/consultations' && options.method==='POST'){
      if(!saved){saved={...body,id:'10000000-0000-4000-8000-000000000001',version:1};idempotency=body.idempotencyKey;}
      assert.equal(body.idempotencyKey,idempotency);return reply(saved,201);
    }
    if(path.endsWith('/'+saved.id)){
      if(options.method==='PATCH'){
        if(index===1)return reply({error:{code:'FORBIDDEN'}},403);
        if(body.version!==saved.version)return reply({error:{code:'CONFLICT'}},409);
        saved={...saved,...body,version:saved.version+1};
      }
      return reply(saved);
    }
    assert.fail('Unexpected synthetic request');
  };
  const result=await runHostedQa(input,fake,'synthetic-oidc-test-only');
  assert.equal(result.status,'PASS');assert.ok(result.checks.includes('PERSISTED_AFTER_RELOGIN'));
  assert.ok(result.checks.includes('OTHER_COLLABORATOR_EDIT_DENIED'));
  assert.ok(result.checks.includes('FINAL_LOGOUT_1'));
  const report=JSON.stringify(result);for(const a of input.accounts){assert.equal(report.includes(a.password),false);assert.equal(report.includes(a.newPassword),false);}
  assert.equal(report.includes('synthetic-oidc-test-only'),false);
});
test('transport error is sanitized instead of echoing credentials',async()=>{
  await assert.rejects(runHostedQa(input,async()=>{throw new Error('synthetic-password-must-not-appear');}),e=>e.message==='NETWORK_FAILURE');
});
