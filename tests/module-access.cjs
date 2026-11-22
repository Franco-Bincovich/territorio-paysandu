const assert = require("node:assert/strict");
const { test } = require("node:test");
require("../scripts/register-runtime-ts.cjs");

const { defaultAccessMatrix } = require("../shared/module-access.ts");
const { createMariaHttp } = require("../Backend/server/mariadb/http.ts");
const { createAdminHttp } = require("../Backend/server/admin/http.ts");
const { AdminService } = require("../Backend/server/admin/service.ts");
const { readModuleAccess } = require("../Backend/server/admin/module-access-repository.ts");
const { createNotificationLotsHttp } = require("../Backend/server/notification-lots/http.ts");

test("la matriz inicial refleja las reglas vigentes y Administración es fija", async () => {
  const matrix = defaultAccessMatrix();
  assert.deepEqual(Object.values(matrix.atencion_publico), [true, true, false, false, false]);
  assert.deepEqual(Object.values(matrix.collaborator), [true, true, false, true, false]);
  assert.deepEqual(Object.values(matrix.administrator), [true, true, true, true, true]);
  const missing = { async query() { throw Object.assign(Error(), { code: "ER_NO_SUCH_TABLE" }); } };
  assert.deepEqual(await readModuleAccess(missing), { revision: 0, matrix, writable: false });
  await assert.rejects(readModuleAccess({ async query() { return []; } }), { code: "MODULE_ACCESS_UNAVAILABLE" });
});

test("persistencia y revocación con sesión abierta, auditoría y permisos de operación", async () => {
  let settings = { matrix: defaultAccessMatrix(), revision: 0, writable: true };
  const actions = [];
  const activity = [];
  const repo = {
    async transaction(actor, target, run) {
      const transaction = {
        principal: async () => actor,
        get: async () => ({ username: "Administrador QA" }),
        moduleAccess: async () => structuredClone(settings),
        saveModuleAccess: async (matrix, revision) => { settings = { matrix, revision: revision + 1, writable: true }; },
        audit: async event => { actions.push(event); },
      };
      return run(transaction);
    },
    async denied(event) { actions.push(event); },
  };
  const auth = {
    async identify(role, allowPasswordChange, touchActivity) {
      activity.push(touchActivity);
      return { id: role, username: role, enabled: true, role, sessionExpiresAt: Date.now() + 60_000 };
    },
  };
  const limits = { enter: async () => () => {}, user: async () => {} };
  const lots = createNotificationLotsHttp({ list: async () => [] });
  const documents = async (request, segments, actor, allowed) => {
    if (segments[0] !== "expedientes") return null;
    assert.equal(allowed, true);
    return Response.json({ items: [] });
  };
  const consultations = async (request, segments) => segments[0] === "consultations" ? Response.json({ items: [] }) : null;
  const origin = "http://127.0.0.1:3115";
  const route = () => createMariaHttp(auth, origin, undefined, consultations, limits, lots,
    createAdminHttp(new AdminService(repo)), documents, async () => structuredClone(settings));
  let handler = route();
  const request = (role, path, body) => handler(new Request(`${origin}/api/${path}`, {
    method: body ? "PATCH" : "GET",
    headers: { cookie: `tp_maria_session=${role}`, origin, "content-type": "application/json" },
    body: body && JSON.stringify(body),
  }), path.split("/"));
  const admin = "administrator";
  const publicRole = "atencion_publico";
  assert.equal((await request(publicRole, "expedientes")).status, 403);
  assert.equal((await request(publicRole, "admin/permissions")).status, 403);
  const updated = defaultAccessMatrix();
  updated.atencion_publico.expedientes = true;
  updated.atencion_publico.notificationLots = true;
  assert.equal((await request(publicRole, "admin/permissions", { revision: 0, matrix: updated })).status, 403);
  assert.equal((await request(admin, "admin/permissions", { revision: 0, matrix: updated })).status, 200);
  assert.deepEqual(actions.find(event => event.result === "success").permissionChanges, [
    { role: publicRole, module: "notificationLots", before: false, after: true },
    { role: publicRole, module: "expedientes", before: false, after: true },
  ]);
  handler = route();
  assert.equal((await (await request(admin, "admin/permissions")).json()).revision, 1);
  assert.equal((await (await request(publicRole, "session")).json()).access.expedientes, true);
  assert.equal((await request(publicRole, "expedientes")).status, 200);
  assert.equal((await request(publicRole, "expedientes/doc/descarga")).status, 403);
  assert.equal((await request(publicRole, "expedientes/doc/contenido")).status, 403);
  assert.equal((await request(publicRole, "notification-lots")).status, 200);
  assert.equal((await request(publicRole, "notification-lots/LOTE_INICIAL_47/export")).status, 403);
  const locked = defaultAccessMatrix();
  locked.administrator.administration = false;
  assert.equal((await request(admin, "admin/permissions", { revision: 1, matrix: locked })).status, 400);
  assert.equal((await request(admin, "admin/permissions", { revision: 0, matrix: updated })).status, 409);
  const revoked = defaultAccessMatrix();
  revoked.atencion_publico.history = false;
  assert.equal((await request(admin, "admin/permissions", { revision: 1, matrix: revoked })).status, 200);
  assert.equal((await request(publicRole, "expedientes")).status, 403);
  assert.equal((await request(publicRole, "notification-lots")).status, 403);
  assert.equal((await request(publicRole, "consultations")).status, 403);
  const live = (await (await request(publicRole, "module-access")).json()).access;
  assert.equal(live.expedientes, false);
  assert.equal(live.history, false);
  assert.equal(activity.at(-1), false);
  assert.equal((await request(admin, "admin/permissions")).status, 200);
});
