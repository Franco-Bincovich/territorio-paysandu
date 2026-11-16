const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'../deploy/migrations/roles-v1');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const sql=fs.readdirSync(root).filter(name=>name.endsWith('.sql')).map(read).join('\n');
const statements=sql.replace(/--[^\n]*/g,'');
test('migration scripts never delete historical identities, credentials, sessions or triggers',()=>{
  assert.doesNotMatch(statements,/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|TRIGGER))\b/i);
  assert.doesNotMatch(statements,/\b(?:UPDATE|ALTER\s+TABLE|INSERT\s+INTO)\s+(?:auxiliares\.)?FB_(?:USUARIOS_CREDENCIALES|USUARIOS_SESIONES|CIU_CONSULTAS_WEB|CONSULTAS_HISTORIAL|LOGIN_INTENTOS|SECURITY_STANDALONE_V1)\b/i);
  assert.doesNotMatch(statements,/\bGRANT\b|\bCREATE\s+USER\b|\bPASSWORD_HASH\b|\bTOKEN_HASH\b/i);
});
test('role remap is bounded by baseline identities and resumable migration state',()=>{
  const s=read('30-migrate-baseline-users.sql');
  assert.match(s,/UPDATE FB_USUARIOS u JOIN TP_ADMIN_ROLES_V1_USERS b ON b.USER_ID=u.USER_ID/);
  assert.match(s,/changed_rows<>10/);assert.match(s,/SET PHASE='migrated'/);assert.match(s,/START TRANSACTION/);assert.match(s,/ROLLBACK; RESIGNAL/);
  assert.match(s,/Triggers cambiaron/);assert.match(s,/ACTION_ORDER,.*SQL_MODE,.*DEFINER/);
  assert.match(read('10-expand.sql'),/WHERE MUST_CHANGE_PASSWORD=1\)<>9/);
});
test('rollback has an independent gate, detects later writes and retains recovery evidence',()=>{
  const s=read('90-rollback-before-reopen.sql');
  assert.match(s,/@tp_roles_v1_rollback_approved/);assert.match(s,/ADMIN_REVISION<>1 OR DELETED_AT IS NOT NULL/);
  assert.match(s,/EXISTS\(SELECT 1 FROM TP_ADMIN_AUDIT_V1\)/);assert.match(s,/SET PHASE='rollback-data'/);
  assert.match(s,/Triggers cambiaron/);assert.match(s,/CHECK\(ROLE='collaborator'\)/);
});
