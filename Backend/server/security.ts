import { createHash } from "node:crypto";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function checkOrigin(request: Request, appOrigin: string) {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    request.headers.get("origin") !== new URL(appOrigin).origin
  )
    throw new HttpError(403, "ORIGIN", "Solicitud no permitida.");
}
export function accountBucket(username: string) {
  return createHash("sha256")
    .update(username.normalize("NFKC").trim().toLowerCase())
    .digest("hex");
}
export async function jsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new HttpError(415, "CONTENT_TYPE", "Se requiere JSON.");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new HttpError(413, "BODY_LIMIT", "Solicitud demasiado grande.");
      }
      chunks.push(value);
    }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Solicitud inválida.");
  }
}
export function required(value: unknown, max = 254): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new HttpError(400, "VALIDATION", "Revisá los campos obligatorios.");
  return value;
}
