"use client";
import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {hasCapability,type Role} from '../../../shared/permissions';
import {request} from './contracts';
import {isAbort} from './request-scope';
import {expedienteQuery as parseQuery,type InstitutionalDocument} from '../../../shared/expedientes';

type DocumentItem=InstitutionalDocument;
type DocumentPage={items:DocumentItem[];total:number};
type DocumentAction='contenido'|'descarga'|'exportar';
export function expedienteQuery(localidad:string,padron:string,caso:string=''):string {
  const parsed=parseQuery({localidad,padron,caso:caso.trim()});
  if(!parsed)throw new Error('Seleccioná una localidad válida e ingresá números positivos de hasta 19 dígitos dentro del rango permitido.');
  const query=new URLSearchParams({localidad:parsed.localidad,padron:parsed.padron});
  if(parsed.caso)query.set('caso',parsed.caso);
  return query.toString();
}
export function expedienteDocumentUrl(item:DocumentItem,action:DocumentAction):string {
  return `/api/expedientes/${encodeURIComponent(item.id)}/${action}?${expedienteQuery(item.localidad,item.padron,item.caseNumber)}`;
}
export function ExpedientesView({role}:{padCod?:string;role?:Role}) {
  const id=useId(),allowed=hasCapability(role,'expedientes.read');
  const [localidad,setLocalidad]=useState('PAYSANDU'),[padron,setPadron]=useState('');
  const [data,setData]=useState<DocumentPage|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [active,setActive]=useState<string|null>(null),[status,setStatus]=useState('');
  const [preview,setPreview]=useState<{url:string;name:string}|null>(null);
  const searchController=useRef<AbortController|null>(null),documentController=useRef<AbortController|null>(null);
  useEffect(()=>()=>{searchController.current?.abort();documentController.current?.abort();},[]);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview.url);},[preview]);
  async function search(event:FormEvent<HTMLFormElement>){
    event.preventDefault();searchController.current?.abort();documentController.current?.abort();documentController.current=null;
    setActive(null);setStatus('');setPreview(null);setError('');setData(null);
    const controller=new AbortController();searchController.current=controller;
    const timer=setTimeout(()=>controller.abort(new Error('La búsqueda demoró demasiado. Intentá nuevamente.')),30000);
    try{const query=expedienteQuery(localidad,padron);setBusy(true);const value=await request<DocumentPage>(`/api/expedientes?${query}`,{signal:controller.signal});if(searchController.current===controller)setData(value);}
    catch(e){if(searchController.current===controller)setError(controller.signal.aborted?'La búsqueda se canceló o demoró demasiado. Intentá nuevamente.':e instanceof Error?e.message:'No se pudieron buscar los expedientes.');}
    finally{clearTimeout(timer);if(searchController.current===controller)setBusy(false);}
  }
  async function openDocument(item:DocumentItem,action:DocumentAction){
    documentController.current?.abort();const controller=new AbortController();documentController.current=controller;
    setActive(`${item.id}:${action}`);setError('');setStatus(action==='descarga'?'Descargando Word…':'Preparando PDF…');
    const timer=setTimeout(()=>controller.abort(),120000);
    try{
      const response=await fetch(expedienteDocumentUrl(item,action),{credentials:'same-origin',cache:'no-store',signal:controller.signal});
      if(response.status===401)window.dispatchEvent(new Event('territory-session-expired'));
      if(!response.ok){const failure=await response.json().catch(()=>null);throw new Error(typeof failure?.error?.message==='string'?failure.error.message:response.status===403?'No tenés permiso para acceder al documento.':response.status===404?'El documento ya no está disponible.':'No se pudo preparar el documento. Intentá nuevamente.');}
      const mime=response.headers.get('content-type')?.split(';')[0];
      if(mime!==(action==='descarga'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/pdf'))throw new Error('El servidor devolvió un formato de documento inesperado.');
      const blob=await response.blob();if(controller.signal.aborted)return;
      const url=URL.createObjectURL(blob);
      if(action==='contenido'){setPreview({url,name:item.name});setStatus('PDF listo para consultar.');}
      else{const link=document.createElement('a');link.href=url;link.download=action==='descarga'?item.name:item.name.replace(/\.docx$/i,'.pdf');document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);setStatus('Documento preparado para descargar.');}
    }catch(e){if(documentController.current===controller){setStatus('');setError(isAbort(e)?'La operación se canceló o demoró demasiado. Intentá nuevamente.':e instanceof Error?e.message:'No se pudo preparar el documento.');}}
    finally{clearTimeout(timer);if(documentController.current===controller)setActive(null);}
  }
  if(!allowed)return null;
  return <section className="expedientes-view" aria-label="Consulta de expedientes">
    <div className="panel-head"><h2>Buscar expedientes</h2><span className="badge">Solo lectura</span></div>
    <p className="muted">Ingresá la localidad y el número de padrón para consultar todos sus expedientes.</p>
    <form className="search-grid expedientes-search" onSubmit={search}>
      <label className="field">Localidad<select aria-label="Localidad" name="localidad" required value={localidad} onChange={event=>setLocalidad(event.target.value)}><option value="PAYSANDU">Paysandú</option><option value="PAYSANDU_CHACRAS">Paysandú Chacras</option></select></label>
      <label className="field">Número de padrón<input name="padron" required inputMode="numeric" pattern="[0-9]+" maxLength={19} placeholder="Número de padrón" value={padron} onChange={event=>setPadron(event.target.value)}/></label>
      <button className="btn primary" disabled={busy}>{busy?'Buscando…':'Buscar expedientes'}</button>
    </form>
    {busy&&<p role="status">Buscando expedientes…</p>}
    {error&&<p className="error" role="alert">{error}</p>}
    {status&&<p role="status">{status} {active&&<button className="btn small" onClick={()=>documentController.current?.abort()}>Cancelar</button>}</p>}
    {data&&<div aria-live="polite">{data.items.length===0?<p className="empty">No se encontraron expedientes para los datos ingresados.</p>:<><p>{data.total} {data.total===1?'expediente encontrado':'expedientes encontrados'}</p><div className="tablewrap" role="region" tabIndex={0} aria-label="Resultados de expedientes"><table className="expedientes-table"><thead><tr><th scope="col">Padrón</th><th scope="col">Localidad</th><th scope="col">Documento</th><th scope="col">Acciones</th></tr></thead><tbody>{data.items.map(item=><tr key={item.id}><td>{item.padron}</td><td>{item.localidad==='PAYSANDU_CHACRAS'?'Paysandú Chacras':'Paysandú'}</td><td className="expediente-name">{item.name}<br/><span className="muted">{Math.ceil(item.size/1024)} KB · Word</span></td><td><div className="actions">{(['contenido','descarga','exportar'] as const).map(action=><button key={action} className="btn small" disabled={!!active} onClick={()=>void openDocument(item,action)}>{active===`${item.id}:${action}`?'Preparando…':action==='contenido'?'Visualizar PDF':action==='descarga'?'Exportar a Word':'Exportar a PDF'}<span className="sr-only"> · caso {item.caseNumber}</span></button>)}</div></td></tr>)}</tbody></table></div></>}</div>}
    {preview&&<section className="expediente-preview" aria-labelledby={`${id}-preview`}><div className="panel-head"><h3 id={`${id}-preview`}>Vista PDF: {preview.name}</h3><button className="btn" onClick={()=>setPreview(null)}>Cerrar vista</button></div><p className="muted">Si tu navegador no muestra el PDF, podés <a href={preview.url} download={preview.name.replace(/\.docx$/i,'.pdf')}>descargarlo</a>.</p><iframe title={`Vista PDF de ${preview.name}`} src={preview.url}/></section>}
  </section>;
}
