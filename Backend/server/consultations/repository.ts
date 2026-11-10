import { HttpError } from "../security";
import { randomUUID } from "node:crypto";
import { retiredAddressFields } from '../../domain/personal-address';
import { addressLimits, authorize, checkEvidence, fingerprint, id, invalid, parseInput, type Actor, type Evidence, type Input, type Verify } from "./model";

// Explicit injection only. No production pool import, route, feature flag or login changes.
export interface Connection {
  query(sql:string, params?:unknown[]):Promise<any>;
  beginTransaction():Promise<void>; commit():Promise<void>; rollback():Promise<void>; release():Promise<void>;
  destroy():void;
}
export interface Pool { getConnection():Promise<Connection> }
export type Receipt = { id:string; personId:string; padCod:string; version:number };
const unavailable=()=>new HttpError(503,"CONSULTATION_UNAVAILABLE","No se pudo guardar la consulta.");
export class ConsultationRepository {
  constructor(private pool:Pool, private verify:Verify, private now=Date.now) {}
  private async verification(input:Input) {
    try { const evidence=await this.verify(input); checkEvidence(input,evidence,this.now()); return evidence; }
    catch(error){if(error instanceof HttpError)throw error;throw unavailable();}
  }
  private async transaction<T>(operation:(c:Connection)=>Promise<T>):Promise<T> {
    for(let attempt=0;;attempt++) {
      try{return await this.transactionOnce(operation);}
      catch(error){
        // Only errors whose whole transaction has already been rolled back.
        // Network/unknown-commit errors are never retried automatically.
        if(!(error instanceof HttpError) || error.code!=="RETRY_TRANSACTION" || attempt>=3)throw error;
        await new Promise(resolve=>setTimeout(resolve,10*(attempt+1)+Math.floor(Math.random()*20)));
      }
    }
  }
  private async transactionOnce<T>(operation:(c:Connection)=>Promise<T>):Promise<T> {
    let c:Connection|undefined;
    try {
      c=await this.pool.getConnection(); await c.query("SET time_zone = '+00:00'"); await c.beginTransaction();
      const installed=await c.query("SELECT REVISION FROM FB_MODELO_REVISION WHERE MODELO = ?",["consultas"]);
      if(installed[0]?.REVISION!=="7.1")throw unavailable();
      const result=await operation(c); await c.commit(); return result;
    } catch(error) {
      if(c)try{await c.rollback();}catch{c.destroy();}
      if(error instanceof HttpError)throw error;
      if((error as {errno?:number}).errno===1062)throw invalid("IDENTITY_CONFLICT",409);
      if([1020,1213,1205].includes((error as {errno?:number}).errno??0))throw invalid("RETRY_TRANSACTION",409);
      if((error as {sqlState?:string}).sqlState==="45000")throw invalid("VERSION_OR_ORIGIN_CONFLICT",409);
      throw unavailable();
    } finally {if(c)try{await c.release();}catch{c.destroy();}}
  }
  private async person(c:Connection,input:Input,e:Evidence,enrich=true) {
    const normalized=await c.query("SELECT UPPER(REGEXP_REPLACE(TRIM(?), '[-.[:space:]]', '')) AS NORMALIZADO",[input.person.document]);
    if(normalized[0]?.NORMALIZADO!==input.person.normalizedDocument)throw invalid("DOCUMENT_NORMALIZATION",409);
    const explicit=input.person.confirmedPersonId;
    // OTROS has no documentary identity key. Only an explicit local ID can be
    // reused; otherwise every new presentation creates its own local person.
    const rows=input.person.documentType==="OTROS"
      ? explicit ? await c.query("SELECT * FROM FB_PERSONAS WHERE ID_PERSONA = ? FOR UPDATE",[explicit]) : []
      : await c.query("SELECT * FROM FB_PERSONAS WHERE TIPO_DOCUMENTO = ? AND DOCUMENTO_NORMALIZADO = ? FOR UPDATE",[input.person.documentType,input.person.normalizedDocument]);
    if(rows.length>1)throw invalid("AMBIGUOUS_IDENTITY",409);
    const previous=rows[0];
    if(previous) {
      if(explicit && String(previous.ID_PERSONA)!==explicit)throw invalid("IDENTITY_CONFLICT",409);
      if(previous.TIPO_DOCUMENTO!==input.person.documentType || previous.DOCUMENTO_NORMALIZADO!==input.person.normalizedDocument)throw invalid("IDENTITY_CONFLICT",409);
      if(previous.ID_PERSONA_CP!=null && String(previous.ID_PERSONA_CP)!==e.personId)throw invalid("INSTITUTIONAL_REFERENCE",409);
      if(previous.ID_PERSONA_CP==null && e.personId) {
        if(!enrich)throw invalid("HISTORICAL_IDENTITY_CHANGE",409);
        await c.query("UPDATE FB_PERSONAS SET ID_PERSONA_CP = ?, VERIFICACION_CP_JSON = ? WHERE ID_PERSONA = ? AND ID_PERSONA_CP IS NULL",[e.personId,JSON.stringify(e),String(previous.ID_PERSONA)]);
      }
      return String(previous.ID_PERSONA);
    }
    if(input.person.confirmedPersonId)throw invalid("IDENTITY_CONFLICT",409);
    const result=await c.query("INSERT INTO FB_PERSONAS (NOMBRE_COMPLETO,TIPO_DOCUMENTO,DOCUMENTO,ID_PERSONA_CP,VERIFICACION_CP_JSON) VALUES (?,?,?,?,?)",
      [input.person.name,input.person.documentType,input.person.document,e.personId??null,e.personId?JSON.stringify(e):null]);
    return String(result.insertId);
  }
  private values(input:Input,e:Evidence,personId:string,actor:Actor,expected:number,updateContact:boolean) {
    const row:Record<string,unknown>={ID_PERSONA:personId,PADCOD:input.parcel.padCod,PADRON:input.parcel.parcel,LOCALIDAD_PADRON:input.parcel.locality,
      NOMBRE_COMPLETO:input.person.name,TIPO_DOCUMENTO:input.person.documentType,DOCUMENTO:input.person.document,REL_COD:input.relationship.code,RELACION_DECLARADA:input.relationship.text,
      ID_PERSONA_CP:e.personId??null,CONCOD:e.conCod??null,REFERENCIAS_CP_JSON:JSON.stringify(e),DOMICILIO_DECLARADO_JSON:input.address?JSON.stringify(input.address):null,
      TIPO_CONSULTA:input.type,DESCRIPCION:input.description,USUARIO_MODIFICADOR_ID:actor.userId,
      ACTUALIZA_CONTACTO:updateContact?1:0,CONTACTO_VERSION_ESPERADA:expected};
    for(let i=0;i<5;i++){row[`TELEFONO_${i+1}`]=input.phones[i]?.value??null;row[`TIPO_TELEFONO_${i+1}`]=input.phones[i]?.type??null;row[`MAIL_${i+1}`]=input.emails[i]??null;}
    // Full personal address lives in DOMICILIO_DECLARADO_JSON. Legacy partial
    // DOMICILIO_* slots are deliberately not guessed/truncated.
    return row;
  }
  private async address(c:Connection,input:Input,e:Evidence,personId:string,queryId:string,actor:Actor,allowCurrent=true) {
    if(!allowCurrent || !input.address)return;
    const current=(await c.query("SELECT * FROM FB_DOMICILIOS WHERE ID_PERSONA = ? FOR UPDATE",[personId]))[0];
    if(current && BigInt(String(current.ID_CONSULTA))>BigInt(queryId))return; // historical edit cannot revert current address
    const row:Record<string,unknown>={ID_PERSONA:personId,ID_PERSONA_CP:e.personId??null,ID_DOMICILIO_CP:e.addressId??null,ID_CONSULTA:queryId,
      VERIFICACION_CP_JSON:e.addressId?JSON.stringify(e):null,USUARIO_MODIFICADOR_ID:actor.userId};
    for(const k of Object.keys(addressLimits))row[k]=input.address[k as keyof typeof input.address]??null;
    const columns=Object.keys(row);
    if(!current)await c.query(`INSERT INTO FB_DOMICILIOS (${columns.join(",")}) VALUES (${columns.map(()=>"?").join(",")})`,Object.values(row));
    else {
      const result=await c.query(`UPDATE FB_DOMICILIOS SET ${columns.map(k=>`${k} = ?`).join(",")} WHERE ID_DOMICILIO = ? AND VERSION = ?`,[...Object.values(row),String(current.ID_DOMICILIO),Number(current.VERSION)]);
      if(!result.affectedRows)throw invalid("VERSION_CONFLICT",409);
    }
  }
  async create(value:unknown,actor:Actor):Promise<Receipt> {
    authorize(actor,this.now()); const input=parseInput(value);
    const evidence=await this.verification(input);
    return this.transaction(async c=>{
      authorize(actor,this.now());
      checkEvidence(input,evidence,this.now());
      const reservation=randomUUID();
      // Upsert takes an exclusive lock; duplicate INSERT + SELECT FOR UPDATE can
      // deadlock when concurrent retries upgrade shared duplicate-key locks.
      await c.query("INSERT INTO FB_CONSULTAS_IDEMPOTENCIA (USUARIO_ID,CLAVE,PAYLOAD_HASH,RESERVA_TOKEN) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE CLAVE=VALUES(CLAVE)",[actor.userId,input.idempotencyKey,fingerprint(input),reservation]);
      const receipt=(await c.query("SELECT * FROM FB_CONSULTAS_IDEMPOTENCIA WHERE USUARIO_ID = ? AND CLAVE = ? FOR UPDATE",[actor.userId,input.idempotencyKey]))[0];
      if(!receipt)throw unavailable();
      if(receipt.RESERVA_TOKEN!==reservation){
        if(!receipt || receipt.PAYLOAD_HASH!==fingerprint(input))throw invalid("IDEMPOTENCY_CONFLICT",409);
        if(!receipt.ID_CONSULTA || !receipt.RESPUESTA_JSON)throw unavailable();
        return typeof receipt.RESPUESTA_JSON==="string"?JSON.parse(receipt.RESPUESTA_JSON):receipt.RESPUESTA_JSON;
      }
      const personId=await this.person(c,input,evidence);
      const contact=(await c.query("SELECT * FROM FB_CONTACTOS WHERE ID_PERSONA = ? FOR UPDATE",[personId]))[0];
      const row={...this.values(input,evidence,personId,actor,Number(contact?.VERSION??0),true),USUARIO_CREADOR_ID:actor.userId};
      const created=await c.query(`INSERT INTO FB_CIU_CONSULTAS_WEB (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(()=>"?").join(",")})`,Object.values(row));
      const queryId=String(created.insertId);
      await c.query("INSERT INTO FB_VINCULOS_DECLARADOS (ID_PERSONA,ID_PERSONA_CP,PADCOD,CONCOD,ID_CONSULTA,REL_COD,RELACION_DECLARADA,USUARIO_CREADOR_ID,VERIFICACION_CP_JSON) VALUES (?,?,?,?,?,?,?,?,?)",
        [personId,evidence.personId??null,input.parcel.padCod,evidence.conCod??null,queryId,input.relationship.code,input.relationship.text,actor.userId,JSON.stringify(evidence)]);
      await this.address(c,input,evidence,personId,queryId,actor);
      const response={id:queryId,personId,padCod:input.parcel.padCod,version:1};
      await c.query("UPDATE FB_CONSULTAS_IDEMPOTENCIA SET ID_CONSULTA = ?, RESPUESTA_JSON = ? WHERE USUARIO_ID = ? AND CLAVE = ?",[queryId,JSON.stringify(response),actor.userId,input.idempotencyKey]);
      return response;
    });
  }
  async edit(queryId:string,expectedVersion:number,value:unknown,actor:Actor):Promise<Receipt> {
    authorize(actor,this.now()); id(queryId);
    if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)throw invalid();
    const input=parseInput(value), evidence=await this.verification(input);
    return this.transaction(async c=>{
      authorize(actor,this.now());
      checkEvidence(input,evidence,this.now());
      // Establish immutable owner first; lock order matches create: person -> query -> current records.
      const reference=(await c.query("SELECT ID_PERSONA, USUARIO_CREADOR_ID FROM FB_CIU_CONSULTAS_WEB WHERE ID_CONSULTA = ?",[queryId]))[0];
      if(!reference)throw invalid("NOT_FOUND",404);
      if(reference.USUARIO_CREADOR_ID!==actor.userId)throw invalid("FORBIDDEN",403);
      const lockedPerson=(await c.query("SELECT ID_PERSONA FROM FB_PERSONAS WHERE ID_PERSONA = ? FOR UPDATE",[String(reference.ID_PERSONA)]))[0];
      if(!lockedPerson)throw invalid("IDENTITY_CONFLICT",409);
      const latest=(await c.query("SELECT ID_CONSULTA FROM FB_CIU_CONSULTAS_WEB WHERE ID_PERSONA = ? ORDER BY ID_CONSULTA DESC LIMIT 1 FOR UPDATE",[String(reference.ID_PERSONA)]))[0];
      const current=String(latest?.ID_CONSULTA)===queryId;
      const editInput={...input,person:{...input.person,confirmedPersonId:input.person.confirmedPersonId??String(reference.ID_PERSONA)}};
      const personId=await this.person(c,editInput,evidence,current);
      if(personId!==String(reference.ID_PERSONA))throw invalid("IDENTITY_CONFLICT",409);
      const old=(await c.query("SELECT * FROM FB_CIU_CONSULTAS_WEB WHERE ID_CONSULTA = ? FOR UPDATE",[queryId]))[0];
      if(old.USUARIO_CREADOR_ID!==actor.userId)throw invalid("FORBIDDEN",403);
      if(Number(old.VERSION)!==expectedVersion)throw invalid("VERSION_CONFLICT",409);
      if(String(old.PADCOD)!==input.parcel.padCod || old.PADRON!==input.parcel.parcel || old.LOCALIDAD_PADRON!==input.parcel.locality)throw invalid("IMMUTABLE_PARCEL",409);
      // Retired fields are read-only on the web. Preserve their exact original values
      // when correcting an address; never reinterpret NUMERO as PUERTA.
      const previous=typeof old.DOMICILIO_DECLARADO_JSON==='string'?JSON.parse(old.DOMICILIO_DECLARADO_JSON):old.DOMICILIO_DECLARADO_JSON;
      if(input.address && previous)for(const key of retiredAddressFields)if(typeof previous[key]==='string')input.address[key]=previous[key];
      const contact=(await c.query("SELECT * FROM FB_CONTACTOS WHERE ID_PERSONA = ? FOR UPDATE",[personId]))[0];
      const row=this.values(input,evidence,personId,actor,Number(contact?.VERSION??0),current);
      const updated=await c.query(`UPDATE FB_CIU_CONSULTAS_WEB SET ${Object.keys(row).map(k=>`${k} = ?`).join(",")} WHERE ID_CONSULTA = ? AND VERSION = ? AND USUARIO_CREADOR_ID = ?`,[...Object.values(row),queryId,expectedVersion,actor.userId]);
      if(!updated.affectedRows)throw invalid("VERSION_CONFLICT",409);
      await c.query("UPDATE FB_VINCULOS_DECLARADOS SET ID_PERSONA_CP = ?, CONCOD = ?, REL_COD = ?, RELACION_DECLARADA = ?, VERIFICACION_CP_JSON = ? WHERE ID_CONSULTA = ? AND ID_PERSONA = ? AND PADCOD = ?",
        [evidence.personId??null,evidence.conCod??null,input.relationship.code,input.relationship.text,JSON.stringify(evidence),queryId,personId,input.parcel.padCod]);
      await this.address(c,input,evidence,personId,queryId,actor,current);
      const fresh=(await c.query("SELECT VERSION FROM FB_CIU_CONSULTAS_WEB WHERE ID_CONSULTA = ?",[queryId]))[0];
      return {id:queryId,personId,padCod:input.parcel.padCod,version:Number(fresh.VERSION)};
    });
  }
}
