import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,type HandlerDependencies} from '../../src/server/handler';
const email='private-test-mailbox@example.invalid';
const origin='https://app.example.invalid';
function fixture(){
 const attempts:unknown[]=[];
 const user={id:'10000000-0000-4000-8000-000000000001',email};
 const deps={
  configuration:()=>({url:'https://synthetic.invalid',key:'synthetic-public-only',origin}),
  privilegedClient:()=>({rpc:async()=>({data:true,error:null})}),
  sessionClient:async()=>({auth:{signInWithPassword:async(input:unknown)=>{attempts.push(input);return {error:null};}}}),
  identity:async()=>({user,profile:{username:'Paysandu',role:'collaborator',enabled:true,must_change_password:true},client:{}}),
  catalogue:()=>{throw new Error('not used');},
 } as unknown as HandlerDependencies;
 return {handle:createHandler(deps),attempts};
}
async function withMapping(run:()=>Promise<void>){const previous=process.env.AUTH_USERNAME_EMAIL_MAP;process.env.AUTH_USERNAME_EMAIL_MAP=JSON.stringify({Paysandu:email});try{await run();}finally{if(previous===undefined)delete process.env.AUTH_USERNAME_EMAIL_MAP;else process.env.AUTH_USERNAME_EMAIL_MAP=previous;}}
function login(body:unknown){return new Request(origin+'/api/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});}
test('visible username maps internally to Auth email and never returns it',async()=>withMapping(async()=>{
 const f=fixture();const response=await f.handle(login({username:'paysandu',password:'synthetic-password-only'}),['auth','login'],()=>{});
 assert.equal(response.status,200);assert.deepEqual(f.attempts,[{email,password:'synthetic-password-only'}]);
 const body=await response.json();assert.deepEqual(body.user,{id:'10000000-0000-4000-8000-000000000001',username:'Paysandu'});assert.equal(body.mustChangePassword,true);
 assert.equal(JSON.stringify(body).includes(email),false);assert.equal(JSON.stringify(body).includes('synthetic-password-only'),false);
}));
test('session contains username and mandatory change flag but no email',async()=>withMapping(async()=>{
 const response=await fixture().handle(new Request(origin+'/api/session'),['session'],()=>{});const body=await response.json();assert.equal(response.status,200);assert.equal(body.user.username,'Paysandu');assert.equal(body.mustChangePassword,true);assert.equal(JSON.stringify(body).includes(email),false);
}));
test('email is not accepted as a substitute for visible username',async()=>withMapping(async()=>{
 const f=fixture();const response=await f.handle(login({username:email,password:'synthetic-password-only'}),['auth','login'],()=>{});assert.equal(response.status,401);assert.equal(f.attempts.length,0);assert.equal(JSON.stringify(await response.json()).includes(email),false);
}));
test('login payload cannot introduce an email field',async()=>withMapping(async()=>{
 const f=fixture();const response=await f.handle(login({username:'Paysandu',email,password:'synthetic-password-only'}),['auth','login'],()=>{});assert.equal(response.status,400);assert.equal(f.attempts.length,0);
}));
