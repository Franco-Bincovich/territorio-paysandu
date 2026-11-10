import mariadb from 'mariadb';
import { poolConfiguration } from '../../mariadb/pool';
import type { Rule } from '../../request-limits';
import { unavailable } from './memory';

// Fixed across deployments and users of the same auxiliaries DB. Never configurable via HTTP.
const lock = 'territorio:auxiliares:standalone:v1';
export interface Coordinator { consume(rules: Rule[]): Promise<number> }

/** One dedicated connection, outside the authentication pool. No unbounded waiting queue. */
export class MariaCoordinator implements Coordinator {
  private connection: any;
  private busy = false;
  private retryAt = 0;
  constructor(private connect = () => mariadb.createConnection({
    ...poolConfiguration(), connectTimeout: 1500, queryTimeout: 1500, socketTimeout: 0,
  })) {}

  close() { this.connection?.destroy(); this.connection = undefined; }

  async consume(rules: Rule[]) {
    if (this.busy || Date.now() < this.retryAt) throw unavailable();
    this.busy = true;
    let transaction = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      const fresh = !this.connection;
      if (!this.connection) {
        this.connection = await this.connect();
        this.connection.on?.('error', () => {});
      }
      const c = this.connection;
      // Bound the entire operation, including a silent network partition.
      // An idle socket timeout would accidentally release the instance lock.
      watchdog = setTimeout(() => c.destroy(), 2000);
      if (fresh) {
        const rows = await this.connection.query('SELECT GET_LOCK(?, 0) AS owned', [lock]);
        if (Number(rows[0]?.owned) !== 1) throw unavailable();
        await this.connection.query('SET SESSION innodb_lock_wait_timeout = 1');
      }
      const ownership = await c.query('SELECT IS_USED_LOCK(?) = CONNECTION_ID() AS owned', [lock]);
      if (Number(ownership[0]?.owned) !== 1) throw unavailable();
      // Verify the reviewed schema exists even for non-login requests.
      if (rules.length) { await c.beginTransaction(); transaction = true; }
      const rows = await c.query('SELECT bucket, tokens, at_ms FROM auxiliares.FB_SECURITY_STANDALONE_V1 ORDER BY bucket' + (rules.length ? ' FOR UPDATE' : ''));
      if (rows.length !== 2 || rows[0].bucket !== 'auth:global' || rows[1].bucket !== 'auth:hour') throw unavailable();
      if (!rules.length) return 0;
      const clock = await c.query('SELECT UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS now_ms');
      const now = Number(clock[0].now_ms);
      if (!Number.isFinite(now)) throw unavailable();
      let retry = 0;
      const states = rules.map(r => {
        const old = rows.find((row: any) => row.bucket === r.key);
        const at = Number(old?.at_ms), previous = Number(old?.tokens);
        if (!old || !Number.isFinite(at) || !Number.isFinite(previous) || previous < 0 || previous > r.capacity) throw unavailable();
        // Backward DB clock jumps do not refill; retain the future timestamp.
        const tokens = Math.min(r.capacity, previous + Math.max(0, now - at) * r.capacity / r.period);
        if (tokens < r.cost) retry = Math.max(retry, Math.ceil((Math.max(0, at - now) + (r.cost - tokens) * r.period / r.capacity) / 1000));
        return { r, tokens, at: Math.max(now, at) };
      });
      if (!retry) for (const { r, tokens, at } of states) await c.query(
        'UPDATE auxiliares.FB_SECURITY_STANDALONE_V1 SET tokens = ?, at_ms = ? WHERE bucket = ?', [tokens - r.cost, at, r.key]);
      await c.commit(); transaction = false;
      return retry;
    } catch {
      if (transaction) { try { await this.connection.rollback(); } catch {} }
      this.connection?.destroy(); this.connection = undefined;
      this.retryAt = Date.now() + 5000;
      throw unavailable();
    } finally { if (watchdog) clearTimeout(watchdog); this.busy = false; }
  }
}
