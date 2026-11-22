import type { Principal } from '../authorization';
import type { AdminUser,ListQuery } from './contracts';
import type { AccessChange, AccessMatrix, AccessSettings } from '../../../shared/module-access';
export type AuditEvent={actorId:string;actorUsername?:string|null;targetUsername?:string|null;targetId:string|null;action:'create'|'update'|'reset-password'|'list'|'delete'|'audit-list'|'permissions-update';result:'success'|'denied';at:string;reason:string;requestId:string;code?:string;before?:AdminUser;after?:AdminUser;permissionChanges?:AccessChange[];permissionRevision?:number};
export type Credential={passwordHash:string};
/** Adapter contract, NOT a declaration of MariaDB columns.
 * transaction acquires one persistent administration mutex, then locks actor and
 * target users in stable order, credentials and actor session. Every writer,
 * including bootstrap, must share that protocol. All writes, revocations, audit,
 * credential hashes commit atomically. Throw rolls everything back.
 * Deleted users remain stored with enabled=false and deletedAt; get preserves
 * their historical identity. findUsername/findEmail reserve only non-deleted keys;
 * recreations get a new ID. activeAdministrators excludes deleted users.
 * listAudit returns only this application administrative events, ordered by time/id.
 * username uniqueness must be enforced by the DB, not just by an earlier read.
 */
export interface AdminTransaction {
  principal(actor:Principal):Promise<Principal|null>;
  get(id:string):Promise<AdminUser|null>;
  findUsername(username:string):Promise<AdminUser|null>;
  findEmail?(email:string):Promise<AdminUser|null>;
  list(query:ListQuery):Promise<{items:AdminUser[];total:number}>;
  listAudit?(query:{page:number;pageSize:number}):Promise<{items:AuditEvent[];total:number}>;
  moduleAccess(lock?:boolean):Promise<AccessSettings>;
  saveModuleAccess(matrix:AccessMatrix,revision:number):Promise<void>;
  put(user:AdminUser):Promise<void>;
  activeAdministrators():Promise<number>;
  revokeSessions(userId:string):Promise<void>;
  credential(userId:string,credential:Credential):Promise<void>;
  audit(event:AuditEvent):Promise<void>;
}
export interface AdminRepository {
  transaction<T>(actor:Principal,targetId:string|null,run:(tx:AdminTransaction)=>Promise<T>):Promise<T>;
  /** Registers a sanitized denial after rollback, using the audit scope when active. */
  denied(event:AuditEvent):Promise<void>;
}
