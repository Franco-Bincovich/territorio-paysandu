import { notificationLots, type NotificationLot, type NotificationLotPreview } from "../../domain/notification-lots";
import { institutionalRead, type InstitutionalRead, type Reader } from "../institutional/pool";

const notificationLotPreviewSize = 10;
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
const previewColumns: ReadonlyArray<{ heading: string; fields: readonly string[] }> = [
  { heading: "Código municipal", fields: ["NRO_OBJETO_NRO_PLAN"] },
  { heading: "Número de padrón", fields: ["OBSERVACIONES_TIPO_OBJETOS"] },
  { heading: "Localidad", fields: ["ZONA"] },
  { heading: "Denominación", fields: ["DENOMINACION"] },
  { heading: "Domicilio y altura", fields: ["DOMICILIO", "ALTURA"] },
  { heading: "Estado del relevamiento", fields: ["ESTADO_RELEVAMIENTO"] },
  { heading: "RUT", fields: ["CUIT"] },
  { heading: "Cédula de identidad", fields: ["TIPO_DOCUMENTO", "DOCUMENTO"] },
  { heading: "Celular", fields: ["CELULAR2"] },
  { heading: "Correo", fields: ["CORREO_ELECTRONICO"] },
];

export type NotificationLotExport = {
  columns: { name: string; dataType: string }[];
  rows: Record<string, unknown>[];
};

function quoteColumn(name: string) {
  return "`" + name.replaceAll("`", "``") + "`";
}

const leadingSortColumns = ["ZONA", "OBSERVACIONES_TIPO_OBJETOS", "NRO_OBJETO_NRO_PLAN", "TIPO_OBJETO"];

function sortExpression(column: NotificationLotExport["columns"][number]) {
  const field = `v.${quoteColumn(column.name)}`;
  const text = /binary|blob/.test(column.dataType)
    ? `REPLACE(TO_BASE64(${field}), CHAR(10), '')`
    : `CAST(${field} AS CHAR CHARACTER SET utf8mb4)`;
  return `BINARY COALESCE(${text}, '')`;
}

function lotTotals(id: NotificationLot["id"], count: Record<string, unknown>) {
  const unmatched = Number(count.unmatched);
  if (unmatched > 0) console.warn("notification_lot_assignments_without_parcel", { lot: id, count: unmatched });
  return { total: Number(count.total), uniqueParcels: Number(count.uniqueParcels), unmatched };
}

async function sourceColumns(reader: Reader): Promise<NotificationLotExport["columns"]> {
  const metadata = await reader.query(`SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'TRABAJO_DATOS' AND TABLE_NAME = 'V_AGM_LOTES_NOTIFICACION_GESTORIA'
    ORDER BY ORDINAL_POSITION`);
  if (!metadata.length) throw new Error("Notification lot view columns unavailable");
  return metadata.map(column => ({ name: String(column.name), dataType: String(column.dataType).toLowerCase() }));
}

function sourceOrder(columns: NotificationLotExport["columns"]) {
  const byName = new Map(columns.map(column => [column.name, column]));
  // Keep the same leading keys and tie-breakers for the preview and the export.
  const sortColumns = [...new Set([...leadingSortColumns, ...byName.keys()])];
  return sortColumns.map(name => sortExpression(byName.get(name) ?? { name, dataType: "varchar" })).join(", ");
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

  async preview(id: NotificationLot["id"]): Promise<NotificationLotPreview> {
    return this.read(async reader => {
      const [count] = await reader.query(`SELECT COUNT(*) AS total, COUNT(DISTINCT ${padCod}) AS uniqueParcels,
        COUNT(*) - COUNT(CASE WHEN ${hasParcel} THEN 1 END) AS unmatched
        ${source} WHERE ${membership}`, [id]);
      const columns = await sourceColumns(reader);
      const projection = previewColumns.flatMap(column => column.fields).map(field => {
        const name = quoteColumn(field);
        return `CAST(v.${name} AS CHAR) AS ${name}`;
      }).join(", ");
      const rows = await reader.query(`SELECT ${projection} ${source} WHERE ${membership}
        ORDER BY ${sourceOrder(columns)} LIMIT ?`, [id, notificationLotPreviewSize]);
      return {
        columns: previewColumns.map(column => column.heading),
        rows: rows.map(row => previewColumns.map(column =>
          column.fields.map(field => String(row[field] ?? "").trim()).filter(Boolean).join(" "))),
        ...lotTotals(id, count),
      };
    });
  }

  async exportRows(id: NotificationLot["id"]): Promise<NotificationLotExport> {
    return this.read(async reader => {
      const columns = await sourceColumns(reader);
      const projection = columns.map(column => {
        const name = quoteColumn(column.name);
        return column.dataType === "date" || column.name === "CUIT"
          ? `CAST(v.${name} AS CHAR) AS ${name}`
          : `v.${name}`;
      }).join(", ");
      const rows = await reader.query(`SELECT ${projection} ${source} WHERE ${membership}
        ORDER BY ${sourceOrder(columns)} LIMIT ?`, [id, excelRowLimit]);
      return { columns, rows };
    });
  }
}
