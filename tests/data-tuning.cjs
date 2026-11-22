const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const { inflateRawSync } = require("node:zlib");
require("../scripts/register-runtime-ts.cjs");

const { InstitutionalRepository } = require("../Backend/server/institutional/repository.ts");
const { NotificationLotRepository } = require("../Backend/server/notification-lots/repository.ts");
const { createNotificationLotsHttp } = require("../Backend/server/notification-lots/http.ts");
const { createMariaHttp } = require("../Backend/server/mariadb/http.ts");
const { HttpError } = require("../Backend/server/security.ts");

const parcel = { PadCod: 10, PADRON: 101, LOCALIDAD: "PAYSANDU", DOMICILIO_INMUEBLE: "Calle QA 123" };
const links = [
  { ConCod: 1, ID_PERSONA_CP: 2, NOMBRE_CP: "Titular QA", RelNom: "Titular", PRIORIDAD_VINCULO: 1 },
  { ConCod: 2, ID_PERSONA_CP: 2, NOMBRE_CP: "Titular QA", RelNom: "Otro vínculo", PRIORIDAD_VINCULO: 2 },
  { ConCod: 3, ID_PERSONA_CP: null, NOMBRE_CP: "Vínculo QA", RelNom: "Ocupante" },
];
const media = [
  { ID_PERSONA_CP: 2, TIPO_MEDIO: "MAIL", VALOR_CONTACTO: "QA@example.invalid" },
  { ID_PERSONA_CP: 2, TIPO_MEDIO: "MAIL", VALOR_CONTACTO: "qa@example.invalid" },
];

function institutionalFixture({ joined = [], fallback = [], failedJoin = false, failedLinks = false } = {}) {
  let transactions = 0;
  const queries = [];
  const repository = new InstitutionalRepository(async read => {
    const transaction = ++transactions;
    return read({
      async query(sql, params) {
        queries.push({ sql, params, transaction });
        if (sql.includes("LEFT JOIN AGM_LOTES_NOTIFICACION")) {
          if (failedJoin) throw new Error("synthetic source failure");
          return joined;
        }
        if (sql.includes("AGM_CIU_VINCULOS")) {
          if (failedLinks) throw new Error("synthetic link failure");
          return links;
        }
        if (sql.includes("AGM_CIU_CONTACTOS")) return media;
        return fallback;
      },
    });
  });
  return { repository, queries };
}

test("ficha conserva relevamiento, vínculos, medios y validación por PadCod", async () => {
  const row = { ...parcel, surveyPadCod: 10, surveyDate: "2026-01-02", detectedArea: "50.00",
    difference: "-0.01", surveyState: "RELEVADO_DIFERENCIA_NEGATIVA" };
  const { repository, queries } = institutionalFixture({ joined: [row] });
  const record = await repository.getParcel(" Paysandú ", "101", "10");
  assert.deepEqual(record.survey, { status: "available", date: "2026-01-02", detectedArea: "50.00",
    difference: "-0.01", state: "RELEVADO_DIFERENCIA_NEGATIVA" });
  assert.deepEqual(record.institutionalPeople.map(p => [p.personId, p.links.length, p.media.length]), [
    ["2", 2, 1], [null, 1, 0],
  ]);
  assert.equal(record.address, parcel.DOMICILIO_INMUEBLE);
  assert.equal(queries.length, 3);
  assert.match(queries[0].sql, /ON n\.PadCod = p\.PadCod/);
  assert.match(queries[0].sql, /BINARY p\.ESTADO_CRUCE_CATASTRO = BINARY 'EN_CATASTRO'/);
  assert.deepEqual(queries[0].params, ["PAYSANDU", "101", "10"]);
  assert.deepEqual(queries[2].params, ["2"]);
  assert.doesNotMatch(queries[1].sql, /CANT_MAILS|CANT_CELULARES|CANT_FIJOS/);
  assert.doesNotMatch(queries[2].sql, /ID_MEDIO_CP/);
  assert.ok(queries.every(query => query.transaction === 1));
});

test("ficha distingue una fila ausente, una fila sin medición y una fuente indisponible", async t => {
  t.mock.method(console, "warn", () => {});
  const absent = institutionalFixture({ joined: [{ ...parcel, surveyPadCod: null }] });
  assert.deepEqual((await absent.repository.getParcel("PAYSANDU", "101", "10")).survey, { status: "absent" });
  const pending = institutionalFixture({ joined: [{ ...parcel, surveyPadCod: 10, surveyState: "SIN_RELEVAR" }] });
  assert.deepEqual((await pending.repository.getParcel("PAYSANDU", "101")).survey, {
    status: "available", date: null, detectedArea: null, difference: null, state: "SIN_RELEVAR",
  });
  assert.doesNotMatch(pending.queries[0].sql, /AND p\.PadCod = /);
  const unavailable = institutionalFixture({ failedJoin: true, fallback: [parcel] });
  const fallback = await unavailable.repository.getParcel("PAYSANDU", "101", "10");
  assert.deepEqual(fallback.survey, { status: "unavailable" });
  assert.equal(fallback.institutionalPeople.length, 2);
  assert.deepEqual(unavailable.queries.map(q => q.transaction), [1, 2, 2, 2]);
  assert.match(unavailable.queries[1].sql, /'EN_CATASTRO'.*p\.PadCod = \?/s);
  const malformed = institutionalFixture({ joined: [{ ...parcel, surveyPadCod: 10, detectedArea: "x" }] });
  assert.deepEqual((await malformed.repository.getParcel("PAYSANDU", "101")).survey, { status: "unavailable" });
});

test("la ficha conserva 404, 409 y errores de dependencias distintas de relevamiento", async t => {
  t.mock.method(console, "warn", () => {});
  for (const failedJoin of [true, false]) {
    for (const [rows, status] of [[[], 404], [[parcel, { ...parcel, PadCod: 11 }], 409]]) {
      const fixture = institutionalFixture({ joined: rows, fallback: rows, failedJoin });
      await assert.rejects(fixture.repository.getParcel("PAYSANDU", "101"), { status });
    }
  }
  const failure = institutionalFixture({ joined: [parcel], failedLinks: true });
  await assert.rejects(failure.repository.getParcel("PAYSANDU", "101"), /synthetic link failure/);
  assert.equal(failure.queries.length, 2);
});

test("búsqueda localidad/padrón conserva su proyección pública y sus límites", async () => {
  const fixture = institutionalFixture({ fallback: [parcel, { ...parcel, PadCod: 12, DOMICILIO_INMUEBLE: null }] });
  const result = await fixture.repository.searchParcel(" Paysandú ", "101");
  assert.deepEqual(result, [
    { padCod: "10", locality: "PAYSANDU", parcel: "101", address: "Calle QA 123", source: "institutional" },
    { padCod: "12", locality: "PAYSANDU", parcel: "101", address: "No informado", source: "institutional" },
  ]);
  assert.match(fixture.queries[0].sql, /^SELECT p\.PadCod, p\.PADRON, p\.LOCALIDAD, p\.DOMICILIO_INMUEBLE\s+FROM/);
  assert.match(fixture.queries[0].sql, /'EN_CATASTRO' AND p\.LOCALIDAD = \? AND p\.PADRON = \? ORDER BY p\.PadCod LIMIT 51/);
  assert.deepEqual(fixture.queries[0].params, ["PAYSANDU", "101"]);
  const many = institutionalFixture({ fallback: Array(51).fill(parcel) });
  await assert.rejects(many.repository.searchParcel("PAYSANDU", "101"), { status: 422, code: "RESULT_LIMIT" });
});

test("nombre cambia el orden del cruce y CI/RUT conservan su predicado", async () => {
  const queries = [];
  const repository = new InstitutionalRepository(async read => read({
    async query(sql, params) {
      queries.push({ sql, params });
      return [{ ...parcel, ...links[0] }];
    },
  }));
  const result = await repository.searchPerson("name", " José, QA ", "2");
  assert.equal(result.selectedPersonId, "2");
  assert.equal(result.results[0].padCod, "10");
  assert.match(queries[0].sql, /FROM AGM_CIU_VINCULOS v STRAIGHT_JOIN AGM_CIU_PADRONES p/);
  assert.match(queries[0].sql, /TRIM\(REGEXP_REPLACE\(UPPER\(REGEXP_REPLACE\(v.NOMBRE_CP/);
  assert.match(queries[0].sql, /ORDER BY p\.PadCod, v\.ID_PERSONA_CP, v\.ConCod LIMIT 501/);
  assert.deepEqual(queries[0].params, ["\\p{P}", "\\s+", "JOSÉ QA"]);
  await repository.searchPerson("ci", "9.000.001-1");
  await repository.searchPerson("rut", "990000000001");
  for (const query of queries.slice(1)) {
    assert.doesNotMatch(query.sql, /STRAIGHT_JOIN/);
    assert.match(query.sql, /v\.TIPO_DOCUMENTO = \? AND v\.DOCUMENTO_NORMALIZADO = \?/);
  }
  assert.deepEqual(queries[1].params, ["CI", "90000011"]);
  assert.deepEqual(queries[2].params, ["RUT", "990000000001"]);
});

const lotId = "LOTE_INICIAL_47";
const previewFields = [
  "NRO_OBJETO_NRO_PLAN", "OBSERVACIONES_TIPO_OBJETOS", "ZONA", "DENOMINACION",
  "DOMICILIO", "ALTURA", "ESTADO_RELEVAMIENTO", "CUIT", "TIPO_DOCUMENTO",
  "DOCUMENTO", "CELULAR2", "CORREO_ELECTRONICO",
];
const previewHeadings = [
  "Código municipal", "Número de padrón", "Localidad", "Denominación",
  "Domicilio y altura", "Estado del relevamiento", "RUT",
  "Cédula de identidad", "Celular", "Correo",
];
const previewMetadata = previewFields.map(name => ({ name, dataType: "varchar" }));

test("Lotes proyecta solo los campos solicitados y respeta el límite y los totales", async t => {
  t.mock.method(console, "warn", () => {});
  const shortLotId = "E2-P03";
  const emptyLotId = "E2-P04";
  const largeRows = Array.from({ length: 47 }, (_, i) => ({ NRO_OBJETO_NRO_PLAN: i + 1 }));
  const shortRows = [
    { NRO_OBJETO_NRO_PLAN: "008", OBSERVACIONES_TIPO_OBJETOS: "123", ZONA: "PAYSANDU",
      DENOMINACION: "Predio QA", DOMICILIO: "Calle QA", ALTURA: "  ", ESTADO_RELEVAMIENTO: "Pendiente",
      CUIT: "00123456", TIPO_DOCUMENTO: "CI", DOCUMENTO: " 00-3 ", CELULAR2: "+598099000004",
      CORREO_ELECTRONICO: "qa@example.test", NOMBRE_IMAGEN_ACTUAL: "/sftp/no-publicar.jpg" },
    { ALTURA: 400, DOCUMENTO: "0005" },
    { DOMICILIO: "Calle Dos", ALTURA: 0, TIPO_DOCUMENTO: "RUT" },
    {},
  ];
  const repository = new NotificationLotRepository(async read => read({
    async query(sql, params) {
      if (sql.includes("information_schema.COLUMNS")) {
        return [...previewMetadata, { name: "NOMBRE_IMAGEN_ACTUAL", dataType: "varchar" }];
      }
      const [id] = params;
      const rows = id === lotId ? largeRows : id === shortLotId ? shortRows : [];
      if (sql.includes("COUNT(*)")) return [{ total: rows.length, uniqueParcels: rows.length, unmatched: 0 }];
      const projection = sql.slice(7, sql.indexOf(" FROM "));
      const selectedFields = [...projection.matchAll(/ AS `([^\x60]+)`/g)].map(match => match[1]);
      assert.deepEqual(selectedFields, previewFields);
      assert.match(sql, /ORDER BY BINARY COALESCE\(CAST\(v.`ZONA` AS CHAR/);
      assert.match(sql, / LIMIT \?$/);
      assert.doesNotMatch(sql, /\bOFFSET\b/);
      assert.deepEqual(params, [id, 10]);
      return rows.slice(0, params[1]);
    },
  }));
  const preview = await repository.preview(lotId);
  assert.equal(preview.total, 47);
  assert.equal(preview.uniqueParcels, 47);
  assert.deepEqual(preview.rows.map(row => row[0]), largeRows.slice(0, 10).map(row => String(row.NRO_OBJETO_NRO_PLAN)));
  assert.deepEqual(await repository.preview(shortLotId), {
    columns: previewHeadings, total: 4, uniqueParcels: 4, unmatched: 0,
    rows: [
      ["008", "123", "PAYSANDU", "Predio QA", "Calle QA", "Pendiente", "00123456", "CI 00-3", "+598099000004", "qa@example.test"],
      ["", "", "", "", "400", "", "", "0005", "", ""],
      ["", "", "", "", "Calle Dos 0", "", "", "RUT", "", ""],
      ["", "", "", "", "", "", "", "", "", ""],
    ],
  });
  assert.deepEqual(await repository.preview(emptyLotId), {
    columns: previewHeadings, total: 0, uniqueParcels: 0, unmatched: 0, rows: [],
  });
});

function zipEntry(bytes, name) {
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8);
    const size = bytes.readUInt32LE(offset + 18);
    const nameSize = bytes.readUInt16LE(offset + 26);
    const start = offset + 30 + nameSize + bytes.readUInt16LE(offset + 28);
    if (bytes.toString("utf8", offset + 30, offset + 30 + nameSize) === name) {
      assert.equal(method, 8);
      return inflateRawSync(bytes.subarray(start, start + size)).toString("utf8");
    }
    offset = start + size;
  }
  throw new Error(`Missing ZIP entry: ${name}`);
}

test("solo Administración accede al listado, a la vista previa y al Excel completo", async () => {
  const metadata = [
    { name: "FECHA_RELEVAMIENTO", dataType: "date" },
    { name: "AREA_PREDIO_CATASTRO", dataType: "decimal" },
    { name: "CUIT", dataType: "decimal" },
    { name: "NOMBRE_IMAGEN_ACTUAL", dataType: "varchar" },
    { name: "NOMBRE_IMAGEN_HISTORICA", dataType: "varchar" },
    ...previewMetadata.filter(column => column.name !== "CUIT"),
    ...Array.from({ length: 46 }, (_, i) => ({ name: `BIN_${i}`, dataType: "binary" })),
    ...Array.from({ length: 22 }, (_, i) => ({ name: `TXT_${i}`, dataType: "varchar" })),
  ];
  const fullRow = Object.fromEntries(metadata.map(({ name, dataType }) =>
    [name, ({ date: "2026-01-02", decimal: "12.30", binary: Buffer.from("QA"), varchar: "Fixture" })[dataType]]));
  Object.assign(fullRow, {
    CUIT: "00123456",
    ZONA: "PAYSANDU CHACRAS",
    OBSERVACIONES_TIPO_OBJETOS: "420",
    NOMBRE_IMAGEN_ACTUAL: "/sftp/ficticio/420_1.jpg",
    NOMBRE_IMAGEN_HISTORICA: "/sftp/ficticio/1985_420.jpg",
    TXT_21: null,
  });
  const query = mock.fn(async (sql, params) => {
    if (sql.includes("COUNT(*)")) return [{ id: lotId, total: 47, uniqueParcels: 42, unmatched: 0 }];
    if (sql.includes("information_schema.COLUMNS")) return metadata;
    assert.ok(metadata.every(({ name }) => sql.includes(`v.\`${name}\``)));
    assert.match(sql, /ORDER BY BINARY COALESCE\(CAST\(v.`ZONA` AS CHAR/);
    assert.match(sql, / LIMIT \?$/);
    const [, limit] = params;
    if (limit === 1_048_576) assert.match(sql, /CAST\(v.`FECHA_RELEVAMIENTO` AS CHAR\) AS `FECHA_RELEVAMIENTO`/);
    assert.ok(limit === 10 || limit === 1_048_576);
    return Array.from({ length: Math.min(47, limit) }, (_, index) => ({
      ...fullRow,
      NOMBRE_IMAGEN_HISTORICA: [
        fullRow.NOMBRE_IMAGEN_HISTORICA, "/sftp/ficticio/sin-fecha.jpg", null,
      ][index % 3],
    }));
  });
  const repository = new NotificationLotRepository(async read => read({ query }));
  const lots = createNotificationLotsHttp(repository);
  const origin = "http://127.0.0.1:3200";
  const auth = {
    async identify(token) {
      if (!token) throw new HttpError(401, "AUTH_REQUIRED", "Missing session");
      return { id: token, username: "QA", role: token, enabled: true };
    },
  };
  const limits = { enter: async () => () => {}, user: async () => {} };
  const route = createMariaHttp(auth, origin, undefined, undefined, limits, lots);
  const request = (token, suffix = `/${lotId}`) => {
    const path = `notification-lots${suffix}`;
    return route(new Request(`${origin}/api/${path}`, {
      headers: token ? { cookie: `tp_maria_session=${token}` } : undefined,
    }), path.split("/"));
  };
  const pageRequest = new Request(`${origin}/api/notification-lots/${lotId}?page=2`);
  await assert.rejects(lots.handle(pageRequest, ["notification-lots", lotId], "administrator"),
    error => error.status === 400);
  assert.equal((await request()).status, 401);
  for (const role of ["collaborator", "atencion_publico", "unknown"]) {
    assert.equal((await request(role, "")).status, 403);
    assert.equal((await request(role)).status, 403);
    assert.equal((await request(role, `/${lotId}/export`)).status, 403);
  }
  assert.equal(query.mock.callCount(), 0);
  const list = await request("administrator", "");
  assert.equal(list.status, 200);
  assert.equal((await list.json()).lots[0].total, 47);
  assert.equal(query.mock.callCount(), 1);
  const previewResponse = await request("administrator");
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(query.mock.callCount(), 4);
  assert.equal(preview.total, 47);
  assert.equal(preview.uniqueParcels, 42);
  assert.deepEqual(preview.columns, previewHeadings);
  assert.equal(preview.rows.length, 10);
  assert.ok(preview.rows.every(row => row.length === 10));
  assert.equal(preview.rows[0][6], "00123456");
  assert.doesNotMatch(JSON.stringify(preview), /sftp|\.jpg/);
  const xlsx = await request("administrator", `/${lotId}/export`);
  assert.equal(xlsx.status, 200);
  assert.equal(query.mock.callCount(), 6);
  const sheet = zipEntry(Buffer.from(await xlsx.arrayBuffer()), "xl/worksheets/sheet1.xml");
  assert.match(sheet, /<dimension ref="A1:CF48"/);
  const [head, ...bodyRows] = [...sheet.matchAll(/<row r="\d+">(.*?)<\/row>/g)].map(match => match[1]);
  assert.equal(bodyRows.length, 47);
  const [body] = bodyRows;
  assert.equal([...head.matchAll(/<c r=/g)].length, 84);
  assert.equal([...body.matchAll(/<c r=/g)].length, 83);
  assert.deepEqual([...head.matchAll(/<t xml:space="preserve">(.*?)<\/t>/g)].map(match => match[1]),
    metadata.map(({ name }) => ({ CUIT: "RUT", NOMBRE_IMAGEN_ACTUAL: "Imagen actual",
      NOMBRE_IMAGEN_HISTORICA: "Imagen histórica" })[name] ?? name));
  assert.match(body, /r="A2" s="2" t="n"/);
  assert.match(body, /r="B2" s="3" t="n"><v>12\.30<\/v>/);
  assert.match(body, /r="C2" s="0" t="inlineStr"><is><t xml:space="preserve">00123456<\/t>/);
  assert.match(body, /2026 · Paysandú Chacras · 420/);
  assert.match(body, /1985 · Paysandú Chacras · 420/);
  assert.match(body, /UUE=/);
});
