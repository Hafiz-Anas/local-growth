import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { HOME_BY_ROLE } from "@/config/navigation";
import { COOKIES } from "@/config/site";

/** Pages reachable while logged out. Logged-in users are sent to their home page instead. */
const PUBLIC_PATHS = new Set(["/login", "/signup", "/forgot-password", "/reset-password"]);
/** "Add account" (account switcher): a signed-in client may open these with ?add=1 to log in or sign up another login. */
const ADD_ACCOUNT_PATHS = new Set(["/login", "/signup"]);
/** Pages that work both logged in and logged out (the emailed verification link). */
const OPEN_PATHS = new Set(["/verify-email"]);

/**
 * Route protection (Next.js 16 renamed `middleware.ts` to `proxy.ts`).
 *  - logged out          → /login
 *  - user on /admin/*    → /dashboard
 *  - admin on user pages → /admin, unless previewing a client
 *  - logged in on a public page or / → role home (a client may open /login or /signup with ?add=1: "Add account")
 *
 * This is the first line of defence only: layouts, pages and server actions
 * check the session again, and feature-gated pages call notFound() on the server.
 * Users whose onboarding is in progress are sent to /onboarding by the (user) layout.
 */
export const proxy = auth((request) => {
  const { pathname } = request.nextUrl;
  const user = request.auth?.user;
  if (OPEN_PATHS.has(pathname)) return NextResponse.next();
  const isPublic = PUBLIC_PATHS.has(pathname);

  if (!user) {
    return isPublic ? NextResponse.next() : NextResponse.redirect(new URL("/login", request.url));
  }

  const home = HOME_BY_ROLE[user.role];
  if (user.role === "user" && ADD_ACCOUNT_PATHS.has(pathname) && request.nextUrl.searchParams.get("add") === "1") {
    return NextResponse.next();
  }
  if (isPublic || pathname === "/") {
    return NextResponse.redirect(new URL(home, request.url));
  }

  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");
  if (isAdminRoute && user.role !== "admin") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  if (!isAdminRoute && user.role === "admin" && !request.cookies.has(COOKIES.preview)) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  return NextResponse.next();
});

export const config = {
  // Everything except Next internals, API routes and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"],
};
