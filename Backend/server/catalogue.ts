import type { CadastreAdapter, ImageAdapter, ParcelRecord } from "../domain";
import { HttpError } from "./security";
import { resolveImageCatalogue } from "./images";
import { SyntheticCadastreCache } from "../domain/cadastre-cache";

const records: readonly (ParcelRecord & {
  name: string;
  CI: string;
  RUT: string;
})[] = [
  {
    key: { locality: "LOCALIDAD SINTÉTICA", parcel: "900001" },
    address: "Calle de prueba 100 — DATOS SINTÉTICOS",
    originalLandArea: 500,
    originalBuildingArea: 120,
    detectedBuildingArea: 135,
    source: "synthetic",
    name: "PERSONA SINTÉTICA UNO",
    CI: "00000001",
    RUT: "000000000001",
  },
  {
    key: { locality: "OTRA LOCALIDAD SINTÉTICA", parcel: "900002" },
    address: "Calle de prueba 200 — DATOS SINTÉTICOS",
    originalLandArea: 600,
    originalBuildingArea: 100,
    detectedBuildingArea: 100,
    source: "synthetic",
    name: "PERSONA SINTÉTICA UNO",
    CI: "00000001",
    RUT: "000000000001",
  },
  // Deliberate synthetic homonym: same exact name, distinct document and parcel.
  {
    key: { locality: "LOCALIDAD SINTÉTICA", parcel: "900003" },
    address: "Calle de prueba 300 — DATOS SINTÉTICOS",
    originalLandArea: null,
    originalBuildingArea: null,
    detectedBuildingArea: null,
    source: "synthetic",
    name: "PERSONA SINTÉTICA UNO",
    CI: "00000002",
    RUT: "000000000002",
  },
];
const syntheticSource: CadastreAdapter & ImageAdapter = {
  async findParcel(key) {
    return (
      records.find(
        (r) => r.key.locality === key.locality && r.key.parcel === key.parcel,
      ) ?? null
    );
  },
  async findPerson(query) {
    return records.filter((r) => r[query.field] === query.exact);
  },
  async getImages() {
    const now = new Date();
    // Synthetic-only processing reference, not an institutional acquisition/construction date.
    const referenceDate =
      process.env.SYNTHETIC_IMAGE_REFERENCE_DATE ??
      now.toISOString().slice(0, 10);
    return resolveImageCatalogue(
      { referenceDate, historicalCandidates: [], survey: null },
      now,
    );
  },
};
let cached: { key: string; adapter: SyntheticCadastreCache } | undefined;
export function catalogue(): CadastreAdapter & ImageAdapter {
  if (process.env.DATA_MODE !== "synthetic")
    throw new HttpError(
      503,
      "INTEGRATION_BLOCKED",
      "La integración institucional está pendiente de autorización.",
    );
  const raw = process.env.SYNTHETIC_CACHE_TTL_MS ?? "30000";
  if (!/^\d+$/.test(raw) || Number(raw) > 300000)
    throw new HttpError(
      503,
      "CONFIGURATION",
      "La configuración de caché no es válida.",
    );
  if (!cached || cached.key !== raw)
    cached = {
      key: raw,
      adapter: new SyntheticCadastreCache(syntheticSource, {
        ttlMs: Number(raw),
        maxEntries: 100,
        maxRecordsPerEntry: 100,
      }),
    };
  const adapter = cached.adapter;
  return {
    findParcel: (key) => adapter.findParcel(key),
    findPerson: (query) => adapter.findPerson(query),
    getImages: (key) => syntheticSource.getImages(key),
  };
}
