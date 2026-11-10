import { HttpError } from './security';

export class ImageAdmissionError extends HttpError {
  readonly retryAfter = 2;
  constructor(code = 'IMAGE_BUSY', status = 503) { super(status, code, status === 499 ? 'Solicitud cancelada.' : 'El servicio de imágenes está ocupado. Reintentá en unos instantes.'); }
}
export function imageInteger(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number) {
  const value = env[key] === undefined ? fallback : Number(env[key]);
  if (!Number.isInteger(value) || value < min || value > max) throw new HttpError(503, 'IMAGE_CONFIG', 'La configuración de imágenes no es válida.');
  return value;
}
type Waiter = { grant: () => void; reject: (error: unknown) => void; cleanup: () => void };
/** FIFO metadata only; never retains response bodies. All exits remove timers/listeners. */
export class ImageAdmission {
  private active = 0;
  private waiting: Waiter[] = [];
  private closed = false;
  constructor(private concurrency: number, private capacity: number, private timeoutMs: number,
    private available = () => true, private entered = () => {}, private left = () => {},
    private report?: (waitMs: number) => void) {}
  acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.closed) return Promise.reject(new ImageAdmissionError());
    if (signal?.aborted) return Promise.reject(new ImageAdmissionError('IMAGE_CANCELLED', 499));
    const start = performance.now();
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => { if (timer) clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      const remove = (error: unknown) => { const i = this.waiting.indexOf(waiter); if (i >= 0) this.waiting.splice(i, 1); cleanup(); reject(error); };
      const abort = () => remove(new ImageAdmissionError('IMAGE_CANCELLED', 499));
      const waiter: Waiter = { cleanup, reject, grant: () => {
        cleanup(); this.active++; this.entered(); this.report?.(performance.now() - start);
        let released = false;
        resolve(() => { if (released) return; released = true; this.active--; this.left(); this.wake(); });
      } };
      if (!this.waiting.length && this.active < this.concurrency && this.available()) { waiter.grant(); return; }
      if (this.waiting.length >= this.capacity) { reject(new ImageAdmissionError()); return; }
      this.waiting.push(waiter);
      timer = setTimeout(() => remove(new ImageAdmissionError('IMAGE_QUEUE_TIMEOUT')), this.timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  wake() { while (this.waiting.length && this.active < this.concurrency && this.available()) this.waiting.shift()!.grant(); }
  close() { this.closed = true; for (const waiter of this.waiting.splice(0)) { waiter.cleanup(); waiter.reject(new ImageAdmissionError()); } }
}
