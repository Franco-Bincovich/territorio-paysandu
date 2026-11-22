import type { Pool, PoolConnection } from "mariadb";
import { defaultAccessMatrix, isAccessMatrix, type AccessMatrix, type AccessSettings } from "../../../shared/module-access";
import { mariaPool } from "../mariadb/pool";
import { HttpError } from "../security";

const unavailable = () => new HttpError(503, "MODULE_ACCESS_UNAVAILABLE", "No se pudo leer la configuración de permisos.");

export async function readModuleAccess(db: Pick<PoolConnection, "query">, lock = false): Promise<AccessSettings> {
  try {
    const [row] = await db.query(`SELECT REVISION, MATRIX_JSON FROM TP_MODULE_ACCESS_V1 WHERE CONFIG_ID = 1${lock ? " FOR UPDATE" : ""}`);
    if (!row) throw unavailable();
    const revision = Number(row.REVISION);
    const matrix = row.MATRIX_JSON === null && revision === 0 ? defaultAccessMatrix()
      : typeof row.MATRIX_JSON === "string" ? JSON.parse(row.MATRIX_JSON) : row.MATRIX_JSON;
    if (!Number.isSafeInteger(revision) || revision < 0 || !isAccessMatrix(matrix)) throw unavailable();
    return { revision, matrix, writable: true };
  } catch (error) {
    if ((error as { code?: string })?.code === "ER_NO_SUCH_TABLE") {
      return { revision: 0, matrix: defaultAccessMatrix(), writable: false };
    }
    throw unavailable();
  }
}

export async function saveModuleAccess(db: Pick<PoolConnection, "query">, matrix: AccessMatrix, revision: number) {
  const result = await db.query("UPDATE TP_MODULE_ACCESS_V1 SET REVISION = REVISION + 1, MATRIX_JSON = ? WHERE CONFIG_ID = 1 AND REVISION = ?",
    [JSON.stringify(matrix), revision]);
  if (Number(result.affectedRows) !== 1) {
    throw new HttpError(409, "VERSION_CONFLICT", "Los permisos cambiaron. Volvé a cargar la matriz antes de guardar.");
  }
}

export function configuredModuleAccess(pool?: Pick<Pool, "query">) {
  return () => readModuleAccess(pool ?? mariaPool());
}
