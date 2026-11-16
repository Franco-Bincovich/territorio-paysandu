require('./register-ts.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { createHandler } = require('../Backend/server/handler.ts');
const { HttpError } = require('../Backend/server/security.ts');

test('existing Supabase login, session, logout and private endpoint guards retain contracts (isolated)', async () => {
  const previous = process.env.AUTH_USERNAME_EMAIL_MAP;
  process.env.AUTH_USERNAME_EMAIL_MAP = JSON.stringify({ qa: 'qa@example.test' });
  let signedIn = false, allowed = true, rejected = false, mustChange = false;
  const password = randomBytes(24).toString('base64url');
  const client = { auth: {
    async signInWithPassword(input) {
      assert.equal(input.email, 'qa@example.test');
      signedIn = !rejected && input.password === password;
      return { error: signedIn ? null : { message: 'invalid' } };
    },
    async signOut() { signedIn = false; return { error: null }; },
  } };
  const handler = createHandler({
    configuration: () => ({ origin: 'http://127.0.0.1:3000' }),
    sessionClient: async () => client,
    privilegedClient: () => ({ rpc: async name => {
      assert.equal(name, 'consume_login_attempt'); return { data: allowed, error: null };
    } }),
    identity: async (allowPasswordChange) => {
      if (!signedIn) throw new HttpError(401, 'UNAUTHENTICATED', 'Login requerido');
      if (mustChange && !allowPasswordChange) throw new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Cambio requerido');
      return { user: { id: 'isolated' }, profile: { username: 'qa', must_change_password: mustChange }, client };
    },
    catalogue: () => { throw Error('Private catalogue must not be accessed'); },
  });
  const send = (path, body) => handler(new Request(`http://127.0.0.1:3000/api/${path}`, {
    method: body ? 'POST' : 'GET', headers: { origin: 'http://127.0.0.1:3000', 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), path.split('/'), () => {});
  try {
    assert.equal((await send('session')).status, 401);
    assert.equal((await send('search')).status, 401);
    rejected = true;
    assert.equal((await send('auth/login', { username: 'qa', password })).status, 401);
    rejected = false; allowed = false;
    assert.equal((await send('auth/login', { username: 'qa', password })).status, 429);
    allowed = true; mustChange = true;
    const login = await send('auth/login', { username: 'qa', password });
    assert.equal(login.status, 200); assert.equal((await login.json()).mustChangePassword, true);
    assert.equal((await send('session')).status, 200);
    assert.equal((await send('search')).status, 403);
    assert.equal((await send('auth/logout', {})).status, 200);
    assert.equal((await send('session')).status, 401);
  } finally {
    if (previous === undefined) delete process.env.AUTH_USERNAME_EMAIL_MAP;
    else process.env.AUTH_USERNAME_EMAIL_MAP = previous;
  }
});
