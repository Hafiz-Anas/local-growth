import "server-only";
import { db } from "@/lib/db";
import { getInstagramService } from "@/lib/services/instagram";
import { initials, toneFor } from "@/lib/utils";
import { uiPreferencesSchema } from "@/lib/validation/api";
import type { Client, PlanId, UiPreferences } from "@/types";
import { connectionStatusOf, getInstagramAccount, needsReconnect } from "./instagram-account";
import { scheduleAutoSync } from "./instagram-sync";

/** Signature colours of the seeded demo businesses (avatar fallback only). */
const DEMO_TONES: Record<string, Client["avatarTone"]> = { cl_mathanet: "roast", cl_cafe: "latte", cl_boutique: "rose" };

/**
 * The business as the user-facing shell shows it: stored details from the
 * database plus live profile numbers from InstagramService. Rendered by the
 * (user) layout; refreshed with `router.refresh()` after profile changes.
 */
export async function getClientView(businessId: string): Promise<Client | null> {
  const row = await db.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      nameAr: true,
      instagramHandle: true,
      category: true,
      categoryAr: true,
      location: true,
      locationAr: true,
      timezone: true,
      avatarUrl: true,
      plan: true,
      createdAt: true,
      users: { where: { role: "USER" }, select: { id: true, email: true }, orderBy: { createdAt: "asc" }, take: 1 },
      instagramConnection: { select: { status: true, tokenExpiresAt: true, connectedAt: true, provider: true, missingPermissions: true } },
      brandVoice: { select: { whatsappNumber: true } },
      activity: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!row) return null;

  const profile = await getInstagramService().getProfile(await getInstagramAccount(businessId));
  const conn = row.instagramConnection;
  const connection = connectionStatusOf(conn);
  // Meta data older than 6 hours is refreshed in the background after this render.
  await scheduleAutoSync(businessId);
  const instagramIssue: Client["instagramIssue"] = needsReconnect(conn)
    ? { reason: "reconnect", permissions: [] }
    : conn?.provider === "META" && conn.status === "CONNECTED" && conn.missingPermissions.length
      ? { reason: "permissions", permissions: conn.missingPermissions }
      : null;
  const owner = row.users[0];
  return {
    id: row.id,
    userId: owner?.id ?? "",
    businessName: row.name,
    businessNameAr: row.nameAr ?? row.name,
    handle: row.instagramHandle ?? row.name,
    instagramHandle: row.instagramHandle,
    category: row.category ?? "",
    categoryAr: row.categoryAr ?? row.category ?? "",
    location: row.location,
    locationAr: row.locationAr ?? row.location,
    timezone: row.timezone,
    email: owner?.email ?? "",
    plan: row.plan.toLowerCase() as PlanId,
    connection,
    connectedAt: connection === "disconnected" ? null : (row.instagramConnection?.connectedAt?.toISOString() ?? null),
    lastActivityAt: (row.activity[0]?.createdAt ?? row.createdAt).toISOString(),
    followers: profile.followers,
    following: profile.following,
    posts: profile.posts,
    bio: profile.bio,
    website: profile.website,
    whatsappNumber: row.brandVoice?.whatsappNumber ?? "",
    postsPublishedToday: profile.postsPublishedToday,
    avatarUrl: row.avatarUrl,
    avatarTone: DEMO_TONES[row.id] ?? toneFor(row.instagramHandle ?? row.id),
    avatarInitials: initials(row.name),
    instagramProvider: conn?.provider === "META" ? "meta" : "mock",
    instagramIssue,
  };
}

export async function getUiPreferences(userId: string): Promise<UiPreferences> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { uiPreferences: true } });
  return uiPreferencesSchema.catch(uiPreferencesSchema.parse({})).parse(user?.uiPreferences ?? {});
}
