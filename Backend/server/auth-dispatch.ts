import { handle as supabaseHandle } from "./handler";
import { requestedAuthProvider } from "./mariadb/provider";
import { authError, observeMariaHttp } from "./mariadb/http";
import { observeRequest,routeTemplate } from './observability';
import { configuredNotificationLots } from "./notification-lots/http";
import { HttpError } from "./security";
import { configuredModuleAccess } from "./admin/module-access-repository";
import { mariaPool } from "./mariadb/pool";
import { requireAdminSchema } from "./admin/schema";
import { auditUnavailable } from "./audit/platform";

// Activate only after the expanded schema and all administrative readers are installed.
let auditSchemaReady = false;
const audit = process.env.PLATFORM_AUDIT_ENABLED === "true" ? {
  query: (sql: string, params: unknown[]) => {
    if (!auditSchemaReady) throw auditUnavailable();
    return mariaPool().query(sql, params);
  },
} : undefined;

let mariaHandler: Promise<ReturnType<typeof import("./mariadb/http").createMariaHttp>> | undefined;
async function localHandler() {
  if (!mariaHandler) {
    mariaHandler = (async () => {
      if (audit && !auditSchemaReady) {
        const connection = await mariaPool().getConnection();
        try {
          if (!await requireAdminSchema(connection)) throw auditUnavailable();
          auditSchemaReady = true;
        } finally { await connection.release(); }
      }
      const [{ createMariaAuth }, { MariaAuthStore }, { createMariaHttp }] = await Promise.all([
        import("./mariadb/auth"), import("./mariadb/store"), import("./mariadb/http"),
      ]);
      const images = (await import('./image-provider')).configuredInstitutionalImages();
      const institutional = process.env.INSTITUTIONAL_ENABLED === "true"
        ? (await import("./institutional/http")).createInstitutionalHttp(undefined,images) : undefined;
      const consultations = institutional ? await (async () => {
        const [{mariaPool},{institutionalRead},{ConsultationRepository},{ConsultationReads},{institutionalVerifier},{requireCompatibility},{createConsultationHttp}] = await Promise.all([
          import('./mariadb/pool'), import('./institutional/pool'), import('./consultations/repository'), import('./consultations/reads'),
          import('./consultations/verification'), import('./consultations/schema'), import('./consultations/http')]);
        const pool=mariaPool();
        return createConsultationHttp(new ConsultationRepository(pool,institutionalVerifier(institutionalRead)),new ConsultationReads(pool),()=>requireCompatibility(pool));
      })() : undefined;
      const [{ configuredAdminHttp }, { configuredExpedientesHttp }] = await Promise.all([
        import("./admin/http"), import("./expedientes/http"),
      ]);
      return createMariaHttp(await createMariaAuth(new MariaAuthStore()), process.env.APP_ORIGIN ?? "http://127.0.0.1:3000",
        institutional, consultations, undefined, configuredNotificationLots(), configuredAdminHttp(), configuredExpedientesHttp(), configuredModuleAccess(), audit);
    })().catch(error => { mariaHandler = undefined; throw error; });
  }
  return mariaHandler;
}
/** Null means continue with the unchanged Supabase route. No automatic fallback. */
export async function mariaResponse(request: Request, segments: string[]): Promise<Response | null> {
  try {
    if (requestedAuthProvider() === "supabase") return null;
    return await (await localHandler())(request, segments);
  } catch (error) { return observeMariaHttp(request, segments, audit, async()=>authError(error)); }
}
export async function dispatch(request: Request, segments: string[]) {
  const maria = await mariaResponse(request, segments);
  if (maria) return maria;
  if (segments[0] === "admin" || segments[0] === "expedientes" ||
    segments.length === 3 && segments[0] === "parcels" && segments[2] === "expedientes") {
    return observeRequest(routeTemplate(segments), async () => authError(
      new HttpError(403, "FORBIDDEN", "Esta funcionalidad requiere el proveedor institucional habilitado.")));
  }
  return supabaseHandle(request, segments);
}
