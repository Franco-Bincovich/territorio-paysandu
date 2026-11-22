// Runs only against a freshly started, loopback-bound MariaDB Docker fixture.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomBytes, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const mariadb = require("mariadb");
require("../scripts/register-runtime-ts.cjs");
const { createMariaHttp } = require("../Backend/server/mariadb/http.ts");
const { createMariaAuth, hashPassword } = require("../Backend/server/mariadb/auth.ts");
const { MariaAuthStore } = require("../Backend/server/mariadb/store.ts");
const { createAdminHttp } = require("../Backend/server/admin/http.ts");
const { AdminService } = require("../Backend/server/admin/service.ts");
const { MariaAdminRepository } = require("../Backend/server/admin/mariadb-repository.ts");
const { readModuleAccess } = require("../Backend/server/admin/module-access-repository.ts");
const { createConsultationHttp } = require("../Backend/server/consultations/http.ts");
const { ConsultationRepository } = require("../Backend/server/consultations/repository.ts");
const { ConsultationReads } = require("../Backend/server/consultations/reads.ts");
const { requireCompatibility } = require("../Backend/server/consultations/schema.ts");
const { defaultAccessMatrix } = require("../shared/module-access.ts");

const worktree = path.join(__dirname, "..");
const package71 = path.join(worktree, "Backend/sql/package-7.1");
const auditTable = "TP_ADMIN_AUDIT_V1";
const migrationDir = path.join(worktree, "Backend/server/mariadb/migrations");
const image = "mariadb:11.8.9";
const origin = "http://127.0.0.1:3115";
const sharedCredential = `QA-Fictitious-${randomBytes(12).toString("hex")}`;
const legacyColumns = "EVENT_ID,ACTOR_ID,TARGET_ID,ACTION,RESULT,OCCURRED_AT,REASON,REQUEST_ID,ERROR_CODE,BEFORE_JSON,AFTER_JSON,ACTOR_USERNAME,TARGET_USERNAME";
const privacyMarker = "QA_SNAPSHOT_PRIVATE";
const json = value => typeof value === "string" ? JSON.parse(value) : value;
const log = (phase, details = {}) => console.log(JSON.stringify({ phase, ...details }));
const docker = (args, env = process.env) => execFileSync("docker", args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env }).trim();

function statements(sql) {
  let delimiter = ";";
  let buffer = "";
  const result = [];
  for (const line of sql.split(/\r?\n/)) {
    const command = line.match(/^\s*DELIMITER\s+(\S+)/i);
    if (command) {
      assert.equal(buffer.trim(), "");
      delimiter = command[1];
      continue;
    }
    if (!buffer && (!line.trim() || /^\s*--/.test(line))) continue;
    buffer += `${line}\n`;
    if (buffer.trimEnd().endsWith(delimiter)) {
      result.push(buffer.trimEnd().slice(0, -delimiter.length));
      buffer = "";
    }
  }
  assert.equal(buffer.trim(), "", "Fixture SQL statement must end in its delimiter");
  return result;
}

async function apply(connection, file) {
  for (const sql of statements(fs.readFileSync(file, "utf8"))) await connection.query(sql);
}

async function bootstrap(connection) {
  assert.match((await connection.query("SELECT VERSION() AS version"))[0].version, /^11\.8\.9-MariaDB/);
  assert.equal((await connection.query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='auxiliares'")).length, 0,
    "A fresh isolated schema is required");
  await apply(connection, path.join(__dirname, "fixtures/consultations-7.1-baseline.sql"));
  const files = ["baseline-triggers-restore.sql", "00-maintenance.sql",
    ...fs.readdirSync(path.join(package71, "steps")).filter(file => /^0[23][a-f]-/.test(file)).sort().map(file => `steps/${file}`),
    ...fs.readdirSync(package71).filter(file => /^(1\d|20)-.*\.sql$/.test(file)).sort(),
    "31-mark-reviewed.sql", "32-release-maintenance.sql"];
  for (const file of files) await apply(connection, path.join(package71, file));
  await connection.query(`ALTER TABLE FB_USUARIOS DROP CONSTRAINT CHK_FB_USUARIOS_ROLE,
    ADD CONSTRAINT CHK_FB_USUARIOS_ROLE CHECK(ROLE IN ('atencion_publico','collaborator','administrator')),
    ADD COLUMN FIRST_NAME VARCHAR(100), ADD COLUMN LAST_NAME VARCHAR(100), ADD COLUMN EMAIL VARCHAR(254),
    ADD COLUMN CI VARCHAR(8), ADD COLUMN USERNAME_KEY VARBINARY(400) UNIQUE, ADD COLUMN EMAIL_KEY VARBINARY(1016) UNIQUE,
    ADD COLUMN ADMIN_REVISION BIGINT UNSIGNED NOT NULL DEFAULT 1, ADD COLUMN DELETED_AT DATETIME(6)`);
  await apply(connection, path.join(__dirname, "fixtures/platform-audit-admin-ddl.sql"));
  await apply(connection, path.join(migrationDir, "001-module-access.sql"));
  const passwordHash = await hashPassword(sharedCredential);
  const users = new Map();
  for (const role of ["administrator", "collaborator", "atencion_publico"]) {
    const id = randomUUID();
    const username = `qa_audit_${role}`;
    await connection.query(`INSERT INTO FB_USUARIOS (USER_ID,USERNAME,USERNAME_KEY,ROLE,MUST_CHANGE_PASSWORD,
      FIRST_NAME, LAST_NAME, EMAIL, EMAIL_KEY, CI) VALUES(?,?,?,?,0,?,?,?,?,?)`,
    [id, username, Buffer.from(username), role, privacyMarker, "FICTICIO", `${username}@example.invalid`, Buffer.from(`${username}@example.invalid`), "11111111"]);
    await connection.query("INSERT INTO FB_USUARIOS_CREDENCIALES (USER_ID,PASSWORD_HASH) VALUES (?,?)", [id, passwordHash]);
    users.set(role, { id, username });
  }
  const history = [
    ["permissions-update", [{ role: "collaborator", module: "search", before: true, after: false }]],
    ["list", null], ["audit-list", null],
  ];
  const actor = users.get("administrator");
  for (const [action, detail] of history) {
    await connection.query(`INSERT INTO ${auditTable}
      (EVENT_ID,ACTOR_ID,ACTION,RESULT,OCCURRED_AT,REASON,REQUEST_ID,AFTER_JSON) VALUES(?,?,?,'success',UTC_TIMESTAMP(6),'QA histórico','qa-duplicate',?)`,
    [randomUUID(), actor.id, action, detail && JSON.stringify(detail)]);
  }
  return { users, passwordHash };
}

function projectedConnection(connection, options) {
  return {
    query: (...args) => connection.query(...args),
    beginTransaction: () => connection.beginTransaction(),
    rollback: () => connection.rollback(),
    release: () => connection.release(),
    destroy: () => connection.destroy(),
    async commit() {
      if (options.commit === "committed") await connection.commit();
      else await connection.rollback();
      throw new Error("QA simulated loss of the COMMIT acknowledgement");
    },
  };
}

function route(pool, { audit = pool, commit } = {}) {
  const authPool = commit ? { async getConnection() { return projectedConnection(await pool.getConnection(), { commit }); } } : pool;
  const institutions = async (request, segments) => {
    if (segments[0] === "search") return Response.json({ entries: ["QA catálogo"] });
    if (segments[0] === "parcels") return Response.json({ padCod: "910001" });
    if (segments[0] === "parcel-images") return Response.json({ images: [] });
    if (segments[0] === "parcel-image") return new Response("QA image bytes");
    return null;
  };
  const consultation = createConsultationHttp(new ConsultationRepository(pool, async input => ({
    source: "institutional", verifiedAt: new Date().toISOString(), ...input.parcel,
  })), new ConsultationReads(pool), () => requireCompatibility(pool), () => true);
  const limits = { async enter() { return () => {}; }, async user() {} };
  const lots = { capabilities: role => ({ consult: true, download: role === "administrator" }),
    async handle(request, segments) {
      return segments[2] === "export" ? new Response("QA Excel bytes") : Response.json({ lots: [] });
    } };
  const expedientes = async (request, segments) => {
    if (segments[0] !== "expedientes") return null;
    return segments[2] ? new Response("QA documento") : Response.json({ items: [] });
  };
  const admin = createAdminHttp(new AdminService(new MariaAdminRepository(pool)));
  return createMariaAuth(new MariaAuthStore(authPool)).then(auth => createMariaHttp(auth, origin,
    institutions, consultation, limits, lots, admin, expedientes, () => readModuleAccess(pool), audit || undefined));
}

async function invoke(handler, route, { method = "GET", body, cookie, requestOrigin = origin } = {}) {
  const request = new Request(`${origin}/api/${route}`, { method,
    headers: { Origin: requestOrigin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const response = await handler(request, new URL(request.url).pathname.slice(5).split("/"));
  const raw = await response.text();
  return { status: response.status, id: response.headers.get("X-Request-ID"), body: response.headers.get("Content-Type")?.includes("application/json") ? JSON.parse(raw) : raw,
    cookie: response.headers.get("Set-Cookie")?.split(";")[0] };
}

async function auditScenario(pool, expectedRequests, handler, request, options, expected) {
  const response = await invoke(handler, request, options);
  assert.equal(response.status, expected.status, `${request}: ${response.body?.error?.code ?? "unexpected response"}`);
  const rows = await pool.query(`SELECT * FROM ${auditTable} WHERE AUDIT_REQUEST_ID=?`, [response.id]);
  assert.equal(rows.length, expected.absent ? 0 : 1, request);
  if (rows.length) {
    assert.equal(rows[0].REQUEST_ID, response.id);
    assert.match(rows[0].EVENT_ID, /^[0-9a-f-]{36}$/);
    assert.ok(rows[0].OCCURRED_AT instanceof Date);
    for (const [column, value] of Object.entries(expected.fields ?? {})) assert.deepEqual(rows[0][column], value, `${request}: ${column}`);
    expectedRequests.add(response.id);
  }
  return { ...response, event: rows[0] };
}

async function releaseFixture(connection, container, ephemeral) {
  if (connection) await connection.end();
  if (container && ephemeral) {
    assert.match(container, /^tp-platform-audit-qa-[0-9a-f]{8}$/);
    assert.equal(docker(["inspect", "--format", "{{.Config.Image}}", container]), image);
    docker(["rm", "-f", "-v", container]);
  }
}

async function main() {
  const reuse = process.argv[2];
  const ephemeral = !reuse;
  const fixture = reuse ? JSON.parse(fs.readFileSync(reuse, "utf8")) : {
    name: `tp-platform-audit-qa-${randomBytes(4).toString("hex")}`, password: randomBytes(20).toString("hex"),
  };
  assert.match(fixture.name, /^tp-platform-audit-qa-[0-9a-f]{8}$/);
  let container, bootstrapPool, pool;
  try {
    if (ephemeral) docker(["run", "-d", "--pull", "never", "--name", fixture.name, "-p", "127.0.0.1::3306",
      "-e", "MARIADB_ROOT_PASSWORD", image], { ...process.env, MARIADB_ROOT_PASSWORD: fixture.password });
    container = fixture.name;
    assert.equal(docker(["inspect", "--format", "{{.Config.Image}}", container]), image);
    const binding = docker(["port", container, "3306/tcp"]);
    assert.match(binding, /^127\.0\.0\.1:\d+$/);
    if (reuse) assert.equal(binding, fixture.hostPort);
    const config = { host: "127.0.0.1", port: Number(binding.split(":")[1]), user: "root", password: fixture.password,
      connectionLimit: 6, connectTimeout: 2000, queryTimeout: 9000, timezone: "+00:00" };
    bootstrapPool = mariadb.createPool(config);
    let connection;
    for (let attempt = 0; attempt < 25; attempt++) {
      try { connection = await bootstrapPool.getConnection(); break; }
      catch (error) { if (attempt === 24) throw error; await delay(400); }
    }
    let seeded;
    try { seeded = await bootstrap(connection); } finally { await connection.release(); }
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "tp-audit-ddl-"));
    const descriptor = path.join(temporary, "mariadb.json");
    try {
      fs.writeFileSync(descriptor, JSON.stringify({ hostPort: binding, password: fixture.password }), { mode: 0o600 });
      execFileSync(process.execPath, [path.join(__dirname, "platform-audit-migration.cjs"), descriptor], { stdio: "inherit", windowsHide: true });
    } finally {
      if (fs.existsSync(descriptor)) fs.unlinkSync(descriptor);
      fs.rmdirSync(temporary);
    }
    pool = mariadb.createPool({ ...config, database: "auxiliares" });
    await requireCompatibility(pool);
    const old = await route(pool, { audit: false });
    const login = await invoke(old, "auth/login", { method: "POST", body: { username: seeded.users.get("administrator").username, password: sharedCredential } });
    assert.equal(login.status, 200);
    const oldPage = await invoke(old, "admin/audit?page=1&pageSize=1", { cookie: login.cookie });
    assert.equal(oldPage.status, 200, oldPage.body?.error?.code);
    const oldFull = await invoke(old, "admin/audit?page=1&pageSize=20", { cookie: login.cookie });
    assert.equal(oldFull.status, 200, oldFull.body?.error?.code);
    assert.ok(oldFull.body.items.some(item => item.action === "permissions-update" && item.permissionChanges?.length === 1));
    const before = await pool.query(`SELECT ${legacyColumns} FROM ${auditTable} ORDER BY EVENT_ID`);
    const migration = await pool.getConnection();
    try { await apply(migration, path.join(migrationDir, "002-platform-audit.sql")); }
    finally { await migration.release(); }
    assert.deepEqual(await pool.query(`SELECT ${legacyColumns} FROM ${auditTable} ORDER BY EVENT_ID`), before);
    const oldAudit = await invoke(old, "admin/audit?page=1&pageSize=1", { cookie: login.cookie });
    assert.equal(oldAudit.status, 200, oldAudit.body?.error?.code);
    assert.equal(oldAudit.body.total, before.length);
    assert.equal((await pool.query(`SELECT MODULE FROM ${auditTable} WHERE REQUEST_ID=?`, [oldAudit.id]))[0].MODULE, null);
    assert.equal((await invoke(old, "admin/audit?page=1&pageSize=20", { cookie: login.cookie })).status, oldFull.status);
    log("administrative reader and legacy-format writes work before and after ALTER");
    await exercise(pool, seeded);
    await verifyAuditGrants(pool, config);
  } finally {
    if (pool) await pool.end();
    await releaseFixture(bootstrapPool, container, ephemeral);
  }
}

async function verifyAuditGrants(pool, config) {
  const password = randomBytes(20).toString("hex");
  await pool.query("CREATE USER 'qa_platform_writer'@'%' IDENTIFIED BY ?", [password]);
  await pool.query("GRANT SELECT, INSERT ON auxiliares.TP_ADMIN_AUDIT_V1 TO 'qa_platform_writer'@'%'");
  const restricted = await mariadb.createConnection({ ...config, database: "auxiliares", user: "qa_platform_writer", password });
  try {
    await restricted.beginTransaction();
    const id = randomUUID();
    const requestId = randomUUID();
    await restricted.query(`INSERT INTO ${auditTable} (EVENT_ID,REQUEST_ID,ACTOR_ID,ACTION,RESULT,OCCURRED_AT,REASON,MODULE)
      VALUES (?,?,'unverified','list','success',UTC_TIMESTAMP(6),'','lots')`, [id, requestId]);
    assert.equal((await restricted.query(`SELECT EVENT_ID FROM ${auditTable} WHERE AUDIT_REQUEST_ID=?`, [requestId]))[0].EVENT_ID, id);
    await assert.rejects(restricted.query(`UPDATE ${auditTable} SET REASON='qa' WHERE EVENT_ID=?`, [id]), { code: "ER_TABLEACCESS_DENIED_ERROR" });
    await assert.rejects(restricted.query(`DELETE FROM ${auditTable} WHERE EVENT_ID=?`, [id]), { code: "ER_TABLEACCESS_DENIED_ERROR" });
    await restricted.rollback();
    log("audit-only SELECT/INSERT privileges, UPDATE/DELETE denied");
  } finally {
    await restricted.end();
  }
}

async function exercise(pool, { users, passwordHash }) {
  const administrator = users.get("administrator");
  const restricted = users.get("atencion_publico");

  const handler = await route(pool);
  const expectedRequests = new Set();
  const check = (request, options, expected, target = handler) => auditScenario(pool, expectedRequests, target, request, options, expected);
  const usersWithSessions = new Map();
  for (const [role, user] of users) {
    const login = await check("auth/login", { method: "POST", body: { username: user.username, password: sharedCredential } },
      { status: 200, fields: { MODULE: "auth", ACTION: "login", RESULT: "success", ACTOR_ID: user.id } });
    usersWithSessions.set(role, login.cookie);
    const options = { cookie: login.cookie };
    for (const [request, module, action] of [
      ["session", "session", "read_session"], ["module-access", "navigation", "read_access"],
      ["search?kind=ci&q=QA_SEARCH_PRIVATE", "search", "by_identity_document"],
      ["parcels/PAYSANDU/910001", "parcel", "read_detail"], ["parcel-images?padCod=910001", "images", "list"],
      ["parcel-image/actual?padCod=910001", "images", "download"], ["consultations", "consultations", "list"],
    ]) await check(request, options, { status: 200, fields: { MODULE: module, ACTION: action, RESULT: "success", ACTOR_ID: user.id } });
  }
  const adminCookie = usersWithSessions.get("administrator");
  const restrictedCookie = usersWithSessions.get("atencion_publico");
  const collaboratorCookie = usersWithSessions.get("collaborator");
  await check("auth/login", { method: "POST", body: { username: administrator.username, password: "QA_BAD_CREDENTIAL" } },
    { status: 401, fields: { RESULT: "denied", ACTOR_ID: "unverified", ACTOR_USERNAME: null, ERROR_CODE: "INVALID_LOGIN" } });
  await check("admin/permissions", { cookie: restrictedCookie },
    { status: 403, fields: { RESULT: "denied", ACTOR_ID: restricted.id, ADMIN_ACTION: "list" } });
  await check("admin/audit", { cookie: collaboratorCookie }, { status: 403, fields: { RESULT: "denied" } });
  await check("notification-lots/LOTE_INICIAL_47/export", { cookie: adminCookie }, { status: 200, fields: { MODULE: "lots", ACTION: "export_excel" } });
  await check("expedientes/doc/descarga", { cookie: adminCookie }, { status: 200, fields: { MODULE: "expedientes", ACTION: "download_word" } });
  await check("health", {}, { status: 404, absent: true });

  const matrix = defaultAccessMatrix();
  matrix.atencion_publico.notificationLots = true;
  matrix.atencion_publico.expedientes = true;
  const permissionBody = { revision: 0, matrix };
  const permission = await check("admin/permissions", { method: "PATCH", cookie: adminCookie, body: permissionBody },
    { status: 200, fields: { RESULT: "success", MODULE: "administration", ACTION: "update_permissions", ADMIN_ACTION: "permissions-update",
      OBJECT_TYPE: "permissions", OBJECT_ID: "1" } });
  assert.equal(Number(permission.event.OBJECT_VERSION), 1);
  const permissionChanges = [
    { role: "atencion_publico", module: "notificationLots", before: false, after: true },
    { role: "atencion_publico", module: "expedientes", before: false, after: true },
  ];
  assert.deepEqual(json(permission.event.AFTER_JSON), permissionChanges);
  assert.equal((await readModuleAccess(pool)).revision, 1);
  await check("admin/permissions", { method: "PATCH", cookie: adminCookie, body: { revision: 1, matrix } },
    { status: 200, fields: { RESULT: "no_change" } });
  assert.equal((await readModuleAccess(pool)).revision, 1);
  await check("notification-lots", { cookie: restrictedCookie }, { status: 200, fields: { MODULE: "lots", ACTION: "list" } });
  await check("expedientes/doc/descarga", { cookie: restrictedCookie }, { status: 403, fields: { MODULE: "expedientes", RESULT: "denied" } });

  const consultation = { idempotencyKey: randomUUID(), padCod: "910001", locality: "PAYSANDU", parcel: "1001",
    person: { name: "QA_PERSON_PRIVATE", documentType: "Otros", document: "QA_DOC_PRIVATE", relationship: "Presentante",
      phones: ["000123456"], phoneTypes: ["Celular"], emails: ["qa-contact@example.invalid"] },
    type: "General", description: "QA_DESCRIPTION_PRIVATE para verificar la auditoría.",
    address: { CALLE: "QA_ADDRESS_PRIVATE", PUERTA: "1", LOCALIDAD: "PAYSANDU" } };
  const first = await check("consultations", { method: "POST", cookie: collaboratorCookie, body: consultation },
    { status: 200, fields: { RESULT: "success", MODULE: "consultations", ACTION: "create", OBJECT_TYPE: "consultation" } });
  assert.equal(first.event.OBJECT_ID, first.body.id);
  assert.equal(Number(first.event.OBJECT_VERSION), 1);
  await check("consultations", { method: "POST", cookie: collaboratorCookie, body: consultation },
    { status: 200, fields: { RESULT: "no_change", OBJECT_ID: first.body.id } });
  const updated = { ...consultation, idempotencyKey: undefined, version: 1,
    description: "QA_DESCRIPTION_PRIVATE para verificar la revisión dos.", address: { ...consultation.address, PUERTA: "2" },
    person: { ...consultation.person, phones: ["000654321"] } };
  await check(`consultations/${first.body.id}`, { method: "PATCH", cookie: restrictedCookie, body: updated },
    { status: 403, fields: { RESULT: "denied" } });
  const edited = await check(`consultations/${first.body.id}`, { method: "PATCH", cookie: collaboratorCookie, body: updated },
    { status: 200, fields: { RESULT: "success", OBJECT_ID: first.body.id } });
  assert.equal(Number(edited.event.OBJECT_VERSION), 2);
  for (const history of ["FB_CONSULTAS_HISTORIAL", "FB_CONTACTOS_HISTORIAL", "FB_DOMICILIOS_HISTORIAL"]) {
    const versions = await pool.query(`SELECT VERSION FROM ${history} WHERE ID_CONSULTA=? ORDER BY VERSION`, [first.body.id]);
    assert.deepEqual(versions.map(row => Number(row.VERSION)), [1, 2]);
  }
  log("three real roles, requests mapped to one real row, permissions and all three business histories");

  const collaborator = users.get("collaborator");
  await check(`admin/users/${collaborator.id}`, { method: "PATCH", cookie: adminCookie, body: {
    expectedRevision: 1, firstName: "QA_NEW_PROFILE_PRIVATE", lastName: "FICTICIO", email: "qa-new-profile@example.invalid", ci: "22222222",
  } }, { status: 200, fields: { ADMIN_ACTION: "update", TARGET_ID: collaborator.id } });
  const visible = await pool.query(`SELECT REQUEST_ID,COALESCE(ADMIN_ACTION,ACTION) AS action FROM ${auditTable}
    WHERE ADMIN_VISIBLE=1 ORDER BY OCCURRED_AT DESC,EVENT_ID DESC`);
  const adminList = await check("admin/audit?page=2&pageSize=2", { cookie: adminCookie }, { status: 200, fields: { ADMIN_ACTION: "audit-list" } });
  assert.equal(adminList.body.total, visible.length);
  assert.deepEqual(adminList.body.items.map(item => [item.requestId, item.action]), visible.slice(2, 4).map(item => [item.REQUEST_ID, item.action]));
  const allAdmin = await check("admin/audit?page=1&pageSize=50", { cookie: adminCookie }, { status: 200 });
  assert.deepEqual(allAdmin.body.items.find(item => item.requestId === permission.id).permissionChanges, permissionChanges);
  assert.ok(allAdmin.body.items.some(item => item.requestId === "qa-duplicate" && item.permissionChanges?.length === 1));
  const bridge = await route(pool, { audit: false });
  const beforeReversal = Number((await pool.query(`SELECT COUNT(*) AS n FROM ${auditTable} WHERE ADMIN_VISIBLE=1`))[0].n);
  const reversed = await invoke(bridge, "admin/audit?page=1&pageSize=50", { cookie: adminCookie });
  assert.equal(reversed.status, 200);
  assert.equal(reversed.body.total, beforeReversal);
  assert.ok(reversed.body.items.every(item => !["login", "read_detail", "by_identity_document"].includes(item.action)));
  assert.deepEqual(reversed.body.items.find(item => item.requestId === permission.id).permissionChanges, permissionChanges);
  assert.equal((await pool.query(`SELECT MODULE FROM ${auditTable} WHERE REQUEST_ID=?`, [reversed.id]))[0].MODULE, null);
  log("admin listing count/order/pagination/authorization and compatible reversal after general events");

  await pool.query(`CREATE TRIGGER qa_intercept_audit BEFORE INSERT ON ${auditTable} FOR EACH ROW
    BEGIN IF NEW.MODULE IS NOT NULL AND NEW.RESULT='success' AND NEW.ACTION='update_permissions'
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='QA administrative write rejected'; END IF; END`);
  const rollback = await check("admin/permissions", { method: "PATCH", cookie: adminCookie, body: { revision: 1, matrix: defaultAccessMatrix() } },
    { status: 503, fields: { RESULT: "error", ERROR_CODE: "PLATFORM_AUDIT_UNAVAILABLE" } });
  assert.equal(rollback.body.error.code, "PLATFORM_AUDIT_UNAVAILABLE");
  assert.equal((await readModuleAccess(pool)).revision, 1);
  await pool.query("DROP TRIGGER qa_intercept_audit");
  const broken = await route(pool, { audit: { async query() { throw new Error("QA_SNAPSHOT_PRIVATE"); } } });
  const blockedDownload = await check("parcel-image/actual?padCod=910001", { cookie: adminCookie }, { status: 503, absent: true }, broken);
  assert.equal(blockedDownload.body.error.code, "PLATFORM_AUDIT_UNAVAILABLE");
  assert.ok(!JSON.stringify(blockedDownload.body).includes("QA image bytes"));

  for (const commit of ["committed", "rolled_back"]) {
    const unreliable = await route(pool, { commit });
    const oldSessions = Number((await pool.query("SELECT COUNT(*) AS n FROM FB_USUARIOS_SESIONES"))[0].n);
    const uncertain = await check("auth/login", { method: "POST", body: { username: administrator.username, password: sharedCredential } },
      { status: 503, fields: { RESULT: commit === "committed" ? "success" : "error" } }, unreliable);
    assert.equal(uncertain.body.error.code, "AUTH_COMMIT_UNCERTAIN");
    assert.equal(Number((await pool.query("SELECT COUNT(*) AS n FROM FB_USUARIOS_SESIONES"))[0].n), oldSessions + Number(commit === "committed"));
  }
  log("writer rollback, fail-closed download, commit reconciliation with simulated acknowledgement loss");

  const nextPassword = "QA_NEW_PASSWORD_PRIVATE_9";
  const passwordChange = { password: nextPassword, confirmPassword: nextPassword };
  await check("auth/password", { method: "POST", cookie: adminCookie, body: { password: nextPassword } },
    { status: 400, fields: { ACTION: "change_password", RESULT: "invalid" } });
  await check("auth/password", { method: "POST", cookie: adminCookie, body: { ...passwordChange, currentPassword: "QA_WRONG_CURRENT_PASSWORD" } },
    { status: 400, fields: { ACTION: "change_password", RESULT: "invalid", ERROR_CODE: "CURRENT_PASSWORD_INVALID" } });
  await check("auth/password", { method: "POST", cookie: adminCookie, body: { ...passwordChange, currentPassword: sharedCredential } },
    { status: 200, fields: { MODULE: "auth", ACTION: "change_password", RESULT: "success", ACTOR_ID: administrator.id } });
  await check("session", { cookie: adminCookie }, { status: 401, fields: { RESULT: "denied", ACTOR_ID: "unverified" } });
  await check("auth/logout", { method: "POST", cookie: restrictedCookie },
    { status: 200, fields: { MODULE: "auth", ACTION: "logout", RESULT: "success", ACTOR_ID: restricted.id } });
  await check("session", { cookie: restrictedCookie }, { status: 401, fields: { RESULT: "denied", ACTOR_ID: "unverified" } });
  await check("auth/logout", { method: "POST" },
    { status: 200, fields: { MODULE: "auth", ACTION: "logout", RESULT: "no_change", ACTOR_ID: "unverified" } });

  const requestId = randomUUID();
  const insert = () => pool.query(`INSERT INTO ${auditTable} (EVENT_ID,REQUEST_ID,ACTOR_ID,ACTION,RESULT,OCCURRED_AT,REASON,MODULE)
    VALUES (?,?,'unverified','list','success',UTC_TIMESTAMP(6),'','lots')`, [randomUUID(), requestId]);
  const contenders = await Promise.allSettled([insert(), insert()]);
  assert.equal(contenders.filter(entry => entry.status === "fulfilled").length, 1);
  assert.equal(contenders.find(entry => entry.status === "rejected").reason.code, "ER_DUP_ENTRY");
  const rows = await pool.query(`SELECT * FROM ${auditTable} WHERE MODULE IS NOT NULL`);
  assert.deepEqual(new Set(rows.map(row => row.REQUEST_ID)), new Set([...expectedRequests, requestId]));
  const serialized = JSON.stringify(rows, (_, value) => typeof value === "bigint" ? value.toString() : value);
  for (const sample of [sharedCredential, nextPassword, "QA_WRONG_CURRENT_PASSWORD", passwordHash, privacyMarker, "QA_NEW_PROFILE_PRIVATE", "qa-new-profile@example.invalid", "22222222",
    "QA_BAD_CREDENTIAL", "QA_SEARCH_PRIVATE", "QA_PERSON_PRIVATE", "QA_DOC_PRIVATE", "QA_DESCRIPTION_PRIVATE", "QA_ADDRESS_PRIVATE",
    ...[...usersWithSessions.values()].map(value => value.split("=")[1])]) assert.ok(!serialized.includes(sample), "unexpected private data in audit");
  assert.equal((await pool.query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA='auxiliares' AND TABLE_NAME='TP_PLATFORM_AUDIT_V1'"))[0].n, 0n);
  log("PASS", { verifiedRequests: expectedRequests.size, dataSource: "MariaDB 11.8.9 fixture on loopback", conflictingNewInserts: 1,
    historicalDuplicatesPreserved: true, referenceData: "fictitious adapters for Catastro, Lotes and Expedientes" });
}

main().catch(error => {
  console.error(error.name, error.code ?? "", error instanceof assert.AssertionError ? error.message : error.stack?.split("\n").slice(1, 4).join("\n"));
  process.exitCode = 1;
});
