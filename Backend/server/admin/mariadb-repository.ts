import {usernameKey,emailKey} from '../../../shared/user-profile';
import { randomUUID } from 'node:crypto';
import type { Pool,PoolConnection } from 'mariadb';
import { mariaPool } from '../mariadb/pool';
import { HttpError } from '../security';
import { isRole,type Principal } from '../authorization';
import { userDto,type AdminUser,type ListQuery } from './contracts';
import type { AdminRepository,AdminTransaction,AuditEvent } from './repository';
import { requireAdminSchema } from './schema';

const unavailable=()=>new HttpError(503,'ADMIN_UNAVAILABLE','Administración no disponible temporalmente.');
const mutex='tp.auxiliares.admin.v1';
const userColumns=`USER_ID,USERNAME,FIRST_NAME,LAST_NAME,EMAIL,CI,ROLE,ENABLED,MUST_CHANGE_PASSWORD,ADMIN_REVISION,
  DATE_FORMAT(DELETED_AT,'%Y-%m-%dT%H:%i:%s.%fZ') AS deleted_iso`;
function fromRow(row:any):AdminUser{
  const revision=Number(row.ADMIN_REVISION);
  if(!isRole(row.ROLE)||!Number.isSafeInteger(revision)||revision<1)throw unavailable();
  return {id:row.USER_ID,username:row.USERNAME,firstName:row.FIRST_NAME??null,lastName:row.LAST_NAME??null,email:row.EMAIL??null,ci:row.CI??null,role:row.ROLE,enabled:Number(row.ENABLED)===1,
    mustChangePassword:Number(row.MUST_CHANGE_PASSWORD)===1,revision,deletedAt:row.deleted_iso??null};
}
function publicSnapshot(value:unknown){
  if(value===null||value===undefined)return undefined;
  const user=typeof value==='string'?JSON.parse(value):value;
  return userDto(user as AdminUser);
}
async function insertAudit(c:PoolConnection,event:AuditEvent){
  const before=event.before?JSON.stringify(userDto(event.before)):null,after=event.after?JSON.stringify(userDto(event.after)):null;
  await c.query(`INSERT INTO TP_ADMIN_AUDIT_V1
    (EVENT_ID,ACTOR_ID,TARGET_ID,ACTION,RESULT,OCCURRED_AT,REASON,REQUEST_ID,ERROR_CODE,BEFORE_JSON,AFTER_JSON,ACTOR_USERNAME,TARGET_USERNAME)
    VALUES (?,?,?,?,?,UTC_TIMESTAMP(6),?,?,?,?,?,?,?)`,
    [randomUUID(),event.actorId,event.targetId,event.action,event.result,event.reason,event.requestId,event.code??null,before,after,event.actorUsername??null,event.targetUsername??null]);
}
function controlled(error:unknown):HttpError{
  if(error instanceof HttpError)return error;
  if((error as {code?:string})?.code==='ER_DUP_ENTRY')return new HttpError(409,'IDENTITY_CONFLICT','El nombre de usuario o correo ya existe.');
  return unavailable();
}
/** Single-primary named mutex coordinates all administration instances. Auth uses
 * the same user/credential -> session row lock order. No DDL or institutional pool. */
export class MariaAdminRepository implements AdminRepository {
  constructor(private pool?:Pick<Pool,'getConnection'>){}
  private async connection<T>(run:(c:PoolConnection)=>Promise<T>):Promise<T>{
    let c:PoolConnection|undefined;
    try{c=await (this.pool??mariaPool()).getConnection();await c.query("SET time_zone = '+00:00'");await requireAdminSchema(c);return await run(c);}
    catch(error){if(c&&!(error instanceof HttpError))c.destroy();throw controlled(error);}
    finally{if(c)try{await c.release();}catch{c.destroy();}}
  }
  async transaction<T>(actor:Principal,targetId:string|null,run:(tx:AdminTransaction)=>Promise<T>):Promise<T>{
    return this.connection(async c=>{
      const lock=await c.query('SELECT GET_LOCK(?,3) AS acquired',[mutex]);
      if(Number(lock[0]?.acquired)!==1)throw new HttpError(503,'ADMIN_BUSY','Administración ocupada. Intentá nuevamente.');
      let unusable=false;
      try{
        await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await c.beginTransaction();
        let commitStarted=false;
        try{
          const ids=[...new Set([actor.userId,...(targetId?[targetId]:[])])].sort();
          const rows=await c.query(`SELECT ${userColumns} FROM FB_USUARIOS WHERE USER_ID IN (${ids.map(()=>'?').join(',')}) ORDER BY USER_ID FOR UPDATE`,ids);
          const credentials=await c.query(`SELECT USER_ID FROM FB_USUARIOS_CREDENCIALES WHERE USER_ID IN (${ids.map(()=>'?').join(',')}) ORDER BY USER_ID FOR UPDATE`,ids);
          const originals=new Map<string,AdminUser>(rows.map((row:any)=>{const user=fromRow(row);return [user.id,user];}));
          const created=new Set<string>();
          const tx:AdminTransaction={
            principal:async requested=>{
              if(requested.userId!==actor.userId||!requested.sessionHash||!/^[a-f0-9]{64}$/.test(requested.sessionHash))return null;
              const user=originals.get(actor.userId);if(!user||user.deletedAt||!credentials.some((row:any)=>row.USER_ID===actor.userId))return null;
              const sessions=await c.query(`SELECT UNIX_TIMESTAMP(EXPIRES_AT)*1000 AS expires_ms FROM FB_USUARIOS_SESIONES
                WHERE USER_ID=? AND TOKEN_HASH=? AND REVOKED_AT IS NULL AND EXPIRES_AT>UTC_TIMESTAMP(6)
                AND LAST_ACTIVITY_AT>TIMESTAMPADD(HOUR,-1,UTC_TIMESTAMP(6)) FOR UPDATE`,[actor.userId,requested.sessionHash]);
              if(sessions.length!==1)return null;
              return {verified:true,userId:user.id,role:user.role,enabled:user.enabled,mustChangePassword:user.mustChangePassword,
                expiresAt:Number(sessions[0].expires_ms),sessionHash:requested.sessionHash};
            },
            get:async id=>{const result=await c.query(`SELECT ${userColumns} FROM FB_USUARIOS WHERE USER_ID=?`,[id]);return result[0]?fromRow(result[0]):null;},
            findUsername:async username=>{const result=await c.query(`SELECT ${userColumns} FROM FB_USUARIOS WHERE USERNAME_KEY=? AND DELETED_AT IS NULL`,[Buffer.from(usernameKey(username))]);return result[0]?fromRow(result[0]):null;},
            findEmail:async email=>{const result=await c.query(`SELECT ${userColumns} FROM FB_USUARIOS WHERE EMAIL_KEY=? AND DELETED_AT IS NULL`,[Buffer.from(emailKey(email))]);return result[0]?fromRow(result[0]):null;},
            list:async query=>this.list(c,query),
            listAudit:async query=>{
              const count=await c.query('SELECT COUNT(*) AS total FROM TP_ADMIN_AUDIT_V1');
              const result=await c.query(`SELECT ACTOR_ID,TARGET_ID,ACTION,RESULT,DATE_FORMAT(OCCURRED_AT,'%Y-%m-%dT%H:%i:%s.%fZ') AS at_iso,
                REASON,REQUEST_ID,ERROR_CODE,BEFORE_JSON,AFTER_JSON,COALESCE(ACTOR_USERNAME,(SELECT USERNAME FROM FB_USUARIOS WHERE USER_ID=ACTOR_ID)) AS actor_name,COALESCE(TARGET_USERNAME,(SELECT USERNAME FROM FB_USUARIOS WHERE USER_ID=TARGET_ID)) AS target_name FROM TP_ADMIN_AUDIT_V1 ORDER BY OCCURRED_AT DESC,EVENT_ID DESC LIMIT ? OFFSET ?`,[query.pageSize,(query.page-1)*query.pageSize]);
              return {total:Number(count[0].total),items:result.map((r:any)=>({actorId:r.ACTOR_ID,actorUsername:r.actor_name??null,targetUsername:r.target_name??null,targetId:r.TARGET_ID,action:r.ACTION,result:r.RESULT,at:r.at_iso,
                reason:r.REASON,requestId:r.REQUEST_ID,...(r.ERROR_CODE?{code:r.ERROR_CODE}:{}),...(r.BEFORE_JSON?{before:publicSnapshot(r.BEFORE_JSON)}:{}),...(r.AFTER_JSON?{after:publicSnapshot(r.AFTER_JSON)}:{})}))};
            },
            put:async user=>{
              const old=originals.get(user.id);if(!old){
                if(user.revision!==1||!user.mustChangePassword||!user.enabled||user.deletedAt)throw unavailable();
                await c.query('INSERT INTO FB_USUARIOS (USER_ID,USERNAME,ROLE,ENABLED,MUST_CHANGE_PASSWORD,ADMIN_REVISION,DELETED_AT,FIRST_NAME,LAST_NAME,EMAIL,CI,USERNAME_KEY,EMAIL_KEY) VALUES (?,?,?,1,1,1,NULL,?,?,?,?,?,?)',[user.id,user.username,user.role,user.firstName??null,user.lastName??null,user.email??null,user.ci??null,Buffer.from(usernameKey(user.username)),user.email?Buffer.from(emailKey(user.email)):null]);
                created.add(user.id);return;
              }
              if(user.revision!==old.revision+1)throw new HttpError(409,'VERSION_CONFLICT','La versión del usuario cambió.');
              const result=await c.query(`UPDATE FB_USUARIOS SET USERNAME=?,ROLE=?,ENABLED=?,MUST_CHANGE_PASSWORD=?,ADMIN_REVISION=?,DELETED_AT=?,FIRST_NAME=?,LAST_NAME=?,EMAIL=?,CI=?,USERNAME_KEY=?,EMAIL_KEY=?
                WHERE USER_ID=? AND ADMIN_REVISION=?`,[user.username,user.role,user.enabled?1:0,user.mustChangePassword?1:0,user.revision,user.deletedAt?new Date(user.deletedAt):null,user.firstName??null,user.lastName??null,user.email??null,user.ci??null,user.deletedAt?null:Buffer.from(usernameKey(user.username)),user.deletedAt||!user.email?null:Buffer.from(emailKey(user.email)),user.id,old.revision]);
              if(Number(result.affectedRows)!==1)throw new HttpError(409,'VERSION_CONFLICT','La versión del usuario cambió.');
            },
            activeAdministrators:async()=>{
              const result=await c.query("SELECT USER_ID FROM FB_USUARIOS WHERE ROLE='administrator' AND ENABLED=1 AND DELETED_AT IS NULL FOR UPDATE");return result.length;
            },
            revokeSessions:async id=>{await c.query('UPDATE FB_USUARIOS_SESIONES SET REVOKED_AT=UTC_TIMESTAMP(6) WHERE USER_ID=? AND REVOKED_AT IS NULL',[id]);},
            credential:async(id,credential)=>{
              if(!/^\$argon2id\$/.test(credential.passwordHash))throw unavailable();
              if(created.has(id))await c.query('INSERT INTO FB_USUARIOS_CREDENCIALES (USER_ID,PASSWORD_HASH,CREATED_AT,PASSWORD_UPDATED_AT) VALUES (?,?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))',[id,credential.passwordHash]);
              else {
                if(!originals.has(id))throw unavailable();
                const result=await c.query('UPDATE FB_USUARIOS_CREDENCIALES SET PASSWORD_HASH=?,PASSWORD_UPDATED_AT=UTC_TIMESTAMP(6) WHERE USER_ID=?',[credential.passwordHash,id]);
                if(Number(result.affectedRows)!==1)throw unavailable();
              }
            },
            audit:async event=>insertAudit(c,event),
          };
          const result=await run(tx);commitStarted=true;await c.commit();return result;
        }catch(error){
          if(commitStarted){unusable=true;c.destroy();throw new HttpError(503,'ADMIN_COMMIT_UNCERTAIN','No se pudo confirmar el resultado. Actualizá el listado antes de reintentar.');}
          try{await c.rollback();}catch{unusable=true;c.destroy();throw unavailable();}
          throw error;
        }
      }finally{
        try{if(!unusable){const released=await c.query('SELECT RELEASE_LOCK(?) AS released',[mutex]);if(Number(released[0]?.released)!==1)throw unavailable();}}
        // Cleanup cannot turn a confirmed commit into a false denial, or mask
        // the original transaction error. Destroy releases any remaining lock.
        catch{c.destroy();}
      }
    });
  }
  private async list(c:PoolConnection,query:ListQuery){
    const clauses:string[]=query.deleted?[]:['DELETED_AT IS NULL'],params:unknown[]=[];
    // LOCATE treats percent/underscore literally; SQL collation defines identity search.
    if(query.q){clauses.push('(LOCATE(?,COALESCE(USERNAME_KEY,CONVERT(LOWER(USERNAME) USING binary)))>0 OR LOCATE(?,COALESCE(EMAIL_KEY,CONVERT(LOWER(EMAIL) USING binary)))>0 OR LOCATE(?,CONCAT_WS(\' \',FIRST_NAME,LAST_NAME))>0)');params.push(Buffer.from(usernameKey(query.q)),Buffer.from(emailKey(query.q)),query.q);}
    if(query.role){clauses.push('ROLE=?');params.push(query.role);}
    if(query.enabled!==undefined){clauses.push('ENABLED=?');params.push(query.enabled?1:0);}
    const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
    const count=await c.query('SELECT COUNT(*) AS total FROM FB_USUARIOS'+where,params);
    const rows=await c.query(`SELECT ${userColumns} FROM FB_USUARIOS${where} ORDER BY USERNAME,USER_ID LIMIT ? OFFSET ?`,[...params,query.pageSize,(query.page-1)*query.pageSize]);
    return {total:Number(count[0].total),items:rows.map(fromRow)};
  }
  async denied(event:AuditEvent){await this.connection(c=>insertAudit(c,{...event,result:'denied',before:undefined,after:undefined}));}
}
