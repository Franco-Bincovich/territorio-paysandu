import { randomUUID } from "node:crypto";

export const routes = {
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
    const result = await operation();
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
