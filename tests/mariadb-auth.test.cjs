require('./register-ts.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { createMariaAuth, hashPassword, tokenHash, sessionCookie } = require('../Backend/server/mariadb/auth.ts');
const { poolConfiguration } = require('../Backend/server/mariadb/pool.ts');
const { requestedAuthProvider } = require('../Backend/server/mariadb/provider.ts');
const { isRole } = require('../shared/permissions.ts');
const rejects = (promise, status, code) => assert.rejects(promise, e => e.status === status && (!code || e.code === code));

async function fixture() {
  let time = Date.now();
  const password = randomBytes(24).toString('base64url');
  const user = { id: 'isolated', username: 'tester', enabled: true, role: 'collaborator',
    mustChangePassword: false, passwordHash: await hashPassword(password) };
  const sessions = new Map(), attempts = new Map();
  const store = {
    async reserveAttempt(key, now, limit, window) {
      const entry = attempts.get(key) ?? { start: now, count: 0 };
      if (now >= entry.start + window) { entry.start = now; entry.count = 0; }
      attempts.set(key, entry);
      return ++entry.count <= limit;
    },
    async findUser(name) { return name === user.username ? { ...user } : null; },
    async issueSession(session, expected) {
      if (!user.enabled || !isRole(user.role) || user.passwordHash !== expected) return false;
      sessions.set(session.tokenHash, { ...session }); return true;
    },
    async sessionWithUser(hash) { const session = sessions.get(hash); return session ? { session, user: { ...user } } : null; },
    async revokeSession(hash) { const session = sessions.get(hash); if (session) session.revoked = true; },
    async changePassword(hash, expected, next, now) {
      const session = sessions.get(hash);
      if (!session || session.revoked || session.expiresAt <= now || expected !== user.passwordHash) return false;
      user.passwordHash = next; user.mustChangePassword = false;
      for (const s of sessions.values()) s.revoked = true;
      return true;
    },
  };
  return { auth: await createMariaAuth(store, () => time), user, password, sessions, store,
    advance: ms => { time += ms; } };
}

test('Argon2id login, random token and hash-only persistence; current role and enabled checked', async () => {
  const f = await fixture();
  assert.match(f.user.passwordHash, /^\$argon2id\$/);
  const login = await f.auth.login(' TESTER ', f.password);
  assert.equal(login.token.length, 43);
  assert.equal(f.sessions.has(login.token), false);
  assert.equal(f.sessions.get(tokenHash(login.token)).tokenHash, tokenHash(login.token));
  assert.equal((await f.auth.identify(login.token)).id, f.user.id);
  f.user.enabled = false;
  await rejects(f.auth.identify(login.token), 403);
  f.user.enabled = true; f.user.role = 'admin';
  await rejects(f.auth.identify(login.token), 403);
});
test('incorrect password, unknown user, disabled user and wrong role share generic failure', async () => {
  const f = await fixture();
  await rejects(f.auth.login('tester', randomBytes(24).toString('hex')), 401, 'INVALID_LOGIN');
  await rejects(f.auth.login('missing', f.password), 401, 'INVALID_LOGIN');
  f.user.enabled = false;
  await rejects(f.auth.login('tester', f.password), 401, 'INVALID_LOGIN');
  f.user.enabled = true; f.user.role = 'admin';
  await rejects(f.auth.login('tester', f.password), 401, 'INVALID_LOGIN');
  assert.equal(f.sessions.size, 0);
});
test('all three roles authenticate and sessions reload current roles without cached privileges', async () => {
  const f = await fixture();
  for (const role of ['atencion_publico', 'collaborator', 'administrator']) {
    f.user.role = role;
    const login = await f.auth.login('tester', f.password);
    assert.equal(login.user.role, role);
    assert.equal((await f.auth.identify(login.token)).role, role);
    f.user.role = 'atencion_publico';
    assert.equal((await f.auth.identify(login.token)).role, 'atencion_publico');
  }
});
test('soft-deleted account is rejected even if a faulty adapter reports enabled', async () => {
  const f = await fixture();
  const login = await f.auth.login('tester', f.password);
  f.user.deletedAt = new Date().toISOString();
  await rejects(f.auth.identify(login.token), 403);
  await rejects(f.auth.login('tester', f.password), 401, 'INVALID_LOGIN');
});
test('attempt limit includes unknown accounts, normalizes names, resets after window', async () => {
  const f = await fixture();
  for (let i = 0; i < 5; i++) await rejects(f.auth.login(' MISSING ', f.password), 401);
  await rejects(f.auth.login('missing', f.password), 429);
  f.advance(15 * 60_000);
  await rejects(f.auth.login('missing', f.password), 401);
});
test('logout, expiration boundary, missing and forged sessions deny private access', async () => {
  const f = await fixture();
  await rejects(f.auth.identify(undefined), 401);
  await rejects(f.auth.identify(randomBytes(32).toString('base64url')), 401);
  const first = await f.auth.login('tester', f.password);
  await f.auth.logout(first.token);
  await rejects(f.auth.identify(first.token), 401);
  const second = await f.auth.login('tester', f.password);
  f.advance(8 * 60 * 60_000);
  await rejects(f.auth.identify(second.token), 401);
});
test('mandatory password change blocks private access, rejects reuse, revokes all sessions', async () => {
  const f = await fixture(); f.user.mustChangePassword = true;
  const a = await f.auth.login('tester', f.password), b = await f.auth.login('tester', f.password);
  await rejects(f.auth.identify(a.token), 403, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await f.auth.identify(a.token, true)).mustChangePassword, true);
  await rejects(f.auth.changePassword(a.token, f.password, f.password, f.password), 400);
  await rejects(f.auth.changePassword(a.token, f.password, 'short', 'short'), 400);
  const next = randomBytes(24).toString('base64url');
  await f.auth.changePassword(a.token, f.password, next, next);
  await rejects(f.auth.identify(a.token), 401); await rejects(f.auth.identify(b.token), 401);
  await rejects(f.auth.login('tester', f.password), 401);
  const fresh = await f.auth.login('tester', next);
  assert.equal(fresh.mustChangePassword, false);
  await f.auth.identify(fresh.token);
});
test('atomic persistence rejection cannot issue a token; persistence failure is fail closed', async () => {
  const f = await fixture();
  f.store.issueSession = async () => false;
  await rejects(f.auth.login('tester', f.password), 401);
  f.store.reserveAttempt = async () => { throw Error('DB unavailable'); };
  await assert.rejects(f.auth.login('tester', f.password));
  assert.equal(f.sessions.size, 0);
});
test('cookies and pool reject insecure remote configuration; default provider remains Supabase', () => {
  const token = randomBytes(32).toString('base64url');
  assert.match(sessionCookie(token, 'https://example.test', Date.now()), /HttpOnly; SameSite=Lax;.*; Secure$/);
  assert.doesNotMatch(sessionCookie(token, 'http://127.0.0.1:3000', Date.now()), /Secure/);
  assert.throws(() => sessionCookie(token, 'http://remote.test', Date.now()));
  assert.match(sessionCookie('', 'https://example.test', 0), /1970/);
  assert.throws(() => poolConfiguration({}));
  const env = { MARIADB_HOST: 'remote.test', MARIADB_USER: 'qa', MARIADB_PASSWORD: token, MARIADB_DATABASE: 'auxiliares' };
  assert.throws(() => poolConfiguration({ ...env, MARIADB_TLS: 'false' }));
  assert.equal(poolConfiguration(env).ssl.rejectUnauthorized, true);
  assert.equal(requestedAuthProvider({}), 'supabase');
  assert.throws(() => requestedAuthProvider({ AUTH_PROVIDER: 'mariadb-test' }));
  assert.throws(() => requestedAuthProvider({ AUTH_PROVIDER: 'mariadb-test', MARIADB_AUTH_TEST_ENABLED: 'true', NODE_ENV: 'production' }));
  assert.equal(requestedAuthProvider({ AUTH_PROVIDER: 'mariadb-test', MARIADB_AUTH_TEST_ENABLED: 'true' }), 'mariadb-test');
  assert.throws(() => requestedAuthProvider({ AUTH_PROVIDER: 'mariadb-test', MARIADB_AUTH_TEST_ENABLED: 'true', APP_ORIGIN: 'https://remote.test' }));
});


test('current password proof, confirmation and common password rejection cannot mutate credentials',async()=>{
 const f=await fixture(),login=await f.auth.login('tester',f.password),next=randomBytes(24).toString('hex'),original=f.user.passwordHash;
 await rejects(f.auth.changePassword(login.token,'wrong current',next,next),400,'CURRENT_PASSWORD_INVALID');
 await rejects(f.auth.changePassword(login.token,f.password,next,next+'x'),400,'PASSWORD_CONFIRMATION');
 await rejects(f.auth.changePassword(login.token,f.password,'password123456','password123456'),400,'PASSWORD_COMMON');
 assert.equal(f.user.passwordHash,original);assert.equal(f.sessions.get(tokenHash(login.token)).revoked,false);
});
test('temporary credentials remain valid at 24, 48 and 72 hours but sessions still expire',async()=>{
 const f=await fixture();f.user.mustChangePassword=true;
 let previous=await f.auth.login('tester',f.password);
 for(const hours of [24,48,72]){
  f.advance(24*3600000);
  await rejects(f.auth.identify(previous.token,true),401,'UNAUTHENTICATED');
  const fresh=await f.auth.login('tester',f.password);
  assert.equal(fresh.mustChangePassword,true,`${hours} hours`);
  assert.equal((await f.auth.identify(fresh.token,true)).id,f.user.id);
  await rejects(f.auth.identify(fresh.token),403,'PASSWORD_CHANGE_REQUIRED');
  assert.equal(fresh.expiresAt-f.sessions.get(tokenHash(previous.token)).expiresAt,24*3600000);
  previous=fresh;
 }
 const next=randomBytes(24).toString('hex');
 await f.auth.changePassword(previous.token,f.password,next,next);
 await rejects(f.auth.identify(previous.token,true),401,'UNAUTHENTICATED');
 await rejects(f.auth.login('tester',f.password),401,'INVALID_LOGIN');
 const changed=await f.auth.login('tester',next);assert.equal(changed.mustChangePassword,false);
});

test('current-password guessing uses persistent account budget',async()=>{
 const f=await fixture(),login=await f.auth.login('tester',f.password),next=randomBytes(24).toString('hex');
 for(let i=0;i<4;i++)await rejects(f.auth.changePassword(login.token,'wrong current',next,next),400,'CURRENT_PASSWORD_INVALID');
 await rejects(f.auth.changePassword(login.token,f.password,next,next),429,'RATE_LIMIT');
});


test('manual create/reset integrates real Argon2 with mandatory change and revoked sessions in memory',async()=>{
 const {AdminService}=require('../Backend/server/admin/service.ts');
 const {randomUUID}=require('node:crypto');
 const adminId=randomUUID(),admin={id:adminId,username:'qa_admin',role:'administrator',enabled:true,mustChangePassword:false,revision:1};
 const actor={verified:true,userId:adminId,role:'administrator',enabled:true,mustChangePassword:false,expiresAt:Date.now()+3600000,sessionHash:'admin-session'};
 let state={users:new Map([[adminId,admin]]),credentials:new Map(),sessions:new Map(),events:[]};
 const repository={transaction:async(_actor,_target,run)=>{
  const draft=structuredClone(state);
  const tx={principal:async()=>actor,get:async id=>draft.users.get(id)??null,findUsername:async name=>[...draft.users.values()].find(u=>u.username===name)??null,
   put:async user=>draft.users.set(user.id,user),credential:async(id,c)=>draft.credentials.set(id,c.passwordHash),audit:async event=>draft.events.push(event),
   revokeSessions:async id=>{for(const session of draft.sessions.values())if(session.userId===id)session.revoked=true;}};
  const result=await run(tx);state=draft;return result;
 },denied:async event=>state.events.push(event)};
 const service=new AdminService(repository),context={requestId:randomUUID()},reason='Prueba integrada sintética';
 const initial=randomBytes(24).toString('hex'),reset=randomBytes(24).toString('hex'),definitive=randomBytes(24).toString('hex');
 const created=await service.create(actor,{firstName:'Persona',lastName:'QA',email:'qa-new@example.test',username:'qa_new',role:'atencion_publico',reason,temporalPassword:initial,confirmPassword:initial},'',context);
 const store={reserveAttempt:async()=>true,findUser:async name=>{const u=[...state.users.values()].find(u=>u.username===name);return u?{...u,passwordHash:state.credentials.get(u.id)}:null;},
  issueSession:async(session,expected)=>{if(state.credentials.get(session.userId)!==expected)return false;state.sessions.set(session.tokenHash,session);return true;},
  sessionWithUser:async hash=>{const session=state.sessions.get(hash);return session?{session,user:{...state.users.get(session.userId),passwordHash:state.credentials.get(session.userId)}}:null;},
  revokeSession:async hash=>{if(state.sessions.has(hash))state.sessions.get(hash).revoked=true;},
  changePassword:async(hash,expected,next)=>{const session=state.sessions.get(hash);if(!session||session.revoked||state.credentials.get(session.userId)!==expected)return false;state.credentials.set(session.userId,next);state.users.get(session.userId).mustChangePassword=false;state.users.get(session.userId).revision++;for(const s of state.sessions.values())if(s.userId===session.userId)s.revoked=true;return true;}};
 const auth=await createMariaAuth(store);
 assert.match(state.credentials.get(created.user.id),/^\$argon2id\$/);
 const first=await auth.login('qa_new',initial);assert.equal(first.mustChangePassword,true);
 await rejects(auth.identify(first.token),403,'PASSWORD_CHANGE_REQUIRED');
 await auth.changePassword(first.token,initial,definitive,definitive);await rejects(auth.identify(first.token),401);
 const active=await auth.login('qa_new',definitive);assert.equal(active.mustChangePassword,false);
 await service.reset(actor,created.user.id,{expectedRevision:2,reason,temporalPassword:reset,confirmPassword:reset},'',context);
 await rejects(auth.identify(active.token),401);await rejects(auth.login('qa_new',definitive),401);
 const again=await auth.login('qa_new',reset);assert.equal(again.mustChangePassword,true);await rejects(auth.identify(again.token),403);
 const publicData=JSON.stringify({created,audits:state.events});for(const secret of [initial,reset,definitive])assert.equal(publicData.includes(secret),false);
 assert.doesNotMatch(publicData,/passwordHash|\$argon2/);
});


test('username capitalization shares one identity while password capitalization remains significant',async()=>{
 const f=await fixture();
 for(const spelling of ['Tester','TESTER','tester']){
  const result=await f.auth.login(spelling,f.password);assert.equal(result.user.id,f.user.id);
 }
 await rejects(f.auth.login('TESTER',f.password.toUpperCase()+'X'),401,'INVALID_LOGIN');
});
