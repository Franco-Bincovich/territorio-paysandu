// Run only after explicit approval for these disposable QA accounts.
// Credentials arrive on stdin from an operator-controlled channel, never argv/logs.
// No administrative key, account creation, endpoint installation or SSO modification.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
export const ORIGIN = 'https://territorio-paysandu-prueba.vercel.app';
export async function runHostedQa(input, fetcher = fetch, protectionToken) {
  const checks = [];
  const fail = (stage) => { throw new Error(stage); };
  if (input?.confirmation !== 'kmimekswqpsuspkrxdet:two-synthetic-qa-users') fail('EXECUTION_CONFIRMATION_REQUIRED');
  if (!Array.isArray(input.accounts) || input.accounts.length !== 2) fail('TWO_QA_ACCOUNTS_REQUIRED');
  const names = ['Paysandu-QA-A', 'Paysandu-QA-B'];
  input.accounts.forEach((a,i) => {
    if(a.username !== names[i] || typeof a.password !== 'string' || typeof a.newPassword !== 'string' || a.password.length<12 || a.newPassword.length<12 || a.password===a.newPassword) fail('INVALID_QA_INPUT');
  });
  const jars = [new Map(),new Map()];
  async function call(index,path,method='GET',body) {
    const headers = {'accept':'application/json','origin':ORIGIN};
    if(protectionToken) headers['x-vercel-trusted-oidc-idp-token']=protectionToken;
    if(body) headers['content-type']='application/json';
    if(jars[index].size) headers.cookie=[...jars[index]].map(([k,v])=>`${k}=${v}`).join('; ');
    let response;
    try { response=await fetcher(ORIGIN+path,{method,headers,redirect:'manual',signal:AbortSignal.timeout(15000),body:body?JSON.stringify(body):undefined}); }
    catch { fail('NETWORK_FAILURE'); }
    if(!response.headers.get('content-type')?.includes('application/json')) fail('PROTECTION_OR_NON_JSON_RESPONSE');
    for(const cookie of response.headers.getSetCookie()) {
      const pair=cookie.split(';')[0];const pos=pair.indexOf('=');
      if(pos>0) { const name=pair.slice(0,pos),value=pair.slice(pos+1); if(value)jars[index].set(name,value);else jars[index].delete(name); }
    }
    let data;try{data=await response.json();}catch{fail('INVALID_JSON_RESPONSE');}
    return {status:response.status,data};
  }
  const expect=(condition,stage)=>{if(!condition)fail(stage);checks.push(stage);};
  // Never transmit passwords until the application's own closed-session response is visible.
  const probe=await call(0,'/api/session');
  expect(probe.status===401 && probe.data?.error?.code==='UNAUTHENTICATED','APPLICATION_AUTH_BOUNDARY');
  for(let i=0;i<2;i++) {
    const a=input.accounts[i];
    const login=await call(i,'/api/auth/login','POST',{username:a.username,password:a.password});
    expect(login.status===200 && login.data.mustChangePassword===true,`FIRST_LOGIN_${i}`);
    const blocked=await call(i,'/api/consultations');
    expect(blocked.status===403 && blocked.data?.error?.code==='PASSWORD_CHANGE_REQUIRED',`PRECHANGE_BLOCKED_${i}`);
    const changed=await call(i,'/api/auth/password','POST',{password:a.newPassword});
    expect(changed.status===200 && changed.data.mustChangePassword===false,`PASSWORD_CHANGED_${i}`);
  }
  const payload={locality:'LOCALIDAD SINTÉTICA',parcel:'900001',type:'General',description:'QA sintética de persistencia y permisos '+randomUUID(),person:{name:'PERSONA QA SINTÉTICA',documentType:'CI',document:'00000001',relationship:'Titular',phones:['00000000'],emails:['qa@example.invalid']},idempotencyKey:randomUUID()};
  const created=await call(0,'/api/consultations','POST',payload);
  expect(created.status===201 && typeof created.data.id==='string','CREATE_PERSISTED');
  const id=created.data.id;
  const retry=await call(0,'/api/consultations','POST',payload);
  expect(retry.status===201 && retry.data.id===id,'IDEMPOTENT_RETRY');
  const other=await call(1,`/api/consultations/${encodeURIComponent(id)}`);
  expect(other.status===200 && other.data.description===payload.description,'OTHER_COLLABORATOR_READ');
  const {idempotencyKey,...edit}=payload;edit.version=created.data.version;edit.description+=' corregida';
  const denied=await call(1,`/api/consultations/${encodeURIComponent(id)}`,'PATCH',edit);
  expect(denied.status===403,'OTHER_COLLABORATOR_EDIT_DENIED');
  const updated=await call(0,`/api/consultations/${encodeURIComponent(id)}`,'PATCH',edit);
  expect(updated.status===200 && updated.data.version===created.data.version+1,'OWNER_EDIT');
  const stale=await call(0,`/api/consultations/${encodeURIComponent(id)}`,'PATCH',edit);
  expect(stale.status===409,'STALE_VERSION_DENIED');
  for(let i=0;i<2;i++) {
    expect((await call(i,'/api/auth/logout','POST',{})).status===200,`LOGOUT_${i}`);
    const a=input.accounts[i];
    const old=await call(i,'/api/auth/login','POST',{username:a.username,password:a.password});
    expect(old.status===401,'OLD_PASSWORD_DENIED_'+i);
    const fresh=await call(i,'/api/auth/login','POST',{username:a.username,password:a.newPassword});
    expect(fresh.status===200 && fresh.data.mustChangePassword===false,'FRESH_LOGIN_'+i);
  }
  const persisted=await call(0,`/api/consultations/${encodeURIComponent(id)}`);
  expect(persisted.status===200 && persisted.data.description===edit.description,'PERSISTED_AFTER_RELOGIN');
  for(let i=0;i<2;i++) expect((await call(i,'/api/auth/logout','POST',{})).status===200,`FINAL_LOGOUT_${i}`);
  return {status:'PASS',checks,consultationId:id,limits:['App HTTP only; direct PostgREST/JWT/idle/session-revocation checks still required','Synthetic QA record intentionally retained; no destructive cleanup','Credential changes are real and require prior user approval']};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const input=JSON.parse(await readFile('/dev/stdin','utf8'));
    console.log(JSON.stringify(await runHostedQa(input,fetch,process.env.QA_VERCEL_OIDC_TOKEN)));
  } catch(error) {
    // Only internal stage labels; never raw SDK errors, response payloads or credentials.
    const stage=error instanceof Error && /^[A-Z_0-9]+$/.test(error.message)?error.message:'INPUT_OR_EXECUTION_FAILURE';
    console.log(JSON.stringify({status:'FAIL',stage}));process.exitCode=1;
  }
}
