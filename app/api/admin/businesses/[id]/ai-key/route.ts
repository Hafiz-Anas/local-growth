import { db } from "@/lib/db";
import { requireRole } from "@/lib/server/guards";
import { handler, notFound, ok, readJson, readParams } from "@/lib/server/http";
import { keyView, removeKey, saveKey } from "@/lib/server/ai-key-routes";
import { aiKeyBodySchema } from "@/lib/validation/api";

async function scopeFor(context: RouteContext<"/api/admin/businesses/[id]/ai-key">) {
  const { id } = await readParams(context, "id");
  if (!(await db.business.count({ where: { id } }))) throw notFound("Business");
  return { kind: "business", businessId: id } as const;
}

/** GET /api/admin/businesses/:id/ai-key — this client's own AI key (last 4 only) and which key its AI calls use. */
export const GET = handler(async (_request, context: RouteContext<"/api/admin/businesses/[id]/ai-key">) => {
  await requireRole("ADMIN");
  return ok(await keyView(await scopeFor(context)));
});

/** PUT { apiKey } — a key that overrides the platform key for this client only. */
export const PUT = handler(async (request, context: RouteContext<"/api/admin/businesses/[id]/ai-key">) => {
  const session = await requireRole("ADMIN");
  const scope = await scopeFor(context);
  const { apiKey } = await readJson(request, aiKeyBodySchema);
  return ok(await saveKey(scope, apiKey, session.userId));
});

/** DELETE — back to the platform key. */
export const DELETE = handler(async (_request, context: RouteContext<"/api/admin/businesses/[id]/ai-key">) => {
  const session = await requireRole("ADMIN");
  return ok(await removeKey(await scopeFor(context), session.userId));
});
