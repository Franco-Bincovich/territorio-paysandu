import type { Actor } from '../consultations/model';
import { HttpError } from '../security';

export type Expediente = { id: string; padCod: string; reference: string; name: string;
  storageKey: string; documentType: 'PDF' | 'PNG' | 'JPEG'; mimeType: string;
  size: number; incorporatedAt: string; available: boolean };
export type PublicExpediente = Omit<Expediente, 'storageKey'>;
/** Catalog implementations must return an atomic, deterministic page ordered by ID.
 * No filename matching: the catalog is the authority for the PadCod association. */
export interface ExpedientesCatalog {
  list(padCod: string, page: number, pageSize: number, actor: Actor): Promise<{ items: Expediente[]; total: number }>;
  find(id: string): Promise<Expediente | null>;
}
/** Explicit resource policy. Administrators do not automatically bypass it. */
export interface ExpedientesPolicy {
  canReadParcel(actor: Actor, padCod: string): Promise<boolean>;
  canReadDocument(actor: Actor, document: Expediente): Promise<boolean>;
}
export interface ExpedientesStorage { read(document: Expediente, signal: AbortSignal): Promise<Uint8Array>; }
export const fail = (code = 'EXPEDIENTES_UNAVAILABLE', status = 503) => new HttpError(status, code,
  status === 403 ? 'No tenés acceso a estos expedientes.' : status === 404 ? 'Documento no disponible.' :
  status === 400 ? 'Revisá los parámetros de la solicitud.' : 'Los expedientes no están disponibles temporalmente.');
export function padCode(value: string) {
  if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) throw fail('VALIDATION', 400);
  return value;
}
export function documentId(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value)) throw fail('VALIDATION', 400);
  return value;
}
export const types = { PDF: ['application/pdf', '.pdf'], PNG: ['image/png', '.png'], JPEG: ['image/jpeg', '.jpg', '.jpeg'] } as const;
export function hasDocumentSignature(document: Expediente, content: Uint8Array) {
  const bytes=Buffer.from(content.buffer,content.byteOffset,content.byteLength);
  return document.documentType === 'PDF' ? bytes.subarray(0,5).equals(Buffer.from('%PDF-')) :
    document.documentType === 'PNG' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
    bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
}
export function validateDocument(value: Expediente): Expediente {
  if (!value || typeof value !== 'object') throw fail('EXPEDIENTES_CATALOG');
  try { documentId(value.id); padCode(value.padCod); } catch { throw fail('EXPEDIENTES_CATALOG'); }
  if (!Object.hasOwn(types, value.documentType) || value.mimeType !== types[value.documentType][0] ||
    !Number.isSafeInteger(value.size) || value.size < 1 || typeof value.available !== 'boolean' ||
    !Number.isFinite(Date.parse(value.incorporatedAt)) ||
    [value.name, value.reference].some(v => typeof v !== 'string' || !v.trim() || v.length > 200 || /[\x00-\x1f\x7f]/.test(v)) ||
    typeof value.storageKey !== 'string') throw fail('EXPEDIENTES_CATALOG');
  return value;
}
export function publicDocument(d: Expediente): PublicExpediente {
  return { id:d.id, padCod:d.padCod, reference:d.reference, name:d.name, documentType:d.documentType,
    mimeType:d.mimeType, size:d.size, incorporatedAt:d.incorporatedAt, available:d.available };
}
