import {imageReference} from '../sftp-images/metrics';
import { queryKeys } from "../filters";
import { HttpError, required } from "../security";
import { InstitutionalRepository } from "./repository";
import type { InstitutionalImages } from '../image-provider';
import { imagePadCod, kindValue } from '../sftp-images/config';

/** Invoked only AFTER the existing MariaDB session/role/password guard succeeds. */
export function createInstitutionalHttp(repository = new InstitutionalRepository(),images?:InstitutionalImages) {
  return async (request: Request, segments: string[]): Promise<Response | null> => {
    const url = new URL(request.url);
    const result = (body: unknown) => Response.json(body, { headers: {
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
    if (request.method !== "GET")
      throw new HttpError(403, "WRITES_DISABLED", "El guardado de consultas todavía no está habilitado.");
    if(images && segments.join('/')==='parcel-images') {
      queryKeys(url.searchParams,['padCod']);
      const ref=await imageReference(process.env.SFTP_IMAGES_METRICS==='true',()=>repository.imageParcel(imagePadCod(url.searchParams.get('padCod'))));
      return result({images:await images.catalogue(ref)});
    }
    if(images && segments.length===2 && segments[0]==='parcel-image') {
      kindValue(segments[1]);queryKeys(url.searchParams,['padCod','v']);
      if(url.searchParams.has('v')&&!/^[0-9a-f]{16}$/.test(url.searchParams.get('v')??''))throw new HttpError(400,'VALIDATION','Referencia inválida.');
      const ref=await imageReference(process.env.SFTP_IMAGES_METRICS==='true',()=>repository.imageParcel(imagePadCod(url.searchParams.get('padCod'))));
      return images.download(segments[1],ref,request.signal);
    }
    if (segments.join("/") === "search") {
      if (url.searchParams.has("kind")) {
        queryKeys(url.searchParams, ["kind", "q", "personId"]);
        return result(await repository.searchPerson(required(url.searchParams.get("kind"), 10), required(url.searchParams.get("q"), 200),
          url.searchParams.get("personId") ?? undefined));
      }
      queryKeys(url.searchParams, ["locality", "parcel"]);
      return result({ results: await repository.searchParcel(required(url.searchParams.get("locality"), 100), required(url.searchParams.get("parcel"), 20)) });
    }
    if (segments[0] === "parcels" && segments.length === 3) {
      queryKeys(url.searchParams, ["padCod"]);
      const parcel=await repository.getParcel(segments[1], segments[2], url.searchParams.get("padCod") ?? undefined);
      return result(images?{...parcel,images:images.placeholders(parcel.padCod)}:parcel);
    }
    if (segments[0] === "parcel-image")
      throw new HttpError(404, "IMAGE_PROVIDER_DISABLED", "Las imágenes todavía no están conectadas.");
    return null;
  };
}
