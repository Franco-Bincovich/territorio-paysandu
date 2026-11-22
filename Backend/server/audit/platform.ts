import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { AuditEvent } from "../admin/repository";
import type { AdminUser } from "../admin/contracts";
import { currentRequestId } from "../observability";
import { HttpError } from "../security";
import { auditUuid, isSafeObject, type ObjectRef, type Operation } from "./operation";

export type AuditConnection = { query(sql: string, params: unknown[]): Promise<unknown> };
type Actor = { id: string; username: string };
type Result = "success" | "no_change" | "denied" | "invalid" | "error";
type Link = { object?: ObjectRef; version?: number };
type Context = {
  eventId: string; requestId: string; operation: Operation; actor?: Actor; link?: Link;
  administrative?: AuditEvent;
  discardResult?: () => void;
  staged?: boolean; committed?: boolean; uncertain?: boolean; unchanged?: boolean;
};
const scope = new AsyncLocalStorage<Context>();
export const auditUnavailable = () => new HttpError(503, "PLATFORM_AUDIT_UNAVAILABLE", "No se pudo registrar la operación. Intentá nuevamente.");

export function auditActor(actor: Actor) {
  const context = scope.getStore();
  if (context && validActor(actor)) context.actor = actor;
}

function validActor(actor: Actor | undefined): actor is Actor {
  return !!actor && auditUuid.test(actor.id) && typeof actor.username === "string" && actor.username.length > 0 && actor.username.length <= 100;
}

export function auditObject(object: ObjectRef) {
  const context = scope.getStore();
  if (context) context.link = { ...context.link, object };
}

export function auditNoChange() {
  const context = scope.getStore();
  if (context) context.unchanged = true;
}

export function discardUnauditedResult(discard: () => void) {
  const context = scope.getStore();
  if (context) context.discardResult = discard;
}

export function recordAdministrativeAudit(event: AuditEvent) {
  const context = scope.getStore();
  if (!context) return false;
  if (context.operation.module !== "administration" || event.requestId !== context.requestId)
    throw auditUnavailable();
  context.administrative = event;
  return true;
}

export async function writeTransactionalAudit(connection: AuditConnection, link: Link = {}, changed = true, verifiedActor?: Actor) {
  const context = scope.getStore();
  if (!context?.operation.transactional) return;
  if (context.staged || context.committed) throw auditUnavailable();
  if (validActor(verifiedActor)) context.actor = verifiedActor;
  await insert(connection, context, changed ? "success" : "no_change", null, link);
  context.staged = true;
}

export function confirmAuditCommit() {
  const context = scope.getStore();
  if (context?.staged) { context.committed = true; context.staged = false; }
}

export function discardStagedAudit(uncertain = false) {
  const context = scope.getStore();
  if (context?.staged) {
    context.uncertain = uncertain;
    context.staged = false;
  }
}

function auditSnapshot(user: AdminUser) {
  const { id, username, role, enabled, mustChangePassword, revision, deletedAt } = user;
  return { id, username, role, enabled, mustChangePassword, revision, deletedAt };
}

const profileFields = ["firstName", "lastName", "email", "ci"] as const;

export function administrativeSnapshots(event: AuditEvent | undefined) {
  const before = event?.before;
  const after = event?.after;
  const profileFieldsChanged = before && after ? profileFields.filter(field => before[field] !== after[field]) : [];
  const permissionChanges = event?.permissionChanges?.map(({ role, module, before, after }) => ({ role, module, before, after }));
  return {
    before: before ? JSON.stringify(auditSnapshot(before)) : null,
    after: permissionChanges ? JSON.stringify(permissionChanges)
      : after ? JSON.stringify({ ...auditSnapshot(after), profileFieldsChanged }) : null,
  };
}

async function insert(connection: AuditConnection, context: Context, result: Result, error: string | null,
  link: Link = context.link ?? {}) {
  const actor = context.actor;
  const candidate = link.object ?? context.operation.object;
  const object = candidate && isSafeObject(candidate) ? candidate : undefined;
  const admin = context.administrative;
  const hasDetails = result === "success" || result === "no_change";
  const snapshots = administrativeSnapshots(hasDetails ? admin : undefined);
  const targetId = admin?.targetId && auditUuid.test(admin.targetId) ? admin.targetId : null;
  try {
    await connection.query(`INSERT INTO TP_ADMIN_AUDIT_V1
      (EVENT_ID, REQUEST_ID, ACTOR_ID, ACTOR_USERNAME, OCCURRED_AT, MODULE, ACTION, RESULT,
       OBJECT_TYPE, OBJECT_ID, OBJECT_VERSION, ADMIN_ACTION, REASON, TARGET_ID, TARGET_USERNAME,
       BEFORE_JSON, AFTER_JSON, ERROR_CODE)
      VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [context.eventId, context.requestId, validActor(actor) ? actor.id : "unverified", validActor(actor) ? actor.username : null,
      context.operation.module, context.operation.action, result, object?.type ?? null, object?.id ?? null,
      object && typeof link.version === "number" && Number.isSafeInteger(link.version) && link.version >= 0 ? link.version : null,
      admin?.action ?? null, admin?.reason ?? "", targetId, hasDetails && targetId ? admin?.targetUsername ?? null : null,
      snapshots.before, snapshots.after, error]);
  } catch (cause) {
    if (context.uncertain && (cause as { code?: unknown })?.code === "ER_DUP_ENTRY"
      && await ownAuditOnPrimary(connection, context)) return;
    throw auditUnavailable();
  }
}

async function ownAuditOnPrimary(connection: AuditConnection, context: Context) {
  const rows = await connection.query(
    "SELECT EVENT_ID FROM TP_ADMIN_AUDIT_V1 WHERE AUDIT_REQUEST_ID = ?", [context.requestId],
  ) as { EVENT_ID: string }[];
  if (rows.length === 0) return false;
  if (rows.length === 1 && rows[0].EVENT_ID === context.eventId) return true;
  throw auditUnavailable();
}

async function responseCode(response: Response) {
  if (response.ok) return null;
  if (response.headers.get("Content-Type")?.startsWith("application/json")) {
    const body = await response.clone().json().catch(() => null);
    const code = body?.error?.code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(code)) return code;
  }
  return `HTTP_${response.status}`;
}

export async function auditRequest(operation: Operation | undefined, connection: AuditConnection | undefined,
  handle: () => Promise<Response>, errorResponse: (error: HttpError) => Response) {
  const requestId = currentRequestId();
  if (!operation || !connection || !requestId) return handle();
  const context: Context = { eventId: randomUUID(), requestId, operation };
  return scope.run(context, async () => {
    let response;
    try {
      response = await handle();
    } catch (cause) {
      response = errorResponse(cause instanceof HttpError ? cause
        : new HttpError(503, "SERVER_ERROR", "La operación no está disponible temporalmente."));
    }
    if (context.committed) return response;
    if (response.ok && operation.transactional && !context.unchanged) {
      void response.body?.cancel().catch(() => {});
      response = errorResponse(new HttpError(503, "PLATFORM_AUDIT_TRANSACTION_REQUIRED", "No se pudo confirmar el registro de la operación."));
    }
    if (!response.ok) context.discardResult?.();
    const result: Result = response.ok ? context.unchanged ? "no_change" : "success"
      : [401, 403, 405, 429].includes(response.status) ? "denied"
      : response.status < 500 ? "invalid" : "error";
    try {
      if (!context.uncertain || !await ownAuditOnPrimary(connection, context))
        await insert(connection, context, result, await responseCode(response));
      return response;
    } catch {
      if (response.ok) context.discardResult?.();
      void response.body?.cancel().catch(() => {});
      console.error(JSON.stringify({ event: "platform_audit.unavailable", requestId, module: operation.module, action: operation.action }));
      return context.uncertain ? response : errorResponse(auditUnavailable());
    }
  });
}
