import { randomUUID } from 'node:crypto';
import { requireCapability,type Principal } from '../authorization';
import { hashPassword } from '../mariadb/auth';
import { HttpError } from '../security';
import { createInput,patchInput,resetInput,revisionInput,userDto,userId,type AdminUser,type ListQuery } from './contracts';
import type { AdminRepository,AdminTransaction,AuditEvent,Credential } from './repository';
const fail=(code:string,status=409,message='No se pudo completar la operación.')=>new HttpError(status,code,message);
export type OperationContext={requestId:string};
export class AdminService {
  private hashing=0;
  private recordedRejections=new WeakSet<object>();
  constructor(private repository:AdminRepository,private now=Date.now,private hash=hashPassword){}
  async recordRejected(actor:Principal,action:AuditEvent['action'],context:OperationContext,error:unknown,targetId:string|null=null,reason='Solicitud administrativa rechazada') {
    if(error&&typeof error==='object'&&this.recordedRejections.has(error))return;
    // A missing schema cannot persist audit. An uncertain commit must never be
    // labelled denied: its atomic success audit may already have committed.
    if(error instanceof HttpError&&['ADMIN_SCHEMA_INCOMPATIBLE','ADMIN_DISABLED','ADMIN_COMMIT_UNCERTAIN'].includes(error.code))return;
    try {
      await this.repository.denied({actorId:actor?.userId??'unverified',targetId,action,result:'denied',at:new Date(this.now()).toISOString(),reason,requestId:context.requestId,code:error instanceof HttpError?error.code:'ADMIN_UNAVAILABLE'});
      if(error&&typeof error==='object')this.recordedRejections.add(error);
    } catch { const unavailable=fail('ADMIN_AUDIT_UNAVAILABLE',503,'No se pudo registrar la operación administrativa.');this.recordedRejections.add(unavailable);throw unavailable; }
  }
  async authorize(actor:Principal,action:AuditEvent['action'],context:OperationContext,targetId:string|null=null){
    try{requireCapability(actor,'users.manage',this.now());}catch(error){
      await this.recordRejected(actor,action,context,error,targetId,'Acceso administrativo denegado');throw error;
    }
  }
  async capabilities(actor:Principal,context:OperationContext) {
    return this.run(actor,null,'list','Consulta de disponibilidad administrativa',context,async()=>({
      users:{list:true,edit:true,delete:true,create:true,resetPassword:true},audit:true,
      credentialDelivery:{available:true,mode:'administrator-input'},
    }));
  }
  private async credential(password:string):Promise<Credential>{
    if(this.hashing>=2)throw fail('ADMIN_BUSY',429,'Esperá un momento e intentá nuevamente.');
    this.hashing++;
    try {return {passwordHash:await this.hash(password)};}
    catch{throw fail('ADMIN_UNAVAILABLE',503);}
    finally{this.hashing--;}
  }
  private async run<T>(actor:Principal,target:string|null,action:AuditEvent['action'],reason:string,context:OperationContext,operation:(tx:AdminTransaction,current:Principal)=>Promise<T>):Promise<T>{
    try{requireCapability(actor,'users.manage',this.now());return await this.repository.transaction(actor,target,async tx=>{
      const current=await tx.principal(actor);if(!current)throw fail('UNAUTHENTICATED',401,'Iniciá sesión para continuar.');
      requireCapability(current,'users.manage',this.now());return operation(tx,current);
    });}catch(error){
      const controlled=error instanceof HttpError?error:fail('ADMIN_UNAVAILABLE',503);
      await this.recordRejected(actor,action,context,controlled,target,reason);throw controlled;
    }
  }
  private async audit(tx:AdminTransaction,actor:Principal,action:AuditEvent['action'],reason:string,context:OperationContext,before?:AdminUser,after?:AdminUser){
    const actorUser=await tx.get(actor.userId);
    await tx.audit({actorId:actor.userId,actorUsername:actorUser?.username??null,targetUsername:after?.username??before?.username??null,targetId:after?.id??before?.id??null,action,result:'success',at:new Date(this.now()).toISOString(),reason,requestId:context.requestId,...(before?{before:userDto(before)}:{}),...(after?{after:userDto(after)}:{})});
  }
  async list(actor:Principal,query:ListQuery,context:OperationContext){return this.run(actor,null,'list','Consulta administrativa',context,async(tx,current)=>{const result=await tx.list(query);await this.audit(tx,current,'list','Consulta administrativa',context);return {items:result.items.map(userDto),total:result.total,page:query.page,pageSize:query.pageSize};});}
  async create(actor:Principal,value:unknown,_key:string,context:OperationContext){
    await this.authorize(actor,'create',context);const input=createInput(value);
    const reason=input.reason.replaceAll(input.temporalPassword,'[dato reservado]');
    await this.run(actor,null,'create',reason,context,async tx=>{if(await tx.findUsername(input.username))throw fail('USERNAME_CONFLICT');if(await tx.findEmail?.(input.email))throw fail('EMAIL_CONFLICT');});
    const user:AdminUser={id:randomUUID(),username:input.username,firstName:input.firstName,lastName:input.lastName,email:input.email,ci:input.ci,role:input.role,enabled:true,mustChangePassword:true,revision:1,deletedAt:null};
    let credential:Credential;
    try{credential=await this.credential(input.temporalPassword);}catch(error){await this.recordRejected(actor,'create',context,error,null,reason);throw error;}
    return this.run(actor,null,'create',reason,context,async(tx,current)=>{
      if(await tx.findUsername(user.username))throw fail('USERNAME_CONFLICT');if(await tx.findEmail?.(input.email))throw fail('EMAIL_CONFLICT');
      await tx.put(user);await tx.credential(user.id,credential);await this.audit(tx,current,'create',reason,context,undefined,user);
      return {user:userDto(user)};
    });
  }
  async patch(actor:Principal,id:string,value:unknown,context:OperationContext){
    await this.authorize(actor,'update',context,id);id=userId(id);const input=patchInput(value);
    return this.run(actor,id,'update',input.reason,context,async(tx,current)=>{
      const old=await tx.get(id);if(!old)throw fail('USER_NOT_FOUND',404);if(old.deletedAt)throw fail('USER_DELETED',409);if(old.revision!==input.expectedRevision)throw fail('VERSION_CONFLICT');
      const next={...old,...(input.firstName!==undefined?{firstName:input.firstName}:{}),...(input.lastName!==undefined?{lastName:input.lastName}:{}),...(input.email!==undefined?{email:input.email}:{}),...(input.ci!==undefined?{ci:input.ci}:{}),...(input.username!==undefined?{username:input.username}:{}),...(input.role!==undefined?{role:input.role}:{}),...(input.enabled!==undefined?{enabled:input.enabled}:{})};
      const collision=await tx.findUsername(next.username);if(collision&&collision.id!==id)throw fail('USERNAME_CONFLICT');
      const emailCollision=next.email?await tx.findEmail?.(next.email):null;if(emailCollision&&emailCollision.id!==id)throw fail('EMAIL_CONFLICT');
      input.reason=[next.role!==old.role?'Cambio de rol':null,next.enabled!==old.enabled?(next.enabled?'Habilitación':'Deshabilitación'):null].filter(Boolean).join(' y ')||'Actualización de usuario';
      if(JSON.stringify(next)===JSON.stringify(old)){await this.audit(tx,current,'update',input.reason,context,old,old);return {user:userDto(old),requiresLogin:false};}
      next.revision++;await tx.put(next);
      if(await tx.activeAdministrators()<1)throw fail('LAST_ADMIN_REQUIRED',409,'Debe permanecer al menos un Administrador activo.');
      await tx.revokeSessions(id);await this.audit(tx,current,'update',input.reason,context,old,next);
      return {user:userDto(next),requiresLogin:current.userId===id};
    });
  }
  async reset(actor:Principal,id:string,value:unknown,_key:string,context:OperationContext){
    await this.authorize(actor,'reset-password',context,id);id=userId(id);const input=resetInput(value);
    const reason=input.reason.replaceAll(input.temporalPassword,'[dato reservado]');
    await this.run(actor,id,'reset-password',reason,context,async tx=>{
      const old=await tx.get(id);if(!old)throw fail('USER_NOT_FOUND',404);if(old.deletedAt)throw fail('USER_DELETED',409);if(old.revision!==input.expectedRevision)throw fail('VERSION_CONFLICT');
    });
    let credential:Credential;
    try{credential=await this.credential(input.temporalPassword);}catch(error){await this.recordRejected(actor,'reset-password',context,error,id,reason);throw error;}
    return this.run(actor,id,'reset-password',reason,context,async(tx,current)=>{
      const old=await tx.get(id);if(!old)throw fail('USER_NOT_FOUND',404);if(old.deletedAt)throw fail('USER_DELETED',409);if(old.revision!==input.expectedRevision)throw fail('VERSION_CONFLICT');
      const next={...old,mustChangePassword:true,revision:old.revision+1};await tx.put(next);await tx.credential(id,credential);await tx.revokeSessions(id);await this.audit(tx,current,'reset-password',reason,context,old,next);
      return {user:userDto(next),requiresLogin:current.userId===id};
    });
  }
  async remove(actor:Principal,id:string,value:unknown,context:OperationContext){
    await this.authorize(actor,'delete',context,id);id=userId(id);const input=revisionInput(value);
    return this.run(actor,id,'delete',input.reason,context,async(tx,current)=>{
      const old=await tx.get(id);if(!old)throw fail('USER_NOT_FOUND',404);
      if(old.revision!==input.expectedRevision)throw fail('VERSION_CONFLICT');
      if(old.deletedAt){await this.audit(tx,current,'delete',input.reason,context,old,old);return {user:userDto(old),requiresLogin:false};}
      const next={...old,enabled:false,deletedAt:new Date(this.now()).toISOString(),revision:old.revision+1};
      await tx.put(next);
      if(await tx.activeAdministrators()<1)throw fail('LAST_ADMIN_REQUIRED',409,'Debe permanecer al menos un Administrador activo.');
      await tx.revokeSessions(id);await this.audit(tx,current,'delete',input.reason,context,old,next);
      return {user:userDto(next),requiresLogin:current.userId===id};
    });
  }
  async auditLog(actor:Principal,query:ListQuery,context:OperationContext){
    return this.run(actor,null,'audit-list','Consulta de auditoría administrativa',context,async(tx,current)=>{
      requireCapability(current,'audit.read',this.now());
      if(!tx.listAudit)throw fail('ADMIN_AUDIT_UNAVAILABLE',503);
      const result=await tx.listAudit({page:query.page,pageSize:query.pageSize});
      const items=result.items.map(event=>({actorId:event.actorId,actorUsername:event.actorUsername??null,targetUsername:event.targetUsername??event.after?.username??event.before?.username??null,targetId:event.targetId,action:event.action,result:event.result,at:event.at,reason:event.reason,requestId:event.requestId,...(event.code?{code:event.code}:{}),...(event.before?{before:userDto(event.before)}:{}),...(event.after?{after:userDto(event.after)}:{})}));
      await this.audit(tx,current,'audit-list','Consulta de auditoría administrativa',context);
      return {items,total:result.total,page:query.page,pageSize:query.pageSize};
    });
  }
}
