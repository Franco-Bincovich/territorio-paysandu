"use client";
import {useEffect,useState} from 'react';
import {request} from './contracts';
import {isAbort} from './request-scope';

type AuditPage={items:{actorId:string;targetId:string|null;actorUsername?:string|null;targetUsername?:string|null;action:string;result:string;at:string;reason:string;requestId:string}[];total:number;page:number;pageSize:number};
const actionLabels:Record<string,string>={'create':'Creación de usuario','update':'Actualización de usuario','disable':'Deshabilitación','enable':'Habilitación','change-role':'Cambio de rol','delete':'Baja de usuario','reset-password':'Restablecimiento de contraseña','list':'Consulta de usuarios','audit':'Consulta de auditoría','audit-list':'Consulta de auditoría'};
export function auditDate(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?'Fecha no disponible':new Intl.DateTimeFormat('es-UY',{dateStyle:'short',timeStyle:'medium',timeZone:'America/Montevideo'}).format(date);}
export function auditAction(value:string){return actionLabels[value]??'Operación administrativa';}
export function AdministrativeAuditView(){
  const [page,setPage]=useState(1),[refresh,setRefresh]=useState(0),[data,setData]=useState<AuditPage|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setData(null);setError('');
    request<AuditPage>(`/api/admin/audit?page=${page}&pageSize=20`,{signal:controller.signal})
      .then(value=>{if(!controller.signal.aborted)setData(value);})
      .catch(error=>{if(!controller.signal.aborted&&!isAbort(error))setError(error instanceof Error?error.message:'No se pudo cargar la auditoría.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[page,refresh]);
  return <section aria-label="Auditoría administrativa"><h2>Auditoría administrativa</h2>
    {loading&&<p role="status">Cargando auditoría…</p>}
    {error&&<p className="error" role="alert">{error} <button className="btn small" onClick={()=>setRefresh(value=>value+1)}>Reintentar</button></p>}
    {data&&<><div className="tablewrap" role="region" aria-label="Eventos administrativos" tabIndex={0}><table><thead><tr><th scope="col">Fecha</th><th scope="col">Actor</th><th scope="col">Usuario afectado</th><th scope="col">Acción</th><th scope="col">Resultado</th><th scope="col">Descripción</th></tr></thead><tbody>{data.items.map((event,index)=><AuditRow key={`${event.requestId}-${event.action}-${index}`} event={event}/>)}</tbody></table></div>
    {data.items.length===0&&<p className="empty">No hay eventos administrativos.</p>}
    <div className="pagination"><button className="btn small" disabled={page<=1} onClick={()=>setPage(value=>value-1)}>Anterior</button><span>Página {page} · {data.total} eventos</span><button className="btn small" disabled={page*data.pageSize>=data.total} onClick={()=>setPage(value=>value+1)}>Siguiente</button></div></>}
  </section>;
}


export function AuditRow({event}:{event:AuditPage['items'][number]}){return <tr><td><time dateTime={event.at}>{auditDate(event.at)}</time></td><td>{event.actorUsername??'Usuario histórico'}<details><summary>Identificador</summary>{event.actorId}</details></td><td>{event.targetUsername??(event.targetId?'Usuario histórico':'—')}{event.targetId&&<details><summary>Identificador</summary>{event.targetId}</details>}</td><td>{auditAction(event.action)}</td><td>{event.result==='success'?'Correcta':event.result==='denied'?'Rechazada':'Resultado no disponible'}</td><td>{event.reason}</td></tr>;}
