import { z } from "zod";
import { ApiError, handler, ok, readJson } from "@/lib/server/http";
import { cancelSignupChoice, pickSignupAccount, signupChoices } from "@/lib/server/signup";

/**
 * Sign-up found several Instagram accounts on one Facebook login (lib/server/signup.ts). No one is signed
 * in yet: the browser's own pending sign-up cookie is the only key, and tokens never leave the server.
 */

/** GET /api/signup/pending — the accounts to pick from (no tokens). */
export const GET = handler(async () => {
  const options = await signupChoices();
  if (!options) throw new ApiError(404, "not_found", "This choice has expired. Continue with Instagram again.");
  return ok(options);
});

const pickSchema = z.object({ pageId: z.string().min(1).max(64).regex(/^\d+$/) });

/** POST /api/signup/pending  { pageId } — create the account with the picked Instagram account; answers where to go next. */
export const POST = handler(async (request) => {
  const { pageId } = await readJson(request, pickSchema);
  const { outcome, redirectTo } = await pickSignupAccount(pageId);
  return ok({ outcome, username: null, redirectTo });
});

/** DELETE /api/signup/pending — the picker was closed: nothing is created. */
export const DELETE = handler(async () => {
  await cancelSignupChoice();
  return ok({ cancelled: true });
});
