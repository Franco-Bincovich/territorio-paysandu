import type { CadastreAdapter, ParcelKey, ParcelRecord, PersonSearch } from './index';

export type CadastreCacheOptions = Readonly<{
  /** 0 disables caching. Hard upper limit: five minutes. Default: 30 seconds. */
  ttlMs?: number;
  /** LRU keys per adapter instance; 1..1000. Default: 100. */
  maxEntries?: number;
  /** Do not cache larger search responses; 1..1000. Default: 100. */
  maxRecordsPerEntry?: number;
  now?: () => number;
}>;
type Value = ParcelRecord | readonly ParcelRecord[];
type Entry = { value: Value; expiresAt: number };

/** Process-local cache for synthetic fixtures only. No persistent/distributed storage,
 * no shared singleton, no auth caching, and no image URL caching. Each caller chooses
 * its adapter instance/scope. Institutional/empty/error results are never retained.
 * Never wrap an authorized institutional adapter until its privacy policy is approved.
 */
export class SyntheticCadastreCache implements CadastreAdapter {
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly maxRecordsPerEntry: number;
  private readonly now: () => number;
  private lastClock = -Infinity;
  private generation = 0;
  constructor(private readonly delegate: CadastreAdapter, options: CadastreCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 30_000;
    this.maxEntries = options.maxEntries ?? 100;
    this.maxRecordsPerEntry = options.maxRecordsPerEntry ?? 100;
    this.now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 0 || this.ttlMs > 300_000) throw new RangeError('Cache TTL must be 0..300000 milliseconds');
    for (const value of [this.maxEntries, this.maxRecordsPerEntry]) if (!Number.isSafeInteger(value) || value < 1 || value > 1000) throw new RangeError('Cache bounds must be 1..1000');
  }
  clear(): void { this.entries.clear(); this.generation++; }
  private clock(): number {
    const now = this.now();
    if (!Number.isFinite(now)) { this.clear(); throw new RangeError('Invalid cache clock'); }
    if (now < this.lastClock) this.clear();
    this.lastClock = now;
    return now;
  }
  private async read<T extends Value | null>(key: string, fetch: () => Promise<T>): Promise<T> {
    const now = this.clock();
    // Purge expired keys as well as bounding live entries.
    for (const [entryKey, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(entryKey);
    const hit = this.entries.get(key);
    if (hit && this.ttlMs > 0) {
      this.entries.delete(key); this.entries.set(key, hit);
      return structuredClone(hit.value) as T;
    }
    const generation = this.generation;
    const value = await fetch(); // Errors propagate; never retain failures or promises.
    const rows: readonly ParcelRecord[] = value === null ? [] : Array.isArray(value) ? value : [value as ParcelRecord];
    if (this.ttlMs > 0 && generation === this.generation && rows.length > 0 && rows.length <= this.maxRecordsPerEntry && rows.every(row => row.source === 'synthetic')) {
      const expiresAt = this.clock() + this.ttlMs;
      // A backwards clock clears/increments generation; do not repopulate that generation.
      if (generation === this.generation) {
        this.entries.delete(key);
        while (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
        this.entries.set(key, { value: structuredClone(value as Value), expiresAt });
      }
    }
    return structuredClone(value);
  }
  findParcel(key: ParcelKey): Promise<ParcelRecord | null> {
    const request = structuredClone(key);
    return this.read(JSON.stringify(['parcel', request.locality, request.parcel]), () => this.delegate.findParcel(request));
  }
  findPerson(query: PersonSearch): Promise<readonly ParcelRecord[]> {
    const request = structuredClone(query);
    return this.read(JSON.stringify(['person', request.field, request.exact]), () => this.delegate.findPerson(request));
  }
}
