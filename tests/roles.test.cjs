require('./register-ts.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ROLES, ROLE_CAPABILITIES, hasCapability, isRole } = require('../shared/permissions.ts');
const { requireCapability, canEditConsultation } = require('../Backend/server/authorization.ts');
const actor = role => ({ verified: true, userId: 'owner', role, enabled: true, mustChangePassword: false, expiresAt: Date.now() + 60000 });

test('Atención al público retains historical functions without administration or any document access', () => {
  for (const capability of ['password.self','institutional.search','institutional.read','histories.read','consultations.read','consultations.write']) {
    assert.equal(hasCapability('atencion_publico', capability), true);
    requireCapability(actor('atencion_publico'), capability);
  }
  for (const capability of ['users.manage','audit.read','consultations.edit.any','expedientes.read','expedientes.download','expedientes.generate','expedientes.export']) {
    assert.equal(hasCapability('atencion_publico', capability), false);
    assert.throws(() => requireCapability(actor('atencion_publico'), capability), e => e.status === 403);
  }
});
test('Colaborador adds document read/download/export and no role can generate documents', () => {
  for (const capability of ROLE_CAPABILITIES.atencion_publico) requireCapability(actor('collaborator'), capability);
  for (const capability of ['expedientes.read','expedientes.download','expedientes.export']) requireCapability(actor('collaborator'), capability);
  assert.throws(() => requireCapability(actor('collaborator'), 'users.manage'), e => e.status === 403);
  for (const capability of ROLE_CAPABILITIES.administrator) requireCapability(actor('administrator'), capability);
  for (const role of ROLES) assert.throws(() => requireCapability(actor(role), 'expedientes.generate'), e => e.status === 403);
});
test('unknown roles/capabilities, unverified, expired and restricted sessions fail closed', () => {
  for (const role of ['admin','__proto__','constructor',undefined,null]) {
    assert.equal(isRole(role), false);
    assert.equal(hasCapability(role, 'users.manage'), false);
  }
  for (const role of ROLES) {
    assert.throws(() => requireCapability(actor(role), 'unknown'), e => e.status === 403);
    for (const mutation of [{ verified: false },{ expiresAt: 0 },{ enabled: false },{ mustChangePassword: true }]) {
      assert.throws(() => requireCapability({ ...actor(role), ...mutation }, 'consultations.read'));
    }
  }
  assert.equal(Object.isFrozen(ROLE_CAPABILITIES), true);
  assert.equal(Object.isFrozen(ROLE_CAPABILITIES.administrator), true);
});
test('own consultation editing is retained; editing another author requires administrator', () => {
  for (const role of ROLES) {
    assert.equal(canEditConsultation(actor(role), 'owner'), true);
    assert.equal(canEditConsultation(actor(role), 'someone-else'), role === 'administrator');
    assert.equal(canEditConsultation({ ...actor(role), verified: false }, 'owner'), false);
  }
});
test('HTTP routes use session roles despite forged client privileges and enforce methods before adapters', async () => {
  const { createMariaHttp } = require('../Backend/server/mariadb/http.ts');
  const { HttpError } = require('../Backend/server/security.ts');
  const origin = 'http://127.0.0.1:3000';
  const token = 'a'.repeat(43);
  let role = 'atencion_publico', calls = 0;
  const auth = { identify: async value => {
    if (value !== token) throw new HttpError(401,'UNAUTHENTICATED','Login requerido');
    return { id: 'owner', username: 'test', role, enabled: true, mustChangePassword: false, sessionExpiresAt: Date.now()+60000 };
  }};
  const adapter = async (_request,_segments,principal) => { calls++; assert.equal(principal.role,role); return Response.json({ok:true}); };
  const limits = { enter: async () => () => {}, user: async () => {} };
  const handle = createMariaHttp(auth,origin,undefined,undefined,limits,adapter,adapter);
  const send = (path,method,cookie=token) => handle(new Request(`${origin}/api/${path}`, {
    method, headers:{ origin, cookie:`tp_maria_session=${cookie}`, 'x-role':'administrator', 'content-type':'application/json' },
    ...(['POST','DELETE'].includes(method)?{body:JSON.stringify({role:'administrator',verified:true})}:{}),
  }),path.split('/'));
  for (const next of ROLES) {
    role = next;
    for (const [path,method,capability] of [
      ['expedientes/generar','POST','expedientes.generate'],
      ['expedientes/document/exportar','GET','expedientes.export'],
      ['admin/users/target','DELETE','users.manage'],
      ['admin/audit','GET','audit.read'],
      ['parcels/1/expedientes','GET','expedientes.read'],
      ['expedientes/document/descarga','GET','expedientes.download'],
    ]) {
      const before=calls;
      const allowed=hasCapability(role,capability);
      assert.equal((await send(path,method)).status,allowed?200:403,`${role} ${path}`);
      assert.equal(calls,before+(allowed?1:0));
    }
  }
  assert.equal((await send('expedientes/generar','GET')).status,405);
  assert.equal((await send('admin/users/target','POST')).status,405);
  assert.equal((await send('admin/audit','GET','forged')).status,401);
});
