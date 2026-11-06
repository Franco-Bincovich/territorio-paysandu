require('./register-ts.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requiresClassificationNotice } = require('../Frontend/src/components/parcel-classification.ts');
// Synthetic fixtures emulate a future verified institutional DTO. Never sent to production.
const fixture = (code) => ({ code, evidence: { source: 'institutional', verified: true, reference: 'SYNTHETIC-QA-ONLY' } });
for (const code of ['PH', 'UH', 'RURAL'])
  test(`${code} with complete evidence requires notice`, () => assert.equal(requiresClassificationNotice(fixture(code)), true));
for (const value of [undefined, null, '', 'PH', 17718, {}, { code: 'PH' }, fixture('URBANO'), fixture('UNKNOWN'), fixture('ph'),
  { ...fixture('PH'), evidence: { source: 'synthetic', verified: true, reference: 'QA' } },
  { ...fixture('PH'), evidence: { source: 'institutional', verified: false, reference: 'QA' } },
  { ...fixture('PH'), evidence: { source: 'institutional', verified: true, reference: ' ' } }])
  test(`no notice for unknown, unverified or unsupported data ${JSON.stringify(value)}`, () => assert.equal(requiresClassificationNotice(value), false));

test('existing search API preserves locality identifiers, results and all person query types; no classification is invented', async () => {
  const { createHandler } = require('../Backend/server/handler.ts');
  const queries = [];
  const record = { key: { locality: 'Paysandú', parcel: '17718' }, address: 'SYNTHETIC QA', source: 'synthetic' };
  const handler = createHandler({
    configuration: () => ({ origin: 'http://127.0.0.1:3102' }),
    identity: async () => ({ client: {}, user: { id: 'synthetic' }, profile: {} }),
    catalogue: () => ({
      findParcel: async (key) => { queries.push(key); return key.locality === 'Paysandú' ? record : null; },
      findPerson: async (query) => { queries.push(query); return [record]; },
    }),
    sessionClient: async () => { throw Error('no real database access'); },
    privilegedClient: () => { throw Error('no real database access'); },
  });
  const send = (query) => handler(new Request(`http://127.0.0.1:3102/api/search?${new URLSearchParams(query)}`), ['search']);
  for (const locality of ['Paysandú', 'Paysandú Chacras']) {
    const response = await send({ locality, parcel: '17718' });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.results.length, locality === 'Paysandú' ? 1 : 0);
    if (body.results.length) assert.equal('classification' in body.results[0], false);
    assert.deepEqual(queries.at(-1), { locality, parcel: '17718' });
  }
  for (const [kind, field] of [['name', 'name'], ['ci', 'CI'], ['rut', 'RUT']]) {
    assert.equal((await send({ kind, q: 'SYNTHETIC QA' })).status, 200);
    assert.deepEqual(queries.at(-1), { field, exact: 'SYNTHETIC QA' });
  }
});
