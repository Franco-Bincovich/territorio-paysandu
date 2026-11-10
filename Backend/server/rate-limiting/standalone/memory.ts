import { performance } from 'node:perf_hooks';
import { HttpError } from '../../security';
import type { QuotaStore, Rule } from '../../request-limits';

export const unavailable = () => new HttpError(503, 'SECURITY_UNAVAILABLE', 'El servicio no está disponible temporalmente.');

/** Synchronous admission: no await between checking and committing the entire batch. */
export class StandaloneMemory implements QuotaStore {
  private entries = new Map<string, { tokens: number; at: number; expires: number }>();
  private cursor = this.entries.keys();
  constructor(private now = () => performance.now(), private maximum = 10000) {}
  prepare(rules: Rule[]) {
    const now = this.now();
    // Bounded maintenance; never evict live counters to admit a new identity.
    for (let i = 0; i < 64; i++) {
      let next = this.cursor.next();
      if (next.done) { this.cursor = this.entries.keys(); break; }
      if (this.entries.get(next.value)!.expires <= now) this.entries.delete(next.value);
    }
    const seen = new Set<string>();
    const states = rules.map(r => {
      if (seen.has(r.key) || !Number.isFinite(r.capacity) || !Number.isFinite(r.period) ||
          !Number.isFinite(r.cost) || r.capacity <= 0 || r.period <= 0 || r.cost <= 0 || r.cost > r.capacity) throw unavailable();
      seen.add(r.key);
      const old = this.entries.get(r.key);
      const tokens = old && old.expires > now
        ? Math.min(r.capacity, old.tokens + Math.max(0, now - old.at) * r.capacity / r.period) : r.capacity;
      return { r, tokens };
    });
    if (this.entries.size + states.filter(s => !this.entries.has(s.r.key)).length > this.maximum) throw unavailable();
    const retry = Math.max(0, ...states.map(({ r, tokens }) => Math.ceil((r.cost - tokens) * r.period / r.capacity / 1000)));
    let committed = false;
    return { retry, commit: () => {
      if (retry || committed) throw unavailable();
      committed = true;
      for (const { r, tokens } of states) this.entries.set(r.key, { tokens: tokens - r.cost, at: now, expires: now + r.period * 2 });
    } };
  }
  async consume(rules: Rule[]) { const plan = this.prepare(rules); if (!plan.retry) plan.commit(); return plan.retry; }
}
