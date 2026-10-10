import type { DefaultSession } from "next-auth";
import type { FeatureKey, Role } from "@/types";

/** App-specific claims added to the Auth.js user, session and JWT. */
interface AppClaims {
  role: Role;
  businessId: string | null;
  avatarUrl: string | null;
  features: FeatureKey[];
}

declare module "next-auth" {
  interface User {
    role?: Role;
    businessId?: string | null;
    avatarUrl?: string | null;
    features?: FeatureKey[];
    sessionVersion?: number;
  }

  interface Session {
    user: AppClaims & { id: string; email: string; name: string } & Omit<DefaultSession["user"], "id" | "email" | "name">;
  }
}

declare module "@auth/core/jwt" {
  interface JWT extends Partial<AppClaims> {
    /** Epoch ms of the last database refresh of these claims. */
    refreshedAt?: number;
    /** Must match User.sessionVersion, otherwise the session is revoked. */
    sessionVersion?: number;
  }
}
