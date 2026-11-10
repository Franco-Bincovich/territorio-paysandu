import type { QuotaStore, Rule } from '../../request-limits';
import { StandaloneMemory, unavailable } from './memory';
import { MariaCoordinator, type Coordinator } from './persistent';

export class StandaloneQuotaStore implements QuotaStore {
  private busy = false;
  private waiting: { active: boolean; timer: ReturnType<typeof setTimeout>; resolve: (ok: boolean) => void }[] = [];
  constructor(private coordinator: Coordinator = new MariaCoordinator(), private memory = new StandaloneMemory()) {}
  private async acquire() {
    if (!this.busy) { this.busy = true; return; }
    this.waiting = this.waiting.filter(w => w.active);
    if (this.waiting.length >= 14) throw unavailable();
    const acquired = await new Promise<boolean>(resolve => {
      const entry = { active: true, resolve, timer: setTimeout(() => { entry.active = false; resolve(false); }, 1500) };
      this.waiting.push(entry);
    });
    if (!acquired) throw unavailable();
  }
  private release() {
    for (;;) {
      const next = this.waiting.shift();
      if (!next) { this.busy = false; return; }
      if (!next.active) continue;
      next.active = false; clearTimeout(next.timer); next.resolve(true); return;
    }
  }
  async consume(rules: Rule[]) {
    await this.acquire();
    try {
      // Serialize planning + SQL + commit, without an unbounded waiting queue.
      const plan = this.memory.prepare(rules);
      const persistent = rules.filter(r => r.key === 'auth:global' || r.key === 'auth:hour');
      const retry = await this.coordinator.consume(plan.retry ? [] : persistent);
      if (retry || plan.retry) return Math.max(retry, plan.retry);
      plan.commit();
      return 0;
    } finally { this.release(); }
  }
}
