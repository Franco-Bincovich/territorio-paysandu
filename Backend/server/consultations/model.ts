import { createHash } from "node:crypto";
import { HttpError } from "../security";
import { personalAddressErrors, normalizeAddressPlace } from '../../domain/personal-address';

export type Actor = { verified: true; userId: string; role: "collaborator"; enabled: boolean; mustChangePassword: boolean; expiresAt: number };
export type Address = Partial<Record<"CALLE" | "NUMERO" | "BARRIO" | "LOCALIDAD" | "DEPARTAMENTO" | "CODIGO_POSTAL" | "PH" | "BLOCK" | "DEPTO" | "PUERTA" | "DOMICILIO_COMPLETO" | "REFERENCIA" | "SECTOR" | "MANZANA" | "LOTE", string>>;
export const addressLimits = { CALLE:250, NUMERO:50, BARRIO:250, LOCALIDAD:250, DEPARTAMENTO:150, CODIGO_POSTAL:50, PH:50, BLOCK:50, DEPTO:50, PUERTA:50, DOMICILIO_COMPLETO:1000, REFERENCIA:150, SECTOR:50, MANZANA:50, LOTE:50 } as const;
export type Input = {
  idempotencyKey: string;
  parcel: { padCod: string; locality: string; parcel: string };
  person: { name: string; documentType: "CEDULA_IDENTIDAD" | "RUT" | "OTROS"; document: string; normalizedDocument: string; confirmedPersonId?: string };
  relationship: { text: string; code: string | null };
  phones: { value: string; type: "FIJO" | "CELULAR" }[]; emails: string[];
  type: "GENERAL" | "RECLAMO" | "FALTA_DOCUMENTACION" | "DECLARACION_METROS";
  description: string; address: Address | null;
};
/** Server-only verification result. Never deserialize this from a web request.
 * personId/conCod/addressId must be verified against this same person/parcel.
 */
export type Evidence = { source: "institutional"; verifiedAt: string; padCod: string; locality: string; parcel: string;
  personId?: string; conCod?: string; addressId?: string;
  media?: {id:string;type:string;value:string}[] };
export type Verify = (input: Input) => Promise<Evidence>;
export const invalid = (code = "VALIDATION", status = 400) => new HttpError(status, code, "Revisá los datos o la versión de la consulta.");
const object = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== "object" || Array.isArray(v)) throw invalid(); return v as Record<string, unknown>; };
const keys = (v: Record<string, unknown>, allowed: string[]) => { if (Object.keys(v).some(k => !allowed.includes(k))) throw invalid(); };
const string = (v: unknown, max: number) => { if (typeof v !== "string" || !v.trim() || Array.from(v.trim()).length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)) throw invalid(); return v.trim(); };
export const id = (v: unknown) => { const s=string(v,19); if (!/^[1-9]\d*$/.test(s) || BigInt(s)>9223372036854775807n) throw invalid(); return s; };
export const normalizeDocument = (v: string) => v.trim().replace(/[-.\s]/gu, "").toUpperCase();
export const uuid = (v: unknown) => { const s=string(v,36); if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) throw invalid(); return s.toLowerCase(); };
export function authorize(actor: Actor, now: number) {
  if (!actor || actor.verified!==true || !actor.userId || actor.expiresAt<=now || !Number.isFinite(actor.expiresAt)) throw invalid("UNAUTHENTICATED",401);
  uuid(actor.userId);
  if (!actor.enabled || actor.role!=="collaborator" || actor.mustChangePassword) throw invalid("FORBIDDEN",403);
}
export function parseInput(value: unknown): Input {
  const v=object(value); keys(v,["idempotencyKey","parcel","person","relationship","phones","emails","type","description","address"]);
  const parcel=object(v.parcel), person=object(v.person), relationship=object(v.relationship);
  keys(parcel,["padCod","locality","parcel"]); keys(person,["name","documentType","document","confirmedPersonId"]); keys(relationship,["text","code"]);
  const document=string(person.document,30), normalizedDocument=normalizeDocument(document);
  const documentType=person.documentType;
  if (!["CEDULA_IDENTIDAD","RUT","OTROS"].includes(String(documentType)) ||
    (documentType==="CEDULA_IDENTIDAD" && !/^\d{7,8}$/.test(normalizedDocument)) ||
    (documentType==="RUT" && !/^\d{12}$/.test(normalizedDocument)) || !normalizedDocument || Array.from(normalizedDocument).length>30) throw invalid();
  if (!Array.isArray(v.phones) || v.phones.length<1 || v.phones.length>5 || !Array.isArray(v.emails) || v.emails.length<1 || v.emails.length>5) throw invalid();
  const phones=v.phones.map(p=>{const item=object(p); keys(item,["value","type"]); const value=string(item.value,30);
    if (!/^\+?[\d ()-]+$/.test(value) || value.replace(/\D/g,"").length<6 || !["FIJO","CELULAR"].includes(String(item.type))) throw invalid();
    return {value,type:item.type as "FIJO"|"CELULAR"};});
  const emails=v.emails.map(e=>{const email=string(e,254); if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw invalid();return email;});
  let address: Address|null=null;
  if(v.address!==undefined && v.address!==null) {
    const raw=object(v.address); keys(raw,Object.keys(addressLimits));
    address=Object.fromEntries(Object.keys(addressLimits).filter(k=>Object.hasOwn(raw,k) && raw[k]!=null && (typeof raw[k]!=="string" || (raw[k] as string).trim()))
      .map(k=>[k,string(raw[k],addressLimits[k as keyof Address])]));
    if(!Object.keys(address).length) address=null;
    else {
      if(Object.keys(personalAddressErrors(address)).length)throw invalid();
      address.LOCALIDAD=normalizeAddressPlace(address.LOCALIDAD!);
      address.DEPARTAMENTO='PAYSANDU';
      address=Object.fromEntries(Object.keys(addressLimits).filter(k=>Object.hasOwn(address!,k)).map(k=>[k,address![k as keyof Address]]));
    }
  }
  const description=string(v.description,10000); if(Array.from(description).length<20)throw invalid();
  if(!["GENERAL","RECLAMO","FALTA_DOCUMENTACION","DECLARACION_METROS"].includes(String(v.type)))throw invalid();
  const parcelNumber=string(parcel.parcel,30); if(!/^\d+$/.test(parcelNumber))throw invalid();
  const code=relationship.code==null ? null:string(relationship.code,3);
  return { idempotencyKey:uuid(v.idempotencyKey), parcel:{padCod:id(parcel.padCod),locality:string(parcel.locality,100),parcel:parcelNumber},
    person:{name:string(person.name,200),documentType:documentType as Input["person"]["documentType"],document,normalizedDocument,
      ...(person.confirmedPersonId!==undefined ? {confirmedPersonId:id(person.confirmedPersonId)}:{})},
    relationship:{text:string(relationship.text,100),code},phones,emails,type:v.type as Input["type"],description,address };
}
export function checkEvidence(input: Input, evidence: Evidence, now: number) {
  const locality=(s:string)=>s.normalize("NFD").replace(/\p{M}/gu,"").trim().toUpperCase();
  if(!evidence || typeof evidence.locality!=="string" || evidence.source!=="institutional" || evidence.padCod!==input.parcel.padCod || evidence.parcel!==input.parcel.parcel ||
    locality(evidence.locality)!==locality(input.parcel.locality) || !Number.isFinite(Date.parse(evidence.verifiedAt)) ||
    Date.parse(evidence.verifiedAt)>now || now-Date.parse(evidence.verifiedAt)>300000) throw invalid("INSTITUTIONAL_REFERENCE",409);
  for(const ref of [evidence.personId,evidence.conCod,evidence.addressId]) if(ref!==undefined)id(ref);
  if((evidence.conCod || evidence.addressId) && !evidence.personId)throw invalid("INSTITUTIONAL_REFERENCE",409);
  if(evidence.conCod && BigInt(evidence.conCod)>4294967295n)throw invalid();
  if(evidence.media) {
    if(!evidence.personId || evidence.media.length>10)throw invalid('INSTITUTIONAL_REFERENCE',409);
    for(const medium of evidence.media) {
      id(medium.id);
      if(![...input.phones.map(p=>p.value),...input.emails].includes(medium.value))throw invalid('INSTITUTIONAL_REFERENCE',409);
    }
  }
}
export const fingerprint = (input: Input) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
