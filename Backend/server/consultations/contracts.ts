import { id, invalid } from './model';
export const typeCodes:Record<string,string>={'General':'GENERAL','Reclamo':'RECLAMO','Falta de documentación':'FALTA_DOCUMENTACION','Declaracion voluntaria de metros':'DECLARACION_METROS'};
export const typeLabels=Object.fromEntries(Object.entries(typeCodes).map(([a,b])=>[b,a]));
const json=(v:any)=>typeof v==='string'?JSON.parse(v):v;
export function webInput(body:Record<string,any>) {
  const allowed=['idempotencyKey','version','padCod','locality','parcel','person','type','description','address'];
  if(Object.keys(body).some(k=>!allowed.includes(k)))throw invalid();
  const p=body.person;
  if(!p || typeof p!=='object' || Array.isArray(p) || Object.keys(p).some(k=>!['name','documentType','document','relationship','phones','phoneTypes','emails','localPersonId'].includes(k)))throw invalid();
  if(!Array.isArray(p.phones)||!Array.isArray(p.phoneTypes)||p.phones.length!==p.phoneTypes.length)throw invalid();
  return {idempotencyKey:body.idempotencyKey,parcel:{padCod:body.padCod,locality:body.locality,parcel:body.parcel},
    person:{name:p.name,documentType:({'CI':'CEDULA_IDENTIDAD','RUT':'RUT','Otros':'OTROS'} as Record<string,string>)[p.documentType],document:p.document,
      ...(p.localPersonId?{confirmedPersonId:p.localPersonId}:{})},relationship:{text:p.relationship,code:null},
    phones:p.phones.map((value:string,i:number)=>({value,type:({'Fijo':'FIJO','Celular':'CELULAR'} as Record<string,string>)[p.phoneTypes[i]]})),
    emails:p.emails,type:typeCodes[body.type],description:body.description,address:body.address??null};
}
export function view(row:Record<string,any>) {
  const slots=Array.from({length:5},(_,i)=>i+1);
  const phones=slots.filter(i=>row[`TELEFONO_${i}`]);
  const date=(v:any)=>v instanceof Date?v.toISOString():String(v);
  return {id:id(String(row.ID_CONSULTA)),padCod:id(String(row.PADCOD)),locality:row.LOCALIDAD_PADRON,parcel:row.PADRON,
    type:typeLabels[row.TIPO_CONSULTA],description:row.DESCRIPCION,
    person:{name:row.NOMBRE_COMPLETO,documentType:row.TIPO_DOCUMENTO==='CEDULA_IDENTIDAD'?'CI':row.TIPO_DOCUMENTO==='RUT'?'RUT':'Otros',document:row.DOCUMENTO,
      localPersonId:String(row.ID_PERSONA),relationship:row.RELACION_DECLARADA,phones:phones.map(i=>row[`TELEFONO_${i}`]),
      phoneTypes:phones.map(i=>row[`TIPO_TELEFONO_${i}`]==='FIJO'?'Fijo':'Celular'),emails:slots.map(i=>row[`MAIL_${i}`]).filter(Boolean)},
    creatorUserId:row.USUARIO_CREADOR_ID,creatorUsername:row.CREATOR_USERNAME??row.USUARIO_CREADOR_ID,createdAt:date(row.FECHA_ALTA),
    version:Number(row.VERSION),address:json(row.DOMICILIO_DECLARADO_JSON)??null};
}
