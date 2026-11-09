import expected from "./schema-7.1.json";
import type { Connection, Pool } from "./repository";
import { HttpError } from "../security";

export const businessTables = ['FB_PERSONAS','FB_CIU_CONSULTAS_WEB','FB_CONTACTOS','FB_CONTACTOS_HISTORIAL','FB_DOMICILIOS','FB_DOMICILIOS_HISTORIAL','FB_VINCULOS_DECLARADOS','FB_CONSULTAS_HISTORIAL','FB_CONSULTAS_IDEMPOTENCIA','FB_MODELO_REVISION'];
export async function readSchema(c: Pick<Connection,'query'>) {
  const queries: Record<string,string> = {
    columns: 'SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,COLLATION_NAME,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION',
    indexes: 'SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX',
    constraints: 'SELECT TABLE_NAME,CONSTRAINT_NAME,CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() ORDER BY TABLE_NAME,CONSTRAINT_NAME',
    references: 'SELECT TABLE_NAME,CONSTRAINT_NAME,REFERENCED_TABLE_NAME,UPDATE_RULE,DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() ORDER BY TABLE_NAME,CONSTRAINT_NAME',
    referenceColumns: 'SELECT TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION',
    checks: 'SELECT TABLE_NAME,CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() ORDER BY TABLE_NAME,CONSTRAINT_NAME',
    triggers: 'SELECT TRIGGER_NAME,ACTION_TIMING,EVENT_MANIPULATION,EVENT_OBJECT_TABLE,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() ORDER BY TRIGGER_NAME',
    engines: 'SELECT TABLE_NAME,ENGINE,TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME',
  };
  const result: Record<string,unknown[]> = {};
  for (const [key, sql] of Object.entries(queries)) {
    const rows=await c.query(sql);
    result[key]=JSON.parse(JSON.stringify(rows.filter((r:Record<string,unknown>)=>businessTables.includes(String(r.TABLE_NAME??r.EVENT_OBJECT_TABLE))),(_,v)=>typeof v==='bigint'?String(v):typeof v==='string'?v.replace(/\r\n/g,'\n'):v));
  }
  return result;
}
export async function inspectCompatibility(pool:Pool) {
  const c=await pool.getConnection();
  try {
    const revision=await c.query('SELECT REVISION FROM FB_MODELO_REVISION WHERE MODELO = ?',['consultas']);
    const actual=await readSchema(c);
    const differences=Object.keys(actual).filter(k=>JSON.stringify(actual[k])!==JSON.stringify((expected as Record<string,unknown>)[k]));
    if(revision[0]?.REVISION!=='7.1')differences.push('revision');
    return {compatible:differences.length===0,differences};
  } finally {await c.release();}
}
export async function requireCompatibility(pool:Pool) {
  try {if((await inspectCompatibility(pool)).compatible)return; } catch { /* fail closed, no SQL/PII in response */ }
  throw new HttpError(503,'CONSULTATION_SCHEMA','El modelo de consultas no está verificado. El guardado permanece bloqueado.');
}
