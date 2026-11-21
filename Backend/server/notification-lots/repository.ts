import { notificationLots, type NotificationLot } from "../../domain/notification-lots";
import { institutionalRead, type InstitutionalRead } from "../institutional/pool";

export const notificationLotPageSize = 25;
export const excelRowLimit = 1_048_576;
const source = "FROM TRABAJO_DATOS.V_AGM_LOTES_NOTIFICACION_GESTORIA v";
const membership = "BINARY v.ID_LOTE = ?";
const padCod = `CASE WHEN BINARY v.TIPO_OBJETO = 'CIU'
  AND TRIM(v.NRO_OBJETO_NRO_PLAN) REGEXP '^[0-9]{1,11}$'
  AND CAST(TRIM(v.NRO_OBJETO_NRO_PLAN) AS UNSIGNED) BETWEEN 1 AND 2147483647
  THEN CAST(TRIM(v.NRO_OBJETO_NRO_PLAN) AS UNSIGNED) END`;
const hasParcel = `(${padCod}) IS NOT NULL
  AND NULLIF(TRIM(v.ZONA), '') IS NOT NULL
  AND NULLIF(TRIM(v.OBSERVACIONES_TIPO_OBJETOS), '') IS NOT NULL`;
const detailOrder = "ORDER BY BINARY v.ZONA, BINARY v.OBSERVACIONES_TIPO_OBJETOS, BINARY v.NRO_OBJETO_NRO_PLAN, BINARY v.TIPO_OBJETO";

export type NotificationLotExport = {
  columns: { name: string; dataType: string }[];
  rows: Record<string, unknown>[];
};

function optionalText(value: unknown): string | null {
  return value == null ? null : String(value).trim() || null;
}

function quoteColumn(name: string) {
  return "`" + name.replaceAll("`", "``") + "`";
}

function orderValue(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  return value == null ? "" : String(value);
}

export class NotificationLotRepository {
  constructor(private read: InstitutionalRead = institutionalRead) {}

  async list() {
    return this.read(async reader => {
      const rows = await reader.query(`SELECT BINARY v.ID_LOTE AS id, COUNT(*) AS total,
        COUNT(DISTINCT ${padCod}) AS uniqueParcels
        ${source} WHERE BINARY v.ID_LOTE IN (?, ?, ?) GROUP BY BINARY v.ID_LOTE`, notificationLots.map(lot => lot.id));
      const counts = new Map(rows.map(row => [String(row.id), { total: Number(row.total), uniqueParcels: Number(row.uniqueParcels) }]));
      return notificationLots.map(lot => ({ ...lot, ...(counts.get(lot.id) ?? { total: 0, uniqueParcels: 0 }) }));
    });
  }

  async detail(id: NotificationLot["id"], page: number) {
    return this.read(async reader => {
      const [count, ...rows] = await reader.query(`SELECT result.* FROM (
        SELECT 0 AS rowKind, COUNT(*) AS total, COUNT(DISTINCT ${padCod}) AS uniqueParcels,
          COUNT(*) - COUNT(CASE WHEN ${hasParcel} THEN 1 END) AS unmatched,
          NULL AS padCod, NULL AS locality, NULL AS parcel, NULL AS hasParcel,
          NULL AS sortObject, NULL AS sortType
        ${source} WHERE ${membership}
        UNION ALL
        SELECT 1, NULL, NULL, NULL, pageRows.padCod, pageRows.locality, pageRows.parcel,
          pageRows.hasParcel, pageRows.sortObject, pageRows.sortType
        FROM (
          SELECT ${padCod} AS padCod, v.ZONA AS locality, v.OBSERVACIONES_TIPO_OBJETOS AS parcel,
            CASE WHEN ${hasParcel} THEN 1 ELSE 0 END AS hasParcel,
            v.NRO_OBJETO_NRO_PLAN AS sortObject, v.TIPO_OBJETO AS sortType
          ${source} WHERE ${membership} ${detailOrder} LIMIT ? OFFSET ?
        ) pageRows
      ) result ORDER BY result.rowKind, BINARY result.locality, BINARY result.parcel,
        BINARY result.sortObject, BINARY result.sortType`,
      [id, id, notificationLotPageSize, (page - 1) * notificationLotPageSize]);
      const unmatched = Number(count.unmatched);
      if (unmatched > 0) console.warn("notification_lot_assignments_without_parcel", { lot: id, count: unmatched });
      return {
        rows: rows.map(row => ({ padCod: optionalText(row.padCod), locality: optionalText(row.locality),
          parcel: row.padCod == null ? null : optionalText(row.parcel), hasParcel: Number(row.hasParcel) === 1 })),
        total: Number(count.total), uniqueParcels: Number(count.uniqueParcels), unmatched,
        page, pageSize: notificationLotPageSize,
      };
    });
  }

  async exportRows(id: NotificationLot["id"]): Promise<NotificationLotExport> {
    return this.read(async reader => {
      const metadata = await reader.query(`SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = 'TRABAJO_DATOS' AND TABLE_NAME = 'V_AGM_LOTES_NOTIFICACION_GESTORIA'
        ORDER BY ORDINAL_POSITION`);
      if (!metadata.length) throw new Error("Notification lot view columns unavailable");
      const columns = metadata.map(column => ({ name: String(column.name), dataType: String(column.dataType).toLowerCase() }));
      const projection = columns.map(column => {
        const name = quoteColumn(column.name);
        return column.dataType === "date" ? `CAST(v.${name} AS CHAR) AS ${name}` : `v.${name}`;
      }).join(", ");
      const rows = await reader.query(`SELECT ${projection} ${source} WHERE ${membership} LIMIT ?`, [id, excelRowLimit]);
      const sortColumns = ["ZONA", "OBSERVACIONES_TIPO_OBJETOS", "NRO_OBJETO_NRO_PLAN", "TIPO_OBJETO", ...columns.map(column => column.name)];
      rows.sort((left, right) => {
        for (const name of sortColumns) {
          const a = orderValue(left[name]), b = orderValue(right[name]);
          if (a !== b) return a < b ? -1 : 1;
        }
        return 0;
      });
      return { columns, rows };
    });
  }
}
