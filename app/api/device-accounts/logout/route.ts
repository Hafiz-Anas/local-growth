import { z } from "zod";
import { signOut } from "@/auth";
import { getSession } from "@/lib/auth/server";
import { logOutOfDevice } from "@/lib/server/device-logins";
import { assertRenderedAccount } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";

const logoutSchema = z.object({ all: z.boolean().optional() }).strict();

/**
 * POST /api/device-accounts/logout  { all? } — "Log out of @handle" (switches to another login remembered
 * here when there is one) or "Log out of all accounts". Answers where to go next.
 */
export const POST = handler(async (request) => {
  const session = await getSession();
  // A tab still showing the previous login must not log out the one switched to since.
  if (session) await assertRenderedAccount(session);
  const { all } = await readJson(request, logoutSchema);
  if (session && session.role !== "user") {
    // Not a client login: nothing of this device's remembered logins is touched.
    await signOut({ redirect: false });
    return ok({ to: "/login" });
  }
  return ok(await logOutOfDevice(session, Boolean(all)));
});
