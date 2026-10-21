import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { finishWithCode, OAUTH_COOKIE, OAUTH_COOKIE_PATH, recordCancelled, recordStateFailure, returnUrl, verifyState } from "@/lib/server/meta-connect";
import { connectContext } from "@/lib/server/meta-session";
import { finishInstagramSignup } from "@/lib/server/signup";
import { getLocale } from "@/lib/i18n/server";
import { isDevModeRefusal, isSignupState } from "@/lib/signup-flow";

/**
 * GET /api/integrations/instagram/callback — Meta's redirect_uri (registered in the Meta app).
 *
 *  ?code=…&state=…               → verify state, exchange the code server-side, connect.
 *  ?error=access_denied&state=…  → the user cancelled: back where they started, calm message.
 *  state "su.…"                  → a sign-up waiting for Instagram (lib/server/signup.ts): no one is
 *                                  signed in yet; the account is created here once Instagram connects.
 *                                  The demo Instagram screen (INSTAGRAM_PROVIDER=mock) sends ?mock_handle.
 *  nothing in the query          → token mode: the token is in the URL fragment, which never reaches
 *                                  the server. Serve a tiny page that posts it once to
 *                                  /api/integrations/instagram/token and clears the URL first.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const code = params.get("code");
  const error = params.get("error") ?? params.get("error_reason");
  const state = params.get("state");

  if (!code && !error && !state) return fragmentPage(await getLocale());

  if (isSignupState(state)) {
    const location = await finishInstagramSignup({
      state,
      code,
      mockHandle: params.get("mock_handle"),
      error,
      errorText: [params.get("error_code"), params.get("error_message"), params.get("error_description")].filter(Boolean).join(" ") || null,
    });
    const response = NextResponse.redirect(new URL(location, request.url));
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }

  const ctx = await connectContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", request.url));

  const jar = await cookies();
  const check = verifyState(jar.get(OAUTH_COOKIE)?.value, state, ctx);
  const done = (location: string) => {
    const response = NextResponse.redirect(new URL(location, request.url));
    response.cookies.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  };

  if (!check.ok) return done(returnUrl(check.returnTo, await recordStateFailure(ctx, check.reason)));
  if (error || !code) {
    // Development mode: Meta refuses people who aren't testers of the app.
    const detail = [params.get("error_code"), params.get("error_message"), params.get("error_description")].filter(Boolean).join(" ");
    if (isDevModeRefusal(detail)) return done(returnUrl(check.returnTo, await recordStateFailure(ctx, "not_tester")));
    return done(returnUrl(check.returnTo, await recordCancelled(ctx, params.get("error_reason") ?? error)));
  }

  const { outcome, username } = await finishWithCode(ctx, code);
  return done(returnUrl(check.returnTo, outcome, username ? { username } : undefined));
}

/** Token mode: read the fragment, clear it from the address bar and history, post it once. */
function fragmentPage(locale: string) {
  const ar = locale === "ar";
  const html = `<!doctype html>
<html lang="${ar ? "ar" : "en"}" dir="${ar ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${ar ? "جارٍ ربط إنستغرام…" : "Connecting Instagram…"}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px system-ui,sans-serif;background:#fff;color:#000}@media (prefers-color-scheme:dark){body{background:#000;color:#f5f5f5}}</style>
</head>
<body>
<p>${ar ? "جارٍ ربط إنستغرام…" : "Connecting Instagram…"}</p>
<script>
(function () {
  var h = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, "", location.pathname);
  var body = {
    state: h.get("state"),
    accessToken: h.get("access_token"),
    longLivedToken: h.get("long_lived_token"),
    error: h.get("error") || h.get("error_reason")
  };
  var fallback = (body.state || "").indexOf("su.") === 0 ? "/signup?instagram=error" : "/settings?instagram=error#instagram";
  fetch("/api/integrations/instagram/token", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then(function (r) { return r.json(); })
    .then(function (j) { location.replace(j && j.ok ? j.data.redirectTo : fallback); })
    .catch(function () { location.replace(fallback); });
})();
</script>
</body>
</html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
