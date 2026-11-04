import { identity } from "../../../../server/supabase";
import { createImageDownloadHandler } from "../../../../server/image-download";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const download = createImageDownloadHandler({
  identity,
  enabled: () => process.env.IMAGE_PROVIDER === "supabase",
});
export async function GET(
  _request: Request,
  context: { params: Promise<{ kind: string }> },
) {
  return download((await context.params).kind);
}
