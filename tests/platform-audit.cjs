const assert = require("node:assert/strict");
const { test } = require("node:test");
require("../scripts/register-runtime-ts.cjs");
const { observeMariaHttp, authError } = require("../Backend/server/mariadb/http.ts");
const {
  auditActor, auditNoChange, confirmAuditCommit, discardStagedAudit, discardUnauditedResult, writeTransactionalAudit,
} = require("../Backend/server/audit/platform.ts");
const { HttpError } = require("../Backend/server/security.ts");
const { currentRequestId } = require("../Backend/server/observability.ts");

const actor = { id: "b38ace6f-d188-4ce8-b16c-375cbc4cb758", username: "qa_actor" };

function memoryAudit() {
  const rows = new Map();
  return {
    rows,
    async query(sql, fields) {
      if (/^SELECT\b/i.test(sql)) {
        const entry = rows.get(fields[0]);
        return entry ? [{ EVENT_ID: entry.EVENT_ID }] : [];
      }
      assert.match(sql, /UTC_TIMESTAMP\(6\)/);
      const match = sql.match(/INSERT INTO (?:auxiliares\.)?TP_ADMIN_AUDIT_V1\s*\(([^)]+)\)/);
      assert.ok(match);
      const columns = match[1].split(",").map(column => column.trim()).filter(column => column !== "OCCURRED_AT");
      assert.equal(columns.length, fields.length);
      const row = Object.fromEntries(columns.map((column, index) => [column, fields[index]]));
      assert.match(row.EVENT_ID, /^[0-9a-f-]{36}$/);
      if (rows.has(row.REQUEST_ID)) throw Object.assign(new Error(), { code: "ER_DUP_ENTRY" });
      rows.set(row.REQUEST_ID, row);
    },
  };
}

test("audita errores anteriores al controlador y no registra entradas de búsqueda ni identidad no verificada", async () => {
  const db = memoryAudit();
  const request = new Request("http://127.0.0.1/api/search?kind=ci&q=CI_ficticio&personId=entrada_privada");
  const response = await observeMariaHttp(request, ["search"], db,
    async () => authError(new HttpError(403, "ORIGIN", "Información interna fuera del evento")));
  const id = response.headers.get("x-request-id");
  assert.equal(response.status, 403);
  const row = db.rows.get(id);
  assert.equal(row.ACTOR_ID, "unverified");
  assert.equal(row.ACTOR_USERNAME, null);
  assert.equal(row.MODULE, "search");
  assert.equal(row.ACTION, "by_identity_document");
  assert.equal(row.RESULT, "denied");
  assert.equal(row.ERROR_CODE, "ORIGIN");
  assert.equal(row.OBJECT_ID, null);
  assert.doesNotMatch(JSON.stringify(row), /CI_ficticio|entrada_privada|Información interna/);
  await observeMariaHttp(new Request("http://127.0.0.1/api/health"), ["health"], db,
    async () => Response.json({ ok: true }));
  assert.equal(db.rows.size, 1);
});

test("una escritura confirmada conserva su único evento incluso si falla la lectura posterior", async () => {
  const db = memoryAudit();
  const request = new Request("http://127.0.0.1/api/consultations", { method: "POST" });
  const response = await observeMariaHttp(request, ["consultations"], db, async () => {
    auditActor(actor);
    await writeTransactionalAudit(db, { object: { type: "consultation", id: "42" }, version: 1 });
    confirmAuditCommit();
    return authError(new HttpError(503, "READ_FAILED", "Relectura no disponible"));
  });
  const id = response.headers.get("x-request-id");
  assert.equal(response.status, 503);
  const row = db.rows.get(id);
  assert.equal(row.ACTOR_ID, actor.id);
  assert.equal(row.ACTOR_USERNAME, actor.username);
  assert.equal(row.MODULE, "consultations");
  assert.equal(row.ACTION, "create");
  assert.equal(row.RESULT, "success");
  assert.equal(row.OBJECT_TYPE, "consultation");
  assert.equal(row.OBJECT_ID, "42");
  assert.equal(row.OBJECT_VERSION, 1);
  assert.equal(row.ERROR_CODE, null);
  assert.equal(db.rows.size, 1);
});

test("un rollback descarta el éxito y un guardado sin cambios se distingue de una escritura", async () => {
  const db = memoryAudit();
  const request = new Request("http://127.0.0.1/api/admin/permissions", { method: "PATCH" });
  const failed = await observeMariaHttp(request, ["admin", "permissions"], db, async () => {
    auditActor(actor);
    const tx = memoryAudit();
    await writeTransactionalAudit(tx, { version: 2 });
    discardStagedAudit();
    return authError(new HttpError(409, "VERSION_CONFLICT", "Conflicto"));
  });
  assert.equal(db.rows.get(failed.headers.get("x-request-id")).RESULT, "invalid");
  const clean = await observeMariaHttp(request, ["admin", "permissions"], db, async () => {
    auditActor(actor);
    auditNoChange();
    return Response.json({ ok: true });
  });
  assert.equal(db.rows.get(clean.headers.get("x-request-id")).RESULT, "no_change");
  assert.equal(db.rows.size, 2);
});

test("un commit incierto reconcilia por REQUEST_ID y EVENT_ID estable", async () => {
  const db = memoryAudit();
  const request = new Request("http://127.0.0.1/api/consultations", { method: "POST" });
  const response = await observeMariaHttp(request, ["consultations"], db, async () => {
    await writeTransactionalAudit(db, { object: { type: "consultation", id: "42" }, version: 1 });
    discardStagedAudit(true);
    return authError(new HttpError(503, "CONSULTATION_COMMIT_UNCERTAIN", "Commit incierto"));
  });
  assert.equal(response.status, 503);
  assert.equal(db.rows.size, 1);
  assert.equal(db.rows.get(response.headers.get("x-request-id")).RESULT, "success");
});

test("un commit incierto no reconoce un evento con el mismo REQUEST_ID y distinto EVENT_ID", async t => {
  t.mock.method(console, "error", () => {});
  const db = memoryAudit();
  const request = new Request("http://127.0.0.1/api/consultations", { method: "POST" });
  const response = await observeMariaHttp(request, ["consultations"], db, async () => {
    await writeTransactionalAudit(db, { object: { type: "consultation", id: "42" }, version: 1 });
    discardStagedAudit(true);
    db.rows.get(currentRequestId()).EVENT_ID = "c262eaa8-405f-4c35-8a4a-453dc6397130";
    return authError(new HttpError(503, "CONSULTATION_COMMIT_UNCERTAIN", "Commit incierto"));
  });
  assert.equal(response.status, 503);
  assert.equal(db.rows.size, 1);
  assert.equal(db.rows.get(response.headers.get("x-request-id")).EVENT_ID, "c262eaa8-405f-4c35-8a4a-453dc6397130");
});

test("si no hay auditoría descarta la respuesta y no entrega la descarga", async t => {
  t.mock.method(console, "error", () => {});
  let cancelled = false;
  let discarded = false;
  const request = new Request("http://127.0.0.1/api/notification-lots/LOTE_INICIAL_47/export");
  const response = await observeMariaHttp(request, ["notification-lots", "LOTE_INICIAL_47", "export"],
    { async query() { throw new Error("dato reservado"); } },
    async () => {
      discardUnauditedResult(() => { discarded = true; });
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    });
  assert.equal(response.status, 503);
  assert.equal(cancelled, true);
  assert.equal(discarded, true);
  assert.equal((await response.json()).error.code, "PLATFORM_AUDIT_UNAVAILABLE");
});

test("usa el mismo ID de solicitud y rechaza éxitos de escritura sin evento transaccional", async () => {
  const db = memoryAudit();
  const request = new Request("http://127.0.0.1/api/auth/login", { method: "POST", headers: { "X-Request-ID": "falso" } });
  let id;
  const response = await observeMariaHttp(request, ["auth", "login"], db, async () => {
    id = currentRequestId();
    return Response.json({ ok: true });
  });
  assert.notEqual(id, "falso");
  assert.equal(response.headers.get("x-request-id"), id);
  assert.equal(response.status, 503);
  assert.equal(db.rows.get(id).ERROR_CODE, "PLATFORM_AUDIT_TRANSACTION_REQUIRED");
});
