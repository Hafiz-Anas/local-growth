import { requireRole } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { keyView, removeKey, saveKey } from "@/lib/server/ai-key-routes";
import { aiKeyBodySchema } from "@/lib/validation/api";

const scope = { kind: "platform" } as const;

/** GET /api/admin/ai-settings — the platform AI key's status (last 4 characters only) and where AI calls get their key. */
export const GET = handler(async () => {
  await requireRole("ADMIN");
  return ok(await keyView(scope));
});

/** PUT /api/admin/ai-settings  { apiKey } — set or replace the platform Gemini key. */
export const PUT = handler(async (request) => {
  const session = await requireRole("ADMIN");
  const { apiKey } = await readJson(request, aiKeyBodySchema);
  return ok(await saveKey(scope, apiKey, session.userId));
});

/** DELETE /api/admin/ai-settings — remove it; AI calls fall back to GEMINI_API_KEY from the environment. */
export const DELETE = handler(async () => {
  const session = await requireRole("ADMIN");
  return ok(await removeKey(scope, session.userId));
});
