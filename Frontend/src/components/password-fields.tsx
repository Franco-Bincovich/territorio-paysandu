"use client";
import {useId,useState} from 'react';
import {PASSWORD_MIN_LENGTH,PASSWORD_MAX_LENGTH,passwordIssues,isCommonPassword} from '../../../shared/password-policy';

export function PasswordField({label,name,autoComplete,disabled=false,value,onChange,describedBy,minLength}:{label:string;name:string;autoComplete:string;disabled?:boolean;value:string;onChange:(value:string)=>void;describedBy?:string;minLength?:number}) {
  const id=useId(),[visible,setVisible]=useState(false);
  return <div className="field"><label htmlFor={id}>{label}</label><div className="password-control">
    <input id={id} name={name} type={visible?'text':'password'} required minLength={minLength} maxLength={PASSWORD_MAX_LENGTH} autoComplete={autoComplete} disabled={disabled} value={value} onChange={event=>onChange(event.target.value)} aria-describedby={describedBy} spellCheck={false} autoCapitalize="none"/>
    <button type="button" className="btn small" aria-label={`${visible?'Ocultar':'Mostrar'} ${label.toLowerCase()}`} aria-controls={id} aria-pressed={visible} disabled={disabled} onClick={()=>setVisible(current=>!current)}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{visible&&<path d="m3 3 18 18"/>}</svg></button>
  </div></div>;
}
type Condition={label:string;state:'Pendiente'|'Cumplida'|'No cumplida'};
export function passwordConditions(password:string,confirmation:string,current?:string):Condition[]{
  const state=(ready:boolean,valid:boolean):Condition['state']=>!ready?'Pendiente':valid?'Cumplida':'No cumplida';
  const issues=passwordIssues(password);
  return [
    {label:`Entre ${PASSWORD_MIN_LENGTH} y ${PASSWORD_MAX_LENGTH} caracteres`,state:state(password.length>0,!issues.includes('PASSWORD_TOO_SHORT')&&!issues.includes('PASSWORD_TOO_LONG'))},
    {label:'No incluida en la lista local de contraseñas comunes',state:state(password.length>0,!isCommonPassword(password))},
    ...(current!==undefined?[{label:'Diferente de la contraseña actual',state:state(password.length>0&&current.length>0,password!==current)}]:[]),
    {label:'Confirmación exacta de la contraseña',state:state(password.length>0&&confirmation.length>0,password===confirmation)},
  ];
}
export function PasswordRequirements({password,confirmation,current,id}:{password:string;confirmation:string;current?:string;id:string}){
  return <div id={id} className="muted"><ul aria-label="Requisitos de contraseña" aria-live="polite" aria-atomic="true">{passwordConditions(password,confirmation,current).map(condition=><li key={condition.label}><strong>{condition.state}</strong>: {condition.label}</li>)}</ul><p>Podés usar letras, números, espacios y símbolos, sin combinaciones obligatorias. La lista local no detecta todas las contraseñas comprometidas; evitá reutilizar claves de otros servicios.</p></div>;
}
