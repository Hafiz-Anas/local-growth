import { NextResponse } from "next/server";
import { asReturnTo, beginLogin, OAUTH_COOKIE, returnUrl, stateCookieOptions } from "@/lib/server/meta-connect";
import { connectContext } from "@/lib/server/meta-session";
import { connectFlow } from "@/lib/services/meta/config";

/**
 * GET /api/integrations/instagram/start?returnTo=signup|onboarding|settings&rerequest=1
 * Browser navigation (not fetch): sets the CSRF state cookie and redirects to
 * Facebook Login for Business. `rerequest` asks again for declined permissions.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = asReturnTo(url.searchParams.get("returnTo"));
  const ctx = await connectContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", request.url));
  if (connectFlow() !== "meta") return NextResponse.redirect(new URL(returnUrl(returnTo, "unavailable"), request.url));

  const { url: dialog, cookie } = beginLogin(ctx, returnTo, url.searchParams.get("rerequest") === "1");
  const response = NextResponse.redirect(dialog);
  response.cookies.set(OAUTH_COOKIE, cookie, stateCookieOptions);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
