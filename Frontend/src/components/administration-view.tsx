"use client";
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {PasswordField,PasswordRequirements} from './password-fields';
import {PASSWORD_MIN_LENGTH,passwordIssues,passwordPolicyMessage} from '../../../shared/password-policy';
import {ROLE_LABELS} from '../../../shared/permissions';
import {request,RequestError} from './contracts';
import {isAbort} from './request-scope';
import {validUsername,type AdminUser,type AdminPage,type AdminResult,type InternalRole,type AdminCapabilities} from './administration-contracts';

export function AdministrationView({onRequiresLogin}:{onRequiresLogin:()=>void}) {
  const [data,setData]=useState<AdminPage|null>(null),[page,setPage]=useState(1),[query,setQuery]=useState(''),[refresh,setRefresh]=useState(0);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [capabilities,setCapabilities]=useState<AdminCapabilities|null>(null),[capabilityError,setCapabilityError]=useState(''),[capabilityRefresh,setCapabilityRefresh]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setCapabilities(null);setCapabilityError('');
    request<AdminCapabilities>('/api/admin/capabilities',{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setCapabilities(value);}).catch(error=>{if(!controller.signal.aborted&&!isAbort(error))setCapabilityError(error instanceof Error?error.message:'No se pudo verificar la disponibilidad de operaciones.');});
    return ()=>controller.abort();
  },[capabilityRefresh]);
  const [includeDeleted,setIncludeDeleted]=useState(false);
  const [editing,setEditing]=useState<AdminUser|'new'|null>(null),[reset,setReset]=useState<AdminUser|null>(null),[deleting,setDeleting]=useState<AdminUser|null>(null);
  useEffect(()=>{
    const controller=new AbortController(); setLoading(true);setError('');
    const params=new URLSearchParams({page:String(page),pageSize:'20',q:query});if(includeDeleted)params.set('deleted','true');
    request<AdminPage>(`/api/admin/users?${params}`,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(e=>{if(!controller.signal.aborted&&!isAbort(e))setError(e instanceof Error?e.message:'No se pudo cargar el listado.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[page,query,refresh,includeDeleted]);
  function saved(result:AdminResult) {
    if(result.requiresLogin){onRequiresLogin();return;}
    setEditing(null);setReset(null);setDeleting(null);setNotice(result.user.mustChangePassword?'Cambios guardados. El usuario deberá cambiar su contraseña al ingresar.':'Cambios guardados.');setRefresh(value=>value+1);
  }
  return <section className="panel admin-users-view" aria-label="Administración de usuarios">
    <div className="panel-head"><div><p className="eyebrow">Administración</p><h1>Usuarios</h1></div><button className="btn primary" disabled={loading||!capabilities?.users.create||!!editing||!!reset||!!deleting} onClick={()=>{setNotice('');setEditing('new');}}>Crear usuario</button></div>
    {capabilityError&&<p className="error" role="alert">{capabilityError} <button className="btn small" onClick={()=>setCapabilityRefresh(value=>value+1)}>Reintentar disponibilidad</button></p>}
    {capabilities&&!capabilities.credentialDelivery.available&&<p className="notice">La creación de usuarios y el restablecimiento de contraseñas no están disponibles: el servicio de credenciales temporales no está disponible en este entorno. Podés utilizar las demás operaciones habilitadas.</p>}
    {notice&&<p role="status">{notice}</p>}
    {editing&&<UserEditor key={editing==='new'?'new':editing.id} user={editing==='new'?null:editing} onSaved={saved} onStale={()=>setRefresh(value=>value+1)} onCancel={()=>{setEditing(null);}}/>}
    {reset&&<UserEditor key={`reset-${reset.id}`} user={reset} reset onSaved={saved} onStale={()=>setRefresh(value=>value+1)} onCancel={()=>{setReset(null);}}/>}
    {deleting&&<UserEditor key={`delete-${deleting.id}`} user={deleting} deleting onSaved={saved} onStale={()=>setRefresh(value=>value+1)} onCancel={()=>{setDeleting(null);}}/>}
    <form className="filter-grid" onSubmit={event=>{event.preventDefault();setQuery(String(new FormData(event.currentTarget).get('q')??'').trim());setPage(1);}}><label><input type="checkbox" checked={includeDeleted} onChange={event=>{setIncludeDeleted(event.target.checked);setPage(1);}}/> Incluir cuentas dadas de baja</label><label className="field">Buscar usuario<input name="q" maxLength={100} defaultValue={query}/></label><button className="btn" disabled={loading}>Buscar</button></form>
    {error&&<p className="error" role="alert">{error} <button className="btn small" onClick={()=>setRefresh(value=>value+1)}>Reintentar</button></p>}
    {loading&&<p role="status">Cargando usuarios…</p>}
    {data&&!error&&<><div className="tablewrap" role="region" aria-label="Listado de usuarios" aria-busy={loading} tabIndex={0}><table className="admin-users-table"><thead><tr><th scope="col">Nombre completo</th><th scope="col">Estado</th><th scope="col">Rol</th><th scope="col">Contraseña</th><th scope="col">Acciones</th></tr></thead><tbody>{data.items.map(user=><tr key={user.id}><td>{[user.firstName,user.lastName].filter(Boolean).join(' ')||'Perfil pendiente'}</td><td>{user.deletedAt?'Baja lógica':user.enabled?'Habilitado':'Deshabilitado'}</td><td>{ROLE_LABELS[user.role]}</td><td>{user.mustChangePassword?'Pendiente de modificación':'Privada'}</td><td className="admin-user-actions"><button className="btn small" disabled={loading||!capabilities?.users.edit||!!user.deletedAt||!!editing||!!reset||!!deleting} onClick={()=>{setNotice('');setEditing(user);}}>Editar <span className="sr-only">{[user.firstName,user.lastName].filter(Boolean).join(' ')||'perfil pendiente'}</span></button>{' '}<button className="btn small" disabled={loading||!capabilities?.users.resetPassword||!!user.deletedAt||!!editing||!!reset||!!deleting} onClick={()=>{setNotice('');setReset(user);}}>Restablecer contraseña <span className="sr-only">de {[user.firstName,user.lastName].filter(Boolean).join(' ')||'perfil pendiente'}</span></button>{' '}<button className="btn small" disabled={loading||!capabilities?.users.delete||!!user.deletedAt||!!editing||!!reset||!!deleting} onClick={()=>{setNotice('');setDeleting(user);}}>Dar de baja <span className="sr-only">a {[user.firstName,user.lastName].filter(Boolean).join(' ')||'perfil pendiente'}</span></button></td></tr>)}</tbody></table></div>
    {data.items.length===0&&<p className="empty">No hay usuarios para esta búsqueda.</p>}
    <div className="pagination"><button className="btn small" disabled={loading||page<=1||!!editing||!!reset||!!deleting} onClick={()=>setPage(value=>value-1)}>Anterior</button><span>Página {page} · {data.total} usuarios</span><button className="btn small" disabled={loading||page*data.pageSize>=data.total||!!editing||!!reset||!!deleting} onClick={()=>setPage(value=>value+1)}>Siguiente</button></div></>}
  </section>;
}
export function UserEditor({user,reset=false,deleting=false,onSaved,onCancel,onStale}:{user:AdminUser|null;reset?:boolean;deleting?:boolean;onSaved:(result:AdminResult)=>void;onCancel:()=>void;onStale?:()=>void}) {
  const [username,setUsername]=useState(user?.username??''),[role,setRole]=useState<InternalRole>(user?.role??'atencion_publico'),[enabled,setEnabled]=useState(user?.enabled??true);
  const [firstName,setFirstName]=useState(user?.firstName??''),[lastName,setLastName]=useState(user?.lastName??''),[email,setEmail]=useState(user?.email??''),[ci,setCi]=useState(user?.ci??'');
  const dialog=useRef<HTMLDialogElement>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false);
  const active=useRef<AbortController|null>(null);
  const [temporalPassword,setTemporalPassword]=useState(''),[confirmPassword,setConfirmPassword]=useState('');
  const credentialOperation=reset||!user;
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const element=dialog.current;element?.showModal();
    element?.querySelector<HTMLElement>('input:not([disabled]),button:not([disabled])')?.focus();
    return ()=>{active.current?.abort();element?.close();previous?.focus();};
  },[]);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(active.current||conflict)return;
    if(!reset&&!deleting&&(!validUsername(username)||(!user&&(!firstName.trim()||!lastName.trim()||!email.trim())))){setError('Completá nombre, apellido, usuario y correo electrónico válidos.');return;}
    if(credentialOperation){const issues=passwordIssues(temporalPassword,confirmPassword);if(issues.length){setError(passwordPolicyMessage(issues[0]));return;}}
    const confirmation=deleting?`Dar de baja a ${user!.username} y cerrar todas sus sesiones? Su identidad e historial se conservarán.`:reset?`Restablecer la contraseña de ${user!.username} y cerrar todas sus sesiones?`:user?`Guardar los cambios de ${user.username}? Los cambios de usuario, rol o estado cierran sus sesiones.`:`Crear el usuario ${username.trim()} con rol ${ROLE_LABELS[role]}?`;
    if(!window.confirm(confirmation))return;
    const profileChanges=user?Object.fromEntries(Object.entries({firstName:firstName.trim(),lastName:lastName.trim(),email:email.trim(),ci:ci.trim()||null}).filter(([key,value])=>value!==(user[key as 'firstName'|'lastName'|'email'|'ci']??(key==='ci'?null:'')))):{};
    const body=reset?{expectedRevision:user!.revision,temporalPassword,confirmPassword}:deleting?{expectedRevision:user!.revision}:user?{expectedRevision:user.revision,username:username.trim(),...profileChanges,role,enabled}:{username:username.trim(),firstName:firstName.trim(),lastName:lastName.trim(),email:email.trim(),ci:ci.trim()||null,role,temporalPassword,confirmPassword};
    const controller=new AbortController();active.current=controller;setBusy(true);setError('');
    try {
      const result=await request<AdminResult>(user?`/api/admin/users/${encodeURIComponent(user.id)}${reset?'/reset-password':''}`:'/api/admin/users',{method:deleting?'DELETE':reset||!user?'POST':'PATCH',body:JSON.stringify(body),signal:controller.signal});
      if(!controller.signal.aborted)onSaved(result);
    }catch(e){if(!controller.signal.aborted&&!isAbort(e)){setError(e instanceof Error?e.message:'No se pudo guardar.');if(e instanceof RequestError&&['VERSION_CONFLICT','ADMIN_COMMIT_UNCERTAIN'].includes(e.code??'')){setConflict(true);onStale?.();}}}
    finally {active.current=null;setTemporalPassword('');setConfirmPassword('');if(!controller.signal.aborted)setBusy(false);}
  }
  return <dialog ref={dialog} className="admin-user-dialog" aria-label={deleting?'Dar de baja':reset?'Restablecer contraseña':user?'Editar usuario':'Crear usuario'} onCancel={event=>{event.preventDefault();if(!busy)onCancel();}}><button className="btn small admin-modal-close" type="button" aria-label="Cerrar formulario" disabled={busy} onClick={onCancel}>×</button><form className="form-stack" onSubmit={submit} aria-label={deleting?'Dar de baja':reset?'Restablecer contraseña':user?'Editar usuario':'Crear usuario'}>
    <h2>{deleting?`Dar de baja a ${user!.username}`:reset?`Restablecer contraseña de ${user!.username}`:user?`Editar ${user.username}`:'Crear usuario'}</h2>
    <fieldset disabled={busy||conflict} className="form-stack">
      {!reset&&!deleting&&<><fieldset className="admin-form-section profile-fields"><legend>Datos personales</legend><label className="field">Nombre<input required={!user} maxLength={100} autoComplete="given-name" value={firstName} onChange={event=>setFirstName(event.target.value)}/></label><label className="field">Apellido<input required={!user} maxLength={100} autoComplete="family-name" value={lastName} onChange={event=>setLastName(event.target.value)}/></label><label className="field">Correo electrónico<input required={!user} type="email" maxLength={254} autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)}/></label><label className="field">Cédula de identidad (opcional)<input maxLength={20} value={ci} onChange={event=>setCi(event.target.value)} inputMode="numeric"/><small>Ingresá el formato acordado para CI uruguaya; se valida al guardar.</small></label></fieldset>{user&&(!user.firstName||!user.lastName||!user.email)&&<p className="notice">Esta cuenta es anterior al perfil personal. Podés completar sus datos sin alterar su identidad ni contraseña.</p>}<fieldset className="admin-form-section profile-fields"><legend>Cuenta y acceso</legend><label className="field">Nombre de usuario<input required maxLength={100} autoComplete="off" value={username} onChange={event=>setUsername(event.target.value)}/></label><label className="field">Rol<select value={role} onChange={event=>setRole(event.target.value as InternalRole)}><option value="atencion_publico">Atención al público</option><option value="collaborator">Colaborador</option><option value="administrator">Administrador</option></select></label>{user&&<label><input type="checkbox" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/> Cuenta habilitada</label>}</fieldset></>}
      <p className="muted">La operación se registrará automáticamente en la auditoría.</p>
      {credentialOperation&&<fieldset className="admin-form-section"><legend>Contraseña temporal</legend><PasswordField label="Contraseña temporal" name="temporalPassword" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} value={temporalPassword} onChange={setTemporalPassword} disabled={busy||conflict} describedBy="temporary-password-requirements"/><PasswordRequirements id="temporary-password-requirements" password={temporalPassword} confirmation={confirmPassword}/><PasswordField label="Confirmar contraseña temporal" name="confirmPassword" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} value={confirmPassword} onChange={setConfirmPassword} disabled={busy||conflict}/><p className="muted">Ingresá la contraseña inicial acordada para este usuario. No se enviará por correo ni se mostrará después de guardar. Deberá reemplazarla al ingresar. Permanece válida hasta que la cambie o se restablezca.</p></fieldset>}

    </fieldset>
    {error&&<p className="error" role="alert">{error}</p>}{conflict&&<p>Cancelá y volvé a abrir el usuario desde el listado actualizado antes de editar.</p>}
    <div className="admin-modal-actions"><button type="button" className="btn" disabled={busy} onClick={onCancel}>Cancelar</button><button className="btn primary" disabled={busy||conflict}>{busy?'Guardando…':deleting?'Confirmar baja lógica':reset?'Confirmar restablecimiento':user?'Guardar cambios':'Crear usuario'}</button></div>
  </form></dialog>;
}
