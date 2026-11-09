import type { SupabaseClient } from "@supabase/supabase-js";
import { downloadPrototypeImage } from "./storage-images";
import { HttpError } from "./security";
import { requestLimits, LimitError } from './request-limits';
import { observeRequest } from './observability';
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
export function createImageDownloadHandler(dependencies: {
  identity: () => Promise<{ client: SupabaseClient;user?:{id:string} }>;
  enabled: () => boolean;
}) {
  return async (kind: string,request?:Request): Promise<Response> => observeRequest('/api/parcel-image/{kind}',async()=>{
    let release=()=>{};
    try {
      if(request)release=await requestLimits().enter(request,['parcel-image',kind]);
      const { client,user } = await dependencies.identity();
      if(request)await requestLimits().user(user?.id??'legacy',request,['parcel-image',kind]);
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
          headers:{...headers,...(error instanceof LimitError?{'Retry-After':String(error.retryAfter)}:{})},
        },
      );
    } finally {release();}
  });
}
