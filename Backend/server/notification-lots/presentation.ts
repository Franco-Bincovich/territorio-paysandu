import type { NotificationLotExport } from "./repository";

const headings: Record<string, string> = {
  CUIT: "RUT",
  NOMBRE_IMAGEN_ACTUAL: "Imagen actual",
  NOMBRE_IMAGEN_HISTORICA: "Imagen histórica",
};
const decimalTypes = new Set(["decimal", "numeric", "float", "double", "real"]);
const msPerDay = 86_400_000;
const excelEpoch = Date.UTC(1899, 11, 30);

function imageLocation(value: unknown) {
  const locality = String(value ?? "").trim();
  const key = locality.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[\s_-]+/g, " ");
  if (key === "PAYSANDU") return "Paysandú";
  if (key === "PAYSANDU CHACRAS") return "Paysandú Chacras";
  return locality || "Sin localidad informada";
}

function imageLabel(name: string, value: unknown, row: Record<string, unknown>) {
  const source = String(value ?? "").trim();
  if (!source) return "";
  const parcel = String(row.OBSERVACIONES_TIPO_OBJETOS ?? "").trim();
  const basename = source.split(/[\\/]/).at(-1) ?? "";
  const candidate = /^((?:19|20)\d{2})[_-]/.exec(basename)?.[1];
  const historicalYear = candidate &&
    (candidate !== parcel || basename.slice(5).split(/[_.-]+/).includes(parcel)) ? candidate : "Sin año informado";
  const year = name === "NOMBRE_IMAGEN_ACTUAL" ? "2026" : historicalYear;
  return `${year} · ${imageLocation(row.ZONA)} · ${parcel || "Sin padrón informado"}`;
}

function excelDate(value: unknown) {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(`${String(value)}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) return null;
  const serial = Math.floor((timestamp - excelEpoch) / msPerDay);
  return serial < 61 ? serial - 1 : serial;
}

function valueText(value: unknown) {
  if (value == null) return "";
  if (Buffer.isBuffer(value)) return value.length ? value.toString("base64") : "";
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value);
}

const decimalFormat = new Intl.NumberFormat("en-US", {
  useGrouping: false,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function notificationLotHeading(name: string) {
  return headings[name] ?? name;
}

type PresentedCell = {
  text: string;
  numeric?: { value: string; style: 2 | 3 };
};

export function presentNotificationLotCell(column: NotificationLotExport["columns"][number], row: Record<string, unknown>): PresentedCell {
  const value = row[column.name];
  const text = (column.name === "NOMBRE_IMAGEN_ACTUAL" || column.name === "NOMBRE_IMAGEN_HISTORICA"
    ? imageLabel(column.name, value, row)
    : valueText(value)).replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, "\ufffd");
  if (!text || column.name === "CUIT") return { text };
  if (column.dataType === "date") {
    const serial = excelDate(value);
    if (serial !== null) return { text, numeric: { value: String(serial), style: 2 } };
  }
  if (decimalTypes.has(column.dataType) && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(text) && Number.isFinite(Number(text))) {
    return { text: decimalFormat.format(Number(text)), numeric: { value: text, style: 3 } };
  }
  return { text };
}
