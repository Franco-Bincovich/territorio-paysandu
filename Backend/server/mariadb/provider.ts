import { HttpError } from "../security";

/** Explicit delivery mode. Never infers activation from database credentials. */
export function productionMariaEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== 'production' || env.AUTH_PROVIDER !== 'mariadb' || env.MARIADB_ENABLED !== 'true' ||
      env.MARIADB_TLS === 'false' || env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
      (env.INSTITUTIONAL_ENABLED === 'true' && env.INSTITUTIONAL_TLS === 'false')) return false;
  try {
    const origin = new URL(env.APP_ORIGIN ?? '');
    return origin.protocol === 'https:' && !origin.username && !origin.password &&
      origin.pathname === '/' && !origin.search && !origin.hash;
  } catch { return false; }
}
/** Selection is server-only; default and local QA behavior remain unchanged. */
export function requestedAuthProvider(env: NodeJS.ProcessEnv = process.env) {
  const provider = env.AUTH_PROVIDER ?? "supabase";
  if (provider === "supabase") return provider;
  if (provider === 'mariadb') {
    if (!productionMariaEnabled(env))
      throw new HttpError(503, 'CONFIGURATION', 'MariaDB de entrega requiere habilitación explícita, HTTPS y TLS con certificados válidos.');
    return provider;
  }
  if (provider !== "mariadb-test" || env.NODE_ENV === "production" || env.MARIADB_AUTH_TEST_ENABLED !== "true")
    throw new HttpError(503, "CONFIGURATION", "Proveedor de pruebas no habilitado.");
  const origin = new URL(env.APP_ORIGIN ?? "http://127.0.0.1:3000");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
    !["http:", "https:"].includes(origin.protocol))
    throw new HttpError(503, "CONFIGURATION", "MariaDB de prueba requiere origen local.");
  return provider;
}
