import { HttpError } from './security';
import { isRole, hasCapability, type Role, type Capability } from '../../shared/permissions';
export { isRole, hasCapability, ROLE_CAPABILITIES, ROLE_LABELS, ROLES } from '../../shared/permissions';
export type { Role, Capability } from '../../shared/permissions';
export type Principal = { verified:true; userId:string; role:Role; enabled:boolean; mustChangePassword:boolean; expiresAt:number; sessionHash?:string };
export function parseRole(value:unknown):Role {
  if(!isRole(value))throw new HttpError(403,'FORBIDDEN','Rol no autorizado.');
  return value;
}
export function requireAuthenticated(actor:Principal,now=Date.now()) {
  if(!actor||actor.verified!==true||!actor.userId||!Number.isFinite(actor.expiresAt)||actor.expiresAt<=now)
    throw new HttpError(401,'UNAUTHENTICATED','Iniciá sesión para continuar.');
  parseRole(actor.role);
  if(!actor.enabled)throw new HttpError(403,'FORBIDDEN','Cuenta no habilitada.');
  if(actor.mustChangePassword)throw new HttpError(403,'PASSWORD_CHANGE_REQUIRED','Cambiá tu contraseña para continuar.');
}
export function requireCapability(actor:Principal,capability:Capability,now=Date.now()) {
  requireAuthenticated(actor,now);
  if(!hasCapability(actor.role,capability))throw new HttpError(403,'FORBIDDEN','No tenés permiso para realizar esta operación.');
}
export function canEditConsultation(actor:Principal,creatorId:string,now=Date.now()) {
  try {requireCapability(actor,'consultations.write',now);return hasCapability(actor.role,'consultations.edit.any')||actor.userId===creatorId;}catch{return false;}
}
export function requireEditConsultation(actor:Principal,creatorId:string,now=Date.now()) {
  requireAuthenticated(actor,now);
  if(!canEditConsultation(actor,creatorId,now))throw new HttpError(403,'FORBIDDEN','No tenés permiso para editar esta consulta.');
}
