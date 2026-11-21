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
test("Lotes usa un comando y conserva página, faltantes y totales aun sin filas", async t => {
  t.mock.method(console, "warn", () => {});
  const repository = new NotificationLotRepository(async read => read({
    async query(sql, params) {
      assert.match(sql, /UNION ALL/);
      assert.match(sql, /ORDER BY result\.rowKind, BINARY result\.locality, BINARY result\.parcel,/);
      assert.deepEqual(params.slice(0, 3), [lotId, lotId, 25]);
      const rows = params[3] === 25 ? [
        { rowKind: 1, padCod: 12n, locality: " PAYSANDU ", parcel: "", hasParcel: 0 },
        { rowKind: 1, padCod: null, locality: null, parcel: "ignored", hasParcel: 0 },
      ] : [];
      return [{ rowKind: 0, total: 27n, uniqueParcels: 25n, unmatched: 2n }, ...rows];
    },
  }));
  assert.deepEqual(await repository.detail(lotId, 2), {
    page: 2, pageSize: 25, total: 27, uniqueParcels: 25, unmatched: 2,
    rows: [{ padCod: "12", locality: "PAYSANDU", parcel: null, hasParcel: false },
      { padCod: null, locality: null, parcel: null, hasParcel: false }],
  });
  assert.deepEqual(await repository.detail(lotId, 3), {
    page: 3, pageSize: 25, total: 27, uniqueParcels: 25, unmatched: 2, rows: [],
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

test("permisos HTTP y exportación completa de 84 columnas", async () => {
  const metadata = [
    { name: "FECHA_RELEVAMIENTO", dataType: "date" },
    { name: "AREA_PREDIO_CATASTRO", dataType: "decimal" },
    ...Array.from({ length: 46 }, (_, i) => ({ name: `BIN_${i}`, dataType: "binary" })),
    ...Array.from({ length: 36 }, (_, i) => ({ name: `TXT_${i}`, dataType: "varchar" })),
  ];
  const fullRow = Object.fromEntries(metadata.map(({ name, dataType }) =>
    [name, ({ date: "2026-01-02", decimal: "12.30", binary: Buffer.from("QA"), varchar: "Fixture" })[dataType]]));
  const query = mock.fn(async sql => {
    if (sql.includes("COUNT(*)")) return [{ total: 0, uniqueParcels: 0, unmatched: 0 }];
    if (sql.includes("information_schema.COLUMNS")) return metadata;
    assert.match(sql, /CAST\(v.`FECHA_RELEVAMIENTO` AS CHAR\) AS `FECHA_RELEVAMIENTO`/);
    assert.ok(metadata.every(({ name }) => sql.includes(`v.\`${name}\``)));
    return [fullRow];
  });
  const repository = new NotificationLotRepository(async read => read({ query }));
  const lots = createNotificationLotsHttp({ canConsult: role => role !== "blocked", canDownload: role => role === "collaborator" }, repository);
  const origin = "http://127.0.0.1:3200";
  const auth = {
    async identify(token) {
      if (!token) throw new HttpError(401, "AUTH_REQUIRED", "Missing session");
      return { id: token, username: "QA", role: token, enabled: true };
    },
  };
  const limits = { enter: async () => () => {}, user: async () => {} };
  const route = createMariaHttp(auth, origin, undefined, undefined, limits, lots);
  const request = (token, suffix = "") => {
    const path = `notification-lots/${lotId}${suffix}`;
    return route(new Request(`${origin}/api/${path}`, {
      headers: token ? { cookie: `tp_maria_session=${token}` } : undefined,
    }), path.split("/"));
  };
  assert.equal((await request()).status, 401);
  assert.equal((await request("blocked")).status, 403);
  assert.equal((await request("reader", "/export")).status, 403);
  assert.equal(query.mock.callCount(), 0);
  assert.equal((await request("reader")).status, 200);
  assert.equal(query.mock.callCount(), 1);
  const xlsx = await request("collaborator", "/export");
  assert.equal(xlsx.status, 200);
  assert.equal(query.mock.callCount(), 3);
  const sheet = zipEntry(Buffer.from(await xlsx.arrayBuffer()), "xl/worksheets/sheet1.xml");
  assert.match(sheet, /<dimension ref="A1:CF2"/);
  const [head, body] = [...sheet.matchAll(/<row r="\d+">(.*?)<\/row>/g)].map(match => match[1]);
  assert.equal([...head.matchAll(/<c r=/g)].length, 84);
  assert.equal([...body.matchAll(/<c r=/g)].length, 84);
  assert.deepEqual([...head.matchAll(/<t xml:space="preserve">(.*?)<\/t>/g)].map(match => match[1]),
    metadata.map(({ name }) => name));
  assert.match(body, /r="A2" s="2" t="n"/);
  assert.match(body, /r="B2" s="3" t="n"><v>12\.30<\/v>/);
  assert.match(body, /UUE=/);
});
