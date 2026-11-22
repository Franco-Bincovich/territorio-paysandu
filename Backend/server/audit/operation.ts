import { notificationLots } from "../../domain/notification-lots";
import type { RouteTemplate } from "../observability";

export type ObjectRef = { type: "user" | "consultation" | "parcel" | "lot" | "expediente" | "permissions"; id: string };
export type Operation = { module: string; action: string; object?: ObjectRef; transactional?: boolean };
const digits = /^[1-9]\d{0,18}$/;
export const auditUuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export function isSafeObject(reference: ObjectRef) {
  switch (reference.type) {
    case "user": return auditUuid.test(reference.id);
    case "parcel":
    case "consultation": return digits.test(reference.id);
    case "lot": return notificationLots.some(lot => lot.id === reference.id);
    case "permissions": return reference.id === "1";
    case "expediente": return /^(PAYSANDU|PAYSANDU_CHACRAS):[1-9]\d{0,18}:[1-9]\d{0,18}$/.test(reference.id);
  }
}
const moduleByPrefix: Record<string, string> = {
  auth: "auth", session: "session", "module-access": "navigation", search: "search",
  parcels: "parcel", "parcel-images": "images", "parcel-image": "images",
  consultations: "consultations", "notification-lots": "lots", expedientes: "expedientes", admin: "administration",
};

export function auditOperation(request: Request, segments: string[], route: RouteTemplate): Operation | undefined {
  const module = Object.hasOwn(moduleByPrefix, segments[0]) ? moduleByPrefix[segments[0]] : undefined;
  if (!module) return;
  if (route === "unmatched") return { module, action: "unknown_route" };
  const [, id] = segments;
  const query = new URL(request.url).searchParams;
  const padCod = query.get("padCod") ?? "";
  const parcel = digits.test(padCod) ? { type: "parcel" as const, id: padCod } : undefined;
  switch (route) {
    case "/api/auth/login": return { module, action: "login", transactional: request.method === "POST" };
    case "/api/auth/logout": return { module, action: "logout", transactional: request.method === "POST" };
    case "/api/auth/password": return { module, action: "change_password", transactional: request.method === "POST" };
    case "/api/session": return { module, action: "read_session" };
    case "/api/module-access": return { module, action: "read_access" };
    case "/api/search": {
      const kind = query.get("kind");
      const action = query.has("padCod") ? "by_municipal_code" : kind === "name"
        ? query.has("personId") ? "select_person" : "by_name"
        : kind === "ci" ? "by_identity_document" : kind === "rut" ? "by_tax_document"
        : kind === null ? "by_locality_and_parcel" : "search";
      return { module, action, object: parcel };
    }
    case "/api/parcels/{locality}/{parcel}": return { module, action: "read_detail", object: parcel };
    case "/api/parcel-images": return { module, action: "list", object: parcel };
    case "/api/parcel-image/{kind}": return { module, action: "download", object: parcel };
    case "/api/consultations/capabilities": return { module, action: "read_capabilities" };
    case "/api/consultations": return request.method === "POST"
      ? { module, action: "create", transactional: true } : { module, action: "list", object: parcel };
    case "/api/consultations/{id}": return {
      module, action: request.method === "PATCH" ? "edit" : request.method === "DELETE" ? "delete" : "read_detail",
      transactional: request.method === "PATCH", object: digits.test(id) ? { type: "consultation", id } : undefined,
    };
    case "/api/notification-lots": return { module, action: "list" };
    case "/api/notification-lots/{id}":
    case "/api/notification-lots/{id}/export": return {
      module, action: segments[2] ? "export_excel" : "read_detail",
      object: notificationLots.some(lot => lot.id === id) ? { type: "lot", id } : undefined,
    };
    case "/api/parcels/{padCod}/expedientes": return {
      module: "expedientes", action: "list_by_parcel", object: digits.test(id) ? { type: "parcel", id } : undefined,
    };
    case "/api/expedientes": return { module, action: "list" };
    case "/api/expedientes/generar": return { module, action: "generate" };
    case "/api/expedientes/{id}/descarga": return { module, action: "download_word" };
    case "/api/expedientes/{id}/contenido": return { module, action: "view_pdf" };
    case "/api/expedientes/{id}/exportar": return { module, action: "download_pdf" };
    case "/api/admin/audit": return { module, action: "list_audit" };
    case "/api/admin/capabilities": return { module, action: "read_capabilities" };
    case "/api/admin/permissions": return {
      module, action: request.method === "PATCH" ? "update_permissions" : "read_permissions",
      object: { type: "permissions", id: "1" }, transactional: request.method === "PATCH",
    };
    case "/api/admin/users": return request.method === "POST"
      ? { module, action: "create_user", transactional: true } : { module, action: "list_users" };
    case "/api/admin/users/{id}":
    case "/api/admin/users/{id}/reset-password": return {
      module, action: segments[3] ? "reset_password" : request.method === "DELETE" ? "delete_user" : "edit_user",
      transactional: ["POST", "PATCH", "DELETE"].includes(request.method),
      object: auditUuid.test(segments[2]) ? { type: "user", id: segments[2] } : undefined,
    };
  }
}
