import type { Pool } from './repository';
import { authorize, id, invalid, type Actor } from './model';
import { historyFilters, queryKeys } from '../filters';
import { typeCodes, view } from './contracts';
import { addressLimits } from './model';
export function historyQuery(query:URLSearchParams){
  queryKeys(query,['historyBefore','historyPageSize']);
  const raw=query.get('historyPageSize'),pageSize=raw===null?20:Number(raw);
  if((raw!==null&&!/^[1-9]\d*$/.test(raw))||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>50)throw invalid();
  const cursor=query.has('historyBefore')?id(query.get('historyBefore')):null;
  return {pageSize,cursor};
}
export function historySnapshot(value:any){
  const row=typeof value==='string'?JSON.parse(value):value;if(row==null)return null;
  const fields=['nombre_completo','tipo_documento','documento','relacion_declarada','descripcion','tipo_consulta','padron','padcod','localidad_padron',
    'domicilio_calle','domicilio_puerta','domicilio_block','domicilio_apto','domicilio_localidad','domicilio_departamento',
    ...Array.from({length:5},(_,i)=>[`telefono_${i+1}`,`tipo_telefono_${i+1}`,`mail_${i+1}`]).flat()];
  const result:Record<string,unknown>={};for(const k of fields)if(Object.hasOwn(row,k)&&(row[k]==null||['string','number'].includes(typeof row[k])))result[k]=row[k];
  let address=row.domicilio_declarado_json;if(typeof address==='string')address=JSON.parse(address);
  if(address&&typeof address==='object'&&!Array.isArray(address))result.domicilio_declarado_json=Object.fromEntries(Object.keys(addressLimits).filter(k=>typeof address[k]==='string').map(k=>[k,address[k]]));
  return result;
}
export class ConsultationReads {
  constructor(private pool:Pool) {}
  async detail(queryId:string,actor:Actor,query=new URLSearchParams()) {
    authorize(actor,Date.now());id(queryId);
    const {pageSize,cursor}=historyQuery(query);
    const c=await this.pool.getConnection();
    try {
      await c.query('START TRANSACTION READ ONLY');
      const rows=await c.query('SELECT q.*,u.USERNAME AS CREATOR_USERNAME,EXISTS(SELECT 1 FROM FB_CIU_CONSULTAS_WEB newer WHERE newer.ID_PERSONA=q.ID_PERSONA AND newer.ID_CONSULTA>q.ID_CONSULTA) AS IS_HISTORICAL FROM FB_CIU_CONSULTAS_WEB q LEFT JOIN FB_USUARIOS u ON u.USER_ID=q.USUARIO_CREADOR_ID WHERE q.ID_CONSULTA = ?',[queryId]);
      if(!rows.length)throw invalid('NOT_FOUND',404);
      const history=await c.query('SELECT h.VERSION,h.TIPO_OPERACION,h.USUARIO_MODIFICADOR_ID,h.FECHA_MODIFICACION,h.DATOS_ANTERIORES,h.DATOS_NUEVOS,u.USERNAME FROM FB_CONSULTAS_HISTORIAL h LEFT JOIN FB_USUARIOS u ON u.USER_ID=h.USUARIO_MODIFICADOR_ID WHERE h.ID_CONSULTA = ?'+(cursor?' AND h.VERSION < ?':'')+' ORDER BY h.VERSION DESC LIMIT ?',[queryId,...(cursor?[cursor]:[]),pageSize+1]);
      const page=history.slice(0,pageSize);
      return {...view(rows[0]),isHistorical:!!Number(rows[0].IS_HISTORICAL),historyPagination:{pageSize,nextBeforeVersion:history.length>pageSize?String(page[page.length-1].VERSION):null},history:page.map((h:any)=>({version:Number(h.VERSION),operation:h.TIPO_OPERACION,by:h.USUARIO_MODIFICADOR_ID,byUsername:h.USERNAME??h.USUARIO_MODIFICADOR_ID,at:h.FECHA_MODIFICACION instanceof Date?h.FECHA_MODIFICACION.toISOString():String(h.FECHA_MODIFICACION),before:historySnapshot(h.DATOS_ANTERIORES),after:historySnapshot(h.DATOS_NUEVOS)}))};
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
