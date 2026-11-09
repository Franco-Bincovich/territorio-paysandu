import { queryKeys } from "../filters";
import { HttpError, required } from "../security";
import { InstitutionalRepository } from "./repository";

/** Invoked only AFTER the existing MariaDB session/role/password guard succeeds. */
export function createInstitutionalHttp(repository = new InstitutionalRepository()) {
  return async (request: Request, segments: string[]): Promise<Response | null> => {
    const url = new URL(request.url);
    const result = (body: unknown) => Response.json(body, { headers: {
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
    if (request.method !== "GET")
      throw new HttpError(403, "WRITES_DISABLED", "El guardado de consultas todavía no está habilitado.");
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
      return result(await repository.getParcel(segments[1], segments[2], url.searchParams.get("padCod") ?? undefined));
    }
    if (segments[0] === "parcel-image")
      throw new HttpError(404, "IMAGE_PROVIDER_DISABLED", "Las imágenes todavía no están conectadas.");
    return null;
  };
}
