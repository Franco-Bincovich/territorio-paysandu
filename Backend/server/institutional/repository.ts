import { eligibleParcelSql } from './eligibility';
import type { SurveyInformation, InstitutionalRef, PersonCandidate, PersonSearchResult } from "../../domain/institutional";
import { HttpError } from "../security";
import { institutionalRead, type InstitutionalRead, type Reader } from "./pool";
import { mapInstitutionalParcel, parcelRef, text } from "./mapping";

const columns = `p.PadCod, p.PADRON, p.LOCALIDAD, p.DEPARTAMENTO, p.PadTipo, p.PadEstado,
 p.PadPH, p.DOMICILIO_INMUEBLE, p.PadAreaTot, p.PadSupEdif, p.AREA_PREDIO_CATASTRO,
 p.AREA_EDIFICADA_CATASTRO, p.ESTADO_CRUCE_CATASTRO, p.PadBlock, p.PadApto,
 p.PadManCod, p.PadZonCod, p.CALLE, p.PadNPuerta`;
const validation = () => new HttpError(400, "VALIDATION", "Revisá los datos de búsqueda.");
const limit = () => new HttpError(422, "RESULT_LIMIT", "La búsqueda supera el límite. Usá datos más específicos.");
export function normalizeLocality(value: string) {
  const s = value.normalize("NFD").replace(/\p{M}/gu, "").trim().toUpperCase();
  if (!s || s.length > 100 || /[\x00-\x1f]/.test(s)) throw validation();
  return s;
}
function parcelNumber(value: string) { if (!/^\d{1,20}$/.test(value)) throw validation(); return value; }
function identifier(value: string) { if (!/^\d{1,30}$/.test(value)) throw validation(); return value; }
export function personPredicate(kind: string, value: string) {
  if (kind === "name") {
    const normalized = normalizePersonName(value);
    return { sql: "TRIM(REGEXP_REPLACE(UPPER(REGEXP_REPLACE(v.NOMBRE_CP, ?, ' ')), ?, ' ')) COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci",
      params: ["\\p{P}", "\\s+", normalized] };
  }
  if (!["ci", "rut"].includes(kind)) throw validation();
  const document = value.replace(/[.\s-]/g, "");
  if (!(kind === "ci" ? /^\d{7,8}$/ : /^\d{12}$/).test(document)) throw validation();
  return { sql: "v.TIPO_DOCUMENTO = ? AND v.DOCUMENTO_NORMALIZADO = ?", params: [kind.toUpperCase(), document] };
}
export function normalizePersonName(value: string) {
  const normalized = value.normalize("NFKC").replace(/\p{P}/gu, " ").trim().replace(/\s+/gu, " ").toUpperCase();
  if (value.length > 200 || normalized.length < 2 || !/[\p{L}\p{N}]/u.test(normalized) || /[\x00-\x1f]/.test(normalized)) throw validation();
  return normalized;
}
function bounded<T>(rows: T[], max: number) { if (rows.length > max) throw limit(); return rows; }

export class InstitutionalRepository {
  async imageParcel(padCod:string) {
    if(!/^[1-9]\d{0,18}$/.test(padCod)||BigInt(padCod)>9223372036854775807n)throw validation();
    return this.read(async r=>{
      const rows=await r.query(`SELECT p.PadCod,p.PADRON,p.LOCALIDAD FROM AGM_CIU_PADRONES p WHERE p.PadCod = ? AND ${eligibleParcelSql} LIMIT 2`,[padCod]);
      if(rows.length!==1)throw new HttpError(rows.length?409:404,'NOT_FOUND','Padrón no encontrado.');
      return {padCod:String(rows[0].PadCod),locality:String(rows[0].LOCALIDAD),parcel:String(rows[0].PADRON)};
    });
  }
  constructor(private read: InstitutionalRead = institutionalRead) {}
  async searchParcel(locality: string, parcel: string) {
    const params = [normalizeLocality(locality), parcelNumber(parcel)];
    return this.read(async r => bounded(await r.query(`SELECT ${columns} FROM AGM_CIU_PADRONES p
      WHERE ${eligibleParcelSql} AND p.LOCALIDAD = ? AND p.PADRON = ? ORDER BY p.PadCod LIMIT 51`, params), 50).map(parcelRef));
  }
  async searchPerson(kind: string, value: string, selectedPersonId?: string): Promise<PersonSearchResult> {
    const predicate = personPredicate(kind, value);
    if (selectedPersonId !== undefined) identifier(selectedPersonId);
    return this.read(async r => {
      const rows = bounded(await r.query(`SELECT DISTINCT p.PadCod, p.PADRON, p.LOCALIDAD, p.DOMICILIO_INMUEBLE,
        v.ID_PERSONA_CP, v.ConCod, v.RelCod, v.RelNom, v.PRIORIDAD_VINCULO,
        v.NOMBRE_CP, v.TIPO_DOCUMENTO, v.DOCUMENTO_NORMALIZADO
        FROM AGM_CIU_PADRONES p JOIN AGM_CIU_VINCULOS v ON v.PadCod = p.PadCod
        WHERE ${eligibleParcelSql} AND ${predicate.sql} ORDER BY p.PadCod, v.ID_PERSONA_CP, v.ConCod LIMIT 501`, predicate.params), 500);
      const people = new Map<string, { candidate: PersonCandidate; parcels: Map<string, InstitutionalRef> }>();
      let unidentifiedMatches = 0;
      for (const row of rows) {
        const personId = text(row.ID_PERSONA_CP), id = text(row.PadCod);
        if (!personId || !id) { unidentifiedMatches++; continue; }
        let person = people.get(personId);
        if (!person) {
          person = { candidate: { personId, name: text(row.NOMBRE_CP) ?? "Nombre no informado",
            documentType: text(row.TIPO_DOCUMENTO), document: text(row.DOCUMENTO_NORMALIZADO), parcelCount: 0 }, parcels: new Map() };
          people.set(personId, person);
        }
        if (!person.parcels.has(id)) person.parcels.set(id, { ...parcelRef(row), matchedPeople: [{ ...person.candidate, links: [] }] });
        const links = person.parcels.get(id)!.matchedPeople![0].links!;
        const priority = row.PRIORIDAD_VINCULO == null ? null : Number(row.PRIORIDAD_VINCULO);
        const link = { conCod: text(row.ConCod), relCod: text(row.RelCod), relationship: text(row.RelNom) ?? "Vínculo no informado", priority };
        if (!links.some(l => JSON.stringify(l) === JSON.stringify(link))) links.push(link);
      }
      for (const person of people.values()) {
        person.candidate.parcelCount = person.parcels.size;
        for (const parcel of person.parcels.values()) parcel.matchedPeople![0].links!.sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity));
      }
      const candidates = bounded([...people.values()].map(p => p.candidate), 50);
      if (selectedPersonId !== undefined && !people.has(selectedPersonId))
        throw new HttpError(400, "INVALID_PERSON_SELECTION", "La persona seleccionada no coincide con la búsqueda.");
      const selected = selectedPersonId ?? (candidates.length === 1 ? candidates[0].personId : null);
      return { results: selected ? bounded([...people.get(selected)!.parcels.values()], 50) : [],
        people: candidates, requiresDisambiguation: candidates.length > 1 && !selected,
        selectedPersonId: selected, unidentifiedMatches };
    });
  }
  async getParcel(locality: string, parcel: string, padCod?: string) {
    const params = [normalizeLocality(locality), parcelNumber(parcel)];
    if (padCod !== undefined) params.push(identifier(padCod));
    return this.read(async r => {
      const rows = await r.query(`SELECT ${columns} FROM AGM_CIU_PADRONES p
        WHERE ${eligibleParcelSql} AND p.LOCALIDAD = ? AND p.PADRON = ?${padCod !== undefined ? " AND p.PadCod = ?" : ""}
        ORDER BY p.PadCod LIMIT 2`, params);
      if (!rows.length) throw new HttpError(404, "NOT_FOUND", "Padrón no encontrado.");
      if (rows.length > 1) throw new HttpError(409, "AMBIGUOUS_PARCEL", "Seleccioná el padrón por su identificador institucional.");
      return this.details(r, rows[0]);
    });
  }
  private async details(r: Reader, parcel: Record<string, any>) {
    const links = bounded(await r.query(`SELECT PadCod, ConCod, RelCod, RelNom, PRIORIDAD_VINCULO, ES_PRIORIZADO,
      ID_PERSONA_CP, NOMBRE_CP, DOCUMENTO_ORIGINAL, DOCUMENTO_NORMALIZADO, TIPO_DOCUMENTO,
      DOCUMENTO_VALIDO, ESTADO_DOCUMENTO, PRIORIDAD_CONTACTO, ES_CONTACTO_PRIORIZADO,
      CANT_MAILS, CANT_CELULARES, CANT_FIJOS FROM AGM_CIU_VINCULOS WHERE PadCod = ?
      ORDER BY PRIORIDAD_VINCULO IS NULL, PRIORIDAD_VINCULO, ConCod LIMIT 501`, [String(parcel.PadCod)]), 500);
    const ids = [...new Set(links.map(v => text(v.ID_PERSONA_CP)).filter((id): id is string => id !== null))];
    const media = ids.length ? bounded(await r.query(`SELECT ID_CONTACTO, ID_PERSONA_CP, TIPO_MEDIO, ID_MEDIO_CP, VALOR_CONTACTO
      FROM AGM_CIU_CONTACTOS WHERE ID_PERSONA_CP IN (${ids.map(() => "?").join(",")})
      ORDER BY ID_PERSONA_CP, TIPO_MEDIO, ID_CONTACTO LIMIT 10001`, ids), 10000) : [];
    // The parcel has already passed locality, identity and EN_CATASTRO checks.
    // Fetch only the four survey columns; never join by the display parcel number.
    let survey: SurveyInformation;
    try {
      const rows = await r.query(`SELECT CAST(n.FECHA_RELEVAMIENTO AS CHAR) AS surveyDate,
        CAST(n.SUP_DETECTADA_M2 AS CHAR) AS detectedArea,
        CAST(n.DIFERENCIA_CALCULADA_M2 AS CHAR) AS difference,
        n.ESTADO_RELEVAMIENTO AS surveyState
        FROM AGM_LOTES_NOTIFICACION n
        WHERE n.PadCod = ? LIMIT 1`, [String(parcel.PadCod)]);
      const row = rows[0];
      const decimal = (value: unknown): string | null => {
        if (value == null) return null;
        if (typeof value !== "string" || !/^-?\d{1,13}\.\d{2}$/.test(value)) throw new Error("Invalid survey decimal");
        return value;
      };
      const date = row?.surveyDate == null ? null : String(row.surveyDate);
      if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid survey date");
      const state = row?.surveyState == null ? null : String(row.surveyState);
      if (state !== null && !["SIN_RELEVAR", "RELEVADO_CON_DIFERENCIA", "RELEVADO_DIFERENCIA_NEGATIVA", "RELEVADO_SIN_DIFERENCIA", "PENDIENTE_VALIDACION"].includes(state)) {
        console.warn("institutional_survey_unknown_state");
      }
      survey = row ? { status: "available", date, detectedArea: decimal(row.detectedArea), difference: decimal(row.difference), state } : { status: "absent" };
    } catch {
      // Do not expose SQL, identifiers, credentials or institutional values.
      console.warn("institutional_survey_read_unavailable");
      survey = { status: "unavailable" };
    }
    return { ...mapInstitutionalParcel(parcel, links, media), survey };
  }
}
