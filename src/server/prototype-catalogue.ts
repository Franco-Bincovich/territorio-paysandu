import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParcelRecord, CadastreAdapter, ImageAdapter } from "../domain";
import { catalogue } from "./catalogue";
import { HttpError } from "./security";
const labels: Record<string, string> = {
  id: "Padrón (prototipo)",
  localidad: "Localidad (prototipo)",
  address: "Domicilio (prototipo)",
  area: "Terreno (texto original)",
  built: "Construida (texto original)",
  detected: "Detectada (texto original)",
  detectedPercent: "Porcentaje declarado (sin validar)",
  zone: "Zona",
  section: "Sección",
  block: "Manzana",
  contact: "Titular / contacto",
  document: "Documento (texto original)",
  phone: "Teléfono",
  phone2: "Teléfono adicional",
  email: "Correo",
  type: "Vínculo declarado",
};
export function prototypeRecord(row: {
  payload: Record<string, string>;
  source_document: string;
}): ParcelRecord {
  const p = row.payload;
  if (
    p.id !== "17718" ||
    p.localidad !== "Paysandú" ||
    Object.keys(labels).some((k) => typeof p[k] !== "string")
  )
    throw new HttpError(
      503,
      "CONFIGURATION",
      "La ficha de prueba no es válida.",
    );
  function area(value: string): number | null {
    if (!value.trim()) return null;
    if (!/^\d{1,3}(?:\.\d{3})*(?:,\d+)? m²$|^\d+(?:,\d+)? m²$/.test(value))
      return null;
    return Number(
      value.replace(" m²", "").replaceAll(".", "").replace(",", "."),
    );
  }
  return {
    key: { locality: p.localidad, parcel: p.id },
    address: p.address,
    originalLandArea: area(p.area),
    originalBuildingArea: area(p.built),
    detectedBuildingArea: area(p.detected),
    source: "prototype",
    fields: Object.fromEntries(
      Object.entries(labels).map(([k, label]) => [
        p.personalDataMode === "synthetic" &&
        ["contact", "document", "phone", "phone2", "email"].includes(k)
          ? `${label.replace(" (texto original)", "")} · Ficticio`
          : label,
        p[k],
      ]),
    ),
    provenance: `${row.source_document} · No verificado institucionalmente${p.personalDataMode === "synthetic" ? " · Titular, documento, teléfonos y correo ficticios para pruebas; no identifican a una persona real." : ""}`,
  };
}
/** Authenticated session client only; RLS rechecks access. No privileged key/cache. */
export function applicationCatalogue(
  client: SupabaseClient,
): CadastreAdapter & ImageAdapter {
  const fallback = catalogue();
  if (process.env.PROTOTYPE_RECORD_ENABLED !== "true") return fallback;
  async function read(): Promise<{
    record: ParcelRecord;
    payload: Record<string, string>;
  } | null> {
    const { data, error } = await client
      .from("prototype_parcels")
      .select("payload,source_document")
      .eq("locality", "Paysandú")
      .eq("parcel", "17718")
      .maybeSingle();
    if (error)
      throw new HttpError(
        503,
        "SOURCE_UNAVAILABLE",
        "La ficha de prueba no está disponible.",
      );
    return data
      ? { record: prototypeRecord(data), payload: data.payload }
      : null;
  }
  return {
    getImages: (key) => fallback.getImages(key),
    async findParcel(key) {
      if (key.locality === "Paysandú" && key.parcel === "17718")
        return (await read())?.record ?? null;
      return fallback.findParcel(key);
    },
    async findPerson(query) {
      const results = await fallback.findPerson(query);
      const entry = await read();
      if (
        entry &&
        query.field === "name" &&
        entry.payload.contact === query.exact
      )
        return [...results, entry.record];
      return results;
    },
  };
}
