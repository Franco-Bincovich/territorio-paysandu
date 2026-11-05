require('./register-ts.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseData } = require('../Backend/domain/index.ts');
const { validateConsultationFields } = require('../Frontend/src/components/consultation-validation.ts');
const base = {
  type: 'General', description: 'Consulta sintética para pruebas sin escrituras.',
  person: { name: 'PERSONA QA', relationship: 'Titular', documentType: 'CI', document: '00000001',
    phones: ['099123456'], emails: ['qa@example.test'] },
};
const input = (person) => ({ ...base, person: { ...base.person, ...person } });
const draft = (person) => ({ ...base, ...base.person, ...person });

for (const document of ['0000001', '00000001', '0.000.001', '0.000.001-2']) {
  test(`CI normalizes without losing zeroes: ${document}`, () => {
    assert.equal(parseData(input({ document })).person.document, document.replace(/[.-]/g, ''));
    assert.equal(validateConsultationFields(draft({ document })).document, undefined);
  });
}
for (const document of ['123456', '123456789', 'ABC12345', '123 4567']) {
  test(`reject invalid CI: ${document}`, () => {
    assert.throws(() => parseData(input({ document })));
    assert.ok(validateConsultationFields(draft({ document })).document);
  });
}
test('RUT accepts exactly twelve digits and separators', () => {
  assert.equal(parseData(input({ documentType: 'RUT', document: '00.123.456.789-0' })).person.document, '001234567890');
  for (const document of ['12345678901', '1234567890123', '12345678901A'])
    assert.throws(() => parseData(input({ documentType: 'RUT', document })));
});
test('Otros keeps identifiers but form reports persistence block', () => {
  assert.equal(parseData(input({ documentType: 'Otros', document: 'PAS-ABC.123' })).person.document, 'PAS-ABC.123');
  assert.match(validateConsultationFields(draft({ documentType: 'Otros', document: 'PAS-ABC.123' })).documentType, /persistencia/);
  assert.ok(validateConsultationFields(draft({ documentType: 'Otros', document: '' })).document);
});
for (const field of ['phones', 'emails']) {
  test(`${field}: accepts one through three, rejects zero and four without mutating input`, () => {
    const value = base.person[field][0];
    for (let count = 1; count <= 3; count++) assert.equal(parseData(input({ [field]: Array(count).fill(value) })).person[field].length, count);
    assert.throws(() => parseData(input({ [field]: [] })));
    const existing = Array(4).fill(value);
    assert.throws(() => parseData(input({ [field]: existing })));
    assert.equal(existing.length, 4);
    assert.ok(validateConsultationFields(draft({ [field]: existing }))[field === 'phones' ? 'phone-0' : 'email-0']);
  });
}
for (const email of ['a@b.com', 'name+tag@sub.example.test'])
  test(`accept email ${email}`, () => assert.equal(parseData(input({ emails: [email] })).person.emails[0], email));
for (const email of ['a b@c.com', 'a@b', 'a@@b.com', '@b.com', 'a@b.com ', ' a@b.com']) {
  test(`reject individual email ${JSON.stringify(email)}`, () => {
    assert.throws(() => parseData(input({ emails: ['ok@example.test', email] })));
    assert.ok(validateConsultationFields(draft({ emails: ['ok@example.test', email] }))['email-1']);
  });
}
test('unchanged valid legacy consultation remains accepted', () => {
  assert.deepEqual(parseData(base), base);
  assert.deepEqual(validateConsultationFields(draft({})), {});
});

test('API validates before RPC and keeps existing payload shape', async () => {
  const { createHandler } = require('../Backend/server/handler.ts');
  let calls = 0;
  let stored;
  const client = { rpc: async (_, args) => {
    calls++; stored = args.p_payload;
    return { data: { id: 'synthetic', ...stored }, error: null };
  } };
  const handler = createHandler({
    configuration: () => ({ origin: 'http://127.0.0.1:3000' }),
    identity: async () => ({ client, user: { id: 'synthetic' }, profile: {} }),
    catalogue: () => ({ findParcel: async (key) => ({ key }) }),
    privilegedClient: () => { throw Error('unexpected privileged access'); },
    sessionClient: async () => client,
  });
  const id = '00000000-0000-4000-8000-000000000001';
  const send = (person, method = 'POST') => handler(new Request(`http://127.0.0.1:3000/api/consultations${method === 'PATCH' ? '/' + id : ''}`, {
    method, headers: { origin: 'http://127.0.0.1:3000', 'content-type': 'application/json' },
    body: JSON.stringify({ ...input(person), locality: 'Paysandú', parcel: '17718', ...(method === 'PATCH' ? { version: 1 } : { idempotencyKey: id }) }),
  }), method === 'PATCH' ? ['consultations', id] : ['consultations']);
  assert.equal((await send({ phones: Array(4).fill('099123456') })).status, 400);
  assert.equal((await send({ emails: ['wrong'] })).status, 400);
  assert.equal((await send({ document: '123' })).status, 400);
  assert.equal((await send({ documentType: 'Otros', document: 'PAS-X1' })).status, 409);
  assert.equal((await send({ documentType: 'Otros', document: 'PAS-X1' }, 'PATCH')).status, 409);
  assert.equal((await send({ phones: Array(4).fill('099123456') }, 'PATCH')).status, 400);
  assert.equal((await send({ phoneTypes: ['Fijo'] })).status, 400);
  assert.equal(calls, 0);
  assert.equal((await send({ document: '0.000.001-2', phones: Array(3).fill('099123456'), emails: Array(3).fill('qa@example.test') })).status, 201);
  assert.equal(stored.person.document, '00000012');
  assert.equal(stored.person.phones.length, 3);
  assert.equal(calls, 1);
  assert.equal((await send({}, 'PATCH')).status, 200);
  assert.equal(calls, 2);
});
