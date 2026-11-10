import { eligibleParcelSql } from '../institutional/eligibility';
import type { InstitutionalRead } from "../institutional/pool";
import { normalizeLocality } from "../institutional/repository";
import { addressLimits, invalid, type Evidence, type Verify } from "./model";

/** Isolated verification port, reusing the institutional SELECT-only reader.
 * No route wiring, credential loading, third pool, or institutional writes.
 */
export function institutionalVerifier(read:InstitutionalRead, now=Date.now):Verify {
  return input=>read(async r=>{
    const pads=await r.query(`SELECT p.PadCod,p.PADRON,p.LOCALIDAD FROM AGM_CIU_PADRONES p WHERE ${eligibleParcelSql} AND p.PadCod = ? AND p.PADRON = ? AND p.LOCALIDAD = ? LIMIT 2`,
      [input.parcel.padCod,input.parcel.parcel,normalizeLocality(input.parcel.locality)]);
    if(pads.length!==1)throw invalid("INSTITUTIONAL_REFERENCE",409);
    const evidence:Evidence={source:"institutional",verifiedAt:new Date(now()).toISOString(),...input.parcel};
    // Unknown/non-institutional document types remain local. Never infer from a name.
    if(input.person.documentType==="OTROS")return evidence;
    const people=await r.query("SELECT DISTINCT ID_PERSONA_CP FROM AGM_CIU_VINCULOS WHERE TIPO_DOCUMENTO = ? AND DOCUMENTO_NORMALIZADO = ? AND DOCUMENTO_VALIDO = 'SI' AND ID_PERSONA_CP IS NOT NULL LIMIT 2",
      [input.person.documentType==="CEDULA_IDENTIDAD"?"CI":"RUT",input.person.normalizedDocument]);
    if(people.length>1)throw invalid("AMBIGUOUS_INSTITUTIONAL_IDENTITY",409);
    if(!people.length)return evidence;
    evidence.personId=String(people[0].ID_PERSONA_CP);
    {
      const links=await r.query(`SELECT DISTINCT ConCod FROM AGM_CIU_VINCULOS WHERE PadCod = ? AND ID_PERSONA_CP = ? AND ${input.relationship.code?'RelCod':'RelNom'} = ? LIMIT 2`,
        [input.parcel.padCod,evidence.personId,input.relationship.code??input.relationship.text]);
      if(links.length===1)evidence.conCod=String(links[0].ConCod);
    }
    // Preserve verified institutional medium IDs in the audited evidence JSON.
    // Current local contact has no institutional medium columns in model 7.1.
    const values=[...input.phones.map(p=>p.value),...input.emails];
    const media=await r.query(`SELECT ID_MEDIO_CP,TIPO_MEDIO,VALOR_CONTACTO FROM AGM_CIU_CONTACTOS WHERE ID_PERSONA_CP = ? AND ID_MEDIO_CP IS NOT NULL AND VALOR_CONTACTO IN (${values.map(()=>'?').join(',')}) LIMIT 101`,[evidence.personId,...values]);
    if(media.length>100)throw invalid('AMBIGUOUS_INSTITUTIONAL_REFERENCE',409);
    evidence.media=media.filter(m=>values.includes(m.VALOR_CONTACTO)).map(m=>({id:String(m.ID_MEDIO_CP),type:String(m.TIPO_MEDIO),value:String(m.VALOR_CONTACTO)}));
    // PUERTA is compared to the institutional PUERTA column; never alias NUMERO.
    if(input.address && (input.address.DOMICILIO_COMPLETO || (input.address.CALLE && input.address.PUERTA && input.address.LOCALIDAD))) {
      const keys=Object.keys(addressLimits).filter(k=>input.address![k as keyof typeof input.address]);
      const addresses=await r.query(`SELECT DISTINCT ID_DOMICILIO_CP FROM AGM_CIU_DOMICILIOS WHERE ID_PERSONA_CP = ? AND ${keys.map(k=>`${k} <=> ?`).join(" AND ")} LIMIT 2`,
        [evidence.personId,...keys.map(k=>input.address![k as keyof typeof input.address])]);
      if(addresses.length===1)evidence.addressId=String(addresses[0].ID_DOMICILIO_CP);
    }
    return evidence;
  });
}
