/** History API date filters currently use UTC; presentation must match that calendar.
 * The institutional G3 contract may replace both together with Montevideo dates.
 */
export function historyDate(iso: string): string {
  const value = new Date(iso);
  if (!Number.isFinite(value.getTime())) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-UY", {
    timeZone: "UTC",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(value);
}
