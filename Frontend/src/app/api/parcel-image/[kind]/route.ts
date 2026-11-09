import { identity } from "@backend/server/supabase";
import { mariaResponse } from "@backend/server/auth-dispatch";
import { createImageDownloadHandler } from "@backend/server/image-download";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const download = createImageDownloadHandler({
  identity,
  enabled: () => process.env.IMAGE_PROVIDER === "supabase",
});
export async function GET(
  request: Request,
  context: { params: Promise<{ kind: string }> },
) {
  const kind = (await context.params).kind;
  return await mariaResponse(request, ["parcel-image", kind]) ?? download(kind,request);
}
