import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { checkSession, loadSessionClaims, type SessionClaims } from "@/lib/auth/claims";
import { DUMMY_HASH, verifyPassword } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { LOGIN_LIMIT, clientIp, getRateLimiter } from "@/lib/server/rate-limit";
import { loginSchema } from "@/lib/validation/auth";

/** Error codes surfaced to the login form (`LoginState.error`). */
export class InvalidCredentials extends CredentialsSignin {
  code = "invalid_credentials";
}
export class SuspendedAccount extends CredentialsSignin {
  code = "suspended";
}
export class TooManyAttempts extends CredentialsSignin {
  code = "rate_limited";
}

/**
 * Claims are reloaded as soon as the user row or the business's permissions
 * change (see `checkSession`); this is only a safety net.
 */
const CLAIMS_MAX_AGE_MS = 5 * 60 * 1000;
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function claimsToToken(claims: SessionClaims) {
  return {
    email: claims.email,
    name: claims.name,
    role: claims.role,
    businessId: claims.businessId,
    avatarUrl: claims.avatarUrl,
    features: claims.features,
    sessionVersion: claims.sessionVersion,
  };
}

export const { handlers, auth, signIn, signOut, unstable_update: updateSession } = NextAuth({
  // Self-hosted: trust the Host header (set AUTH_URL in production).
  trustHost: true,
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw, request) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) throw new InvalidCredentials();
        const { email, password } = parsed.data;

        // 5 failed attempts per 15 minutes per IP + email.
        const limiter = getRateLimiter();
        const limitKey = `${clientIp(request.headers)}:${email}`;
        if (await limiter.isLimited(LOGIN_LIMIT, limitKey)) throw new TooManyAttempts();

        const user = await db.user.findUnique({ where: { email }, select: { id: true, passwordHash: true, status: true } });
        // Always run bcrypt so unknown emails take as long as wrong passwords.
        const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !valid) {
          await limiter.hit(LOGIN_LIMIT, limitKey);
          throw new InvalidCredentials();
        }
        if (user.status === "SUSPENDED") throw new SuspendedAccount();

        await limiter.reset(LOGIN_LIMIT, limitKey);
        await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

        const claims = await loadSessionClaims(user.id);
        if (!claims) throw new InvalidCredentials();
        return {
          id: claims.userId,
          email: claims.email,
          name: claims.name,
          role: claims.role,
          businessId: claims.businessId,
          avatarUrl: claims.avatarUrl,
          features: claims.features,
          sessionVersion: claims.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        return {
          ...token,
          role: user.role,
          businessId: user.businessId ?? null,
          avatarUrl: user.avatarUrl ?? null,
          features: user.features ?? [],
          sessionVersion: user.sessionVersion ?? 0,
          refreshedAt: Date.now(),
        };
      }
      if (!token.sub) return null;

      // Every request: end the session if the user was deleted or suspended, or
      // the password changed since this token was issued; reload the claims when the
      // active Instagram account changed or the user no longer belongs to it.
      const refreshedAt = token.refreshedAt ?? 0;
      const check = await checkSession(token.sub, token.sessionVersion ?? 0, refreshedAt, token.businessId ?? null);
      if (check === "revoked") return null;

      // Reload claims when the user, the active account or its permissions changed.
      if (check === "stale" || trigger === "update" || Date.now() - refreshedAt > CLAIMS_MAX_AGE_MS) {
        const startedAt = Date.now();
        const claims = await loadSessionClaims(token.sub);
        if (!claims) return null;
        return { ...token, ...claimsToToken(claims), refreshedAt: startedAt };
      }
      return token;
    },
    session({ session, token }) {
      session.user = {
        ...session.user,
        id: token.sub!,
        email: token.email ?? "",
        name: token.name ?? "",
        role: token.role ?? "user",
        businessId: token.businessId ?? null,
        avatarUrl: token.avatarUrl ?? null,
        features: token.features ?? [],
      };
      return session;
    },
  },
  logger: {
    // Wrong passwords are expected; don't print them as server errors.
    error(error) {
      if (error instanceof CredentialsSignin) return;
      console.error(error);
    },
  },
});
