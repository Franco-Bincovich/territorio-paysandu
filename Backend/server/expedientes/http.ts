import { authorize, type Actor } from '../consultations/model';
import { HttpError, jsonBody } from '../security';
import { requireCapability } from '../authorization';
import { discardUnauditedResult } from '../audit/platform';
import { configuredInstitutionalExpedientesHttp } from './institutional-http';
import type { DocumentGeneration } from './generation';
import { documentId, fail, padCode, publicDocument, types, validateDocument, hasDocumentSignature,
  type ExpedientesCatalog, type ExpedientesPolicy, type ExpedientesStorage } from './contracts';

const headers = { 'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer', 'Cross-Origin-Resource-Policy':'same-origin' };
export type ExpedientesHandler = (request: Request, segments: string[], actor: Actor, moduleAccess?: boolean) => Promise<Response | null>;
export function matchesExpedientes(segments: string[]) {
  return segments.length === 2 && segments[0] === 'expedientes' && segments[1] === 'generar' ||
    segments.length === 3 && ((segments[0] === 'parcels' && segments[2] === 'expedientes') ||
    (segments[0] === 'expedientes' && ['contenido','descarga','exportar'].includes(segments[2])));
}
function capability(segments:string[]) {
  return segments.length===2 && segments[1]==='generar'?'expedientes.generate':segments[2]==='exportar'?'expedientes.export':
    segments[2]==='descarga'?'expedientes.download':'expedientes.read';
}
/** Retain admission until the body is consumed, cancelled or expires. Zero queue
 * prefetch and copied 64 KiB chunks prevent a small queued slice retaining the full
 * document buffer after cleanup. The HTTP transport has its own bounded buffers. */
function admittedBody(bytes: Uint8Array | undefined, signal: AbortSignal, timeoutMs: number, release: () => void) {
  let position=0, finished=false, streamController:ReadableStreamDefaultController<Uint8Array>;
  let timer:ReturnType<typeof setTimeout> | undefined;
  const finish=()=>{
    if(finished)return;
    finished=true; bytes=undefined;
    if(timer)clearTimeout(timer);
    signal.removeEventListener('abort',abort);
    release();
  };
  const abort=()=>{
    if(finished)return;
    streamController.error(fail('EXPEDIENTES_CANCELLED',499)); finish();
  };
  const body=new ReadableStream<Uint8Array>({
    start(controller){streamController=controller;},
    pull(controller){
      if(finished)return;
      if(!bytes || position===bytes.byteLength){controller.close();finish();return;}
      const end=Math.min(position+65536,bytes.byteLength);
      // Buffer.slice aliases memory; Uint8Array.from guarantees a bounded copy.
      controller.enqueue(Uint8Array.from(bytes.subarray(position,end)));position=end;
    },
    cancel(){finish();},
  },{highWaterMark:0});
  timer=setTimeout(abort,timeoutMs);
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  return {body,finish};
}
export function createExpedientesHttp(catalog: ExpedientesCatalog, policy: ExpedientesPolicy, storage: ExpedientesStorage,
  options: { concurrency?: number; timeoutMs?: number; generation?: DocumentGeneration } = {}): ExpedientesHandler {
  const concurrency = options.concurrency ?? 2, timeoutMs = options.timeoutMs ?? 15000;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 6 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw fail('EXPEDIENTES_CONFIG');
  let active = 0;
  return async (request, segments, actor, moduleAccess) => {
    if (!matchesExpedientes(segments)) return null;
    let release = () => {};
    try {
      authorize(actor, Date.now());
      const operationCapability = capability(segments);
      if (!moduleAccess || operationCapability !== 'expedientes.read') requireCapability(actor,operationCapability);
      const generate=segments.length===2 && segments[1]==='generar', exporting=segments[2]==='exportar';
      const method=generate?'POST':'GET';
      if (request.method !== method) return Response.json({error:{code:'METHOD_NOT_ALLOWED',message:'Método no permitido.'}}, {status:405,headers:{...headers,Allow:method}});
      if (active >= concurrency) throw fail('EXPEDIENTES_BUSY',429);
      active++; let released = false;
      release = () => { if (!released) { released = true; active--; } };
      const query = new URL(request.url).searchParams;
      if (generate || exporting) {
        if(query.size)throw fail('VALIDATION',400);
        const generation=options.generation;
        if(!generation)throw fail('EXPEDIENTES_DOCUMENT_CONTRACT_PENDING');
        if(generate) {
          const body=await jsonBody(request);
          if(Object.keys(body).some(k=>!['padCod','contractId'].includes(k)) || typeof body.padCod!=='string' || typeof body.contractId!=='string')throw fail('VALIDATION',400);
          const controller=new AbortController(),cancel=()=>controller.abort();
          request.signal.addEventListener('abort',cancel,{once:true});if(request.signal.aborted)cancel();
          const timer=setTimeout(cancel,timeoutMs);
          try {
            const artifact=await generation.generate(actor,body.padCod,body.contractId,controller.signal);
            discardUnauditedResult(()=>generation.discard(artifact.id));
            return Response.json(artifact,{status:201,headers});
          }
          finally {clearTimeout(timer);request.signal.removeEventListener('abort',cancel);}
        }
        const artifact=await generation.export(actor,segments[1]);
        const admitted=admittedBody(artifact.bytes,request.signal,timeoutMs,release);
        try {
          const response=new Response(admitted.body,{headers:{...headers,'Content-Type':artifact.metadata.mimeType,
            'Content-Length':String(artifact.metadata.size),'Content-Disposition':`attachment; filename="documento-${artifact.metadata.id}${types[artifact.metadata.documentType][1]}"`,
            'Content-Security-Policy':"sandbox; default-src 'none'; frame-ancestors 'none'"}});
          release=()=>{};return response;
        }catch(error){admitted.finish();throw error;}
      }
      if (segments[0] === 'parcels') {
        for (const key of query.keys()) if (!['page','pageSize'].includes(key) || query.getAll(key).length !== 1) throw fail('VALIDATION',400);
        const integer = (key:string, fallback:number, max:number) => { const s=query.get(key) ?? String(fallback); if (!/^[1-9]\d{0,5}$/.test(s) || Number(s)>max) throw fail('VALIDATION',400); return Number(s); };
        const padCod=padCode(segments[1]), page=integer('page',1,100001), pageSize=integer('pageSize',20,50);
        if ((page-1)*pageSize>100000) throw fail('VALIDATION',400);
        if (!await policy.canReadParcel(actor,padCod)) throw fail('FORBIDDEN',403);
        const result=await catalog.list(padCod,page,pageSize,actor);
        if (!Number.isSafeInteger(result.total) || result.total<0 || result.items.length>pageSize) throw fail('EXPEDIENTES_CATALOG');
        for (const item of result.items) {
          validateDocument(item);
          if (item.padCod!==padCod) throw fail('EXPEDIENTES_CATALOG');
          // Fail closed; adapters must apply document policy before pagination/count.
          if (!await policy.canReadDocument(actor,item)) throw fail('FORBIDDEN',403);
        }
        return Response.json({total:result.total,items:result.items.map(publicDocument),page,pageSize},{headers});
      }
      if (query.size) throw fail('VALIDATION',400);
      const item=await catalog.find(documentId(segments[1]));
      if (!item) throw fail('EXPEDIENTE_NOT_FOUND',404);
      validateDocument(item);
      if (item.id!==segments[1]) throw fail('EXPEDIENTES_CATALOG');
      if (!await policy.canReadParcel(actor,item.padCod) || !await policy.canReadDocument(actor,item)) throw fail('FORBIDDEN',403);
      if (!item.available) throw fail('EXPEDIENTE_NOT_FOUND',404);
      const controller=new AbortController(), cancel=()=>controller.abort();
      request.signal.addEventListener('abort',cancel,{once:true}); if(request.signal.aborted)cancel();
      const timer=setTimeout(cancel,timeoutMs);
      let bytes:Uint8Array;
      try { bytes=await storage.read(item,controller.signal); } finally {clearTimeout(timer);request.signal.removeEventListener('abort',cancel);}
      if(controller.signal.aborted) throw fail('EXPEDIENTES_CANCELLED',499);
      if(bytes.byteLength!==item.size || bytes.byteLength>20*1024*1024) throw fail('EXPEDIENTES_SIZE',413);
      if(!hasDocumentSignature(item,bytes)) throw fail('EXPEDIENTES_FILE_TYPE',415);
      const filename=`expediente-${item.id}${types[item.documentType][1]}`;
      const admitted=admittedBody(bytes,request.signal,timeoutMs,release);
      try {
        const response=new Response(admitted.body,{headers:{...headers,'Content-Type':item.mimeType,'Content-Length':String(bytes.byteLength),
          'Content-Disposition':`${segments[2]==='descarga'?'attachment':'inline'}; filename="${filename}"`,
          'Content-Security-Policy':"sandbox; default-src 'none'; frame-ancestors 'none'"}});
        release=()=>{}; // The body owns admission from here, including slow clients.
        return response;
      } catch(error){admitted.finish();throw error;}
    } catch(error) {
      const e=error instanceof HttpError?error:fail();
      return Response.json({error:{code:e.code,message:e.message}},{status:e.status,headers:{...headers,...(e.status===429?{'Retry-After':'1'}:{})}});
    } finally { release(); }
  };
}
/** No inferred catalog, no implicit all-users policy, and no production mock fallback.
 * Enablement requires wiring approved catalog/policy adapters, independently of DB. */
export function configuredExpedientesHttp(): ExpedientesHandler {
  return configuredInstitutionalExpedientesHttp();
}
