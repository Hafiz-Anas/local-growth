import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { COOKIES } from "@/config/site";
import { db } from "@/lib/db";
import { isFeatureEnabled, permissionsFromKeys, permissionsFromRows } from "@/lib/permissions";
import type { FeatureKey, Permissions, Session } from "@/types";

/** Server-side session accessors for server components, layouts and actions. Cached per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return null;
  return {
    userId: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    businessId: user.businessId,
    features: user.features,
  };
});

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (session.role !== "admin") redirect("/gallery");
  return session;
}

export interface ActiveClientContext {
  session: Session;
  /** Business whose data the user-facing screens show. */
  clientId: string;
  isPreview: boolean;
  /** Effective permissions for that business. */
  permissions: Permissions;
}

/**
 * The business the user-facing screens show: a user's own business (features
 * from the session), or — for an admin in preview mode — the previewed
 * business (features read from the database).
 */
export const getActiveClientContext = cache(async (): Promise<ActiveClientContext> => {
  const session = await requireSession();
  if (session.role === "user") {
    if (!session.businessId) redirect("/login");
    return { session, clientId: session.businessId, isPreview: false, permissions: permissionsFromKeys(session.features) };
  }

  const store = await cookies();
  const previewId = store.get(COOKIES.preview)?.value;
  if (!previewId) redirect("/admin");
  const business = await db.business.findUnique({
    where: { id: previewId },
    select: { id: true, permissions: { select: { featureKey: true, enabled: true } } },
  });
  if (!business) redirect("/admin");
  return { session, clientId: business.id, isPreview: true, permissions: permissionsFromRows(business.permissions) };
});

/** For pages of switchable features: responds with the not-found page when the feature is OFF. */
export async function requireFeature(key: FeatureKey): Promise<ActiveClientContext> {
  const context = await getActiveClientContext();
  if (!isFeatureEnabled(context.permissions, key)) notFound();
  return context;
}
