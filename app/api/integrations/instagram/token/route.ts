import { cookies } from "next/headers";
import { z } from "zod";
import { requireBusiness } from "@/lib/server/guards";
import { handler, ok, readJson } from "@/lib/server/http";
import { finishWithToken, OAUTH_COOKIE, OAUTH_COOKIE_PATH, recordCancelled, recordStateFailure, returnUrl, verifyState } from "@/lib/server/meta-connect";
import { connectContext } from "@/lib/server/meta-session";
import { finishInstagramSignup } from "@/lib/server/signup";
import { isSignupState } from "@/lib/signup-flow";

const bodySchema = z.object({
  state: z.string().max(200).nullable(),
  accessToken: z.string().max(4096).nullable(),
  longLivedToken: z.string().max(4096).nullable(),
  error: z.string().max(200).nullable(),
});

/**
 * POST /api/integrations/instagram/token — token mode only: the callback page
 * posts the fragment here once. The state cookie is checked and burned; the
 * token is validated with /debug_token (it must belong to our app) before use.
 * Answers where to send the browser next.
 */
export const POST = handler(async (request) => {
  const body = await readJson(request, bodySchema);
  // A sign-up waiting for Instagram: no one is signed in yet (lib/server/signup.ts).
  if (isSignupState(body.state)) {
    const token = body.accessToken ? { accessToken: body.accessToken, longLivedToken: body.longLivedToken } : null;
    return ok({ redirectTo: await finishInstagramSignup({ state: body.state, token, error: body.error ?? (token ? null : "missing_token"), errorText: body.error }) });
  }
  await requireBusiness();
  const ctx = (await connectContext())!;
  const jar = await cookies();
  const check = verifyState(jar.get(OAUTH_COOKIE)?.value, body.state, ctx);
  jar.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });

  if (!check.ok) return ok({ redirectTo: returnUrl(check.returnTo, await recordStateFailure(ctx, check.reason)) });
  if (body.error || !body.accessToken) return ok({ redirectTo: returnUrl(check.returnTo, await recordCancelled(ctx, body.error)) });

  const { outcome, username } = await finishWithToken(ctx, body.accessToken, body.longLivedToken);
  return ok({ redirectTo: returnUrl(check.returnTo, outcome, username ? { username } : undefined) });
});
