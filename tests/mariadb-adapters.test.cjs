require('./register-ts.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { MariaAuthStore } = require('../Backend/server/mariadb/store.ts');
const { createMariaHttp } = require('../Backend/server/mariadb/http.ts');
const { mariaResponse } = require('../Backend/server/auth-dispatch.ts');
const { HttpError } = require('../Backend/server/security.ts');

function mockPool(query) {
  const calls = [];
  const connection = {
    query: async (sql, params) => { calls.push({ sql, params }); return query(sql, params); },
    beginTransaction: async () => calls.push('begin'), commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'), release: async () => calls.push('release'),
    destroy: () => calls.push('destroy'),
  };
  return { pool: { getConnection: async () => connection }, calls };
}
test('SQL attempt reservation binds values, reserves audit ID and releases named lock', async () => {
  const m = mockPool(async sql => {
    if (sql.includes('GET_LOCK')) return [{ acquired: 1 }];
    if (sql.includes('COUNT')) return [{ total: 0 }];
    if (sql.includes('INSERT')) return { insertId: 42n };
    if (sql.includes('RELEASE_LOCK')) return [{ released: 1 }];
    return [];
  });
  const bucket = randomBytes(32).toString('hex');
  assert.equal(await new MariaAuthStore(m.pool).reserveAttempt(bucket, 0, 5, 900000), '42');
  assert.deepEqual(m.calls.find(c => c.sql?.includes('INSERT')).params, [bucket]);
  assert.equal(m.calls.filter(c => c.sql?.includes('RELEASE_LOCK')).length, 1);
  assert.equal(m.calls.at(-1), 'release');
});
test('SQL failure rolls back and sanitizes parameter/driver information', async () => {
  const m = mockPool(async sql => {
    if (sql.includes('FB_USUARIOS_CREDENCIALES')) throw Error('secret SQL driver diagnostic');
    return [];
  });
  await assert.rejects(new MariaAuthStore(m.pool).createTestUser({ username: 'qa_isolated_test', passwordHash: '$argon2id$synthetic' }),
    e => e.status === 503 && !e.message.includes('secret'));
  assert.ok(m.calls.includes('begin')); assert.ok(m.calls.includes('rollback'));
  assert.ok(!m.calls.includes('commit')); assert.ok(m.calls.includes('release'));
});
test('failed named lock does not reserve an attempt; lock release failure destroys connection', async () => {
  const a = mockPool(async sql => sql.includes('GET_LOCK') ? [{ acquired: 0 }] : []);
  await assert.rejects(new MariaAuthStore(a.pool).reserveAttempt('a', 0, 5, 900000), e => e.status === 503);
  assert.ok(!a.calls.some(c => c.sql?.includes('INSERT')));
  const b = mockPool(async sql => {
    if (sql.includes('GET_LOCK')) return [{ acquired: 1 }];
    if (sql.includes('COUNT')) return [{ total: 5 }];
    if (sql.includes('RELEASE_LOCK')) throw Error('release failed');
    return [];
  });
  await assert.rejects(new MariaAuthStore(b.pool).reserveAttempt('b', 0, 5, 900000), e => e.status === 503);
  assert.ok(b.calls.includes('destroy'));
});
test('Maria HTTP serializes secure identity only and protects private routes and CSRF', async () => {
  const token = randomBytes(32).toString('base64url');
  let signedIn = true, mustChange = true, revoked = 0;
  const auth = {
    login: async () => ({ token, expiresAt: Date.now() + 100000, user: { id: 'qa', username: 'qa_test' }, mustChangePassword: true }),
    identify: async (value, allowChange) => {
      if (!signedIn || value !== token) throw new HttpError(401, 'UNAUTHENTICATED', 'Login requerido');
      if (mustChange && !allowChange) throw new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Cambio requerido');
      return { id: 'qa', username: 'qa_test', role: 'collaborator', passwordHash: 'secret', mustChangePassword: mustChange };
    },
    logout: async () => { revoked++; },
    changePassword: async () => { signedIn = false; },
  };
  const origin = 'http://127.0.0.1:3000', handle = createMariaHttp(auth, origin);
  const send = (path, body, cookie = `tp_maria_session=${token}`, extra = {}) => handle(new Request(`${origin}/api/${path}`, {
    method: body ? 'POST' : 'GET', headers: { origin, cookie, 'content-type': 'application/json', ...extra },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), path.split('/'));
  const login = await send('auth/login', { username: 'qa_test', password: 'temporary' });
  assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  assert.ok(!JSON.stringify(await login.json()).includes(token));
  const session = await send('session'); const payload = await session.json();
  assert.equal(payload.user.role, 'collaborator'); assert.equal(payload.user.provider, 'mariadb');
  assert.ok(!JSON.stringify(payload).includes('secret'));
  assert.equal((await send('search')).status, 403);
  mustChange = false;
  assert.equal((await send('search')).status, 503);
  assert.equal((await send('parcel-image/street')).status, 503);
  assert.equal((await send('unknown')).status, 404);
  assert.equal((await send('session', {})).status, 405);
  assert.equal((await send('session', null, '')).status, 401);
  const canonical = await handle(new Request('http://localhost:3000/api/session',
    { headers: { host: '127.0.0.1:3000' } }), ['session']);
  assert.equal(canonical.status, 401);
  const badHost = await send('session', null, '', { host: 'evil.test' });
  assert.equal(badHost.status, 403);
  assert.equal((await send('session', null, `tp_maria_session=${token}; tp_maria_session=${token}`)).status, 401);
  assert.equal((await send('auth/logout', {}, undefined, { origin: 'http://evil.test' })).status, 403);
  const nextPassword=randomBytes(16).toString('hex');
  const changed = await send('auth/password', {currentPassword:'current fixture', password:nextPassword,confirmPassword:nextPassword});
  assert.equal(changed.status, 200); assert.match(changed.headers.get('set-cookie'), /1970/);
  assert.equal((await send('session')).status, 401);
  assert.equal((await send('auth/logout', {})).status, 200); assert.ok(revoked > 0);
});
test('default dispatcher leaves Supabase untouched; invalid explicit provider fails closed', async () => {
  const previous = process.env.AUTH_PROVIDER;
  try {
    delete process.env.AUTH_PROVIDER;
    assert.equal(await mariaResponse(new Request('http://127.0.0.1:3000/api/session'), ['session']), null);
    process.env.AUTH_PROVIDER = 'invalid';
    const denied = await mariaResponse(new Request('http://127.0.0.1:3000/api/session'), ['session']);
    assert.equal(denied.status, 503);
  } finally { if (previous === undefined) delete process.env.AUTH_PROVIDER; else process.env.AUTH_PROVIDER = previous; }
});


test('SQL authentication rejects soft deletion before issuing a session',async()=>{
 const row={USER_ID:'fixture',USERNAME:'fixture',ROLE:'administrator',ENABLED:1,MUST_CHANGE_PASSWORD:0,PASSWORD_HASH:'expected',DELETED_AT:new Date()};
 const m=mockPool(async sql=>sql.includes('FROM FB_USUARIOS u')?[row]:[]);
 const store=new MariaAuthStore(m.pool);
 assert.notEqual((await store.findUser('fixture')).deletedAt,null);
 assert.equal(await store.issueSession({userId:'fixture',tokenHash:'a'.repeat(64),expiresAt:Date.now()+60000,revoked:false},'expected','1'),false);
 assert.equal(m.calls.some(c=>c.sql?.includes('INSERT INTO FB_USUARIOS_SESIONES')),false);
});
test('own password changes increment administrative revision and preserve user-before-session locking',async()=>{
 const row={USER_ID:'fixture',USERNAME:'fixture',ROLE:'atencion_publico',ENABLED:1,MUST_CHANGE_PASSWORD:1,PASSWORD_HASH:'expected',DELETED_AT:null};
 const m=mockPool(async sql=>{
  if(sql.startsWith('SELECT USER_ID FROM FB_USUARIOS_SESIONES'))return [{USER_ID:'fixture'}];
  if(sql.includes('FROM FB_USUARIOS u'))return [row];
  if(sql.includes('SELECT SESSION_ID'))return [{SESSION_ID:'session'}];
  return {affectedRows:1};
 });
 assert.equal(await new MariaAuthStore(m.pool).changePassword('a'.repeat(64),'expected','replacement',Date.now()),true);
 const userLock=m.calls.findIndex(c=>c.sql?.includes('STRAIGHT_JOIN')&&c.sql.includes('FOR UPDATE'));
 const sessionLock=m.calls.findIndex(c=>c.sql?.includes('SELECT SESSION_ID')&&c.sql.includes('FOR UPDATE'));
 assert.ok(userLock>=0&&sessionLock>userLock);
 const update=m.calls.find(c=>c.sql?.includes('UPDATE FB_USUARIOS SET'));
 assert.match(update.sql,/ADMIN_REVISION = ADMIN_REVISION \+ 1/);
 assert.ok(m.calls.some(c=>c.sql?.includes('SET REVOKED_AT')&&c.params[0]==='fixture'));
 assert.ok(m.calls.includes('commit'));
});


test('SQL credential age does not block issuance/change while session expiry and inactivity remain guarded',async()=>{
 const row={USER_ID:'fixture',USERNAME:'fixture',ROLE:'atencion_publico',ENABLED:1,MUST_CHANGE_PASSWORD:1,PASSWORD_HASH:'expected',DELETED_AT:null,CREATED_AT:new Date(0),PASSWORD_UPDATED_AT:new Date(0)};
 const m=mockPool(async sql=>{
  if(sql.startsWith('SELECT USER_ID FROM FB_USUARIOS_SESIONES'))return [{USER_ID:'fixture'}];
  if(sql.includes('FROM FB_USUARIOS u'))return [row];
  if(sql.includes('SELECT ID_INTENTO'))return [{ID_INTENTO:1}];
  if(sql.includes('SELECT SESSION_ID'))return [{SESSION_ID:'session'}];
  return {affectedRows:1};
 });
 const store=new MariaAuthStore(m.pool);
 assert.equal(await store.issueSession({userId:'fixture',tokenHash:'a'.repeat(64)},'expected','1'),true);
 assert.equal(await store.changePassword('a'.repeat(64),'expected','newhash',Date.now()),true);
 const statements=m.calls.filter(c=>c.sql).map(c=>c.sql).join('\n');
 assert.doesNotMatch(statements,/temporary_expired|temporary_expires|COALESCE\(c.PASSWORD_UPDATED_AT,c.CREATED_AT\)/);
 assert.match(statements,/TIMESTAMPADD\(HOUR, 8, UTC_TIMESTAMP\(6\)\)/);
 assert.match(statements,/EXPIRES_AT > UTC_TIMESTAMP\(6\)/);
 assert.match(statements,/LAST_ACTIVITY_AT > TIMESTAMPADD\(HOUR, -1, UTC_TIMESTAMP\(6\)\)/);
});
