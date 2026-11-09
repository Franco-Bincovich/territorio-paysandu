import { readFileSync } from "node:fs";
import mariadb, { type PoolConfig, type PoolConnection } from "mariadb";
import { HttpError } from "../security";
import { productionMariaEnabled } from '../mariadb/provider';

const blocked = () => new HttpError(503, "INSTITUTIONAL_UNAVAILABLE", "La fuente institucional no está disponible. Revisá la conexión de solo lectura.");
export function institutionalConfiguration(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  if (env.INSTITUTIONAL_ENABLED !== "true" || (env.NODE_ENV === "production" && !productionMariaEnabled(env))) throw blocked();
  const host = env.INSTITUTIONAL_HOST, user = env.INSTITUTIONAL_USER;
  const password = env.INSTITUTIONAL_PASSWORD, database = env.INSTITUTIONAL_DATABASE;
  const port = Number(env.INSTITUTIONAL_PORT ?? 3306);
  if (!host || !user || !password || !database || database.toLowerCase() === "auxiliares" ||
    user === env.MARIADB_USER || password === env.MARIADB_PASSWORD || !Number.isInteger(port) || port < 1 || port > 65535 ||
    env.INSTITUTIONAL_TLS === "false" || env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw blocked();
  return { host, user, password, database, port, connectionLimit: 3,
    connectTimeout: 5000, acquireTimeout: 5000, queryTimeout: 5000, socketTimeout: 10000,
    multipleStatements: false, timezone: "+00:00", bigIntAsNumber: false,
    ssl: { rejectUnauthorized: true,
      ...(env.INSTITUTIONAL_TLS_CA_FILE ? { ca: readFileSync(env.INSTITUTIONAL_TLS_CA_FILE, "utf8") } : {}) } };
}
let pool: ReturnType<typeof mariadb.createPool> | undefined;
function institutionalPool() { return pool ??= mariadb.createPool(institutionalConfiguration()); }
export async function closeInstitutionalPool() { if (pool) { await pool.end(); pool = undefined; } }

export type Reader = { query(sql: string, params?: unknown[]): Promise<Record<string, any>[]> };
export type InstitutionalRead = <T>(run: (reader: Reader) => Promise<T>) => Promise<T>;

/** Check privileges via SELECT metadata only. Roles are rejected unless absent:
 * no assumption about hidden/inherited grants, no probe with write statements. */
async function verifyReadOnly(c: PoolConnection) {
  const info = await c.query("SELECT CURRENT_USER() AS account, CURRENT_ROLE() AS role_name");
  if (info[0].role_name && info[0].role_name !== "NONE") throw blocked();
  const account: string = info[0].account;
  const index = account.lastIndexOf("@");
  const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const grantee = `${quote(account.slice(0, index))}@${quote(account.slice(index + 1))}`;
  const privileges = await c.query(`SELECT PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = ?
    UNION ALL SELECT PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE = ? AND TABLE_SCHEMA = DATABASE()
    UNION ALL SELECT PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE = ? AND TABLE_SCHEMA = DATABASE()
    UNION ALL SELECT PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.COLUMN_PRIVILEGES WHERE GRANTEE = ? AND TABLE_SCHEMA = DATABASE()`,
  [grantee, grantee, grantee, grantee]);
  if (!privileges.some((p: { PRIVILEGE_TYPE: string }) => p.PRIVILEGE_TYPE === "SELECT") ||
    privileges.some((p: { PRIVILEGE_TYPE: string; IS_GRANTABLE: string }) =>
      !["SELECT", "SHOW VIEW", "USAGE"].includes(p.PRIVILEGE_TYPE) || p.IS_GRANTABLE === "YES")) throw blocked();
}
export const institutionalRead: InstitutionalRead = async run => {
  let c: PoolConnection | undefined;
  try {
    c = await institutionalPool().getConnection();
    const tls = await c.query("SELECT VARIABLE_VALUE AS cipher FROM information_schema.SESSION_STATUS WHERE VARIABLE_NAME = 'SSL_CIPHER'");
    if (!tls[0]?.cipher) throw blocked();
    await verifyReadOnly(c);
    // Transaction control changes no institutional data. No DML/DDL is issued.
    await c.query("START TRANSACTION READ ONLY");
    const connection = c;
    const reader: Reader = { query: (sql, params = []) => {
      if (!/^SELECT\s/i.test(sql) || /;/.test(sql)) throw blocked();
      return connection.query(sql, params);
    } };
    const result = await run(reader);
    await c.rollback();
    return result;
  } catch (error) {
    if (c) { try { await c.rollback(); } catch { c.destroy(); } }
    if (error instanceof HttpError && [400, 404, 409, 422].includes(error.status)) throw error;
    throw blocked();
  } finally { if (c) try { await c.release(); } catch { c.destroy(); } }
};
