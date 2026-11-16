import type { PoolConnection } from 'mariadb';
import { HttpError } from '../security';
const mismatch=()=>new HttpError(503,'ADMIN_SCHEMA_INCOMPATIBLE','El esquema administrativo no es compatible.');
/** Read-only metadata validation. No migration and no cached assumption about grants. */
export async function requireAdminSchema(c:Pick<PoolConnection,'query'>){
  const db=await c.query('SELECT DATABASE() AS database_name');
  if(db[0]?.database_name!=='auxiliares')throw mismatch();
  const tables=['FB_USUARIOS','FB_USUARIOS_CREDENCIALES','FB_USUARIOS_SESIONES','TP_ADMIN_AUDIT_V1'];
  const engines=await c.query(`SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?,?,?)`,tables);
  if(tables.some(name=>!engines.some((r:any)=>r.TABLE_NAME===name&&r.ENGINE==='InnoDB')))throw mismatch();
  const columns=await c.query(`SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,CHARACTER_MAXIMUM_LENGTH,IS_NULLABLE
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?,?,?)`,tables);
  const required:Record<string,Record<string,string[]>>={
    FB_USUARIOS:{USER_ID:['char'],USERNAME:['varchar'],ROLE:['varchar'],ENABLED:['tinyint'],MUST_CHANGE_PASSWORD:['tinyint'],ADMIN_REVISION:['bigint'],DELETED_AT:['datetime'],FIRST_NAME:['varchar'],LAST_NAME:['varchar'],EMAIL:['varchar'],CI:['varchar'],USERNAME_KEY:['varbinary'],EMAIL_KEY:['varbinary']},
    FB_USUARIOS_CREDENCIALES:{USER_ID:['char'],PASSWORD_HASH:['varchar','text'],CREATED_AT:['datetime'],PASSWORD_UPDATED_AT:['datetime']},
    FB_USUARIOS_SESIONES:{USER_ID:['char'],TOKEN_HASH:['char','varchar'],REVOKED_AT:['datetime'],EXPIRES_AT:['datetime'],LAST_ACTIVITY_AT:['datetime']},
    TP_ADMIN_AUDIT_V1:{EVENT_ID:['char'],ACTOR_ID:['varchar'],TARGET_ID:['char'],ACTION:['varchar'],RESULT:['varchar'],OCCURRED_AT:['datetime'],REASON:['varchar'],REQUEST_ID:['varchar'],ERROR_CODE:['varchar'],BEFORE_JSON:['longtext'],AFTER_JSON:['longtext'],ACTOR_USERNAME:['varchar'],TARGET_USERNAME:['varchar']},
  };
  for(const [table,fields] of Object.entries(required))for(const [column,types] of Object.entries(fields)){
    const row=columns.find((r:any)=>r.TABLE_NAME===table&&r.COLUMN_NAME===column);
    if(!row||!types.includes(row.DATA_TYPE))throw mismatch();
    const nullable=['FIRST_NAME','LAST_NAME','EMAIL','CI','USERNAME_KEY','EMAIL_KEY','ACTOR_USERNAME','TARGET_USERNAME'].includes(column)||column==='DELETED_AT'||column==='REVOKED_AT'||table==='TP_ADMIN_AUDIT_V1'&&['TARGET_ID','ERROR_CODE','BEFORE_JSON','AFTER_JSON'].includes(column);
    if(column!=='PASSWORD_UPDATED_AT'&&row.IS_NULLABLE!==(nullable?'YES':'NO'))throw mismatch();
  }
  const minimums:Record<string,Record<string,number>>={FB_USUARIOS:{USER_ID:36,USERNAME:100,ROLE:30,FIRST_NAME:100,LAST_NAME:100,EMAIL:254,CI:8,USERNAME_KEY:400,EMAIL_KEY:1016},FB_USUARIOS_CREDENCIALES:{PASSWORD_HASH:128},FB_USUARIOS_SESIONES:{TOKEN_HASH:64},TP_ADMIN_AUDIT_V1:{EVENT_ID:36,ACTOR_ID:100,TARGET_ID:36,ACTION:30,RESULT:10,REASON:500,REQUEST_ID:100,ERROR_CODE:100,ACTOR_USERNAME:100,TARGET_USERNAME:100}};
  for(const [table,fields] of Object.entries(minimums))for(const [name,min] of Object.entries(fields)){
    if(Number(columns.find((r:any)=>r.TABLE_NAME===table&&r.COLUMN_NAME===name)?.CHARACTER_MAXIMUM_LENGTH)<min)throw mismatch();
  }
  const indexes=await c.query(`SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns_list
    FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?,?,?)
    GROUP BY TABLE_NAME,INDEX_NAME,NON_UNIQUE`,tables);
  for(const [table,column] of [['FB_USUARIOS','USER_ID'],['FB_USUARIOS','USERNAME_KEY'],['FB_USUARIOS','EMAIL_KEY'],['FB_USUARIOS_CREDENCIALES','USER_ID'],['FB_USUARIOS_SESIONES','TOKEN_HASH'],['TP_ADMIN_AUDIT_V1','EVENT_ID']]){
    if(!indexes.some((r:any)=>r.TABLE_NAME===table&&Number(r.NON_UNIQUE)===0&&r.columns_list===column))throw mismatch();
  }
}
