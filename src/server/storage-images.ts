import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ImageAdapter, ParcelImages, ParcelKey } from "../domain";
import { HttpError } from "./security";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const PROTOTYPE_KEY = Object.freeze({
  locality: "Paysandú",
  parcel: "17718",
});
const buckets = {
  historical: "imagenes-satelitales",
  survey: "imagenes-catastro",
} as const;
const reference = z
  .object({
    locality: z.literal("Paysandú"),
    parcel: z.literal("17718"),
    kind: z.enum(["historical", "survey"]),
    bucket: z.enum(["imagenes-satelitales", "imagenes-catastro"]),
    filename: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/),
    object_path: z.string(),
    source: z.string().min(1).max(200),
    metadata: z.record(z.string().max(100), z.string().max(1000)),
    hosting_authorized_at: z.string().datetime({ offset: true }),
  })
  .superRefine((r, ctx) => {
    if (
      r.bucket !== buckets[r.kind] ||
      r.object_path !== `paysandu/17718/${r.kind}/${r.filename}`
    )
      ctx.addIssue({ code: "custom", message: "Invalid image association" });
  });
export function isPrototypeKey(key: ParcelKey) {
  return (
    key.locality === PROTOTYPE_KEY.locality &&
    key.parcel === PROTOTYPE_KEY.parcel
  );
}
type ImageReference = z.infer<typeof reference>;
async function references(client: SupabaseClient): Promise<ImageReference[]> {
  const { data, error } = await client
    .from("parcel_images")
    .select(
      "locality,parcel,kind,bucket,filename,object_path,source,metadata,hosting_authorized_at",
    )
    .eq("locality", PROTOTYPE_KEY.locality)
    .eq("parcel", PROTOTYPE_KEY.parcel);
  if (error)
    throw new HttpError(
      503,
      "IMAGES_UNAVAILABLE",
      "No se pudieron consultar las imágenes.",
    );
  const parsed = z.array(reference).max(2).safeParse(data);
  if (
    !parsed.success ||
    new Set(parsed.data.map((r) => r.kind)).size !== parsed.data.length
  )
    throw new HttpError(
      503,
      "IMAGES_UNAVAILABLE",
      "Las referencias de imágenes no están disponibles.",
    );
  return parsed.data;
}
/** Request-scoped user's JWT; no secret keys, signed bearer URLs, cache or writes. */
export function supabaseImageAdapter(client: SupabaseClient): ImageAdapter {
  return {
    async getImages(key): Promise<ParcelImages> {
      const result: {
        historical: ParcelImages["historical"];
        survey: ParcelImages["survey"];
        unavailableReason?: "not_found";
      } = { historical: null, survey: null };
      if (!isPrototypeKey(key))
        return { ...result, unavailableReason: "not_found" };
      for (const row of await references(client)) {
        const image = {
          url: `/api/parcel-image/${row.kind}`,
          source: row.source,
        };
        if (row.kind === "historical") result.historical = image;
        else result.survey = { ...image, metadata: row.metadata };
      }
      if (!result.historical || !result.survey)
        result.unavailableReason = "not_found";
      return result;
    },
  };
}
/** Called only after identity() revalidates the current session. Storage rechecks JWT/RLS. */
export async function downloadPrototypeImage(
  client: SupabaseClient,
  kind: string,
): Promise<Blob> {
  if (kind !== "historical" && kind !== "survey")
    throw new HttpError(404, "NOT_FOUND", "Imagen no encontrada.");
  const row = (await references(client)).find((r) => r.kind === kind);
  if (!row) throw new HttpError(404, "NOT_FOUND", "Imagen no encontrada.");
  const { data, error } = await client.storage
    .from(row.bucket)
    .download(row.object_path);
  if (error || !data)
    throw new HttpError(404, "NOT_FOUND", "Imagen no disponible.");
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(data.type) ||
    data.size > MAX_IMAGE_BYTES
  )
    throw new HttpError(502, "INVALID_IMAGE", "El archivo no está disponible.");
  return data;
}
/** Institutional provider stays behind ImageAdapter; selection never comes from request input. */
export function imageProvider(
  client: SupabaseClient,
  fallback: ImageAdapter,
): ImageAdapter {
  const mode = process.env.IMAGE_PROVIDER;
  if (!mode || mode === "catalogue") return fallback;
  if (mode === "supabase") return supabaseImageAdapter(client);
  throw new HttpError(
    503,
    "CONFIGURATION",
    "El proveedor de imágenes no está configurado.",
  );
}
