import { DomainError, parseData, parseParcel } from "../domain";
import { applicationCatalogue } from "./prototype-catalogue";
import { imageResponse } from "./images";
import { imageProvider } from "./storage-images";
import { historyFilters, queryKeys } from "./filters";
import { requestLimits, LimitError } from './request-limits';
import {
  observeRequest,
  routeTemplate,
  routes,
  type RequestLogger,
} from "./observability";
import {
  accountBucket,
  checkOrigin,
  HttpError,
  jsonBody,
  required,
} from "./security";
import {
  configuration,
  identity,
  privilegedClient,
  sessionClient,
} from "./supabase";

const response = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function dbError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.code === "42501")
    throw new HttpError(
      403,
      "FORBIDDEN",
      "No tenés permiso para esta operación.",
    );
  if (error.code === "40001" || error.code === "23505")
    throw new HttpError(
      409,
      "CONFLICT",
      "El registro cambió o la solicitud ya se utilizó.",
    );
  if (error.code?.startsWith("22") || error.code === "23514")
    throw new HttpError(400, "VALIDATION", "Revisá los datos ingresados.");
  throw new HttpError(
    503,
    "PERSISTENCE",
    "No pudimos completar la operación. Intentá nuevamente.",
  );
}
function dto(row: Record<string, unknown>) {
  return {
    id: row.id,
    locality: row.locality,
    parcel: row.parcel,
    type: row.type,
    description: row.description,
    person: row.person,
    creatorUserId: row.creator_user_id ?? row.creatorUserId,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
    version: row.version,
  };
}
function payload(body: Record<string, unknown>, editing = false) {
  const allowed = [
    "locality",
    "parcel",
    "person",
    "type",
    "description",
    editing ? "version" : "idempotencyKey",
  ];
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new HttpError(400, "VALIDATION", "Campo no permitido.");
  const data = {
    ...parseParcel({ locality: body.locality, parcel: body.parcel }),
    ...parseData({
      person: body.person,
      type: body.type,
      description: body.description,
    }),
  };
  if (!data.person.phoneTypes)
    throw new HttpError(400, "VALIDATION", "Elegí Fijo o Celular para cada teléfono.");
  return data;
}
export type HandlerDependencies = Readonly<{
  configuration: typeof configuration;
  identity: typeof identity;
  privilegedClient: typeof privilegedClient;
  sessionClient: typeof sessionClient;
  catalogue: typeof applicationCatalogue;
}>;
/** Composition seam for isolated adapter testing; never controlled by a request or environment test flag. */
export function createHandler(dependencies: HandlerDependencies) {
  const adapters = Object.freeze({ ...dependencies });
  return async (request: Request, segments: string[], logger?: RequestLogger) =>
    observeRequest(
      routeTemplate(segments),
      async () => {
        let release=()=>{};
        try {release=await requestLimits().enter(request,segments);return await handleRequest(request, segments, adapters);}
        catch(error){const r=response({error:{code:error instanceof HttpError?error.code:'SECURITY_UNAVAILABLE',message:error instanceof HttpError?error.message:'El servicio no está disponible temporalmente.'}},error instanceof HttpError?error.status:503);if(error instanceof LimitError)r.headers.set('Retry-After',String(error.retryAfter));return r;}
        finally{release();}
      },
      logger,
    );
}
// The route module always imports this production composition with real authentication adapters.
export const handle = createHandler({
  configuration,
  identity,
  privilegedClient,
  sessionClient,
  catalogue: applicationCatalogue,
});
async function handleRequest(
  request: Request,
  segments: string[],
  dependencies: HandlerDependencies,
) {
  const {
    configuration,
    identity,
    privilegedClient,
    sessionClient,
    catalogue,
  } = dependencies;
  try {
    const template = routeTemplate(segments);
    if (template === "unmatched")
      return response(
        { error: { code: "NOT_FOUND", message: "Ruta no encontrada." } },
        404,
      );
    const methods: readonly string[] = routes[template];
    if (!methods.includes(request.method)) {
      const result = response(
        {
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "Método no permitido.",
          },
        },
        405,
      );
      result.headers.set("Allow", methods.join(", "));
      return result;
    }
    const { origin } = configuration();
    checkOrigin(request, origin);
    const path = segments.join("/");
    const url = new URL(request.url);
    if (path === "auth/login" && request.method === "POST") {
      const body = await jsonBody(request);
      if (
        Object.keys(body).some((key) => !["username", "password"].includes(key))
      )
        throw new HttpError(400, "VALIDATION", "Campo no permitido.");
      const username = required(body.username, 100).trim();
      const password = required(body.password, 1024);
      const admin = privilegedClient();
      const { data: allowed, error } = await admin.rpc(
        "consume_login_attempt",
        { p_key: accountBucket(username) },
      );
      if (error)
        throw new HttpError(
          503,
          "AUTH_UNAVAILABLE",
          "El acceso no está disponible temporalmente.",
        );
      if (!allowed)
        throw new HttpError(
          429,
          "RATE_LIMIT",
          "Demasiados intentos. Esperá unos minutos.",
        );
      let mapping: Record<string, string>;
      try {
        mapping = JSON.parse(process.env.AUTH_USERNAME_EMAIL_MAP ?? "{}");
      } catch {
        throw new HttpError(
          503,
          "CONFIGURATION",
          "El acceso aún no está configurado.",
        );
      }
      const email = Object.entries(mapping).find(
        ([name]) => name.toLowerCase() === username.toLowerCase(),
      )?.[1];
      if (!email)
        throw new HttpError(
          401,
          "INVALID_LOGIN",
          "Usuario o contraseña incorrectos.",
        );
      const client = await sessionClient();
      const { error: loginError } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (loginError)
        throw new HttpError(
          401,
          "INVALID_LOGIN",
          "Usuario o contraseña incorrectos.",
        );
      const session = await identity(true);
      return response({
        user: { id: session.user.id, username: session.profile.username },
        mustChangePassword: session.profile.must_change_password,
        synthetic: process.env.DATA_MODE === "synthetic",
      });
    }
    if (path === "auth/logout" && request.method === "POST") {
      const client = await sessionClient();
      const { error } = await client.auth.signOut();
      if (error)
        throw new HttpError(
          503,
          "AUTH_UNAVAILABLE",
          "No se pudo cerrar la sesión.",
        );
      return response({ ok: true });
    }
    if (path === "auth/password" && request.method === "POST") {
      const { client, user } = await identity(true);
      await requestLimits().user(user.id,request,segments);
      const body = await jsonBody(request);
      if (Object.keys(body).some((key) => key !== "password"))
        throw new HttpError(400, "VALIDATION", "Campo no permitido.");
      const password = required(body.password, 1024);
      if (password.length < 12)
        throw new HttpError(
          400,
          "PASSWORD_WEAK",
          "Usá al menos 12 caracteres.",
        );
      const { error } = await client.auth.updateUser({ password });
      if (error)
        throw new HttpError(
          400,
          "PASSWORD_REJECTED",
          "No se pudo actualizar la contraseña. Usá una contraseña nueva y segura.",
        );
      const { error: logoutError } = await client.auth.signOut({
        scope: "global",
      });
      if (logoutError || !user.email)
        throw new HttpError(
          401,
          "REAUTH_REQUIRED",
          "Contraseña actualizada. Iniciá sesión nuevamente.",
        );
      const { data: signedIn, error: loginError } =
        await client.auth.signInWithPassword({ email: user.email, password });
      if (loginError || !signedIn.session)
        throw new HttpError(
          401,
          "REAUTH_REQUIRED",
          "Contraseña actualizada. Iniciá sesión nuevamente.",
        );
      // Only the fresh, server-issued token is used. Neither actor nor session ID comes from the request.
      const token = signedIn.session.access_token;
      const [
        { data: verified, error: verificationError },
        { data: claimsData, error: claimsError },
      ] = await Promise.all([
        client.auth.getUser(token),
        client.auth.getClaims(token),
      ]);
      const sessionId = claimsData?.claims.session_id;
      if (
        verificationError ||
        claimsError ||
        verified.user?.id !== user.id ||
        claimsData?.claims.sub !== user.id ||
        typeof sessionId !== "string" ||
        !uuid.test(sessionId)
      )
        throw new HttpError(
          401,
          "REAUTH_REQUIRED",
          "Contraseña actualizada. Iniciá sesión nuevamente.",
        );
      const { data: finalized, error: finalizationError } =
        await privilegedClient().rpc("finalize_password_change", {
          p_user_id: verified.user.id,
          p_session_id: sessionId,
        });
      if (finalizationError || finalized !== true)
        throw new HttpError(
          503,
          "PASSWORD_FINALIZATION",
          "Contraseña actualizada. No se pudo habilitar el acceso; intentá cambiarla nuevamente.",
        );
      const fresh = await identity();
      return response({
        ok: true,
        user: { id: fresh.user.id, username: fresh.profile.username },
        mustChangePassword: false,
      });
    }
    if (path === "session" && request.method === "GET") {
      const { user, profile } = await identity(true);
      await requestLimits().user(user.id,request,segments);
      return response({
        user: { id: user.id, username: profile.username },
        mustChangePassword: profile.must_change_password,
        synthetic: process.env.DATA_MODE === "synthetic",
      });
    }
    const { client, user: quotaUser } = await identity();
    await requestLimits().user(quotaUser.id,request,segments);
    if (path === "search" && request.method === "GET") {
      queryKeys(
        url.searchParams,
        url.searchParams.has("kind") ? ["kind", "q"] : ["locality", "parcel"],
      );
      const adapter = catalogue(client);
      let records;
      if (url.searchParams.has("kind")) {
        const kind = url.searchParams.get("kind");
        if (!["name", "ci", "rut"].includes(kind ?? ""))
          throw new HttpError(400, "VALIDATION", "Tipo de búsqueda inválido.");
        records = await adapter.findPerson({
          field: kind === "name" ? "name" : kind === "ci" ? "CI" : "RUT",
          exact: required(url.searchParams.get("q"), 200).trim(),
        });
      } else {
        const found = await adapter.findParcel(
          parseParcel({
            locality: url.searchParams.get("locality"),
            parcel: url.searchParams.get("parcel"),
          }),
        );
        records = found ? [found] : [];
      }
      return response({
        results: records.map((r) => ({
          ...r.key,
          address: r.address,
          synthetic: r.source === "synthetic",
        })),
      });
    }
    if (
      segments[0] === "parcels" &&
      segments.length === 3 &&
      request.method === "GET"
    ) {
      const requestedKey = parseParcel({
        locality: segments[1],
        parcel: segments[2],
      });
      const adapter = catalogue(client);
      const parcel = await adapter.findParcel(requestedKey);
      if (!parcel)
        throw new HttpError(404, "NOT_FOUND", "Padrón no encontrado.");
      const key = parcel.key;
      const { data: contacts, error } = await client
        .from("contacts")
        .select("id,person,created_at")
        .eq("locality", key.locality)
        .eq("parcel", key.parcel)
        .order("created_at");
      dbError(error);
      const images = await imageProvider(client, adapter).getImages(key);
      return response({
        ...key,
        address: parcel.address,
        originalLandArea: parcel.originalLandArea,
        originalBuiltArea: parcel.originalBuildingArea,
        detectedBuiltArea: parcel.detectedBuildingArea,
        synthetic: parcel.source === "synthetic",
        fields: parcel.fields,
        provenance: parcel.provenance,
        contacts: (contacts ?? [])
          .map((c) => ({
            id: c.id,
            name: c.person.name,
            relationship: c.person.relationship,
            phones: c.person.phones,
            phoneTypes: c.person.phoneTypes,
            emails: c.person.emails,
          }))
          .sort(
            (a, b) =>
              Number(
                String(b.relationship).trim().toLowerCase() === "titular",
              ) -
              Number(String(a.relationship).trim().toLowerCase() === "titular"),
          ),
        images: imageResponse(images, new Date()),
      });
    }
    if (path === "consultations" && request.method === "POST") {
      const body = await jsonBody(request);
      const data = payload(body);
      const key = required(body.idempotencyKey, 128);
      if (!uuid.test(key))
        throw new HttpError(
          400,
          "VALIDATION",
          "Identificador de solicitud inválido.",
        );
      const parcel = await catalogue(client).findParcel(data);
      if (!parcel)
        throw new HttpError(404, "NOT_FOUND", "Padrón no encontrado.");
      const { data: created, error } = await client.rpc("create_consultation", {
        p_payload: { ...data, ...parcel.key },
        p_idempotency_key: key,
      });
      dbError(error);
      return response(dto(created), 201);
    }
    if (path === "consultations" && request.method === "GET") {
      const { page, pageSize, start, end, filters, from, to } = historyFilters(
        url.searchParams,
      );
      let query = client
        .from("consultations")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .order("id")
        .range(start, end);
      for (const [key, value] of Object.entries(filters))
        query = query.eq(key, value);
      if (from) query = query.gte("created_at", from + "T00:00:00.000Z");
      if (to) {
        const nextDay = new Date(to + "T00:00:00.000Z");
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        query = query.lt("created_at", nextDay.toISOString());
      }
      const { data, error, count } = await query;
      dbError(error);
      return response({
        items: (data ?? []).map(dto),
        total: count ?? 0,
        page,
        pageSize,
      });
    }
    if (
      segments[0] === "consultations" &&
      segments.length === 2 &&
      uuid.test(segments[1])
    ) {
      queryKeys(url.searchParams,[]);
      if (request.method === "GET") {
        const { data, error } = await client
          .from("consultations")
          .select("*")
          .eq("id", segments[1])
          .maybeSingle();
        dbError(error);
        if (!data)
          throw new HttpError(404, "NOT_FOUND", "Consulta no encontrada.");
        return response(dto(data));
      }
      if (request.method === "PATCH") {
        const body = await jsonBody(request);
        const data = payload(body, true);
        if (!Number.isSafeInteger(body.version) || Number(body.version) < 1)
          throw new HttpError(400, "VALIDATION", "Versión inválida.");
        const { data: updated, error } = await client.rpc("edit_consultation", {
          p_id: segments[1],
          p_expected_version: body.version,
          p_payload: data,
        });
        dbError(error);
        return response(dto(updated));
      }
    }
    return response(
      { error: { code: "NOT_FOUND", message: "Ruta no encontrada." } },
      404,
    );
  } catch (error) {
    if (error instanceof HttpError) {
      const rejected=response(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
      if(error instanceof LimitError)rejected.headers.set('Retry-After',String(error.retryAfter));
      return rejected;
    }
    if (error instanceof DomainError)
      return response(
        {
          error: { code: error.code, message: "Revisá los datos ingresados." },
        },
        400,
      );
    return response(
      {
        error: {
          code: "INTERNAL",
          message: "No pudimos completar la solicitud.",
        },
      },
      500,
    );
  }
}
