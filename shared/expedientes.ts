/** Institutional document numbers are not PadCod identifiers. */
export const EXPEDIENTE_LOCALIDADES = ['PAYSANDU', 'PAYSANDU_CHACRAS'] as const;
export type ExpedienteLocalidad = typeof EXPEDIENTE_LOCALIDADES[number];
export type ExpedienteQuery = { localidad: ExpedienteLocalidad; padron: string; caso?: string };
export type InstitutionalDocument = { id: string; caseNumber: string; padron: string; localidad: ExpedienteLocalidad; name: string; size: number };
export function expedienteNumber(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{1,19}$/.test(trimmed) || BigInt(trimmed) === 0n || BigInt(trimmed) > 9223372036854775807n) return null;
  return BigInt(trimmed).toString();
}
export function expedienteQuery(value: { localidad?: unknown; padron?: unknown; caso?: unknown }): ExpedienteQuery | null {
  const localidad = typeof value.localidad === 'string' ? value.localidad.trim() : '';
  const padron = expedienteNumber(value.padron);
  const caso = value.caso === undefined || value.caso === '' ? undefined : expedienteNumber(value.caso);
  if (!EXPEDIENTE_LOCALIDADES.includes(localidad as ExpedienteLocalidad) || !padron || caso === null) return null;
  return { localidad: localidad as ExpedienteLocalidad, padron, ...(caso ? { caso } : {}) };
}
export function parseExpedienteName(name: string): Omit<InstitutionalDocument, 'id' | 'size'> | null {
  const match = /^Expediente_(\d{1,19})_(\d{1,19})_(PAYSANDU|PAYSANDU_CHACRAS)\.docx$/.exec(name);
  if (!match) return null;
  const caseNumber = expedienteNumber(match[1]), padron = expedienteNumber(match[2]);
  return caseNumber && padron ? { name, caseNumber, padron, localidad: match[3] as ExpedienteLocalidad } : null;
}
