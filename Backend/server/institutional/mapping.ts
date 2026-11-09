import type { InstitutionalParcel, InstitutionalPerson, InstitutionalRef } from "../../domain/institutional";
type Row = Record<string, any>;
export const text = (v: unknown): string | null => v == null || String(v).trim() === "" ? null : String(v).trim();
const number = (v: unknown) => text(v) !== null && Number.isFinite(Number(v)) ? Number(v) : null;
export function parcelRef(p: Row): InstitutionalRef {
  return { padCod: String(p.PadCod), locality: String(p.LOCALIDAD), parcel: String(p.PADRON),
    address: text(p.DOMICILIO_INMUEBLE) ?? "No informado", source: "institutional" };
}
export function mapInstitutionalParcel(p: Row, links: Row[], contacts: Row[]): InstitutionalParcel {
  const people = new Map<string, InstitutionalPerson>();
  for (const [index, v] of links.entries()) {
    const personId = text(v.ID_PERSONA_CP), key = personId ?? `unresolved:${index}`;
    let person = people.get(key);
    if (!person) {
      person = { personId, name: text(v.NOMBRE_CP) ?? "Nombre no informado", links: [], media: [] };
      people.set(key, person);
    }
    person.links.push({ conCod: text(v.ConCod), relCod: text(v.RelCod), relationship: text(v.RelNom) ?? "Vínculo no informado",
      priority: number(v.PRIORIDAD_VINCULO), prioritized: text(v.ES_PRIORIZADO),
      contactPriority: number(v.PRIORIDAD_CONTACTO), contactPrioritized: text(v.ES_CONTACTO_PRIORIZADO),
      documentType: text(v.TIPO_DOCUMENTO), documentOriginal: text(v.DOCUMENTO_ORIGINAL),
      documentNormalized: text(v.DOCUMENTO_NORMALIZADO), documentValid: text(v.DOCUMENTO_VALIDO), documentState: text(v.ESTADO_DOCUMENTO) });
  }
  for (const person of people.values()) {
    person.links.sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity));
    const seen = new Set<string>();
    if (person.personId === null) continue;
    for (const c of contacts) {
      if (text(c.ID_PERSONA_CP) !== person.personId) continue;
      const type = (text(c.TIPO_MEDIO) ?? "SIN_TIPO").toUpperCase();
      const value = text(c.VALOR_CONTACTO);
      if (!value) continue;
      // Phone punctuation is presentation only; preserve leading zero and +.
      const normalized = type === "MAIL" ? value.normalize("NFKC").toLowerCase() :
        ["CELULAR", "FIJO"].includes(type) ? value.replace(/[\s().-]/g, "") : value.normalize("NFKC");
      const key = JSON.stringify([type, normalized]);
      if (!seen.has(key)) { seen.add(key); person.media.push({ type, value }); }
    }
  }
  const fields: Record<string, string> = {};
  const labels: Record<string, string> = { PadCod: "Identificador institucional (PadCod)", DEPARTAMENTO: "Departamento",
    PadTipo: "Tipo de inmueble · código PadTipo", PadEstado: "Estado · código PadEstado", PadPH: "Tipo de propiedad · código PadPH",
    PadAreaTot: "Área total institucional (m²)", PadSupEdif: "Superficie edificada institucional (m²)",
    AREA_PREDIO_CATASTRO: "Área predio Catastro (m²)", AREA_EDIFICADA_CATASTRO: "Área edificada Catastro (m²)",
    ESTADO_CRUCE_CATASTRO: "Estado del cruce catastral", PadBlock: "Bloque · PadBlock", PadApto: "Apartamento · PadApto",
    PadManCod: "Manzana · código PadManCod", PadZonCod: "Zona · código PadZonCod", CALLE: "Calle", PadNPuerta: "Número de puerta" };
  for (const [column, label] of Object.entries(labels)) if (text(p[column]) !== null) fields[label] = String(p[column]);
  return { ...parcelRef(p), fields, provenance: "Fuente institucional · Solo lectura. Códigos sin equivalencias confirmadas.",
    originalLandArea: number(p.AREA_PREDIO_CATASTRO), originalBuiltArea: number(p.AREA_EDIFICADA_CATASTRO), detectedBuiltArea: null,
    institutionalPeople: [...people.values()].sort((a, b) => (a.links[0]?.priority ?? Infinity) - (b.links[0]?.priority ?? Infinity)),
    contacts: [], images: [], readOnly: true, synthetic: false };
}
