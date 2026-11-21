const assert = require("node:assert/strict");
const { test } = require("node:test");
require("../scripts/register-runtime-ts.cjs");

const { createConsultationHttp } = require("../Backend/server/consultations/http.ts");
const { createMariaHttp } = require("../Backend/server/mariadb/http.ts");
const { MariaAuthStore } = require("../Backend/server/mariadb/store.ts");
const { ROLES } = require("../shared/permissions.ts");

const id = "12345678-1234-1234-1234-123456789012";
const row = { USER_ID: id, USERNAME: "Franco", ENABLED: 1, ROLE: "administrator", MUST_CHANGE_PASSWORD: 0 };

test("MariaDB resolves the canonical key and rejects ambiguous or inconsistent records", async () => {
  let rows = [row];
  const store = new MariaAuthStore({
    async getConnection() {
      return {
        async query(sql, params) {
          if (sql.startsWith("SET")) return;
          assert.match(sql, /u\.USERNAME_KEY = \? AND u\.DELETED_AT IS NULL LIMIT 2/);
          assert.deepEqual(params, [Buffer.from("franco")]);
          return rows;
        },
        async release() {},
      };
    },
  });
  for (const spelling of ["Franco", "franco", "FRANCO", " Ｆｒａｎｃｏ "]) {
    assert.equal((await store.findUser(spelling)).username, "Franco");
  }
  rows = [];
  assert.equal(await store.findUser("Franco"), null);
  rows = [{ ...row, USERNAME: "different" }];
  assert.equal(await store.findUser("Franco"), null);
  rows = [row, { ...row, USERNAME: "FRANCO" }];
  assert.equal(await store.findUser("Franco"), null);
});

test("MariaDB session preserves the real role without expanding consultation permissions", async () => {
  const origin = "http://127.0.0.1:3105";
  const limits = { async enter() { return () => {}; }, async user() {} };
  const consultations = createConsultationHttp({}, { async list() { return { consultations: [] }; } },
    async () => {}, () => true);
  for (const role of ROLES) {
    const auth = { async identify() {
      return { id, username: "QA", role, enabled: true, mustChangePassword: false, sessionExpiresAt: Date.now() + 60_000 };
    } };
    const handler = createMariaHttp(auth, origin, undefined, consultations, limits);
    const session = await handler(new Request(origin + "/api/session"), ["session"]);
    assert.equal((await session.json()).user.role, role);
    const list = await handler(new Request(origin + "/api/consultations"), ["consultations"]);
    assert.equal(list.status, role === "collaborator" ? 200 : 403);
  }
});
