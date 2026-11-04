import type { SupabaseClient } from "@supabase/supabase-js";
import { downloadPrototypeImage } from "./storage-images";
import { HttpError } from "./security";
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
export function createImageDownloadHandler(dependencies: {
  identity: () => Promise<{ client: SupabaseClient }>;
  enabled: () => boolean;
}) {
  return async (kind: string): Promise<Response> => {
    try {
      const { client } = await dependencies.identity();
      if (!dependencies.enabled())
        throw new HttpError(
          404,
          "IMAGE_PROVIDER_DISABLED",
          "Imagen no encontrada.",
        );
      const image = await downloadPrototypeImage(client, kind);
      return new Response(image, {
        headers: { ...headers, "Content-Type": image.type },
      });
    } catch (error) {
      return Response.json(
        {
          error: {
            code: error instanceof HttpError ? error.code : "IMAGE_UNAVAILABLE",
            message: "Imagen no disponible. Verificá tu sesión.",
          },
        },
        {
          status: error instanceof HttpError ? error.status : 503,
          headers,
        },
      );
    }
  };
}
