import { checkOrigin, HttpError, jsonBody, required } from "../security";
import { createMariaAuth, sessionCookie } from "./auth";
import { routes, routeTemplate, observeRequest } from "../observability";
import { requestLimits, LimitError, type RequestLimits } from '../request-limits';

type MariaAuth = Awaited<ReturnType<typeof createMariaAuth>>;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export function authError(error: unknown) {
  const known = error instanceof HttpError;
  return Response.json({ error: { code: known ? error.code : "AUTH_UNAVAILABLE",
    message: known ? error.message : "El acceso no está disponible temporalmente." } },
  { status: known ? error.status : 503, headers: {...headers,...(error instanceof LimitError?{'Retry-After':String(error.retryAfter)}:{})} });
}
function tokenFrom(request: Request) {
  const parts = (request.headers.get("cookie") ?? "").split(";")
    .map(s => s.trim()).filter(s => s.startsWith("tp_maria_session="));
  if (parts.length !== 1) return undefined;
  return parts[0].slice("tp_maria_session=".length);
}
export function createMariaHttp(auth: MariaAuth, origin: string,
  institutional?: (request: Request, segments: string[]) => Promise<Response | null>,
  consultations?: (request: Request, segments: string[], actor: import('../consultations/model').Actor) => Promise<Response | null>,
  limits:RequestLimits=requestLimits()) {
  return async (request: Request, segments: string[]) => observeRequest(routeTemplate(segments),async()=>{
    let release=()=>{};
    try {
      // Next dev canonicalizes request.url to localhost. Validate the actual Host
      // against the fixed configured origin; never trust forwarded-host headers.
      const requestUrl = new URL(request.url);
      const expectedOrigin = new URL(origin);
      if ((request.headers.get("host") ?? requestUrl.host) !== expectedOrigin.host ||
        requestUrl.protocol !== expectedOrigin.protocol)
        throw new HttpError(403, "ORIGIN", "Solicitud no permitida.");
      checkOrigin(request, origin);
      const path = segments.join("/");
      const template = routeTemplate(segments);
      const image = segments.length === 2 && segments[0] === "parcel-image";
      if (template === "unmatched" && !image)
        throw new HttpError(404, "NOT_FOUND", "Ruta no encontrada.");
      const methods: readonly string[] = image ? ["GET"] : routes[template as keyof typeof routes];
      if (!methods.includes(request.method))
        return Response.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Método no permitido." } },
          { status: 405, headers: { ...headers, Allow: methods.join(", ") } });
      const token = tokenFrom(request);
      release=await limits.enter(request,segments);
      const result = (body: unknown, cookie?: string) => Response.json(body,
        { headers: { ...headers, ...(cookie ? { "Set-Cookie": cookie } : {}) } });
      if (path === "auth/login") {
        const body = await jsonBody(request);
        if (Object.keys(body).some(k => !["username", "password"].includes(k)))
          throw new HttpError(400, "VALIDATION", "Campo no permitido.");
        const login = await auth.login(required(body.username, 100), required(body.password, 1024));
        // Replace prior browser session only after successful authentication.
        await auth.logout(token);
        return result({ user: login.user, mustChangePassword: login.mustChangePassword, synthetic: true },
          sessionCookie(login.token, origin, login.expiresAt));
      }
      if (path === "auth/logout") {
        await auth.logout(token);
        return result({ ok: true }, sessionCookie("", origin, 0));
      }
      if (path === "auth/password") {
        const changing=await auth.identify(token,true);
        await limits.user(changing.id,request,segments);
        const body = await jsonBody(request);
        if (Object.keys(body).some(k => k !== "password"))
          throw new HttpError(400, "VALIDATION", "Campo no permitido.");
        await auth.changePassword(token ?? "", required(body.password, 1024));
        return result({ ok: true, requiresLogin: true }, sessionCookie("", origin, 0));
      }
      const user = await auth.identify(token, path === "session");
      await limits.user(user.id,request,segments);
      const identity = { id: user.id, username: user.username, role: user.role, provider: "mariadb" };
      if (path === "session") return result({ user: identity, mustChangePassword: user.mustChangePassword, synthetic: !institutional, institutional: !!institutional });
      if (consultations) {
        const response = await consultations(request, segments, { verified: true, userId: user.id,
          role: 'collaborator', enabled: user.enabled, mustChangePassword: user.mustChangePassword, expiresAt: user.sessionExpiresAt });
        if (response) return response;
      }
      if (institutional) {
        const read = await institutional(request, segments);
        if (read) return read;
      }
      // The MariaDB identity is retained for future data adapters; never grant a
      // Supabase client/service key to it or fall back to old Supabase cookies.
      throw new HttpError(503, "MARIADB_DATA_PENDING", "Sesión MariaDB válida. El acceso a datos todavía no está integrado.");
    } catch (error) { return authError(error); } finally {release();}
  });
}
