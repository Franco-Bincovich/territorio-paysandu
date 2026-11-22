import { authorize } from '../consultations/model';
import { requireCapability } from '../authorization';
import { HttpError } from '../security';
import { imageServices } from '../sftp-images/runtime';
import { expedienteQuery } from '../../../shared/expedientes';
import { InstitutionalCatalog } from './institutional-catalog';
import { docError, InstitutionalFilesystemStorage, InstitutionalSftpStorage, MAX_DOCX_BYTES, type InstitutionalStorage } from './institutional-storage';
import type { ExpedientesHandler } from './http';
import { validateDocx } from './docx';
import { convertDocxToPdf } from './conversion';
import { auditObject } from '../audit/platform';

const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin' };
export function createInstitutionalExpedientesHttp(storage: InstitutionalStorage, options: {
  ttlMs?: number; timeoutMs?: number; concurrency?: number;
  convert?: (bytes: Buffer, signal?: AbortSignal) => Promise<Buffer>;
} = {}): ExpedientesHandler {
  const catalog = new InstitutionalCatalog(storage, options.ttlMs), concurrency = options.concurrency ?? 2, timeoutMs = options.timeoutMs ?? 45000;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw docError('EXPEDIENTES_CONFIG');
  let active = 0;
  return async (request, segments, actor, moduleAccess) => {
    if (segments[0] !== 'expedientes' && !(segments[0] === 'parcels' && segments[2] === 'expedientes')) return null;
    let release = () => {}, timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController(), abort = () => controller.abort();
    try {
      authorize(actor, Date.now());
      const operationCapability = segments[2] === 'descarga' ? 'expedientes.download' : segments[2] === 'exportar' || segments[2] === 'contenido' ? 'expedientes.export' : 'expedientes.read';
      if (!moduleAccess || operationCapability !== 'expedientes.read') requireCapability(actor,operationCapability);
      const search = segments.length === 1 && segments[0] === 'expedientes';
      if (!search && !(segments.length === 3 && segments[0] === 'expedientes' && ['descarga', 'contenido', 'exportar'].includes(segments[2]))) throw docError('EXPEDIENTE_NOT_FOUND', 404);
      if (request.method !== 'GET') return Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Método no permitido.' } }, { status: 405, headers: { ...headers, Allow: 'GET' } });
      const query = new URL(request.url).searchParams;
      for (const key of query.keys()) if (!['localidad', 'padron', 'caso'].includes(key) || query.getAll(key).length !== 1) throw docError('VALIDATION', 400);
      const criteria = expedienteQuery({ localidad: query.get('localidad'), padron: query.get('padron'), caso: query.get('caso') ?? undefined });
      if (!criteria || !search && !criteria.caso) throw docError('VALIDATION', 400);
      if (active >= concurrency) throw docError('EXPEDIENTES_BUSY', 429);
      active++; let released = false;
      release = () => { if (!released) { released = true; active--; } };
      request.signal.addEventListener('abort', abort, { once: true }); if (request.signal.aborted) abort();
      timer = setTimeout(abort, timeoutMs);
      if (search) {
        const items = await catalog.search(criteria, controller.signal);
        if (controller.signal.aborted) throw docError('EXPEDIENTES_TIMEOUT');
        return Response.json({ items, total: items.length }, { headers });
      }
      const document = await catalog.find(segments[1], criteria, controller.signal);
      auditObject({type:'expediente',id:`${document.localidad}:${document.padron}:${document.caseNumber}`});
      let bytes = await storage.read(document.name, controller.signal);
      if (bytes.length !== document.size || bytes.length > MAX_DOCX_BYTES) throw docError('EXPEDIENTES_SIZE', 413);
      validateDocx(bytes);
      const word = segments[2] === 'descarga';
      if (!word) bytes = await (options.convert ?? convertDocxToPdf)(bytes, controller.signal);
      if (controller.signal.aborted) throw docError('EXPEDIENTES_TIMEOUT');
      if (!word && (bytes.length > MAX_DOCX_BYTES || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))) throw docError('EXPEDIENTES_CONVERSION');
      const size = bytes.length, filename = word ? document.name : document.name.replace(/\.docx$/, '.pdf');
      // Keep the buffer/admission bounded until response consumption, cancellation or expiry.
      const complete = release; let offset = 0, done = false;
      let bodyTimer: ReturnType<typeof setTimeout>;
      let streamController: ReadableStreamDefaultController<Uint8Array>;
      const finish = () => { if (done) return; done = true; bytes = Buffer.alloc(0); clearTimeout(bodyTimer); request.signal.removeEventListener('abort', cancelBody); complete(); };
      const cancelBody = () => { if (!done) { streamController.error(docError('EXPEDIENTES_CANCELLED', 499)); finish(); } };
      const body = new ReadableStream<Uint8Array>({
        start(c) { streamController = c; },
        pull(c) { if (done) return; if (offset === size) { c.close(); finish(); return; } const end = Math.min(offset + 65536, size); c.enqueue(Uint8Array.from(bytes.subarray(offset, end))); offset = end; },
        cancel() { finish(); },
      }, { highWaterMark: 0 });
      bodyTimer = setTimeout(cancelBody, timeoutMs);
      request.signal.addEventListener('abort', cancelBody, { once: true }); if (request.signal.aborted) cancelBody();
      const response = new Response(body, { headers: { ...headers,
        'Content-Type': word ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf',
        'Content-Length': String(size), 'Content-Disposition': `${segments[2] === 'contenido' ? 'inline' : 'attachment'}; filename="${filename}"`,
        'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'self'",
      } });
      release = () => {}; return response;
    } catch (error) {
      const e = error instanceof HttpError ? error : docError('EXPEDIENTES_UNAVAILABLE');
      return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status, headers: { ...headers, ...(e.status === 429 ? { 'Retry-After': '1' } : {}) } });
    } finally { if (timer) clearTimeout(timer); request.signal.removeEventListener('abort', abort); release(); }
  };
}
export function configuredInstitutionalExpedientesHttp(env: NodeJS.ProcessEnv = process.env): ExpedientesHandler {
  let handler: ExpedientesHandler | undefined;
  return async (request, segments, actor, moduleAccess) => {
    if (segments[0] !== 'expedientes' && !(segments[0] === 'parcels' && segments[2] === 'expedientes')) return null;
    // Authenticate before reading configuration or constructing any remote adapter.
    authorize(actor, Date.now());
    if (!moduleAccess) requireCapability(actor, 'expedientes.read');
    if (!handler) {
      const provider = env.EXPEDIENTES_PROVIDER ?? env.IMAGE_PROVIDER;
      let storage: InstitutionalStorage;
      if (provider === 'filesystem') storage = new InstitutionalFilesystemStorage(env.EXPEDIENTES_DIRECTORY ?? '/Satelitales/EXPEDIENTES_GENERADOS');
      else if (provider === 'sftp' && env.IMAGE_PROVIDER === 'sftp') storage = new InstitutionalSftpStorage(imageServices().reader, env.EXPEDIENTES_DIRECTORY ?? '/Satelitales/EXPEDIENTES_GENERADOS');
      else throw docError('EXPEDIENTES_CONFIGURATION_PENDING');
      handler = createInstitutionalExpedientesHttp(storage);
    }
    return handler(request, segments, actor, moduleAccess);
  };
}
