import { notificationLots, type NotificationLotCapabilities } from "../../domain/notification-lots";
import { queryKeys } from "../filters";
import { HttpError } from "../security";
import { excelRowLimit, NotificationLotRepository, notificationLotPageSize } from "./repository";
import { notificationLotWorkbook } from "./xlsx";
import { productionMariaEnabled } from "../mariadb/provider";

type NotificationLotPolicy = {
  canConsult(role: string): boolean;
  canDownload(role: string): boolean;
};
const noStore = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

function pageNumber(value: string | null) {
  if (value === null) return 1;
  const page = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(page) || page > Math.floor(2147483647 / notificationLotPageSize)) {
    throw new HttpError(400, "VALIDATION", "Página inválida.");
  }
  return page;
}

export function createNotificationLotsHttp(policy: NotificationLotPolicy, repository = new NotificationLotRepository()) {
  function capabilities(role: string): NotificationLotCapabilities {
    return { consult: policy.canConsult(role), download: policy.canDownload(role) };
  }

  async function handle(request: Request, segments: string[], role: string): Promise<Response> {
    const exportRequest = segments.length === 3 && segments[2] === "export";
    const granted = capabilities(role);
    if (!(exportRequest ? granted.download : granted.consult)) {
      throw new HttpError(403, "NOTIFICATION_LOTS_FORBIDDEN", "Acceso a lotes no habilitado.");
    }
    const query = new URL(request.url).searchParams;
    queryKeys(query, segments.length === 2 ? ["page"] : []);
    if (segments.length === 1) {
      return Response.json({ lots: await repository.list() }, { headers: noStore });
    }

    const lot = notificationLots.find(entry => entry.id === segments[1]);
    if (!lot) throw new HttpError(404, "NOT_FOUND", "Lote no encontrado.");
    if (!exportRequest) {
      return Response.json(await repository.detail(lot.id, pageNumber(query.get("page"))), { headers: noStore });
    }

    const workbook = await repository.exportRows(lot.id);
    if (workbook.rows.length >= excelRowLimit) {
      throw new HttpError(422, "NOTIFICATION_LOT_EXPORT_TOO_LARGE", "El lote supera el máximo de filas de Excel.");
    }
    return new Response(new Uint8Array(notificationLotWorkbook(lot, workbook)), {
      headers: {
        ...noStore,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="lote-${lot.label.slice(-1)}-${lot.id}.xlsx"`,
      },
    });
  }

  return { capabilities, handle };
}

export type NotificationLotsHttp = ReturnType<typeof createNotificationLotsHttp>;

/** The synthetic fixture retains its own loopback-only policy. */
export function configuredLocalNotificationLots(env: NodeJS.ProcessEnv = process.env) {
  if (env.NOTIFICATION_LOTS_LOCAL_QA !== "true" ||
    (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") ||
    env.AUTH_PROVIDER !== "mariadb-test" || env.MARIADB_AUTH_TEST_ENABLED !== "true" ||
    env.INSTITUTIONAL_ENABLED !== "true" || env.INSTITUTIONAL_DATABASE !== "TRABAJO_DATOS" ||
    !["127.0.0.1", "localhost", "::1"].includes(env.INSTITUTIONAL_HOST ?? "")) return undefined;

  return createNotificationLotsHttp({
    canConsult: role => role === "collaborator" || role === "administrator",
    canDownload: role => role === "collaborator" || role === "administrator",
  });
}

export function configuredNotificationLots(env: NodeJS.ProcessEnv = process.env) {
  const production = productionMariaEnabled(env);
  if (production) {
    if (env.NOTIFICATION_LOTS_ENABLED !== "true") return undefined;
  } else if (env.NOTIFICATION_LOTS_LOCAL_INSTITUTIONAL === "true") {
    if (env.NODE_ENV !== "development" || env.AUTH_PROVIDER !== "mariadb-test" ||
      env.MARIADB_AUTH_TEST_ENABLED !== "true" || env.APP_ORIGIN !== "http://127.0.0.1:3105" ||
      env.MARIADB_TLS === "false" || env.INSTITUTIONAL_TLS === "false" ||
      env.NODE_TLS_REJECT_UNAUTHORIZED === "0") return undefined;
  } else {
    return configuredLocalNotificationLots(env);
  }
  if (env.INSTITUTIONAL_ENABLED !== "true" || env.INSTITUTIONAL_DATABASE !== "TRABAJO_DATOS") return undefined;
  return createNotificationLotsHttp({
    canConsult: role => role === "administrator",
    canDownload: role => role === "administrator",
  });
}
