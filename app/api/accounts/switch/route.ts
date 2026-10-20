import { z } from "zod";
import { updateSession } from "@/auth";
import { LOGIN_HAS_SEVERAL_ACCOUNTS } from "@/config/accounts";
import { switchAccount } from "@/lib/server/accounts";
import { requireRole } from "@/lib/server/guards";
import { handler, notFound, ok, readJson } from "@/lib/server/http";

const switchSchema = z.object({ accountId: z.string().min(1).max(64) }).strict();

/**
 * POST /api/accounts/switch  { accountId } — make another of the user's Instagram accounts active.
 * Accounts the user doesn't belong to are 404. Answers where to land (Home, or the setup of an
 * unfinished account); the browser then loads that page fresh so nothing of the old account stays.
 */
export const POST = handler(async (request) => {
  if (!LOGIN_HAS_SEVERAL_ACCOUNTS) throw notFound();
  const session = await requireRole("USER");
  const { accountId } = await readJson(request, switchSchema);
  const result = await switchAccount(session.userId, accountId);
  // Re-issue the session cookie now (every request would also pick the change up from the database).
  await updateSession({}).catch(() => undefined);
  return ok(result);
});
