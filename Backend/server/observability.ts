import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

const requestContext = new AsyncLocalStorage<string>();
export const currentRequestId = () => requestContext.getStore();

export const routes = {
  "/api/notification-lots": ["GET"],
  "/api/notification-lots/{id}": ["GET"],
  "/api/notification-lots/{id}/export": ["GET"],
  "/api/expedientes": ["GET"],
  "/api/admin/capabilities": ["GET"],
  "/api/admin/audit": ["GET"],
  "/api/expedientes/generar": ["POST"],
  "/api/expedientes/{id}/exportar": ["GET"],
  "/api/admin/users": ["GET", "POST"],
  "/api/admin/users/{id}": ["PATCH", "DELETE"],
  "/api/admin/users/{id}/reset-password": ["POST"],
  "/api/parcels/{padCod}/expedientes": ["GET"],
  "/api/expedientes/{id}/contenido": ["GET"],
  "/api/expedientes/{id}/descarga": ["GET"],
  "/api/auth/login": ["POST"],
  "/api/auth/logout": ["POST"],
  "/api/auth/password": ["POST"],
  "/api/session": ["GET"],
  "/api/search": ["GET"],
  "/api/parcel-images": ["GET"],
  "/api/parcel-image/{kind}": ["GET"],
  "/api/parcels/{locality}/{parcel}": ["GET"],
  "/api/consultations": ["GET", "POST"],
  "/api/consultations/{id}": ["GET", "PATCH"],
} as const;
export type RouteTemplate = keyof typeof routes | "unmatched";
export type RequestEvent = Readonly<{
  event: "http.request.completed";
  requestId: string;
  route: RouteTemplate;
  status: number;
  durationMs: number;
}>;
export type RequestLogger = (event: RequestEvent) => void;
export function routeTemplate(segments: readonly string[]): RouteTemplate {
  const staticPath = `/api/${segments.join("/")}`;
  if (Object.hasOwn(routes, staticPath))
    return staticPath as keyof typeof routes;
  if (segments[0] === "notification-lots") {
    if (segments.length === 2) return "/api/notification-lots/{id}";
    if (segments.length === 3 && segments[2] === "export") return "/api/notification-lots/{id}/export";
  }
  if (segments[0] === "admin" && segments[1] === "users") {
    if (segments.length === 3) return "/api/admin/users/{id}";
    if (segments.length === 4 && segments[3] === "reset-password") return "/api/admin/users/{id}/reset-password";
  }
  if (segments.length === 3 && segments[0] === "parcels" && segments[2] === "expedientes")
    return "/api/parcels/{padCod}/expedientes";
  if (segments.length === 3 && segments[0] === "expedientes") {
    if (segments[2] === "contenido") return "/api/expedientes/{id}/contenido";
    if (segments[2] === "exportar") return "/api/expedientes/{id}/exportar";
    if (segments[2] === "descarga") return "/api/expedientes/{id}/descarga";
  }
  if (segments.length === 3 && segments[0] === "parcels")
    return "/api/parcels/{locality}/{parcel}";
  if (segments.length === 2 && segments[0] === "consultations")
    return "/api/consultations/{id}";
  if (segments.length === 2 && segments[0] === "parcel-image")
    return "/api/parcel-image/{kind}";
  return "unmatched";
}
export const structuredLogger: RequestLogger = (event) => {
  // Reconstruct the allowlist rather than serializing arbitrary caller properties.
  console.info(
    JSON.stringify({
      event: event.event,
      requestId: event.requestId,
      route: event.route,
      status: event.status,
      durationMs: event.durationMs,
    }),
  );
};
export async function observeRequest(
  route: RouteTemplate,
  operation: () => Promise<Response>,
  logger: RequestLogger = structuredLogger,
): Promise<Response> {
  const requestId = randomUUID(); // Never copy an untrusted inbound correlation header.
  const start = performance.now();
  let status = 500;
  try {
    const result = await requestContext.run(requestId, operation);
    status = result.status;
    result.headers.set("X-Request-ID", requestId);
    return result;
  } finally {
    const event = Object.freeze({
      event: "http.request.completed" as const,
      requestId,
      route,
      status,
      durationMs: Math.max(
        0,
        Math.round((performance.now() - start) * 100) / 100,
      ),
    });
    try {
      logger(event);
    } catch {
      /* Telemetry failure cannot expose errors or break the request. */
    }
  }
}
