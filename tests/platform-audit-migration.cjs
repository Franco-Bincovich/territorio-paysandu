// Opt-in. Pass a JSON file with { hostPort, password } for a disposable local MariaDB.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const maria = require("mariadb");

const fixture = readFileSync(path.join(__dirname, "fixtures/platform-audit-admin-ddl.sql"), "utf8");
const migration = readFileSync(path.join(__dirname, "../Backend/server/mariadb/migrations/002-platform-audit.sql"), "utf8");
const verification = readFileSync(path.join(__dirname, "../deploy/auditoria-transversal-verificacion.sql"), "utf8");
const table = "TP_ADMIN_AUDIT_V1";
const originalColumns = [
  "EVENT_ID", "ACTOR_ID", "TARGET_ID", "ACTION", "RESULT", "OCCURRED_AT", "REASON",
  "REQUEST_ID", "ERROR_CODE", "BEFORE_JSON", "AFTER_JSON", "ACTOR_USERNAME", "TARGET_USERNAME",
].join(",");
const oldInsert = `INSERT INTO ${table} (${originalColumns})
  VALUES (?,?,?,?,?,UTC_TIMESTAMP(6),?,?,?,?,?,?,?)`;
const newInsert = `INSERT INTO ${table}
  (EVENT_ID, ACTOR_ID, ACTION, RESULT, OCCURRED_AT, REASON, REQUEST_ID, MODULE, ADMIN_ACTION,
   OBJECT_TYPE, OBJECT_ID, OBJECT_VERSION, AFTER_JSON)
  VALUES (?,?,?,?,UTC_TIMESTAMP(6),'',?,?,?,?,?,?,?)`;

async function main() {
  const configPath = process.argv[2];
  if (!configPath) throw new Error("Pass the disposable loopback MariaDB config JSON path.");
  const { hostPort, password } = JSON.parse(readFileSync(configPath, "utf8"));
  const port = Number(/^127\.0\.0\.1:(\d+)$/.exec(hostPort)?.[1]);
  assert(Number.isInteger(port) && port > 1024 && port < 65536 && port !== 3306);
  assert.equal(typeof password, "string");
  assert(password);
  const config = { host: "127.0.0.1", port, user: "root", password, dateStrings: true };
  const db = await maria.createConnection(config);
  const schema = `qa_audit_ddl_${randomUUID().replaceAll("-", "")}`;
  let created = false;
  let locker;
  try {
    const [{ db_version: version }] = await db.query("SELECT VERSION() AS db_version");
    assert.match(version, /^11\.8\./);
    await db.query(`CREATE DATABASE \`${schema}\``);
    created = true;
    await db.query(`USE \`${schema}\``);
    await db.query(fixture);

    const duplicated = "historical-duplicate";
    const detail = JSON.stringify([{ role: "collaborator", module: "history", before: false, after: true }]);
    const actor = randomUUID();
    const target = randomUUID();
    const seed = index => db.query(oldInsert, [
      randomUUID(), actor, index === 0 ? null : target,
      index === 0 ? "permissions-update" : index === 1 ? "update" : "list",
      index === 1 ? "denied" : "success", "Fixture de prueba",
      index < 2 ? duplicated : randomUUID(), index === 1 ? "FORBIDDEN" : null,
      index === 2 ? "{}" : null, index === 0 ? detail : null, "Actor ficticio", null,
    ]);
    for (let index = 0; index < 109; index++) await seed(index);
    const historical = () => db.query(`SELECT ${originalColumns} FROM ${table}
      WHERE MODULE IS NULL ORDER BY EVENT_ID`);
    const before = await db.query(`SELECT ${originalColumns} FROM ${table} ORDER BY EVENT_ID`);
    const ddl = migration.replace("auxiliares.TP_ADMIN_AUDIT_V1", `\`${schema}\`.${table}`);
    const start = performance.now();
    await db.query(ddl);
    const initialMs = Math.round(performance.now() - start);
    assert.deepEqual(await historical(), before);
    const [{ matching: legacyDuplicates }] = await db.query(
      `SELECT COUNT(*) AS matching FROM ${table} WHERE REQUEST_ID = ? AND AUDIT_REQUEST_ID IS NULL
         AND ADMIN_VISIBLE = 1`, [duplicated]);
    assert.equal(Number(legacyDuplicates), 2);
    await seed(110);
    const withOldWrite = await historical();
    assert.equal(withOldWrite.length, 110);

    const request = randomUUID();
    const newArgs = [randomUUID(), actor, "update_permissions", "success", request, "administration",
      "permissions-update", "permissions", "1", 8, detail];
    await db.query(newInsert, newArgs);
    await assert.rejects(db.query(newInsert, [randomUUID(), ...newArgs.slice(1)]), { code: "ER_DUP_ENTRY" });
    await db.query(newInsert, [
      randomUUID(), "unverified", "login", "denied", randomUUID(), "auth",
      null, null, null, null, null,
    ]);
    await assert.rejects(db.query(newInsert, [
      randomUUID(), actor, "read_detail", "success", "invalid-request-id", "consultations",
      null, null, null, null, null,
    ]), { code: "ER_CONSTRAINT_FAILED" });
    const expectedRows = await db.query(`SELECT * FROM ${table} ORDER BY EVENT_ID`);
    const repeatStart = performance.now();
    await db.query(ddl);
    const repeatMs = Math.round(performance.now() - repeatStart);
    assert.deepEqual(await db.query(`SELECT * FROM ${table} ORDER BY EVENT_ID`), expectedRows);
    assert.deepEqual(await historical(), withOldWrite);

    locker = await maria.createConnection({ ...config, database: schema });
    await locker.beginTransaction();
    await locker.query(`SELECT EVENT_ID FROM ${table} LIMIT 1`);
    let alterFinished = false;
    const blockedStart = performance.now();
    const blockedAlter = db.query(ddl).then(() => alterFinished = true);
    const observedAlter = blockedAlter.then(() => null, error => error);
    await delay(300);
    const waitedWhileLocked = !alterFinished;
    await locker.rollback();
    const blockedError = await observedAlter;
    if (blockedError) throw blockedError;
    assert(waitedWhileLocked);
    const blockedMs = Math.round(performance.now() - blockedStart);
    assert(alterFinished);
    assert.deepEqual(await db.query(`SELECT * FROM ${table} ORDER BY EVENT_ID`), expectedRows);

    const verify = verification.replaceAll("auxiliares.TP_ADMIN_AUDIT_V1", `\`${schema}\`.${table}`);
    const outputs = verify.replace(/^--.*$/gm, "").split(";").map(part => part.trim()).filter(Boolean);
    assert.equal(outputs.length, 5);
    const results = [];
    for (const sql of outputs) results.push(await db.query(sql));
    const [verifiedDdl, verifiedHistoric, verifiedTransverse, verifiedDuplicates, verifiedPermissions] = results;
    assert.match(verifiedDdl[0]["Create Table"], /UX_TP_ADMIN_AUDIT_REQUEST_V2/);
    assert.equal(verifiedHistoric.reduce((total, row) => total + Number(row.eventos_historicos), 0), 110);
    assert.deepEqual(verifiedTransverse.map(row => [row.MODULE, Number(row.ADMIN_VISIBLE)]),
      [["administration", 1], ["auth", 0]]);
    assert.equal(Number(verifiedDuplicates[0].claves_nuevas_repetidas), 0);
    assert.equal(Number(verifiedPermissions[0].cambios_de_permisos_incompletos), 0);
    console.log(JSON.stringify({ version, initialMs, repeatMs, blockedMs,
      waitedWhileLocked, historicalRowsPreserved: 109, legacyWriteAccepted: true,
      historicalDuplicateRowsPreserved: 2, newDuplicateRejected: true, verifiedStatements: results.length }));
  } finally {
    if (locker) await locker.end();
    try {
      if (created) await db.query(`DROP DATABASE \`${schema}\``);
    } finally {
      await db.end();
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
