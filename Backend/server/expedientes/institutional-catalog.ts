import { createHash } from 'node:crypto';
import { parseExpedienteName, type ExpedienteQuery, type InstitutionalDocument } from '../../../shared/expedientes';
import { docError, type InstitutionalStorage } from './institutional-storage';

type Entry = Omit<InstitutionalDocument, 'size'>;
export class InstitutionalCatalog {
  private snapshot?: Entry[];
  private refreshedAt = 0;
  private pending?: Promise<Entry[]>;
  constructor(private storage: InstitutionalStorage, private ttlMs = 30000, private now = Date.now) {
    if (!Number.isInteger(ttlMs) || ttlMs < 0 || ttlMs > 60000) throw docError('EXPEDIENTES_CONFIG');
  }
  invalidate() { this.snapshot = undefined; }
  private async entries(signal: AbortSignal, fresh = false) {
    if (!fresh && this.snapshot && this.now() - this.refreshedAt < this.ttlMs) return this.snapshot;
    if (!this.pending) this.pending = (async () => {
      const names = await this.storage.names(signal);
      if (names.length > 100000) throw docError('EXPEDIENTES_INDEX_LIMIT');
      const entries = names.flatMap(name => {
        const parsed = parseExpedienteName(name);
        return parsed ? [{ ...parsed, id: createHash('sha256').update(name).digest('hex') }] : [];
      });
      this.snapshot = entries; this.refreshedAt = this.now(); return entries;
    })().catch(error => { this.snapshot = undefined; throw error; }).finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private matching(entries: Entry[], query: ExpedienteQuery) {
    const items = entries.filter(d => d.localidad === query.localidad && d.padron === query.padron && (!query.caso || d.caseNumber === query.caso));
    const unique = new Set<string>();
    for (const item of items) {
      if (unique.has(item.caseNumber)) {
        // No physical paths, filenames or personal identifiers in operational logs.
        console.warn(JSON.stringify({ event: 'expedientes.catalog.ambiguous', code: 'EXPEDIENTES_AMBIGUOUS' }));
        throw docError('EXPEDIENTES_AMBIGUOUS', 409);
      }
      unique.add(item.caseNumber);
    }
    if (items.length > 1000) throw docError('EXPEDIENTES_RESULT_LIMIT');
    return items.sort((a, b) => BigInt(a.caseNumber) < BigInt(b.caseNumber) ? -1 : BigInt(a.caseNumber) > BigInt(b.caseNumber) ? 1 : 0);
  }
  async search(query: ExpedienteQuery, signal: AbortSignal): Promise<InstitutionalDocument[]> {
    const entries = this.matching(await this.entries(signal), query), result: InstitutionalDocument[] = [];
    const sizes = this.storage.sizes && entries.length ? await this.storage.sizes(entries.map(entry => entry.name), signal) : undefined;
    for (const [index, entry] of entries.entries()) result.push({ ...entry, size: sizes ? sizes[index] : await this.storage.size(entry.name, signal) });
    return result;
  }
  async find(id: string, query: ExpedienteQuery, signal: AbortSignal): Promise<InstitutionalDocument> {
    if (!/^[a-f0-9]{64}$/.test(id) || !query.caso) throw docError('VALIDATION', 400);
    // Revalidate association and ambiguity against current catalog before every download.
    const item = this.matching(await this.entries(signal, true), query).find(entry => entry.id === id);
    if (!item) throw docError('EXPEDIENTE_NOT_FOUND', 404);
    return { ...item, size: await this.storage.size(item.name, signal) };
  }
}
