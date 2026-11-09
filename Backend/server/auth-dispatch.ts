import { handle as supabaseHandle } from "./handler";
import { requestedAuthProvider } from "./mariadb/provider";
import { authError } from "./mariadb/http";
import { observeRequest,routeTemplate } from './observability';

let mariaHandler: Promise<ReturnType<typeof import("./mariadb/http").createMariaHttp>> | undefined;
async function localHandler() {
  if (!mariaHandler) {
    mariaHandler = (async () => {
      const [{ createMariaAuth }, { MariaAuthStore }, { createMariaHttp }] = await Promise.all([
        import("./mariadb/auth"), import("./mariadb/store"), import("./mariadb/http"),
      ]);
      const images = process.env.IMAGE_PROVIDER==='sftp' ? new (await import('./sftp-images/provider')).SftpImages() : undefined;
      const institutional = process.env.INSTITUTIONAL_ENABLED === "true"
        ? (await import("./institutional/http")).createInstitutionalHttp(undefined,images) : undefined;
      const consultations = institutional ? await (async () => {
        const [{mariaPool},{institutionalRead},{ConsultationRepository},{ConsultationReads},{institutionalVerifier},{requireCompatibility},{createConsultationHttp}] = await Promise.all([
          import('./mariadb/pool'), import('./institutional/pool'), import('./consultations/repository'), import('./consultations/reads'),
          import('./consultations/verification'), import('./consultations/schema'), import('./consultations/http')]);
        const pool=mariaPool();
        return createConsultationHttp(new ConsultationRepository(pool,institutionalVerifier(institutionalRead)),new ConsultationReads(pool),()=>requireCompatibility(pool));
      })() : undefined;
      return createMariaHttp(await createMariaAuth(new MariaAuthStore()), process.env.APP_ORIGIN ?? "http://127.0.0.1:3000", institutional, consultations);
    })().catch(error => { mariaHandler = undefined; throw error; });
  }
  return mariaHandler;
}
/** Null means continue with the unchanged Supabase route. No automatic fallback. */
export async function mariaResponse(request: Request, segments: string[]): Promise<Response | null> {
  try {
    if (requestedAuthProvider() === "supabase") return null;
    return await (await localHandler())(request, segments);
  } catch (error) { return observeRequest(routeTemplate(segments),async()=>authError(error)); }
}
export async function dispatch(request: Request, segments: string[]) {
  return await mariaResponse(request, segments) ?? supabaseHandle(request, segments);
}
