import { performance } from 'node:perf_hooks';
import { HttpError } from '../security';
import { imageDirectory, imageError, localityToken, selectHistorical, type ParcelImageRef } from './config';
import type { ImageReader } from '../image-reader';

export const HISTORICAL_REFRESH_MS = 60 * 60 * 1000;
type Snapshot = { groups: Map<string, string[]>; files: number; indexed: number; bytes: number };
export type HistoricalStatus = {
  lastAttempt: number | null; lastSuccess: number | null; files: number; indexed: number;
  metadataBytes: number; durationMs: number | null; error: string | null; building: boolean;
};
type Options = {
  now?: () => number; monotonic?: () => number;
  schedule?: (tick: () => void, ms: number) => { unref?: () => void };
  cancel?: (timer: any) => void; report?: (status: HistoricalStatus) => void;
  maxEntries?: number; maxBytes?: number; timeoutMs?: number;
};
const key = (locality: string, parcel: string) => JSON.stringify([locality, parcel]);
const safeCodes = new Set(['IMAGE_TIMEOUT','IMAGE_CONNECTION','IMAGE_ACCESS_DENIED','IMAGE_AUTHENTICATION',
  'IMAGE_HOST_KEY','IMAGE_HOST_KEY_UNVERIFIED','IMAGE_CONFIG','IMAGE_BUSY','IMAGE_INDEX_LIMIT','IMAGE_TOO_LARGE','IMAGE_READ','IMAGE_QUEUE_TIMEOUT']);

/** Names only. All valid numeric splits preserve the existing reference-specific selector. */
function build(names: string[], maxEntries: number, maxBytes: number): Snapshot {
  if (names.length > maxEntries) throw imageError('IMAGE_INDEX_LIMIT');
  const groups = new Map<string, string[]>(); let indexed = 0, bytes = 0;
  for (const filename of names) {
    const match = /^(\d{4})_(.+)\.png$/i.exec(filename);
    if (filename.length > 255 || !match || Number(match[1]) === 0) continue;
    let accepted = false;
    for (let i = 0; i < match[2].length; i++) if (match[2][i] === '_') {
      const locality = match[2].slice(0, i), tail = /^(\d+)(?:_([A-Za-z0-9_-]+))?$/.exec(match[2].slice(i + 1));
      if (!tail || !/^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*$/.test(locality)) continue;
      const id = key(locality.toUpperCase(), tail[1]);
      let bucket = groups.get(id);
      // Conservative accounting budget, including keys, links, arrays and strings.
      bytes += 32 + (bucket ? 0 : 160 + id.length * 2) + (accepted ? 0 : 160 + filename.length * 2);
      if (bytes > maxBytes) throw imageError('IMAGE_INDEX_LIMIT');
      if (!bucket) { bucket = []; groups.set(id, bucket); }
      bucket.push(filename); accepted = true;
    }
    if (accepted) indexed++;
  }
  return { groups, files: names.length, indexed, bytes };
}

export class HistoricalIndex {
  private snapshot?: Snapshot;
  private pending?: Promise<boolean>;
  private controller?: AbortController;
  private timer?: { unref?: () => void };
  private started = false;
  private stopped = false;
  private state: HistoricalStatus = { lastAttempt: null, lastSuccess: null, files: 0, indexed: 0,
    metadataBytes: 0, durationMs: null, error: null, building: false };
  private now; private monotonic; private maxEntries; private maxBytes; private timeoutMs;
  constructor(private load: (signal: AbortSignal) => Promise<string[]>, private options: Options = {}) {
    this.now = options.now ?? Date.now; this.monotonic = options.monotonic ?? (() => performance.now());
    this.maxEntries = options.maxEntries ?? 100000; this.maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
    this.timeoutMs = options.timeoutMs ?? 10000;
  }
  start() {
    if (this.started || this.stopped) return;
    this.started = true;
    this.timer = (this.options.schedule ?? ((tick, ms) => setInterval(tick, ms)))(() => { void this.refresh(); }, HISTORICAL_REFRESH_MS);
    this.timer.unref?.();
    void this.refresh();
  }
  refresh(): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false);
    if (this.pending) return this.pending;
    const controller = this.controller = new AbortController(), start = this.monotonic();
    this.state = { ...this.state, lastAttempt: this.now(), building: true };
    // Defer load so pending is installed before any user-supplied loader runs.
    this.pending = Promise.resolve().then(async () => {
      try {
        const names = await this.load(controller.signal);
        const next = build(names, this.maxEntries, this.maxBytes);
        if (this.stopped || controller.signal.aborted) return false;
        if (this.monotonic() - start > this.timeoutMs) throw imageError('IMAGE_TIMEOUT');
        this.snapshot = next; // Single atomic publication; old snapshot remains usable until here.
        this.state = { ...this.state, lastSuccess: this.now(), files: next.files, indexed: next.indexed,
          metadataBytes: next.bytes, error: null };
        return true;
      } catch (error) {
        if (!this.stopped) this.state.error = error instanceof HttpError && safeCodes.has(error.code) ? error.code : 'IMAGE_CONNECTION';
        return false;
      } finally {
        this.state = { ...this.state, durationMs: Math.round(this.monotonic() - start), building: false };
        this.pending = undefined; this.controller = undefined;
        if (!this.stopped) { try { this.options.report?.(this.status()); } catch { /* Diagnostics cannot break scheduling. */ } }
      }
    });
    return this.pending;
  }
  lookup(ref: ParcelImageRef) {
    if (!this.snapshot || this.stopped) throw imageError('IMAGE_CATALOG_UNAVAILABLE');
    return selectHistorical(this.snapshot.groups.get(key(localityToken(ref.locality), ref.parcel)) ?? [], ref);
  }
  status(): HistoricalStatus { return { ...this.state }; }
  async stop() {
    this.stopped = true;
    if (this.timer) (this.options.cancel ?? clearInterval)(this.timer as any);
    this.timer = undefined; this.controller?.abort(); this.snapshot = undefined;
    await this.pending;
  }
}

export function historicalLoader(reader: Pick<ImageReader, 'read'>, env: NodeJS.ProcessEnv) {
  return (signal: AbortSignal): Promise<string[]> => reader.read(
    r => r.filenames(imageDirectory('historical', env), 100000, 16 * 1024 * 1024), 'historical-index', signal);
}
