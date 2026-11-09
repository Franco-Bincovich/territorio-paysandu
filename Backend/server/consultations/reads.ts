import type { Pool } from './repository';
import { authorize, id, invalid, type Actor } from './model';
import { historyFilters, queryKeys } from '../filters';
import { typeCodes, view } from './contracts';
export class ConsultationReads {
  constructor(private pool:Pool) {}
  async detail(queryId:string,actor:Actor) {
    authorize(actor,Date.now());id(queryId);
    const c=await this.pool.getConnection();
    try {
      await c.query('START TRANSACTION READ ONLY');
      const rows=await c.query('SELECT q.*,u.USERNAME AS CREATOR_USERNAME,EXISTS(SELECT 1 FROM FB_CIU_CONSULTAS_WEB newer WHERE newer.ID_PERSONA=q.ID_PERSONA AND newer.ID_CONSULTA>q.ID_CONSULTA) AS IS_HISTORICAL FROM FB_CIU_CONSULTAS_WEB q LEFT JOIN FB_USUARIOS u ON u.USER_ID=q.USUARIO_CREADOR_ID WHERE q.ID_CONSULTA = ?',[queryId]);
      if(!rows.length)throw invalid('NOT_FOUND',404);
      const history=await c.query('SELECT h.VERSION,h.TIPO_OPERACION,h.USUARIO_MODIFICADOR_ID,h.FECHA_MODIFICACION,h.DATOS_ANTERIORES,h.DATOS_NUEVOS,u.USERNAME FROM FB_CONSULTAS_HISTORIAL h LEFT JOIN FB_USUARIOS u ON u.USER_ID=h.USUARIO_MODIFICADOR_ID WHERE h.ID_CONSULTA = ? ORDER BY h.VERSION',[queryId]);
      const parse=(v:any)=>typeof v==='string'?JSON.parse(v):v;
      return {...view(rows[0]),isHistorical:!!Number(rows[0].IS_HISTORICAL),history:history.map((h:any)=>({version:Number(h.VERSION),operation:h.TIPO_OPERACION,by:h.USUARIO_MODIFICADOR_ID,byUsername:h.USERNAME??h.USUARIO_MODIFICADOR_ID,at:h.FECHA_MODIFICACION instanceof Date?h.FECHA_MODIFICACION.toISOString():String(h.FECHA_MODIFICACION),before:parse(h.DATOS_ANTERIORES),after:parse(h.DATOS_NUEVOS)}))};
    } finally {try{await c.rollback();}finally{await c.release();}}
  }
  async list(query:URLSearchParams,actor:Actor) {
    authorize(actor,Date.now());
    queryKeys(query,['page','pageSize','locality','parcel','padCod','type','from','to']);
    const copy=new URLSearchParams(query);copy.delete('padCod');
    const f=historyFilters(copy),clauses:string[]=[],params:unknown[]=[];
    if(query.has('padCod')){clauses.push('q.PADCOD = ?');params.push(id(query.get('padCod')));}
    for(const [key,column] of [['locality','LOCALIDAD_PADRON'],['parcel','PADRON'],['type','TIPO_CONSULTA']])if(f.filters[key]){clauses.push(`q.${column} = ?`);params.push(key==='type'?typeCodes[f.filters[key]]:f.filters[key]);}
    if(f.from){clauses.push('q.FECHA_ALTA >= ?');params.push(f.from+' 00:00:00');}
    if(f.to){clauses.push('q.FECHA_ALTA < DATE_ADD(?, INTERVAL 1 DAY)');params.push(f.to+' 00:00:00');}
    const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
    const c=await this.pool.getConnection();
    try {
      await c.query('START TRANSACTION READ ONLY');
      const count=await c.query('SELECT COUNT(*) AS n FROM FB_CIU_CONSULTAS_WEB q'+where,params);
      const rows=await c.query('SELECT q.*,u.USERNAME AS CREATOR_USERNAME FROM FB_CIU_CONSULTAS_WEB q LEFT JOIN FB_USUARIOS u ON u.USER_ID=q.USUARIO_CREADOR_ID'+where+' ORDER BY q.ID_CONSULTA DESC LIMIT ? OFFSET ?',[...params,f.pageSize,f.start]);
      return {items:rows.map(view),total:Number(count[0].n),page:f.page,pageSize:f.pageSize};
    }finally{try{await c.rollback();}finally{await c.release();}}
  }
}
