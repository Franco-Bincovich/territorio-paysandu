import { randomUUID } from 'node:crypto';
import { currentRequestId } from '../observability';
import { requireCapability,type Principal } from '../authorization';
import { HttpError,jsonBody } from '../security';
import { listQuery } from './contracts';
import { AdminService } from './service';
import type { AuditEvent,AdminRepository } from './repository';
import { MariaAdminRepository } from './mariadb-repository';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
export type AdminHandler=((request:Request,segments:string[],actor:Principal)=>Promise<Response|null>)&{
  denied?:(request:Request,segments:string[],actor:Principal,error:unknown)=>Promise<void>;
};
const context=()=>({requestId:currentRequestId()??randomUUID()});
const action=(request:Request,segments:string[]):AuditEvent['action']=>segments[1]==='audit'?'audit-list':request.method==='GET'?'list':segments[3]==='reset-password'?'reset-password':request.method==='DELETE'?'delete':request.method==='PATCH'?'update':'create';
// Only syntactically valid IDs reach audit storage; arbitrary URLs are never logged.
const target=(segments:string[])=>segments[1]==='users'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segments[2]??'')?segments[2]:null;
export function createAdminHttp(service?:AdminService):AdminHandler{
  const handler:AdminHandler=async(request,segments,actor)=>{
    if(segments[0]!=='admin')return null;
    const operationContext=context(),operation=action(request,segments);
    try {
      if(service)await service.authorize(actor,operation,operationContext,target(segments));
      else requireCapability(actor,'users.manage');
      const list=segments.length===2&&segments[1]==='users',edit=segments.length===3&&segments[1]==='users',reset=segments.length===4&&segments[1]==='users'&&segments[3]==='reset-password';
      const audit=segments.length===2&&segments[1]==='audit',capabilities=segments.length===2&&segments[1]==='capabilities';
      if(!list&&!edit&&!reset&&!audit&&!capabilities)throw new HttpError(404,'NOT_FOUND','Ruta no encontrada.');
      const allowed=audit||capabilities?['GET']:list?['GET','POST']:edit?['PATCH','DELETE']:['POST'];
      if(!allowed.includes(request.method))return Response.json({error:{code:'METHOD_NOT_ALLOWED',message:'Método no permitido.'}},{status:405,headers:{...headers,Allow:allowed.join(', ')}});
      if(!service)throw new HttpError(503,'ADMIN_UNAVAILABLE','Administración no disponible.');
      const query=new URL(request.url).searchParams;
      if(capabilities){if(query.size)throw new HttpError(400,'VALIDATION','Parámetros no permitidos.');return Response.json(await service.capabilities(actor,operationContext),{headers});}
      if(audit){if([...query.keys()].some(key=>!['page','pageSize'].includes(key)))throw new HttpError(400,'VALIDATION','Parámetros no permitidos.');return Response.json(await service.auditLog(actor,listQuery(query),operationContext),{headers});}
      if(list&&request.method==='GET')return Response.json(await service.list(actor,listQuery(query),operationContext),{headers});
      if(query.size)throw new HttpError(400,'VALIDATION','Parámetros no permitidos.');
      const body=await jsonBody(request);
      if(list){const result=await service.create(actor,body,request.headers.get('Idempotency-Key')??'',operationContext);return Response.json(result,{status:201,headers});}
      if(edit&&request.method==='DELETE')return Response.json(await service.remove(actor,segments[2],body,operationContext),{headers});
      if(edit)return Response.json(await service.patch(actor,segments[2],body,operationContext),{headers});
      return Response.json(await service.reset(actor,segments[2],body,request.headers.get('Idempotency-Key')??'',operationContext),{status:202,headers});
    }catch(error){if(service)await service.recordRejected(actor,operation,operationContext,error,target(segments));throw error;}
  };
  handler.denied=async(request,segments,actor,error)=>{if(service)await service.recordRejected(actor,action(request,segments),context(),error,target(segments));};
  return handler;
}
/** Composition uses the existing auxiliares pool. Instantiation is lazy; only
 * administrative requests validate its schema. Passwords are supplied manually; no delivery provider or plaintext receipt exists. */
export function configuredAdminHttp(repository?:AdminRepository,env:NodeJS.ProcessEnv=process.env):AdminHandler{
  let handler:AdminHandler|undefined;
  const ready=()=>handler??=createAdminHttp(new AdminService(repository??new MariaAdminRepository()));
  const enabled=env.ADMINISTRATION_ENABLED==='true';
  const configured:AdminHandler=async(request,segments,actor)=>{
    if(segments[0]!=='admin')return null;
    try { requireCapability(actor,'users.manage'); } catch(error) { if(enabled)await ready().denied?.(request,segments,actor,error);throw error; }
    if(!enabled)throw new HttpError(503,'ADMIN_DISABLED','La administración no está habilitada en este entorno.');
    return ready()(request,segments,actor);
  };
  configured.denied=async(request,segments,actor,error)=>{if(enabled)await ready().denied?.(request,segments,actor,error);};
  return configured;
}
