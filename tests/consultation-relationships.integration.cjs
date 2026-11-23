// Called only by the isolated MariaDB fixture in platform-audit.integration.cjs.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const legacyText = '  Autorizada por la familia  ';
const legacyPerson = { name: 'Consulta manual QA', documentType: 'Otros', document: 'QA-MANUAL',
  phones: ['000123456'], phoneTypes: ['Celular'], emails: ['qa-manual@example.invalid'] };
const legacyBody = { padCod: '910001', parcel: '1001', locality: 'PAYSANDU', type: 'General', person: legacyPerson };
const json = value => typeof value === 'string' ? JSON.parse(value) : value;

async function migrateRelationships(db, apply, migrationDir, package71, actorId) {
  const migrate = () => apply(db, path.join(migrationDir, '003-consultas-vinculo.sql'));
  // New installation with neither column present.
  await migrate();
  assert.equal((await db.query("SELECT REVISION FROM FB_MODELO_REVISION WHERE MODELO='consultas'"))[0].REVISION, '7.2');

  // Reproduce an installation where a DBA already added both columns under 7.1.
  for (const name of ['10-TRG_FB_CONSULTAS_VERSION', '11-TRG_FB_CONSULTAS_HIST_ALTA', '12-TRG_FB_CONSULTAS_HIST_UPDATE']) {
    await apply(db, path.join(package71, name + '.sql'));
  }
  await db.query("UPDATE FB_MODELO_REVISION SET REVISION='7.1' WHERE MODELO='consultas'");
  await db.query('ALTER TABLE FB_CIU_CONSULTAS_WEB MODIFY RELACION_OTRO_DETALLE VARCHAR(100) NULL AFTER RELACION_DECLARADA');
  await db.query('ALTER TABLE FB_CONSULTAS_HISTORIAL MODIFY RELACION_OTRO_DETALLE VARCHAR(100) NULL AFTER DATOS_NUEVOS');
  const person = await db.query("INSERT INTO FB_PERSONAS (NOMBRE_COMPLETO,TIPO_DOCUMENTO,DOCUMENTO) VALUES (?,'OTROS',?)",
    [legacyPerson.name, legacyPerson.document]);
  const proof = JSON.stringify({ source: 'institutional', verifiedAt: new Date().toISOString(), padCod: legacyBody.padCod });
  const record = await db.query(`INSERT INTO FB_CIU_CONSULTAS_WEB
    (ID_PERSONA,PADCOD,PADRON,LOCALIDAD_PADRON,NOMBRE_COMPLETO,TIPO_DOCUMENTO,DOCUMENTO,RELACION_DECLARADA,
     TELEFONO_1,TIPO_TELEFONO_1,MAIL_1,TIPO_CONSULTA,DESCRIPCION,USUARIO_CREADOR_ID,REFERENCIAS_CP_JSON)
    VALUES (?,?,?,?,?,'OTROS',?,?,?,'CELULAR',?,'GENERAL','Consulta de prueba anterior a la migración',?,?)`,
    [person.insertId, legacyBody.padCod, legacyBody.parcel, legacyBody.locality, legacyPerson.name, legacyPerson.document,
      legacyText, legacyPerson.phones[0], legacyPerson.emails[0], actorId, proof]);
  await db.query(`INSERT INTO FB_VINCULOS_DECLARADOS
    (ID_PERSONA,PADCOD,ID_CONSULTA,RELACION_DECLARADA,USUARIO_CREADOR_ID,VERIFICACION_CP_JSON) VALUES (?,?,?,?,?,?)`,
    [person.insertId, legacyBody.padCod, record.insertId, legacyText, actorId, proof]);
  const snapshot = () => db.query('SELECT * FROM FB_CONSULTAS_HISTORIAL WHERE ID_CONSULTA=? ORDER BY VERSION', [record.insertId]);
  const before = await snapshot();
  assert.equal(Object.hasOwn(json(before[0].DATOS_NUEVOS), 'relacion_otro_detalle'), false);
  await migrate();
  await migrate();
  assert.deepEqual(await snapshot(), before);
  return String(record.insertId);
}

async function verifyRelationships(pool, check, cookie, base, legacyId) {
  const submit = (body, status) => check('consultations', { method: 'POST', cookie, body }, { status });
  const patch = (id, body, status) => check(`consultations/${id}`, { method: 'PATCH', cookie, body }, { status });
  const newBody = (relationship, detail) => ({ ...base, idempotencyKey: randomUUID(),
    person: { ...base.person, relationship, relationshipOtherDetail: detail } });
  const current = async id => (await pool.query(`SELECT q.RELACION_DECLARADA,q.RELACION_OTRO_DETALLE,q.REL_COD,
    v.RELACION_DECLARADA AS vinculo,v.REL_COD AS codigo FROM FB_CIU_CONSULTAS_WEB q
    JOIN FB_VINCULOS_DECLARADOS v ON v.ID_CONSULTA=q.ID_CONSULTA WHERE q.ID_CONSULTA=?`, [id]))[0];
  const count = async () => (await pool.query('SELECT COUNT(*) AS n FROM FB_CIU_CONSULTAS_WEB'))[0].n;
  const before = await count();
  for (const detail of ['', '  ', 'x'.repeat(101)]) await submit(newBody('Otro', detail), 400);
  assert.equal(await count(), before);
  const limit = 'á'.repeat(100);
  const hundred = await submit(newBody('Otro', '  ' + limit + '  '), 200);
  assert.equal((await current(hundred.body.id)).RELACION_OTRO_DETALLE, limit);

  const institutional = await submit(newBody('TITULAR', null), 200);
  const titular = await current(institutional.body.id);
  assert.equal(titular.RELACION_DECLARADA, 'TITULAR');
  assert.equal(titular.RELACION_OTRO_DETALLE, null);
  assert.equal(titular.vinculo, 'TITULAR');
  assert.equal(titular.codigo, titular.REL_COD);

  const original = newBody('Otro', '  Apoderado  ');
  const created = await submit(original, 200);
  const id = created.body.id;
  assert.equal(created.body.person.relationshipOtherDetail, 'Apoderado');
  const row = await current(id);
  assert.equal(row.RELACION_DECLARADA, 'Otro');
  assert.equal(row.RELACION_OTRO_DETALLE, 'Apoderado');
  assert.equal(row.REL_COD, null);
  assert.equal(row.codigo, null);
  assert.equal(row.vinculo, 'Otro');
  const editedBody = { ...original, idempotencyKey: undefined, version: 1,
    person: { ...original.person, relationshipOtherDetail: 'Apoderada' } };
  const edited = await patch(id, editedBody, 200);
  assert.equal(edited.body.version, 2);
  const changed = await patch(id, { ...editedBody, version: 2,
    person: { ...editedBody.person, relationship: 'TITULAR' } }, 200);
  assert.equal(changed.body.version, 3);
  assert.equal(changed.body.person.relationship, 'TITULAR');
  assert.equal(changed.body.person.relationshipOtherDetail, null);
  assert.deepEqual(changed.body.history.map(item => [item.version,
    item.before && item.before.relacion_otro_detalle, item.after.relacion_otro_detalle]), [
    [3, 'Apoderada', null], [2, 'Apoderado', 'Apoderada'], [1, null, 'Apoderado'],
  ]);
  assert.deepEqual(await current(id), titular);
  const history = await pool.query(`SELECT VERSION,RELACION_OTRO_DETALLE,DATOS_ANTERIORES,DATOS_NUEVOS
    FROM FB_CONSULTAS_HISTORIAL WHERE ID_CONSULTA=? ORDER BY VERSION`, [id]);
  assert.deepEqual(history.map(h => [h.VERSION, h.RELACION_OTRO_DETALLE,
    h.DATOS_ANTERIORES && json(h.DATOS_ANTERIORES).relacion_otro_detalle,
    json(h.DATOS_NUEVOS).relacion_otro_detalle, json(h.DATOS_NUEVOS).relacion_declarada]), [
    [1, 'Apoderado', null, 'Apoderado', 'Otro'], [2, 'Apoderada', 'Apoderado', 'Apoderada', 'Otro'],
    [3, null, 'Apoderada', null, 'TITULAR'],
  ]);
  // Pin down the BEFORE UPDATE condition independently of any API verification timestamps.
  const probe = await pool.getConnection();
  try {
    await probe.beginTransaction();
    await probe.query('UPDATE FB_CIU_CONSULTAS_WEB SET ACTUALIZA_CONTACTO=0 WHERE ID_CONSULTA=?', [hundred.body.id]);
    await probe.query('UPDATE FB_CIU_CONSULTAS_WEB SET RELACION_OTRO_DETALLE=? WHERE ID_CONSULTA=?', ['Mayúscula', hundred.body.id]);
    assert.equal((await probe.query('SELECT VERSION FROM FB_CIU_CONSULTAS_WEB WHERE ID_CONSULTA=?', [hundred.body.id]))[0].VERSION, 2);
    await probe.query('UPDATE FB_CIU_CONSULTAS_WEB SET RELACION_OTRO_DETALLE=? WHERE ID_CONSULTA=?', ['mayúscula', hundred.body.id]);
    assert.equal((await probe.query('SELECT VERSION FROM FB_CIU_CONSULTAS_WEB WHERE ID_CONSULTA=?', [hundred.body.id]))[0].VERSION, 3);
  } finally {
    await probe.rollback();
    await probe.release();
  }
  const manual = await check(`consultations/${legacyId}`, { cookie }, { status: 200 });
  await submit({ ...legacyBody, idempotencyKey: randomUUID(), description: 'Consulta posterior de la misma persona.',
    person: { ...legacyPerson, localPersonId: manual.body.person.localPersonId, relationship: 'POSEEDOR' } }, 200);
  const legacy = await patch(legacyId, { ...legacyBody, version: 1, description: 'Se corrigió solamente el motivo de la consulta.' }, 200);
  assert.equal(legacy.body.version, 2);
  assert.equal(legacy.body.isHistorical, true);
  const preserved = await current(legacyId);
  assert.equal(preserved.RELACION_DECLARADA, legacyText);
  assert.equal(preserved.vinculo, legacyText);
  assert.ok(legacy.body.history.every(item => item.after.relacion_declarada === legacyText));
}

module.exports = { migrateRelationships, verifyRelationships };
