import { readFileSync } from "node:fs";
import mariadb, { type PoolConfig } from "mariadb";

export function poolConfiguration(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const { MARIADB_HOST: host, MARIADB_USER: user, MARIADB_PASSWORD: password } = env;
  if (!host || !user || !password || env.MARIADB_DATABASE !== "auxiliares")
    throw new Error("MariaDB: configuración incompleta o base no permitida.");
  const local = ["127.0.0.1", "::1", "localhost"].includes(host);
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0' || (env.NODE_ENV === 'production' && env.MARIADB_TLS === 'false'))
    throw new Error('MariaDB: TLS con validación de certificados obligatorio.');
  if (env.MARIADB_TLS === "false" && !local)
    throw new Error("MariaDB: TLS obligatorio para conexiones remotas.");
  const port = Number(env.MARIADB_PORT ?? 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("MariaDB: puerto inválido.");
  return {
    host, user, password, port, database: "auxiliares",
    connectionLimit: 5, connectTimeout: 5000, acquireTimeout: 5000,
    queryTimeout: 5000, multipleStatements: false, timezone: "+00:00",
    ssl: env.MARIADB_TLS === "false" && local ? false : {
      rejectUnauthorized: true,
      ...(env.MARIADB_TLS_CA_FILE ? { ca: readFileSync(env.MARIADB_TLS_CA_FILE, "utf8") } : {}),
    },
  };
}
// Lazy: importing the adapter never connects or reads credentials.
let pool: ReturnType<typeof mariadb.createPool> | undefined;
export function mariaPool() {
  return pool ??= mariadb.createPool(poolConfiguration());
}
export async function closeMariaPool() {
  if (pool) { await pool.end(); pool = undefined; }
}
