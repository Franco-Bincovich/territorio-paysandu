require('./register-ts.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { mapInstitutionalParcel } = require('../Backend/server/institutional/mapping.ts');
const { InstitutionalRepository, personPredicate } = require('../Backend/server/institutional/repository.ts');
const { institutionalConfiguration } = require('../Backend/server/institutional/pool.ts');
const { createInstitutionalHttp } = require('../Backend/server/institutional/http.ts');
const { createMariaHttp } = require('../Backend/server/mariadb/http.ts');
const { HttpError } = require('../Backend/server/security.ts');
const { groupParcelResults } = require('../Frontend/src/components/parcel-result-groups.ts');
const { renderToStaticMarkup } = require('react-dom/server');
const React = require('react');
const { InstitutionalPeople } = require('../Frontend/src/components/institutional-people.tsx');

// Entirely synthetic: never use institutional personal data in fixtures.
const parcel = { PadCod: 'qa-pad-01', PADRON: '900101', LOCALIDAD: 'LOCALIDAD QA', DOMICILIO_INMUEBLE: 'DOMICILIO QA',
  PadAreaTot: '456.25', AREA_PREDIO_CATASTRO: '456.25', AREA_EDIFICADA_CATASTRO: '0', PadPH: 'CODIGO_QA' };
const link = (personId, conCod, priority, more = {}) => ({ ID_PERSONA_CP: personId, ConCod: conCod, NOMBRE_CP: 'HOMONIMO QA',
  RelNom: 'VINCULO QA', PRIORIDAD_VINCULO: priority, PRIORIDAD_CONTACTO: 99 - priority, TIPO_DOCUMENTO: 'OTRO', DOCUMENTO_VALIDO: 'NO', ...more });
test('multiple holders and homonyms stay distinct; all links retained with independent priorities', () => {
  const result = mapInstitutionalParcel(parcel, [link('qa-A', 'qa-c1', 4), link('qa-B', 'qa-c2', 2), link('qa-A', 'qa-c3', 1)], []);
  assert.equal(result.institutionalPeople.length, 2);
  assert.equal(result.institutionalPeople[0].personId, 'qa-A');
  assert.deepEqual(result.institutionalPeople[0].links.map(l => l.priority), [1, 4]);
  assert.deepEqual(result.institutionalPeople[0].links.map(l => l.contactPriority), [98, 95]);
  assert.equal(result.originalBuiltArea, 0);
  assert.equal(result.fields['Tipo de propiedad · código PadPH'], 'CODIGO_QA');
});
test('deduplicate contacts per person/type/normalized value and never expose ORIGEN', () => {
  const media = (type, value, id = 'qa-A') => ({ ID_PERSONA_CP: id, TIPO_MEDIO: type, VALOR_CONTACTO: value, ORIGEN: 'QA_PRIVATE_SOURCE' });
  const result = mapInstitutionalParcel(parcel, [link('qa-A', 'c1', 1), link('qa-B', 'c2', 2)], [
    media('CELULAR', '000 123-456'), media('CELULAR', '000123456'), media('FIJO', '000123456'),
    media('MAIL', 'QA@example.test'), media('MAIL', 'qa@example.test'), media('MAIL', 'qa@example.test', 'qa-B'),
  ]);
  assert.equal(result.institutionalPeople[0].media.length, 3);
  assert.equal(result.institutionalPeople[1].media.length, 1);
  assert.equal(JSON.stringify(result).includes('QA_PRIVATE_SOURCE'), false);
  assert.equal(JSON.stringify(result).includes('ORIGEN'), false);
});
test('missing person IDs are never merged and unknown document types show a warning', () => {
  const result = mapInstitutionalParcel(parcel, [link(null, 'c1', 1), link(null, 'c2', 2)], []);
  assert.equal(result.institutionalPeople.length, 2);
  const html = renderToStaticMarkup(React.createElement(InstitutionalPeople, { people: result.institutionalPeople }));
  assert.match(html, /Documento sin validación confirmada/);
  assert.doesNotMatch(html, /Prioridad del vínculo/); assert.doesNotMatch(html, /Prioridad de contacto|Validez del documento/);
  assert.doesNotMatch(html, /ORIGEN/);
});
test('SQL names use normalized exact equality; documents retain leading zeroes and reject invalid types', () => {
  const predicate = personPredicate('name', 'QA,  A_B');
  assert.doesNotMatch(predicate.sql, /LIKE/);
  assert.deepEqual(predicate.params, ['\\p{P}', '\\s+', 'QA A B']);
  assert.deepEqual(personPredicate('ci', '0.000.000-1').params, ['CI', '00000001']);
  assert.throws(() => personPredicate('rut', '123'));
  assert.throws(() => personPredicate('sql', 'QA'));
});
test('SQL repository uses bound PadCod, link query and grouped-person contacts; no write statements', async () => {
  const calls = [];
  const read = async run => run({ query: async (sql, params) => {
    calls.push({ sql, params });
    assert.match(sql, /^SELECT /); assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i);
    if (sql.includes('FROM AGM_CIU_PADRONES')) return [{ ...parcel, PadCod: '900100' }];
    if (sql.includes('FROM AGM_CIU_VINCULOS')) return [link('qa-A', 'c1', 1), link('qa-A', 'c2', 2)];
    return [{ ID_PERSONA_CP: 'qa-A', TIPO_MEDIO: 'MAIL', VALOR_CONTACTO: 'qa@example.test' }];
  } });
  const result = await new InstitutionalRepository(read).getParcel('Localidad QA', '900101', '900100');
  assert.equal(result.padCod, '900100');
  assert.deepEqual(calls[0].params, ['LOCALIDAD QA', '900101', '900100']);
  assert.deepEqual(calls[1].params, ['900100']);
  assert.deepEqual(calls[2].params, ['qa-A']);
  assert.equal(result.institutionalPeople[0].links.length, 2);
  assert.equal(result.readOnly, true); assert.deepEqual(result.images, []);
});
test('person search deduplicates person+PadCod while keeping same-name different identities', async () => {
  const read = async run => run({ query: async () => [
    { ...parcel, ID_PERSONA_CP: '1001', NOMBRE_CP: 'HOMONIMO QA', ConCod: '1', RelNom: 'VINCULO A' },
    { ...parcel, ID_PERSONA_CP: '1001', NOMBRE_CP: 'HOMONIMO QA', ConCod: '2', RelNom: 'VINCULO B' },
    { ...parcel, ID_PERSONA_CP: '1002', NOMBRE_CP: 'HOMONIMO QA', ConCod: '3' },
  ] });
  const repository = new InstitutionalRepository(read);
  const result = await repository.searchPerson('name', 'HOMONIMO QA');
  assert.equal(result.requiresDisambiguation, true); assert.equal(result.results.length, 0);
  assert.equal(result.people.length, 2);
  const selected = await repository.searchPerson('name', 'HOMONIMO QA', '1001');
  assert.equal(selected.results.length, 1); assert.equal(selected.results[0].matchedPeople.length, 1);
  assert.equal(selected.results[0].matchedPeople[0].links.length, 2);
  await assert.rejects(repository.searchPerson('name', 'HOMONIMO QA', '9999'), e => e.status === 400);
});
test('no results, ambiguous parcels, caps, and PadCod-based result grouping', async () => {
  const repo = rows => new InstitutionalRepository(async run => run({ query: async () => rows }));
  assert.deepEqual(await repo([]).searchParcel('QA', '900101'), []);
  await assert.rejects(repo([]).getParcel('QA', '900101'), e => e.status === 404);
  await assert.rejects(repo([parcel, parcel]).getParcel('QA', '900101'), e => e.status === 409);
  await assert.rejects(repo(Array(51).fill(parcel)).searchParcel('QA', '900101'), e => e.code === 'RESULT_LIMIT');
  assert.equal(groupParcelResults([{ padCod: '1', locality: 'QA', parcel: '1', address: '' },
    { padCod: '2', locality: 'QA', parcel: '1', address: '' }]).length, 2);
});
test('TLS and institutional credentials are separate and fail closed without configuration', () => {
  const env = { INSTITUTIONAL_ENABLED: 'true', INSTITUTIONAL_HOST: 'qa.invalid', INSTITUTIONAL_PORT: '3306',
    INSTITUTIONAL_DATABASE: 'qa_source', INSTITUTIONAL_USER: 'qa_reader', INSTITUTIONAL_PASSWORD: randomBytes(24).toString('hex') };
  const config = institutionalConfiguration(env);
  assert.equal(config.ssl.rejectUnauthorized, true); assert.equal(config.multipleStatements, false);
  assert.throws(() => institutionalConfiguration({ ...env, INSTITUTIONAL_TLS: 'false' }));
  assert.throws(() => institutionalConfiguration({ ...env, INSTITUTIONAL_DATABASE: 'auxiliares' }));
  assert.throws(() => institutionalConfiguration({ ...env, MARIADB_USER: env.INSTITUTIONAL_USER }));
  assert.throws(() => institutionalConfiguration({ ...env, NODE_ENV: 'production' }));
});
test('institutional access follows session/password/role guards; write and storage paths remain blocked', async () => {
  let calls = 0, authorized = false;
  const data = createInstitutionalHttp({ searchParcel: async () => { calls++; return []; } });
  const auth = { identify: async () => {
    if (!authorized) throw new HttpError(401, 'UNAUTHENTICATED', 'QA');
    return { id: 'qa', username: 'qa', role: 'collaborator', mustChangePassword: false };
  } };
  const handle = createMariaHttp(auth, 'http://127.0.0.1:3105', data);
  const request = (path, method = 'GET') => handle(new Request(`http://127.0.0.1:3105/api/${path}`, {
    method, headers: { origin: 'http://127.0.0.1:3105' },
  }), path.split('?')[0].split('/'));
  assert.equal((await request('search?locality=QA&parcel=900101')).status, 401); assert.equal(calls, 0);
  authorized = true;
  assert.equal((await request('search?locality=QA&parcel=900101')).status, 200); assert.equal(calls, 1);
  assert.equal((await request('consultations', 'POST')).status, 403);
  assert.equal((await request('parcel-image/survey')).status, 404);
  assert.equal((await (await request('session')).json()).synthetic, false);
});
