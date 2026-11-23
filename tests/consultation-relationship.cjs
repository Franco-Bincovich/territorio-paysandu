const assert = require('node:assert/strict');
const { test } = require('node:test');
require('../scripts/register-runtime-ts.cjs');
const { parseData } = require('../Backend/domain/index.ts');
const { webInput, view } = require('../Backend/server/consultations/contracts.ts');
const { parseInput, fingerprint } = require('../Backend/server/consultations/model.ts');
const { institutionalVerifier } = require('../Backend/server/consultations/verification.ts');
const { historySnapshot } = require('../Backend/server/consultations/reads.ts');

const base = {
  idempotencyKey: '20000000-0000-4000-a000-000000000001',
  padCod: '12', locality: 'PAYSANDU', parcel: '812',
  person: { name: 'Persona de prueba', documentType: 'CI', document: '88888888',
    phones: ['00000000'], phoneTypes: ['Fijo'], emails: ['qa@example.invalid'] },
  type: 'General', description: 'Consulta ficticia para validar vínculos.',
};
const personData = (fields, saved) => parseData({ person: { ...base.person, ...fields },
  type: base.type, description: base.description }, saved).person;
const input = (fields, saved) => parseInput(webInput({ ...base, person: { ...base.person, ...fields } }), saved);

test('ambos adaptadores validan las siete opciones y el detalle después del recorte', () => {
  for (const parse of [personData, input]) {
    for (const [fields, code] of [
      [{}, 'RELATIONSHIP'],
      [{ relationship: 'Ingresado a mano' }, 'RELATIONSHIP'],
      ...[undefined, '', ' \t\n ', 'a'.repeat(101)].map(relationshipOtherDetail =>
        [{ relationship: 'Otro', relationshipOtherDetail }, 'RELATIONSHIP_OTHER_DETAIL']),
    ]) {
      assert.throws(() => parse(fields), { code });
    }
    for (const relationship of ['TITULAR', 'BIEN GANANCIAL', 'BIEN EN USUFRUC', 'NUDA PROPIEDAD', 'POSEEDOR', 'PROMITENTE COMP']) {
      const result = parse({ relationship, relationshipOtherDetail: 'detalle anterior' });
      if (parse === input) assert.deepEqual(result.relationship, { text: relationship, otherDetail: null });
      else assert.equal(result.relationshipOtherDetail, null);
    }
    for (const detail of ['Apoderado', 'á'.repeat(100), '📝'.repeat(100)]) {
      const result = parse({ relationship: 'Otro', relationshipOtherDetail: '  ' + detail + '   ' });
      assert.equal(parse === input ? result.relationship.otherDetail : result.relationshipOtherDetail, detail);
    }
  }
  assert.throws(() => input({ relationship: 'TITULAR', relCod: '999' }));
  assert.notEqual(fingerprint(input({ relationship: 'Otro', relationshipOtherDetail: 'Apoderado' })),
    fingerprint(input({ relationship: 'Otro', relationshipOtherDetail: 'Representante' })));
});

test('una edición conserva el texto histórico exacto y el caso Otro antiguo', () => {
  for (const text of ['Titular', '   Mandataria especial  ', 'Otro']) {
    const saved = { relationship: text, relationshipOtherDetail: null };
    assert.deepEqual(input({}, saved).relationship, { text, otherDetail: null });
    assert.equal(personData({}, saved).relationship, text);
    assert.throws(() => input({ relationship: 'Otro', relationshipOtherDetail: ' ' }, saved), { code: 'RELATIONSHIP_OTHER_DETAIL' });
    assert.throws(() => input({ relationship: 'texto distinto' }, saved), { code: 'RELATIONSHIP' });
  }
});

test('detalle e historial exponen la declaración y el detalle de su propia versión', () => {
  const row = { ID_CONSULTA: 2, PADCOD: 12, RELACION_DECLARADA: 'Otro', RELACION_OTRO_DETALLE: 'Apoderado' };
  assert.equal(view(row).person.relationshipOtherDetail, 'Apoderado');
  const old = { relacion_declarada: 'Otro', relacion_otro_detalle: 'Apoderado' };
  assert.deepEqual(historySnapshot(JSON.stringify(old)), old);
  const next = { relacion_declarada: 'TITULAR', relacion_otro_detalle: null };
  assert.deepEqual(historySnapshot(next), next);
  assert.deepEqual(historySnapshot({ relacion_declarada: 'Histórico' }), { relacion_declarada: 'Histórico' });
  assert.deepEqual(historySnapshot({ relacion_declarada: 'Otro' }, 'Apoderado'), old);
  assert.deepEqual(historySnapshot(old, 'dato distinto'), old);
  assert.deepEqual(historySnapshot(next, 'Apoderado'), next);
});

test('el código institucional proviene del padrón verificado y no se infiere para Otro', async () => {
  // Synthetic distinct codes exercise two contexts without defining a production codebook.
  const parcels = { '12': { code: 'A01', con: 3 }, '13': { code: 'B07', con: 4 } };
  const queries = [];
  const read = fn => fn({ async query(sql, params) {
    queries.push(sql);
    if (sql.includes('FROM AGM_CIU_PADRONES')) return [{ PadCod: params[0] }];
    if (sql.includes('SELECT DISTINCT ID_PERSONA_CP')) return [{ ID_PERSONA_CP: 10 }];
    if (sql.includes('SELECT DISTINCT ConCod,RelCod')) {
      assert.deepEqual(params.slice(1), ['10', 'TITULAR']);
      return [{ ConCod: parcels[params[0]].con, RelCod: parcels[params[0]].code }];
    }
    if (sql.includes('SELECT DISTINCT RelCod')) {
      assert.deepEqual(params, ['12', 'TITULAR']);
      return [{ RelCod: 'A01' }, { RelCod: 'C09' }];
    }
    if (sql.includes('FROM AGM_CIU_CONTACTOS')) return [];
    assert.fail(sql);
  } });
  const verify = institutionalVerifier(read);
  for (const [padCod, parcel] of Object.entries(parcels)) {
    const consultation = input({ relationship: 'TITULAR' });
    consultation.parcel.padCod = padCod;
    const evidence = await verify(consultation);
    assert.equal(evidence.relCod, parcel.code);
    assert.equal(evidence.conCod, String(parcel.con));
  }
  queries.length = 0;
  const other = await verify(input({ relationship: 'Otro', relationshipOtherDetail: 'TITULAR' }));
  assert.equal(other.conCod, undefined);
  assert.equal(other.relCod, undefined);
  assert.ok(queries.every(sql => !sql.includes('RelNom')));
  const ambiguous = await verify(input({ relationship: 'TITULAR', documentType: 'Otros', document: 'QA' }));
  assert.equal(ambiguous.relCod, undefined);
  assert.equal(ambiguous.conCod, undefined);
});
