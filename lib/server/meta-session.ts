import "server-only";
import { getSession } from "@/lib/auth/server";
import { db } from "@/lib/db";
import type { ConnectContext } from "./meta-connect";

/**
 * The signed-in business user a Facebook Login belongs to, or null (logged out,
 * an admin, or a user without a business). For the browser-navigation routes
 * of the connect flow, which redirect instead of answering JSON errors.
 */
export async function connectContext(): Promise<ConnectContext | null> {
  const session = await getSession();
  if (!session || session.role !== "user" || !session.businessId) return null;
  const business = await db.business.findUnique({ where: { id: session.businessId }, select: { onboardingStatus: true } });
  if (!business) return null;
  return { businessId: session.businessId, userId: session.userId, onboarding: business.onboardingStatus === "IN_PROGRESS" };
}
