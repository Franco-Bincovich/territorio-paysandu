import { handle } from "../../../server/handler";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ path: string[] }> };
async function route(request: Request, context: Context) {
  return handle(request, (await context.params).path);
}
export const GET = route;
export const POST = route;
export const PATCH = route;

export const PUT = route;
export const DELETE = route;
export const OPTIONS = route;
export const HEAD = route;
