import { checkOrigin, HttpError, jsonBody, required } from "../security";
import { createMariaAuth, sessionCookie } from "./auth";
import { routes, routeTemplate, observeRequest } from "../observability";
import { requestLimits, LimitError, type RequestLimits } from '../request-limits';
import { ImageAdmissionError } from '../image-admission';
import { admittedImageResponse } from '../image-response';
import type { NotificationLotsHttp } from "../notification-lots/http";
import { requireCapability, type Principal } from "../authorization";
import type { AdminHandler } from "../admin/http";
import type { ExpedientesHandler } from "../expedientes/http";
import { defaultModuleAccess, type AccessSettings, type Module } from "../../../shared/module-access";
import { isRole } from "../../../shared/permissions";
import { auditActor, auditRequest, type AuditConnection } from "../audit/platform";
import { auditOperation } from "../audit/operation";

type MariaAuth = Awaited<ReturnType<typeof createMariaAuth>>;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export function authError(error: unknown) {
  const known = error instanceof HttpError;
  return Response.json({ error: { code: known ? error.code : "AUTH_UNAVAILABLE",
    message: known ? error.message : "El acceso no está disponible temporalmente." } },
  { status: known ? error.status : 503, headers: {...headers,...(error instanceof LimitError||error instanceof ImageAdmissionError?{'Retry-After':String(error.retryAfter)}:{})} });
}
function tokenFrom(request: Request) {
  const parts = (request.headers.get("cookie") ?? "").split(";")
    .map(s => s.trim()).filter(s => s.startsWith("tp_maria_session="));
  if (parts.length !== 1) return undefined;
  return parts[0].slice("tp_maria_session=".length);
}

function routeModule(template: string): Module | undefined {
  if (template.startsWith("/api/consultations")) return "history";
  if (template.startsWith("/api/notification-lots")) return "notificationLots";
  if (template.startsWith("/api/expedientes") || template === "/api/parcels/{padCod}/expedientes") return "expedientes";
  if (["/api/search", "/api/parcels/{locality}/{parcel}", "/api/parcel-images", "/api/parcel-image/{kind}"].includes(template))
    return "search";
}

export function createMariaHttp(auth: MariaAuth, origin: string,
  institutional?: (request: Request, segments: string[]) => Promise<Response | null>,
  consultations?: (request: Request, segments: string[], actor: import('../consultations/model').Actor) => Promise<Response | null>,
  limits:RequestLimits=requestLimits(),
  notificationLots?: NotificationLotsHttp,
  administration?: AdminHandler,
  expedientes?: ExpedientesHandler,
  readAccess?: () => Promise<AccessSettings>,
  audit?: AuditConnection) {
  return async (request: Request, segments: string[]) => observeMariaHttp(request, segments, audit, async()=>{
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
        const login = await auth.login(required(body.username, 100), required(body.password, 1024), token);
        return result({ user: login.user, mustChangePassword: login.mustChangePassword, synthetic: true },
          sessionCookie(login.token, origin, login.expiresAt));
      }
      if (path === "auth/logout") {
        await auth.logout(token);
        return result({ ok: true }, sessionCookie("", origin, 0));
      }
      if (path === "auth/password") {
        const changing=await auth.identify(token,true);
        auditActor(changing);
        await limits.user(changing.id,request,segments);
        const body = await jsonBody(request);
        if (Object.keys(body).some(k => !["currentPassword", "password", "confirmPassword"].includes(k)))
          throw new HttpError(400, "VALIDATION", "Campo no permitido.");
        await auth.changePassword(token ?? "", required(body.currentPassword, 1024),
          required(body.password, 1024), required(body.confirmPassword, 1024));
        return result({ ok: true, requiresLogin: true }, sessionCookie("", origin, 0));
      }
      const user = await auth.identify(token, path === "session", path !== "module-access");
      auditActor(user);
      await limits.user(user.id,request,segments);
      const identity = { id: user.id, username: user.username, role: user.role, provider: "mariadb" };
      const module = routeModule(template);
      if (module || path === "session" || path === "module-access") {
        const saved = !user.mustChangePassword && isRole(user.role) && readAccess ? (await readAccess()).matrix[user.role] : undefined;
        const access = { ...(saved ?? defaultModuleAccess(user.role)) };
        access.notificationLots = access.notificationLots && !!notificationLots;
        if (path === "module-access") return result({ access });
        if (path === "session") return result({
          user: identity, mustChangePassword: user.mustChangePassword, synthetic: !institutional, institutional: !!institutional,
          ...(!user.mustChangePassword && { access }),
          ...(notificationLots && !user.mustChangePassword && {
            notificationLots: { consult: access.notificationLots, download: access.notificationLots && notificationLots.capabilities(user.role).download },
          }),
        });
        if (module && !access[module])
          throw new HttpError(403, "MODULE_ACCESS_FORBIDDEN", "No tenés permiso para acceder a esta solapa.");
      }
      if (segments[0] === "notification-lots") {
        if (!notificationLots) throw new HttpError(403, "NOTIFICATION_LOTS_FORBIDDEN", "Acceso a lotes no habilitado.");
        return await notificationLots.handle(request, segments, user.role, true);
      }
      const actor: Principal = { verified: true, userId: user.id, role: user.role, enabled: user.enabled,
        mustChangePassword: user.mustChangePassword, expiresAt: user.sessionExpiresAt, sessionHash: user.sessionHash };
      if (segments[0] === "admin") {
        try { requireCapability(actor, segments[1] === "audit" ? "audit.read" : "users.manage"); }
        catch (error) { await administration?.denied?.(request, segments, actor, error); throw error; }
      }
      if (segments[0] === "expedientes") {
        if (path === "expedientes/generar") requireCapability(actor, "expedientes.generate");
        if (segments[2] === "descarga") requireCapability(actor, "expedientes.download");
        if (segments[2] === "exportar" || segments[2] === "contenido") requireCapability(actor, "expedientes.export");
      }
      const administrative = await administration?.(request, segments, actor);
      if (administrative) return administrative;
      const documents = await expedientes?.(request, segments, actor, module === "expedientes");
      if (documents) return documents;
      if (consultations) {
        const response = await consultations(request, segments, actor);
        if (response) return response;
      }
      if (institutional) {
        const read = await institutional(request, segments);
        if (read) {
          if (image && process.env.IMAGE_PROVIDER==='filesystem' && read.status===200) {
            const completed=release;release=()=>{};
            return admittedImageResponse(read,completed,request.signal);
          }
          return read;
        }
      }
      // The MariaDB identity is retained for future data adapters; never grant a
      // Supabase client/service key to it or fall back to old Supabase cookies.
      throw new HttpError(503, "MARIADB_DATA_PENDING", "Sesión MariaDB válida. El acceso a datos todavía no está integrado.");
    } catch (error) { return authError(error); } finally {release();}
  });
}

export function observeMariaHttp(request: Request, segments: string[], audit: AuditConnection | undefined, run: () => Promise<Response>) {
  const route = routeTemplate(segments);
  return observeRequest(route, () => auditRequest(auditOperation(request, segments, route), audit, run, authError));
}
