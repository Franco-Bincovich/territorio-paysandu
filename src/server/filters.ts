import { HttpError } from "./security";
const invalid = (message: string): never => {
  throw new HttpError(400, "VALIDATION", message);
};
const consultationTypes = [
  "General",
  "Reclamo",
  "Falta de documentación",
  "Declaracion voluntaria de metros",
];
export function queryKeys(query: URLSearchParams, allowed: readonly string[]) {
  for (const key of query.keys()) {
    if (!allowed.includes(key) || query.getAll(key).length !== 1)
      invalid("Parámetro de búsqueda inválido.");
  }
}
function integer(
  query: URLSearchParams,
  key: string,
  fallback: number,
  max: number,
) {
  const value = query.get(key);
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/.test(value)) invalid("Página inválida.");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n > max) invalid("Página inválida.");
  return n;
}
export function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000"))
    invalid("Fecha inválida.");
  const date = new Date(value + "T00:00:00.000Z");
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    invalid("Fecha inválida.");
  return value;
}
export function historyFilters(query: URLSearchParams) {
  queryKeys(query, [
    "page",
    "pageSize",
    "locality",
    "parcel",
    "type",
    "from",
    "to",
  ]);
  const page = integer(query, "page", 1, 2147483647),
    pageSize = integer(query, "pageSize", 20, 100);
  // PostgREST uses bounded integer offsets; reject overflow instead of silently changing the range.
  const end = page * pageSize - 1;
  if (end > 2147483647) invalid("Página inválida.");
  const filters: Record<string, string> = {};
  for (const key of ["locality", "parcel", "type"]) {
    const raw = query.get(key);
    if (raw === null) continue;
    const value = raw.trim();
    if (
      !value ||
      value.length > (key === "parcel" ? 30 : 100) ||
      /[\u0000-\u001f]/.test(value)
    )
      invalid("Filtro inválido.");
    if (key === "parcel" && !/^\d+$/.test(value)) invalid("Padrón inválido.");
    if (key === "type" && !consultationTypes.includes(value))
      invalid("Tipo de consulta inválido.");
    filters[key] = value;
  }
  const from = query.has("from") ? calendarDate(query.get("from")!) : undefined;
  const to = query.has("to") ? calendarDate(query.get("to")!) : undefined;
  if (from && to && from > to) invalid("El rango de fechas está invertido.");
  return {
    page,
    pageSize,
    start: (page - 1) * pageSize,
    end,
    filters,
    from,
    to,
  };
}
