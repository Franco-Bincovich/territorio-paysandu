import { randomUUID } from 'node:crypto';
import { HttpError, jsonBody } from '../security';
import { authorize, type Actor } from './model';
import type { ConsultationRepository } from './repository';
import type { ConsultationReads } from './reads';
import { webInput } from './contracts';
import { productionMariaEnabled } from '../mariadb/provider';

export function writesRequested(env:NodeJS.ProcessEnv=process.env) {
  return (productionMariaEnabled(env) || (env.NODE_ENV!=='production' && env.AUTH_PROVIDER==='mariadb-test' && env.MARIADB_AUTH_TEST_ENABLED==='true')) &&
    env.INSTITUTIONAL_ENABLED==='true' && env.CONSULTATIONS_WRITE_ENABLED==='true';
}
export function createConsultationHttp(repository:ConsultationRepository,reads:ConsultationReads,compatible:()=>Promise<void>,enabled=()=>writesRequested()) {
  return async(request:Request,segments:string[],actor:Actor):Promise<Response|null>=>{
    if(segments[0]!=='consultations')return null;
    authorize(actor,Date.now());
    const result=(body:unknown)=>Response.json(body,{headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    await compatible();
    if(segments.length===2 && segments[1]==='capabilities') {
      if(request.method!=='GET')throw new HttpError(405,'METHOD_NOT_ALLOWED','Método no permitido.');
      return result({read:true,write:enabled()});
    }
    if(request.method==='GET')return result(segments.length===1?await reads.list(new URL(request.url).searchParams,actor):await reads.detail(segments[1],actor));
    if(!enabled())throw new HttpError(403,'WRITES_DISABLED','El guardado de consultas está deshabilitado para este entorno.');
    const body=await jsonBody(request);
    if(request.method==='POST' && segments.length===1) {
      if(body.version!==undefined)throw new HttpError(400,'VALIDATION','Revisá los campos.');
      const receipt=await repository.create(webInput(body),actor);
      return result(await reads.detail(receipt.id,actor));
    }
    if(request.method==='PATCH' && segments.length===2) {
      const receipt=await repository.edit(segments[1],body.version as number,webInput({...body,idempotencyKey:randomUUID()}),actor);
      return result(await reads.detail(receipt.id,actor));
    }
    throw new HttpError(405,'METHOD_NOT_ALLOWED','Método no permitido.');
  };
}
